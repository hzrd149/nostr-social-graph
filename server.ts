import express from "express";
import cors from "cors";
import { SocialGraph } from "./src";
import { Crawler } from "./scripts/crawler";
import { ProfileIndexer } from "./scripts/profileIndexer";
import { SOCIAL_GRAPH_ROOT, DATA_DIR, SOCIAL_GRAPH_FILE, RELAY_URLS } from "./src/constants";
import fs from "fs";
import NDK from "@nostr-dev-kit/ndk";
import WebSocket from "ws";

global.WebSocket = WebSocket as any;

const app = express();
app.use(cors());
app.use(express.json());

// Create a single social graph instance
let socialGraph: SocialGraph;

// Load or create social graph
if (fs.existsSync(SOCIAL_GRAPH_FILE)) {
  try {
    const socialGraphData = fs.readFileSync(SOCIAL_GRAPH_FILE, "utf-8");
    socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT, JSON.parse(socialGraphData));
    console.log("Loaded social graph of size", socialGraph.size());
  } catch (e) {
    console.error("Error deserializing social graph:", e);
    socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
  }
} else {
  socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
  console.log("Created new social graph");
}

// Create a single NDK instance
const ndk = new NDK({
  explicitRelayUrls: RELAY_URLS,
});

// Create crawler and profile indexer instances with the shared social graph and NDK
const crawler = new Crawler(socialGraph, ndk);
const profileIndexer = new ProfileIndexer(socialGraph, ndk);

// Initialize crawler and profile indexer
crawler.initialize();
profileIndexer.initialize();

// ... rest of the code ... 