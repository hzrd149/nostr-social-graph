import { EventStore } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

export const eventStore = new EventStore();
export const relayPool = new RelayPool();
export const relayUrls = [
  "wss://relay.snort.social",
  "wss://relay.damus.io",
  "wss://nostr.wine",
  "wss://soloco.nl",
  "wss://eden.nostr.land",
  "wss://temp.iris.to",
  "wss://vault.iris.to",
];

// Create event loader for the store so it can automatically load events and profiles
createEventLoaderForStore(eventStore, relayPool, {
  // Extra relays to always query
  extraRelays: relayUrls,
  // Extra relays to use for user profiles and mailboxes
  lookupRelays: relayUrls,
});
