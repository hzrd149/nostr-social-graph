use std::fs;
use std::path::PathBuf;
use std::process::Command;

use nostr_social_graph_server::ProfileStore;
use serde_json::Value;
use tempfile::TempDir;

const ALICE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CAROL: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

#[test]
fn loading_profiles_preserves_snapshot_order() {
    let tempdir = TempDir::new().unwrap();
    let profile_data_path = tempdir.path().join("profileData.large.json");
    let rows = vec![
        vec![CAROL.to_string(), "Carol Example".to_string()],
        vec![
            ALICE.to_string(),
            "Alice Example".to_string(),
            "alice".to_string(),
        ],
        vec![BOB.to_string(), "Bob Example".to_string()],
    ];
    fs::write(&profile_data_path, serde_json::to_vec(&rows).unwrap()).unwrap();

    let profiles = ProfileStore::load_or_default(&profile_data_path).unwrap();

    assert_eq!(profiles.snapshot(None, false), rows);
}

#[test]
fn profile_index_matches_fuse_serialization_for_snapshot_rows() {
    let tempdir = TempDir::new().unwrap();
    let profile_data_path = tempdir.path().join("profileData.large.json");
    let profile_index_path = tempdir.path().join("profileIndex.json");
    let rows = vec![
        vec![CAROL.to_string(), "Carol Example".to_string()],
        vec![
            ALICE.to_string(),
            "Alice Example".to_string(),
            "alice".to_string(),
        ],
        vec![BOB.to_string(), "Bob Example".to_string()],
    ];
    fs::write(&profile_data_path, serde_json::to_vec(&rows).unwrap()).unwrap();

    let profiles = ProfileStore::load_or_default(&profile_data_path).unwrap();
    profiles.write_profile_index(&profile_index_path).unwrap();

    let actual: Value = serde_json::from_slice(&fs::read(&profile_index_path).unwrap()).unwrap();
    let expected = node_fuse_index_json(&rows);

    assert_eq!(actual, expected);
}

fn node_fuse_index_json(rows: &[Vec<String>]) -> Value {
    let repo_root = repo_root();
    let script = r#"
const Fuse = require('fuse.js');
const rows = JSON.parse(process.argv[1]);
const docs = rows.map((row) => ({
  pubKey: row[0],
  name: row[1],
  nip05: row[2] || undefined,
}));
const fuse = new Fuse(docs, { keys: ['name', 'pubKey', 'nip05'] });
process.stdout.write(JSON.stringify(fuse.getIndex().toJSON()));
"#;

    let output = Command::new("pnpm")
        .arg("--filter")
        .arg("nostr-social-graph")
        .arg("exec")
        .arg("node")
        .arg("-e")
        .arg(script)
        .arg(serde_json::to_string(rows).unwrap())
        .current_dir(&repo_root)
        .output()
        .expect("run node fuse fixture");

    assert!(
        output.status.success(),
        "node fuse fixture failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    serde_json::from_slice(&output.stdout).expect("parse node fuse index")
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap()
        .to_path_buf()
}
