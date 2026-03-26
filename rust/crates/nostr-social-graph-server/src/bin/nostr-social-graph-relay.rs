use nostr_social_graph_server::{RelayMirrorConfig, run_relay_mirror};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    if let Err(error) = run_relay_mirror(RelayMirrorConfig::from_env()).await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
