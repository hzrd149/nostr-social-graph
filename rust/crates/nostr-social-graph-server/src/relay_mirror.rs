use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use nostr_lmdb::NostrLMDB;
use nostr_sdk::prelude::{
    Client, ClientBuilder, Event, Filter, Kind, PublicKey, RelayPoolNotification, SyncOptions,
    Timestamp,
};
use nostr_social_graph::SocialGraph;
use tracing::{error, info, warn};

use crate::{
    DEFAULT_RELAY_URLS, DEFAULT_SOCIAL_GRAPH_ROOT, Result, ServerError, load_graph_read_only,
};

pub const ALLOWED_EVENT_KINDS: [u16; 3] = [0, 3, 10_000];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct AllowedAuthors {
    sorted_hex: BTreeSet<String>,
    parsed: HashSet<PublicKey>,
}

#[derive(Debug, Clone)]
pub struct RelayMirrorConfig {
    pub root: String,
    pub sync_relay_urls: Vec<String>,
    pub live_relay_urls: Vec<String>,
    pub graph_db_dir: PathBuf,
    pub legacy_graph_binary_path: Option<PathBuf>,
    pub graph_snapshot_url: Option<String>,
    pub state_dir: PathBuf,
    pub allowlist_path: PathBuf,
    pub local_relay_url: String,
    pub allowed_distance: Option<u32>,
    pub authors_per_filter: usize,
    pub sync_interval: Duration,
    pub negentropy_initial_timeout: Duration,
}

