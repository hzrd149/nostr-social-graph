use nostr_social_graph_server::{ServerConfig, run};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    if let Err(error) = run(ServerConfig::from_env()).await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
