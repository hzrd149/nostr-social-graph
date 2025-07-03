import express from "express";
import { Crawler } from "../scripts/crawler";
import { ProfileIndexer } from "../scripts/profileIndexer";
import { SocialGraph } from "../src";
import { SOCIAL_GRAPH_ROOT, SOCIAL_GRAPH_FILE, FUSE_INDEX_FILE, RELAY_URLS } from "../src/constants";
import fs from "fs";
import NDK from "@nostr-dev-kit/ndk";
import WebSocket from "ws";
import { nip19 } from "nostr-tools";

global.WebSocket = WebSocket as any;

// Initialize crawler and indexer
let crawler: Crawler;
let indexer: ProfileIndexer;
let socialGraph: SocialGraph;

// HTTP server
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  const stats = socialGraph.size();
  const rootNpub = nip19.npubEncode(SOCIAL_GRAPH_ROOT);
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Nostr Social Graph Stats</title>
        <style>
          body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .stats { background: #f5f5f5; padding: 20px; border-radius: 8px; }
          .stats h2 { margin-top: 0; }
          .stats p { margin: 10px 0; }
          .distance-stats { margin-top: 20px; }
          .distance-stats h3 { margin-bottom: 10px; }
          .distance-stats table { width: 100%; border-collapse: collapse; }
          .distance-stats th, .distance-stats td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
          .distance-stats th { background: #eee; }
          .stats a { color: #0066cc; text-decoration: none; }
          .stats a:hover { text-decoration: underline; }
          .downloads { margin-top: 20px; background: #f5f5f5; padding: 20px; border-radius: 8px; }
          .downloads h3 { margin-top: 0; }
          .downloads ul { list-style: none; padding: 0; margin: 0; }
          .downloads li { margin: 10px 0; }
          .downloads a { color: #0066cc; text-decoration: none; }
          .downloads a:hover { text-decoration: underline; }
          .profile-stats { margin-top: 20px; background: #f5f5f5; padding: 20px; border-radius: 8px; }
          .profile-stats h3 { margin-top: 0; }
          .profile-stats p { margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="stats">
          <h2>Social Graph Statistics</h2>
          <p>Graph root: <a href="https://iris.to/${rootNpub}" target="_blank">${rootNpub}</a></p>
          <p>Total users: ${stats.users}</p>
          <p>Total follows: ${stats.follows}</p>
          <p>Total mutes: ${stats.mutes}</p>
          
          <div class="distance-stats">
            <h3>Users by Follow Distance</h3>
            <table>
              <thead>
                <tr>
                  <th>Distance</th>
                  <th>Users</th>
                </tr>
              </thead>
              <tbody>
                ${Object.entries(stats.sizeByDistance)
                  .map(([distance, count]) => `
                    <tr>
                      <td>${distance}</td>
                      <td>${count}</td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="profile-stats">
          <h3>Profile Data Statistics</h3>
          <p>Total indexed profiles: ${indexer.getData().length}</p>
        </div>
        <div class="downloads">
          <h3>Download Data</h3>
          <ul>
            <li><a href="/social-graph">Download Social Graph (JSON)</a></li>
            <li><a href="/social-graph?format=binary">Download Social Graph (Binary)</a></li>
            <li><a href="/profile-data">Download Profile Data</a></li>
            <li><a href="/profile-index">Download Profile Index</a></li>
          </ul>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

app.get("/social-graph", async (req, res) => {
  const maxBytes = req.query.maxBytes ? parseInt(req.query.maxBytes as string) : undefined;
  const format = req.query.format as string;
  
  if (format === 'binary') {
    // Output binary format
    const binaryData = await socialGraph.toBinary();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="social-graph.bin"');
    res.setHeader('Cache-Control', 'public, max-age=31536000, stale-while-revalidate=86400');
    res.send(Buffer.from(binaryData));
  } else {
    // Output JSON format (default)
    const serialized = socialGraph.serialize(maxBytes);
    res.setHeader('Cache-Control', 'public, max-age=31536000, stale-while-revalidate=86400');
    res.json(serialized);
  }
});

app.get("/profile-data", (req, res) => {
  const maxBytes = req.query.maxBytes ? parseInt(req.query.maxBytes as string) : undefined;
  const noPictures = req.query.noPictures === 'true';
  const data = indexer.getData(maxBytes, noPictures);
  
  res.setHeader('Cache-Control', 'public, max-age=31536000, stale-while-revalidate=86400');
  res.json(data);
});

app.get("/profile-index", (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, stale-while-revalidate=86400');
  res.sendFile(FUSE_INDEX_FILE);
});

// Main function
async function main() {
  // Create a single social graph instance
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

  crawler.listen();
  indexer.listen();

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

main().catch(console.error); 