impl RelayMirrorConfig {
    pub fn from_env() -> Self {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let data_dir = std::env::var_os("DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| cwd.join("data"));
        let graph_db_dir = std::env::var_os("SOCIAL_GRAPH_DB_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| data_dir.join("socialGraph.heed"));
        let legacy_graph_binary_path = std::env::var_os("LEGACY_SOCIAL_GRAPH_BINARY_PATH")
            .map(PathBuf::from)
            .or_else(|| {
                let default = data_dir.join("socialGraph.large.bin");
                default.exists().then_some(default)
            });
        let graph_snapshot_url = std::env::var("GRAPH_RELAY_GRAPH_URL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let state_dir = std::env::var_os("GRAPH_RELAY_STATE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| data_dir.join("graph-relay"));
        let allowlist_path = std::env::var_os("GRAPH_RELAY_ALLOWLIST_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| state_dir.join("allowlist.txt"));
        let sync_relay_urls = resolve_sync_relay_urls(
            std::env::var("GRAPH_RELAY_SYNC_RELAY_URLS")
                .ok()
                .or_else(|| std::env::var("RELAY_URLS").ok()),
        );
        let live_relay_urls = resolve_live_relay_urls(
            std::env::var("GRAPH_RELAY_LIVE_RELAY_URLS").ok(),
            &sync_relay_urls,
        );

        Self {
            root: std::env::var("SOCIAL_GRAPH_ROOT")
                .unwrap_or_else(|_| DEFAULT_SOCIAL_GRAPH_ROOT.to_string()),
            sync_relay_urls,
            live_relay_urls,
            graph_db_dir,
            legacy_graph_binary_path,
            graph_snapshot_url,
            state_dir,
            allowlist_path,
            local_relay_url: std::env::var("GRAPH_RELAY_LOCAL_URL")
                .unwrap_or_else(|_| "ws://127.0.0.1:7777".to_string()),
            allowed_distance: parse_optional_distance(
                std::env::var("GRAPH_RELAY_DISTANCE")
                    .ok()
                    .or_else(|| std::env::var("SOCIAL_GRAPH_CRAWL_DISTANCE").ok())
                    .or_else(|| std::env::var("CRAWL_DISTANCE").ok()),
                Some(4),
            ),
            authors_per_filter: parse_env_usize("GRAPH_RELAY_AUTHORS_PER_FILTER", 256),
            sync_interval: Duration::from_millis(parse_env_u64(
                "GRAPH_RELAY_SYNC_INTERVAL_MS",
                300_000,
            )),
            negentropy_initial_timeout: Duration::from_millis(parse_env_u64(
                "GRAPH_RELAY_NEGENTROPY_TIMEOUT_MS",
                10_000,
            )),
        }
    }
}

pub fn allowed_pubkeys_from_graph(
    graph: &SocialGraph,
    max_distance: Option<u32>,
) -> BTreeSet<String> {
    graph
        .users_in_distance_order(max_distance)
        .into_iter()
        .collect()
}

pub fn render_allowlist(pubkeys: &BTreeSet<String>) -> String {
    let mut contents = String::new();
    for pubkey in pubkeys {
        contents.push_str(pubkey);
        contents.push('\n');
    }
    contents
}

pub fn event_is_allowed(event: &Event, allowed_pubkeys: &HashSet<PublicKey>) -> bool {
    ALLOWED_EVENT_KINDS.contains(&event.kind.as_u16()) && allowed_pubkeys.contains(&event.pubkey)
}

pub async fn run_relay_mirror(config: RelayMirrorConfig) -> Result<()> {
    fs::create_dir_all(&config.state_dir)?;
    if let Some(parent) = config.allowlist_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let upstream_db = NostrLMDB::open(config.state_dir.join("nostr-lmdb"))
        .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;
    let upstream = ClientBuilder::default().database(upstream_db).build();
    let relay_urls = config
        .sync_relay_urls
        .iter()
        .chain(config.live_relay_urls.iter())
        .cloned()
        .collect::<BTreeSet<_>>();
    for relay in relay_urls {
        upstream
            .add_read_relay(relay)
            .await
            .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;
    }
    upstream.connect().await;
    upstream.wait_for_connection(Duration::from_secs(5)).await;
    info!(
        "graph relay sync relays: {}",
        config.sync_relay_urls.join(", ")
    );
    info!(
        "graph relay live relays: {}",
        config.live_relay_urls.join(", ")
    );

    let local = Client::default();
    local
        .add_write_relay(&config.local_relay_url)
        .await
        .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;
    local.connect().await;
    local.wait_for_connection(Duration::from_secs(5)).await;

    let allowed = Arc::new(RwLock::new(AllowedAuthors::default()));
    refresh_allowed_authors(&config, &allowed).await?;
    subscribe_live_notifications(&upstream).await?;
    publish_snapshot(&upstream, &local, &config, &allowed).await?;

    let live_upstream = upstream.clone();
    let live_local = local.clone();
    let live_allowed = Arc::clone(&allowed);
    tokio::spawn(async move {
        if let Err(error) = notification_loop(live_upstream, live_local, live_allowed).await {
            error!("graph relay live notification loop failed: {error}");
        }
    });

    loop {
        refresh_allowed_authors(&config, &allowed).await?;
        sync_once(&upstream, &local, &config, &allowed).await?;
        tokio::time::sleep(config.sync_interval).await;
    }
}

async fn refresh_allowed_authors(
    config: &RelayMirrorConfig,
    allowed: &Arc<RwLock<AllowedAuthors>>,
) -> Result<()> {
    let graph = load_graph_snapshot(config).await?;
    let sorted_hex = allowed_pubkeys_from_graph(&graph, config.allowed_distance);
    let parsed = sorted_hex
        .iter()
        .filter_map(|pubkey| match pubkey.parse::<PublicKey>() {
            Ok(pubkey) => Some(pubkey),
            Err(error) => {
                warn!("skipping invalid graph pubkey {pubkey}: {error}");
                None
            }
        })
        .collect::<HashSet<_>>();
    let next = AllowedAuthors { sorted_hex, parsed };

    let mut guard = allowed.write().expect("allowed authors lock poisoned");
    if *guard == next && config.allowlist_path.exists() {
        return Ok(());
    }

    write_allowlist(&config.allowlist_path, &next.sorted_hex)?;
    info!(
        "updated graph relay allowlist: {} authors -> {}",
        next.sorted_hex.len(),
        config.allowlist_path.display()
    );
    *guard = next;
    Ok(())
}

async fn load_graph_snapshot(config: &RelayMirrorConfig) -> Result<SocialGraph> {
    if let Some(url) = config.graph_snapshot_url.as_deref() {
        match load_graph_from_url(&config.root, url).await {
            Ok(graph) => return Ok(graph),
            Err(error) => {
                warn!("failed to load graph relay snapshot from {url}: {error}");
            }
        }
    }

    load_graph_read_only(
        &config.root,
        &config.graph_db_dir,
        config.legacy_graph_binary_path.as_deref(),
    )
}

async fn load_graph_from_url(root: &str, url: &str) -> Result<SocialGraph> {
    let response = reqwest::get(url)
        .await
        .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;
    let response = response
        .error_for_status()
        .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;
    let binary = response
        .bytes()
        .await
        .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;
    SocialGraph::from_binary(root, &binary)
        .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))
}

async fn subscribe_live_notifications(client: &Client) -> Result<()> {
    let kinds = allowed_kinds();
    client
        .subscribe(
            Filter::new()
                .kinds(kinds)
                .since(Timestamp::from(unix_timestamp())),
            None,
        )
        .await
        .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;
    Ok(())
}

async fn notification_loop(
    upstream: Client,
    local: Client,
    allowed: Arc<RwLock<AllowedAuthors>>,
) -> Result<()> {
    let mut notifications = upstream.notifications();

    loop {
        match notifications.recv().await {
            Ok(RelayPoolNotification::Event { event, .. }) => {
                if is_allowed_event(&event, &allowed) {
                    publish_event(&local, &event).await?;
                }
            }
            Ok(RelayPoolNotification::Shutdown) => return Ok(()),
            Ok(RelayPoolNotification::Message { .. }) => {}
            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                warn!("graph relay notification loop skipped {skipped} events");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return Ok(()),
        }
    }
}

async fn sync_once(
    upstream: &Client,
    local: &Client,
    config: &RelayMirrorConfig,
    allowed: &Arc<RwLock<AllowedAuthors>>,
) -> Result<()> {
    let authors = {
        let guard = allowed.read().expect("allowed authors lock poisoned");
        guard.parsed.iter().copied().collect::<Vec<_>>()
    };
    if authors.is_empty() {
        warn!("graph relay allowlist is empty, skipping sync");
        return Ok(());
    }

    let kinds = allowed_kinds();
    let mut synced = 0usize;
    let mut forwarded = 0usize;
    let authors_per_filter = config.authors_per_filter.max(1);
    let total_chunks = authors.len().div_ceil(authors_per_filter);
    for (index, chunk) in authors.chunks(authors_per_filter).enumerate() {
        let filter = Filter::new().authors(chunk.to_vec()).kinds(kinds.clone());
        let output = upstream
            .sync_with(
                config.sync_relay_urls.iter().map(String::as_str),
                filter,
                &SyncOptions::new().initial_timeout(config.negentropy_initial_timeout),
            )
            .await
            .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;

        for (relay, failure) in &output.failed {
            warn!("graph relay sync failed for {relay}: {failure}");
        }

        synced += output.received.len();
        forwarded += publish_events_by_ids(upstream, local, &output.received, allowed).await?;
        let processed_chunks = index + 1;
        if processed_chunks == 1 || processed_chunks == total_chunks || processed_chunks % 25 == 0 {
            info!(
                "graph relay sync progress: chunks={processed_chunks}/{total_chunks} synced={synced} forwarded={forwarded}"
            );
        }
    }

    info!("graph relay sync complete: synced={synced} forwarded={forwarded}");
    Ok(())
}

async fn publish_snapshot(
    upstream: &Client,
    local: &Client,
    config: &RelayMirrorConfig,
    allowed: &Arc<RwLock<AllowedAuthors>>,
) -> Result<()> {
    let authors = {
        let guard = allowed.read().expect("allowed authors lock poisoned");
        guard.parsed.iter().copied().collect::<Vec<_>>()
    };
    if authors.is_empty() {
        return Ok(());
    }

    let kinds = allowed_kinds();
    let mut forwarded = 0usize;
    for chunk in authors.chunks(config.authors_per_filter.max(1)) {
        let events = upstream
            .database()
            .query(Filter::new().authors(chunk.to_vec()).kinds(kinds.clone()))
            .await
            .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;
        for event in events.into_iter() {
            if is_allowed_event(&event, allowed) {
                publish_event(local, &event).await?;
                forwarded += 1;
            }
        }
    }

    info!("graph relay startup republished {forwarded} stored events");
    Ok(())
}

async fn publish_events_by_ids(
    upstream: &Client,
    local: &Client,
    ids: &HashSet<nostr_sdk::prelude::EventId>,
    allowed: &Arc<RwLock<AllowedAuthors>>,
) -> Result<usize> {
    let mut forwarded = 0usize;
    for id in ids {
        let Some(event) = upstream
            .database()
            .event_by_id(id)
            .await
            .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?
        else {
            continue;
        };
        if is_allowed_event(&event, allowed) {
            publish_event(local, &event).await?;
            forwarded += 1;
        }
    }
    Ok(forwarded)
}

async fn publish_event(local: &Client, event: &Event) -> Result<()> {
    let output = local
        .send_event(event)
        .await
        .map_err(|error| ServerError::Io(std::io::Error::other(error.to_string())))?;
    for (relay, failure) in output.failed {
        warn!("graph relay publish failed for {relay}: {failure}");
    }
    Ok(())
}

fn is_allowed_event(event: &Event, allowed: &Arc<RwLock<AllowedAuthors>>) -> bool {
    let guard = allowed.read().expect("allowed authors lock poisoned");
    event_is_allowed(event, &guard.parsed)
}

fn write_allowlist(path: &Path, pubkeys: &BTreeSet<String>) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, render_allowlist(pubkeys))?;
    fs::rename(tmp_path, path)?;
    Ok(())
}

