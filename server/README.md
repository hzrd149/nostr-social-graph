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
- `ALLOW_ORIGIN` - CORS allowed origin (default: "*")

## Data Storage

The server stores data in the following files:

- `data/socialGraph.json` - Serialized social graph
- `data/profileData.json` - Profile data
- `data/profileIndex.json` - Fuse.js search index for profiles 