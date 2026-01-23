[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/mmalmi/nostr-social-graph)

# Nostr Social Graph

A TypeScript library for building and querying social graphs from Nostr follow events.

## Features

- Build social graphs from Nostr follow events
- Query followed users, followers, and follow distances
- Change social graph root user with efficient distance recalculation
- Low memory consumption
- Efficient binary serialization (55% smaller than JSON)
- Pre-crawled datasets
- Server for maintaining and serving the up-to-date social graph, for quick initialization in web apps

## Usage

See [tests](./tests/SocialGraph.test.ts) for detailed usage examples.

## Demo & API

- **Demo**: [graph.iris.to](https://graph.iris.to) ([examples dir](./examples/))
- **Documentation**: [mmalmi.github.io/nostr-social-graph/docs](https://mmalmi.github.io/nostr-social-graph/docs/)
- **API Endpoints**:
  - https://graph-api.iris.to/social-graph?maxBytes=2000000
  - https://graph-api.iris.to/profile-data?maxBytes=2000000&noPictures=true
- Used in production at [iris.to](https://iris.to).

To point the examples search at a hashtree index, set `VITE_PROFILE_SEARCH_INDEX=nhash1qqsgm4ex4d4dxgz39hj6q7t7ax7u4k57gp2zkjuxtfga7wpw6dy6xpg9yqu6y09zecw9hzettkaulu928dt58ndt0h2exw6qg5kxyrprucz0cukym2c` (and optionally `VITE_BLOSSOM_SERVERS=url1,url2`).
Latest published profile search index (2025-01-23): `nhash1qqsgm4ex4d4dxgz39hj6q7t7ax7u4k57gp2zkjuxtfga7wpw6dy6xpg9yqu6y09zecw9hzettkaulu928dt58ndt0h2exw6qg5kxyrprucz0cukym2c`.
To publish the profile search index to Blossom, run `BLOSSOM_NSEC=... yarn publish-profile-index`.

## Core Implementation

The main logic is in [SocialGraph.ts](./src/SocialGraph.ts).