fn allowed_kinds() -> Vec<Kind> {
    ALLOWED_EVENT_KINDS
        .iter()
        .map(|kind| Kind::from(*kind))
        .collect()
}

fn parse_relay_urls(raw: Option<String>) -> Option<Vec<String>> {
    raw.map(|value| {
        value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>()
    })
    .filter(|urls| !urls.is_empty())
}

fn resolve_sync_relay_urls(raw: Option<String>) -> Vec<String> {
    parse_relay_urls(raw).unwrap_or_else(|| {
        DEFAULT_RELAY_URLS
            .iter()
            .map(|url| (*url).to_string())
            .collect()
    })
}

fn resolve_live_relay_urls(raw: Option<String>, sync_relay_urls: &[String]) -> Vec<String> {
    parse_relay_urls(raw).unwrap_or_else(|| sync_relay_urls.to_vec())
}

fn parse_env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

fn parse_env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
}

fn parse_optional_distance(raw: Option<String>, default: Option<u32>) -> Option<u32> {
    match raw {
        Some(value) => {
            let value = value.trim();
            if value.is_empty() || value.eq_ignore_ascii_case("none") {
                None
            } else {
                value.parse::<u32>().ok().or(default)
            }
        }
        None => default,
    }
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    use axum::Router;
    use axum::body::Body;
    use axum::http::{Response, StatusCode};
    use axum::routing::get;
    use nostr_social_graph::NostrEvent;
    use tempfile::TempDir;

    const ADAM: &str = "020f2d21ae09bf35fcdfb65decf1478b846f5f728ab30c5eaabcd6d081a81c3e";
    const FIATJAF: &str = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
    const BOB: &str = "4132aeeee5c7b3497d260c922758e804a9cf9c0933d3e333bfd15f7695db3852";

    #[tokio::test]
    async fn refresh_allowed_authors_can_load_graph_from_http_snapshot() {
        let graph = scenario_graph();
        let payload = graph.to_binary().unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route(
            "/social-graph",
            get(move || {
                let payload = payload.clone();
                async move {
                    Response::builder()
                        .status(StatusCode::OK)
                        .body(Body::from(payload))
                        .unwrap()
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let tempdir = TempDir::new().unwrap();
        let allowlist_path = tempdir.path().join("allowlist.txt");
        let allowed = Arc::new(RwLock::new(AllowedAuthors::default()));
        let config = RelayMirrorConfig {
            root: ADAM.to_string(),
            sync_relay_urls: Vec::new(),
            live_relay_urls: Vec::new(),
            graph_db_dir: tempdir.path().join("missing.heed"),
            legacy_graph_binary_path: None,
            graph_snapshot_url: Some(format!("http://{address}/social-graph")),
            state_dir: tempdir.path().join("state"),
            allowlist_path: allowlist_path.clone(),
            local_relay_url: "ws://127.0.0.1:7777".to_string(),
            allowed_distance: Some(1),
            authors_per_filter: 32,
            sync_interval: Duration::from_secs(60),
            negentropy_initial_timeout: Duration::from_secs(10),
        };

        refresh_allowed_authors(&config, &allowed).await.unwrap();

        let rendered = fs::read_to_string(allowlist_path).unwrap();
        assert_eq!(rendered, format!("{ADAM}\n{FIATJAF}\n{BOB}\n"));
        assert_eq!(allowed.read().unwrap().parsed.len(), 3);

        server.abort();
    }

    #[test]
    fn relay_url_resolution_defaults_sync_relays_to_project_defaults() {
        assert_eq!(
            resolve_sync_relay_urls(None),
            DEFAULT_RELAY_URLS
                .iter()
                .map(|url| (*url).to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn relay_url_resolution_defaults_live_relays_to_sync_relays() {
        let sync_relay_urls = resolve_sync_relay_urls(Some(
            "wss://relay-a.example,wss://relay-b.example".to_string(),
        ));

        assert_eq!(
            resolve_live_relay_urls(None, &sync_relay_urls),
            sync_relay_urls
        );
    }

    #[test]
    fn relay_url_resolution_prefers_explicit_live_relays() {
        let sync_relay_urls = resolve_sync_relay_urls(Some("wss://sync-only.example".to_string()));

        assert_eq!(
            resolve_live_relay_urls(
                Some("wss://live-a.example, wss://live-b.example".to_string()),
                &sync_relay_urls,
            ),
            vec![
                "wss://live-a.example".to_string(),
                "wss://live-b.example".to_string(),
            ]
        );
    }

    fn scenario_graph() -> SocialGraph {
        let mut graph = SocialGraph::new(ADAM);
        for event in [
            event(ADAM, 3, 1_000, vec![BOB, FIATJAF]),
            event(FIATJAF, 3, 1_100, vec![ADAM]),
        ] {
            graph.handle_event(&event, true, 1.0);
        }
        graph
    }

    fn event(pubkey: &str, kind: u32, created_at: u64, tagged: Vec<&str>) -> NostrEvent {
        NostrEvent {
            created_at,
            content: String::new(),
            tags: tagged
                .into_iter()
                .map(|pk| vec!["p".to_string(), pk.to_string()])
                .collect(),
            kind,
            pubkey: pubkey.to_string(),
            id: format!("{pubkey}:{kind}:{created_at}"),
            sig: "00".repeat(64),
        }
    }
}
