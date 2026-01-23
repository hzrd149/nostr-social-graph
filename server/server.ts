import express from "express";
import { Crawler } from "../scripts/crawler";
import { ProfileIndexer } from "../scripts/profileIndexer";
import { SocialGraph } from "../src";
import { SOCIAL_GRAPH_ROOT, SOCIAL_GRAPH_LARGE_BIN, FUSE_INDEX_FILE, RELAY_URLS } from "../src/constants";
import fs from "fs";
import NDK from "@nostr-dev-kit/ndk";
import WebSocket from "ws";
import { nip19 } from "nostr-tools";
import { fromBinary } from "../src";

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
            <li><a href="/social-graph">Download Social Graph (Binary)</a></li>
            <li><a href="/social-graph?maxNodes=10000&maxEdges=50000">Download Social Graph (Binary, Limited)</a></li>
            <li><a href="/social-graph?maxDistance=2">Download Social Graph (Binary, Distance ≤ 2)</a></li>
            <li><a href="/social-graph?maxDistance=2&maxEdges=20000">Download Social Graph (Binary, Distance ≤ 2, Limited Edges)</a></li>
            <li><a href="/social-graph?maxEdgesPerNode=100">Download Social Graph (Binary, ≤100 edges per user)</a></li>
            <li><a href="/social-graph?maxDistance=2&maxEdgesPerNode=50">Download Social Graph (Binary, Distance ≤ 2, ≤50 edges per user)</a></li>
            <li><a href="/profile-data">Download Profile Data</a></li>
            <li><a href="/profile-index">Download Profile Index</a></li>
          </ul>
          <p><small>
            You can customize the download size using query parameters:<br/>
            <code>?maxNodes=N</code> - Limit to N unique users<br/>
            <code>?maxEdges=N</code> - Limit to N follow/mute relationships<br/>
            <code>?maxDistance=N</code> - Include only users within N follow hops from root<br/>
            <code>?maxEdgesPerNode=N</code> - Limit each user to N follow/mute relationships<br/>
            Parameters can be combined: <code>?maxDistance=2&maxEdgesPerNode=100</code>
          </small></p>
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

app.get("/social-graph", async (req, res) => {
  const maxNodes = req.query.maxNodes ? parseInt(req.query.maxNodes as string) : undefined;
  const maxEdges = req.query.maxEdges ? parseInt(req.query.maxEdges as string) : undefined;
  const maxDistance = req.query.maxDistance ? parseInt(req.query.maxDistance as string) : undefined;
  const maxEdgesPerNode = req.query.maxEdgesPerNode ? parseInt(req.query.maxEdgesPerNode as string) : undefined;

  //socialGraph.removeMutedNotFollowedUsers()
  
  // Output binary format as a stream to avoid large memory usage
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="social-graph.bin"');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');

  try {
    for await (const chunk of socialGraph.toBinaryChunks(maxNodes, maxEdges, maxDistance, maxEdgesPerNode)) {
      // Node's res.write can accept Uint8Array directly, but Buffer is safer across versions.
      res.write(Buffer.from(chunk));
    }
  } catch (err) {
    console.error('Error streaming social graph binary:', err);
    res.status(500).end('Error generating social graph binary');
    return;
  }

  res.end();
});

app.get("/profile-data", (req, res) => {
  const maxBytes = req.query.maxBytes ? parseInt(req.query.maxBytes as string) : undefined;
  const noPictures = req.query.noPictures === 'true';
  const data = indexer.getData(maxBytes, noPictures);
  
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  res.json(data);
});

app.get("/profile-index", (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
  res.sendFile(FUSE_INDEX_FILE);
});

// Main function
async function main() {
  // Create a single social graph instance
  if (fs.existsSync(SOCIAL_GRAPH_LARGE_BIN)) {
    try {
      const socialGraphData = fs.readFileSync(SOCIAL_GRAPH_LARGE_BIN);
      socialGraph = await fromBinary(SOCIAL_GRAPH_ROOT, socialGraphData);
      console.log("Loaded social graph of size", socialGraph.size());
    } catch (e) {
      console.error("Error deserializing social graph:", e);
      socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
    }
  } else {
    socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
    console.log("Created new social graph");
  }
  await socialGraph.recalculateFollowDistances();

  // Create a single NDK instance
  const ndk = new NDK({
    explicitRelayUrls: RELAY_URLS,
  });

  // Initialize crawler and indexer with shared instances
  crawler = new Crawler(socialGraph, ndk);
  indexer = new ProfileIndexer(socialGraph, ndk);

  // Trigger profile re-indexing when crawl completes
  crawler.setOnCrawlComplete(() => {
    console.log("Crawl completed, triggering profile re-indexing...");
    indexer.reindex();
  });

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
