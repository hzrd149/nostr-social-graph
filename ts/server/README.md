# Nostr Social Graph Server

A server that crawls and maintains the Nostr social graph and profile cache. It connects to Nostr relays using NDK and provides HTTP endpoints to access the data.

## Features

- Crawls social graph starting from a root identity
- Listens to all incoming kind 0 (profile) and kind 3/10000 (follow/mute) events
- Maintains an in-memory social graph and profile cache
- Periodically saves data to disk
- Provides HTTP endpoints to download the data
- Integrated crawler and profile indexer functionality

## HTTP Endpoints

- `/` - View social graph statistics (users, follows, mutes, and distribution by follow distance)
- `/social-graph` - Download the current social graph data
- `/profile-data` - Download the profile data
- `/profile-index` - Download the Fuse.js search index for profiles

All data endpoints include aggressive caching headers for optimal performance.

## Running the Server

### Development

```bash
cd server
yarn install
yarn dev
```

### Production

```bash
cd server
yarn install
yarn build
yarn start
```

### Docker

```bash
cd server
docker build -t nostr-social-graph-server .
docker run -p 3000:3000 nostr-social-graph-server
```

## Configuration

The server can be configured using environment variables:

- `PORT` - HTTP server port (default: 3000)
- `SOCIAL_GRAPH_ROOT` - Root identity to start crawling from (default: iris.to's pubkey)
- `SOCIAL_GRAPH_CRAWL_DISTANCE` - Max follow distance to crawl (default: 4, use `all` for unlimited)
- `PROFILE_CRAWL_DISTANCE` - Max follow distance to profile-index (default: unlimited, uses graph distance)
- `PROFILE_CRAWL_LIMIT` - Max number of profiles to index per run (useful for load tests)
- `CRAWL_BATCH_SIZE` - Number of authors per crawl batch (default: 500)
- `CRAWL_BATCH_IDLE_MS` - End batch after this idle period with no events (default: 2000)
- `CRAWL_BATCH_MAX_MS` - Hard stop for a batch regardless of events (default: 15000)
- `CRAWL_BATCH_CONCURRENCY` - Number of crawl batches in flight (default: 2)
- `CRAWL_BATCH_DELAY_MS` - Delay before launching the next batch (default: 0)
- `CRAWL_BATCH_EOSE_GRACE_MS` - Grace window after EOSE before closing (default: 250)
- `ALLOW_ORIGIN` - CORS allowed origin (default: "*")
- `PUBLISH_PROFILE_SEARCH_INDEX` - Publish the hashtree profile index to Blossom after crawl (default: false)
- `PROFILE_SEARCH_BLOSSOM_SERVERS` - Comma-separated Blossom servers for publish (default: iris upload/cdn/hashtree)
- `BLOSSOM_SECRET_KEY` - Hex secret key to sign Blossom uploads
- `BLOSSOM_NSEC` - Nostr nsec to sign Blossom uploads (alternative to `BLOSSOM_SECRET_KEY`)
- `PROFILE_SEARCH_PUBLISH_CONCURRENCY` - Parallel Blossom uploads (default: 4)

## Production crawl script (optional)

Run a capped crawl against production relays and print the search index nhash:

```bash
PROFILE_CRAWL_LIMIT=100000 SKIP_SOCIAL_GRAPH_CRAWL=true yarn crawl-prod
```

To publish the search index to Blossom after crawling, set `PUBLISH_PROFILE_SEARCH_INDEX=true` and provide a signing key.
If you want to crawl the social graph from scratch, set `FORCE_SOCIAL_GRAPH_CRAWL=true`.

## Publish profile search index (optional)

Publish an existing profile search index to Blossom and print the nhash:

```bash
BLOSSOM_NSEC=... yarn publish-profile-index
```

## Data Storage

The server stores data in the following files:

- `data/socialGraph.bin` - Binary serialized social graph
- `data/profileData.json` - Profile data
- `data/profileIndex.json` - Fuse.js search index for profiles 
