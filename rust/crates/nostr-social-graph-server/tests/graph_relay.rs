use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use nostr_sdk::prelude::{Event, EventBuilder, Keys, Kind, Timestamp};
use nostr_social_graph::{NostrEvent, SocialGraph};
use nostr_social_graph_server::{allowed_pubkeys_from_graph, event_is_allowed, render_allowlist};
use serde_json::Value;
use tempfile::TempDir;

const ADAM: &str = "020f2d21ae09bf35fcdfb65decf1478b846f5f728ab30c5eaabcd6d081a81c3e";
const FIATJAF: &str = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const SNOWDEN: &str = "84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240";
const SIRIUS: &str = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0";
const BOB: &str = "4132aeeee5c7b3497d260c922758e804a9cf9c0933d3e333bfd15f7695db3852";
const CHARLIE: &str = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

#[test]
fn allowed_pubkeys_follow_graph_distance() {
    let graph = scenario_graph();

    let pubkeys = allowed_pubkeys_from_graph(&graph, Some(1));

    assert_eq!(
        pubkeys.into_iter().collect::<Vec<_>>(),
        vec![ADAM.to_string(), FIATJAF.to_string(), BOB.to_string()]
    );
}

#[test]
fn event_filter_only_accepts_allowed_kinds_and_pubkeys() {
    let keys = Keys::generate();
    let other = Keys::generate();
    let allowed = [keys.public_key()].into_iter().collect();

    let metadata = signed_event(&keys, 0);
    let text_note = signed_event(&keys, 1);
    let other_metadata = signed_event(&other, 0);

    assert!(event_is_allowed(&metadata, &allowed));
    assert!(!event_is_allowed(&text_note, &allowed));
    assert!(!event_is_allowed(&other_metadata, &allowed));
}

#[test]
fn render_allowlist_is_sorted_and_newline_terminated() {
    let rendered = render_allowlist(
        &[
            FIATJAF.to_string(),
            ADAM.to_string(),
            BOB.to_string(),
            ADAM.to_string(),
        ]
        .into_iter()
        .collect(),
    );

    assert_eq!(rendered, format!("{ADAM}\n{FIATJAF}\n{BOB}\n"));
}

#[test]
fn write_policy_plugin_enforces_read_only_allowlist() {
    let tempdir = TempDir::new().unwrap();
    let allowlist_path = tempdir.path().join("allowlist.txt");
    fs::write(
        &allowlist_path,
        render_allowlist(&[ADAM.to_string()].into_iter().collect()),
    )
    .unwrap();

    let mut child = Command::new("perl")
        .arg(plugin_path())
        .env("GRAPH_RELAY_ALLOWLIST_PATH", &allowlist_path)
        .env("GRAPH_RELAY_INGEST_IP", "172.30.0.3")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    let stdin = child.stdin.as_mut().unwrap();
    writeln!(
        stdin,
        "{}",
        plugin_request("allowed", ADAM, 0, "IP4", "172.30.0.3")
    )
    .unwrap();
    writeln!(
        stdin,
        "{}",
        plugin_request("readonly", ADAM, 0, "IP4", "203.0.113.9")
    )
    .unwrap();
    writeln!(
        stdin,
        "{}",
        plugin_request("outside-graph", FIATJAF, 0, "IP4", "172.30.0.3")
    )
    .unwrap();
    writeln!(
        stdin,
        "{}",
        plugin_request("wrong-kind", ADAM, 1, "IP4", "172.30.0.3")
    )
    .unwrap();
    drop(child.stdin.take());

    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());

    let responses = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();

    assert_eq!(responses[0]["action"], "accept");
    assert_eq!(responses[1]["action"], "reject");
    assert_eq!(responses[1]["msg"], "blocked: read-only mirror");
    assert_eq!(responses[2]["action"], "reject");
    assert_eq!(responses[2]["msg"], "blocked: author outside graph");
    assert_eq!(responses[3]["action"], "reject");
    assert_eq!(responses[3]["msg"], "blocked: unsupported kind");
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

fn signed_event(keys: &Keys, kind: u16) -> Event {
    EventBuilder::new(Kind::from(kind), "")
        .custom_created_at(Timestamp::from(1_700_000_000))
        .sign_with_keys(keys)
        .unwrap()
}

fn plugin_request(
    id: &str,
    pubkey: &str,
    kind: u32,
    source_type: &str,
    source_info: &str,
) -> String {
    serde_json::json!({
        "type": "new",
        "event": {
            "id": id,
            "pubkey": pubkey,
            "kind": kind,
        },
        "receivedAt": 1_700_000_000u64,
        "sourceType": source_type,
        "sourceInfo": source_info,
    })
    .to_string()
}

fn plugin_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap()
        .join("rust/scripts/graph_relay_write_policy.pl")
}
