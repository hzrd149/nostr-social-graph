# Nostr Social Graph Rust

This workspace contains the Rust implementation of the Nostr social graph.

Crates:

- [`crates/nostr-social-graph`](./crates/nostr-social-graph): in-memory core graph, binary format, and shared `SocialGraphBackend` trait
- [`crates/nostr-social-graph-heed`](./crates/nostr-social-graph-heed): optional LMDB/`heed` backend implementing the same runtime trait

Common commands:

- `cargo test --manifest-path rust/Cargo.toml`
- `cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings`
- `cargo fmt --manifest-path rust/Cargo.toml --all`

For repo-wide context and the TypeScript package, see the [root README](../README.md).
