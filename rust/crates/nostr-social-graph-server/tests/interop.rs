use std::fs;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::Command;

use axum::Router;
use nostr_social_graph::{BinaryBudget, NostrEvent, SocialGraph};
use nostr_social_graph_server::{AppState, ProfileStore, build_router};
use serde::Deserialize;
use tempfile::TempDir;

const ADAM: &str = "020f2d21ae09bf35fcdfb65decf1478b846f5f728ab30c5eaabcd6d081a81c3e";
const FIATJAF: &str = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const SNOWDEN: &str = "84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240";
const SIRIUS: &str = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0";
const BOB: &str = "4132aeeee5c7b3497d260c922758e804a9cf9c0933d3e333bfd15f7695db3852";
const CHARLIE: &str = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct GraphSummary {
    root: String,
    binary_hex: Option<String>,
    distances: Vec<(String, u32)>,
    follows: Vec<(String, Vec<String>)>,
    followers: Vec<(String, Vec<String>)>,
    mutes: Vec<(String, Vec<String>)>,
    muters: Vec<(String, Vec<String>)>,
    follow_list_created_at: Vec<(String, Option<u64>)>,
    mute_list_created_at: Vec<(String, Option<u64>)>,
}

#[tokio::test(flavor = "multi_thread")]
async fn social_graph_endpoint_loads_through_typescript_fetch_path() {
    let tempdir = TempDir::new().unwrap();
    let app = build_test_app(tempdir.path());
    let (address, handle) = spawn_test_server(app).await;
    let url = format!(
        "http://127.0.0.1:{}/social-graph?format=binary",
        address.port()
    );

    let loaded = spawn_fixture(move || ts_fixture_fetch(ADAM, &url)).await;
    let expected = spawn_fixture(|| without_binary(ts_fixture_emit("default"))).await;

    handle.abort();
    let _ = handle.await;

    assert_eq!(loaded, expected);
}

#[tokio::test(flavor = "multi_thread")]
async fn social_graph_endpoint_applies_budget_queries_for_typescript_clients() {
    let tempdir = TempDir::new().unwrap();
    let app = build_test_app(tempdir.path());
    let (address, handle) = spawn_test_server(app).await;
    let budget = BinaryBudget {
        max_nodes: Some(3),
        max_edges: Some(2),
        max_distance: Some(1),
        max_edges_per_node: Some(1),
    };
    let url = format!(
        "http://127.0.0.1:{}/social-graph?maxNodes=3&maxEdges=2&maxDistance=1&maxEdgesPerNode=1&format=binary",
        address.port()
    );

    let loaded = spawn_fixture(move || ts_fixture_fetch(ADAM, &url)).await;
    let expected =
        spawn_fixture(move || without_binary(ts_fixture_emit_budgeted("default", budget))).await;

    handle.abort();
    let _ = handle.await;

    assert_eq!(loaded, expected);
}

fn build_test_app(data_dir: &Path) -> Router {
    let profile_data_path = data_dir.join("profileData.large.json");
    let profile_index_path = data_dir.join("profileIndex.json");
    fs::write(&profile_data_path, b"[]").unwrap();
    fs::write(&profile_index_path, br#"{"version":1}"#).unwrap();

    let profiles = ProfileStore::load_or_default(&profile_data_path).unwrap();
    build_router(AppState::for_tests(
        scenario_graph(),
        profiles,
        profile_index_path,
    ))
}

async fn spawn_test_server(app: Router) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (address, handle)
}

fn scenario_graph() -> SocialGraph {
    let mut graph = SocialGraph::new(ADAM);
    for event in [
        event(ADAM, 3, 1_000, vec![BOB, FIATJAF]),
        event(FIATJAF, 3, 1_100, vec![SNOWDEN]),
        event(BOB, 10_000, 1_200, vec![SNOWDEN]),
        event(ADAM, 10_000, 1_300, vec![CHARLIE]),
        event(ADAM, 10_000, 900, vec![SNOWDEN]),
        event(FIATJAF, 3, 1_400, vec![SIRIUS]),
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

fn ts_fixture_emit(name: &str) -> GraphSummary {
    run_fixture(["emit", name])
}

fn ts_fixture_emit_budgeted(name: &str, budget: BinaryBudget) -> GraphSummary {
    run_fixture_owned(vec![
        "emit-budget".to_string(),
        name.to_string(),
        budget_arg(budget.max_nodes),
        budget_arg(budget.max_edges),
        budget_arg(budget.max_distance.map(|value| value as usize)),
        budget_arg(budget.max_edges_per_node),
    ])
}

fn ts_fixture_fetch(root: &str, url: &str) -> GraphSummary {
    run_fixture(["fetch", root, url])
}

fn without_binary(mut summary: GraphSummary) -> GraphSummary {
    summary.binary_hex = None;
    summary
}

fn run_fixture<const N: usize>(args: [&str; N]) -> GraphSummary {
    let owned_args: Vec<String> = args.into_iter().map(ToOwned::to_owned).collect();
    run_fixture_owned(owned_args)
}

fn run_fixture_owned(args: Vec<String>) -> GraphSummary {
    let repo_root = repo_root();
    let output = Command::new("pnpm")
        .arg("--filter")
        .arg("nostr-social-graph")
        .arg("exec")
        .arg("tsx")
        .arg("scripts/rustInteropFixture.ts")
        .args(&args)
        .current_dir(&repo_root)
        .output()
        .expect("run ts fixture");
    assert!(
        output.status.success(),
        "fixture failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("fixture json")
}

fn budget_arg(value: Option<usize>) -> String {
    value.map(|number| number.to_string()).unwrap_or_default()
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap()
        .to_path_buf()
}

async fn spawn_fixture<F>(fixture: F) -> GraphSummary
where
    F: FnOnce() -> GraphSummary + Send + 'static,
{
    tokio::task::spawn_blocking(fixture).await.unwrap()
}
