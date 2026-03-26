FROM rust:1-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY rust/Cargo.toml rust/Cargo.lock rust/
COPY rust/crates rust/crates

RUN cargo build --manifest-path rust/Cargo.toml -p nostr-social-graph-server --release

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/rust/target/release/nostr-social-graph-server /usr/local/bin/nostr-social-graph-server

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV RUST_LOG=info

EXPOSE 3000

CMD ["nostr-social-graph-server"]
