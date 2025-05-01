import express from "express";
import path from "path";
import { Crawler } from "../scripts/crawler";
import { ProfileIndexer } from "../scripts/profileIndexer";
import { SocialGraph } from "../src";
import { SOCIAL_GRAPH_ROOT, DATA_DIR, SOCIAL_GRAPH_FILE, FUSE_INDEX_FILE, DATA_FILE, RELAY_URLS } from "../src/constants";
import fs from "fs";
import NDK from "@nostr-dev-kit/ndk";
import WebSocket from "ws";

global.WebSocket = WebSocket as any;

// Initialize crawler and indexer
let crawler: Crawler;
let indexer: ProfileIndexer;

// HTTP server
const app = express();
const port = process.env.PORT || 3000;

// Add CORS headers
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.header("Access-Control-Allow-Methods", "GET");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get("/social-graph", (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, stale-while-revalidate=86400');
  res.sendFile(SOCIAL_GRAPH_FILE);
});

app.get("/profile-data", (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, stale-while-revalidate=86400');
  res.sendFile(DATA_FILE);
});

app.get("/profile-index", (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, stale-while-revalidate=86400');
  res.sendFile(FUSE_INDEX_FILE);
});

// Main function
async function main() {
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

  // Initialize crawler and indexer with shared instances
  crawler = new Crawler(socialGraph, ndk);
  indexer = new ProfileIndexer(socialGraph, ndk);

  // Start both services
  crawler.initialize();
  indexer.initialize();

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

main().catch(console.error); 