# Nostr Social Graph

A TypeScript library for building and querying social graphs from Nostr follow events.

## Features

- Build social graphs from Nostr follow events
- Query followed users, followers, and follow distances
- Change social graph root user with efficient distance recalculation
- Low memory consumption with efficient serialization
- Pre-crawled datasets
- Server for maintaining and serving the up-to-date social graph, for quick initialization in web apps

## Usage

See [tests](./tests/SocialGraph.test.ts) for detailed usage examples.

## Demo & API

- **Demo**: [graph.iris.to](https://graph.iris.to) ([examples dir](./examples/))
- **API Endpoints**:
  - https://graph-api.iris.to/social-graph?maxBytes=2000000
  - https://graph-api.iris.to/profile-data?maxBytes=2000000&noPictures=true

## Core Implementation

The main logic is in [SocialGraph.ts](./src/SocialGraph.ts).

## Datasets

- **Follows**: 260 follow lists, 23K users (2.2 MB)
- **Large Social Graph**: 161K users, 5.3M follows (36.8 MB) - [Download](https://files.iris.to/large_social_graph.json)
- **Profiles**: Names and pictures for 19K users (2.8 MB)

Used in production at [iris.to](https://iris.to).

