import express from "express";
import path from "path";
import { Crawler } from "../scripts/crawler";
import { ProfileIndexer } from "../scripts/profileIndexer";

const DATA_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../data");
const SOCIAL_GRAPH_FILE = path.join(DATA_DIR, "socialGraph.json");
const FUSE_INDEX_FILE = path.join(DATA_DIR, "profileIndex.json");
const DATA_FILE = path.join(DATA_DIR, "profileData.json");

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
  // Initialize crawler and indexer
  crawler = new Crawler();
  indexer = new ProfileIndexer();

  // Start both services
  crawler.initialize();
  indexer.initialize();

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

main().catch(console.error); 