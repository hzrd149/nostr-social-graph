import path from "path";

export const SOCIAL_GRAPH_ROOT = "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0";
export const MAX_SOCIAL_GRAPH_SERIALIZE_SIZE = 10 * 1024 * 1024;

// Data directory and file paths
export const DATA_DIR = path.resolve(process.cwd(), "data");
export const SOCIAL_GRAPH_FILE = path.join(DATA_DIR, "socialGraph.json");
export const FUSE_INDEX_FILE = path.join(DATA_DIR, "profileIndex.json");
export const DATA_FILE = path.join(DATA_DIR, "profileData.json");

// Relay URLs
export const RELAY_URLS = [
  "wss://relay.snort.social",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://soloco.nl",
  "wss://eden.nostr.land"
]; 