import NDK from "@nostr-dev-kit/ndk";
import fs from "fs";
import debounce from "lodash/debounce";
import { SocialGraph, NostrEvent, fromBinary, toBinary } from "../src";
import { SOCIAL_GRAPH_ROOT, DATA_DIR, SOCIAL_GRAPH_LARGE_BIN, RELAY_URLS, CRAWL_DISTANCE_DEFAULT } from "../src/constants";
import WebSocket from "ws";

console.log('Starting crawler...');

global.WebSocket = WebSocket as any;

export class Crawler {
  private socialGraph: SocialGraph;
  private ndk: NDK;
  private debouncedSave: any;
  private eventsSinceLastSave = 0;

  constructor(socialGraph: SocialGraph, ndk: NDK) {
    console.log('Creating crawler instance...');
    this.ndk = ndk;
    this.socialGraph = socialGraph;

    this.debouncedSave = debounce(async () => {
      const start = Date.now();
      console.log(`Starting social graph serialization … (${this.eventsSinceLastSave} new events)`);
      this.eventsSinceLastSave = 0;
      try {
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR);
        }
        const serialized = await toBinary(this.socialGraph);
        fs.writeFile(
          SOCIAL_GRAPH_LARGE_BIN,
          Buffer.from(serialized),
          (err) => {
            if (err) {
              console.error("failed to serialize SocialGraph", err);
            } else {
              const dur = Date.now() - start;
              console.log(`Saved social graph (size: ${this.socialGraph.size().users} users) in ${dur} ms`);
            }
          }
        );
      } catch (e) {
        console.error("failed to serialize SocialGraph", e);
        console.log("social graph size", this.socialGraph.size());
      }
    }, 30000);
  }

  async initialize() {
    console.log('Initializing crawler...');
    try {
      console.log('Connecting to NDK...');
      await this.ndk.connect(5000); // 5 second timeout
      console.log('ndk connected');
    } catch (e) {
      console.error('Failed to connect to NDK:', e);
      return;
    }

    const event = await this.ndk.fetchEvent({
      kinds: [3],
      authors: [SOCIAL_GRAPH_ROOT],
      limit: 1,
    });

    if (event) {
      this.processEvent(event as NostrEvent);
      await this.crawlSocialGraph(SOCIAL_GRAPH_ROOT);
      const removedCount = this.socialGraph.removeMutedNotFollowedUsers();
      console.log("Removing", removedCount, "muted users not followed by anyone");
      this.debouncedSave();
    } else {
      console.log('No root follow event found');
      this.socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
    }
  }

  private async crawlSocialGraph(myPubKey: string, upToDistance = CRAWL_DISTANCE_DEFAULT) {
    const allCrawledUsers = new Set<string>()
    allCrawledUsers.add(myPubKey)

    console.log(`Starting iterative crawl with distance limit: ${upToDistance}`);

    // Process each distance level sequentially, waiting for fetches to complete
    for (let currentDistance = 0; currentDistance < upToDistance; currentDistance++) {
      // Find all users at this distance that we haven't crawled yet
      const usersAtDistance = this.socialGraph.getUsersByFollowDistance(currentDistance)
      const toFetch = new Set<string>()

      for (const user of usersAtDistance) {
        if (!allCrawledUsers.has(user)) {
          toFetch.add(user)
          allCrawledUsers.add(user)
        }
      }

      if (toFetch.size === 0) {
        console.log(`Distance ${currentDistance}: no new users to fetch`);
        continue
      }

      console.log(`Distance ${currentDistance}: fetching ${toFetch.size} users' follow lists`);

      // Fetch all users at this distance and wait for completion
      await this.fetchUsersInBatches([...toFetch], currentDistance)

      // Recalculate distances after fetching new data
      console.log(`Distance ${currentDistance}: recalculating follow distances...`);
      await this.socialGraph.recalculateFollowDistances()
      this.debouncedSave()
    }

    console.log("All distances processed. Graph size:", this.socialGraph.size());
  }

  private fetchUsersInBatches(users: string[], distance: number): Promise<void> {
    return new Promise((resolve) => {
      const toFetch = new Set(users)
      let batchNumber = 0
      const totalBatches = Math.ceil(users.length / 500)

      const fetchBatch = (authors: string[]) => {
        console.log(`Distance ${distance} - Batch ${batchNumber}/${totalBatches}: fetching ${authors.length} users, ${toFetch.size} remaining`);
        const sub = this.ndk.subscribe(
          {
            kinds: [3, 10000],
            authors: authors,
          },
          { closeOnEose: true }
        );
        let eventsInBatch = 0;
        sub.on("event", (e) => {
          eventsInBatch++;
          this.processEvent(e as NostrEvent);
        });
        sub.on("eose", () => {
          console.log(`Batch ${batchNumber} finished – processed ${eventsInBatch} events`);
          this.debouncedSave();
        });
        setTimeout(() => {
          sub.stop();
          this.debouncedSave();
        }, 10000);
      }

      const processBatch = () => {
        const batch = [...toFetch].slice(0, 500)
        if (batch.length > 0) {
          batchNumber++;
          fetchBatch(batch)
          batch.forEach((author) => toFetch.delete(author))
          if (toFetch.size > 0) {
            setTimeout(processBatch, 5000)
          } else {
            console.log(`Distance ${distance}: All batches processed.`);
            // Wait a bit for final events to process before resolving
            setTimeout(resolve, 15000)
          }
        } else {
          resolve()
        }
      }

      processBatch()
    })
  }

  listen() {
    const sub = this.ndk.subscribe(
      {
        kinds: [3, 10000],
        since: Math.floor(Date.now() / 1000),
      },
    )
    sub.on("event", (e) => this.processEvent(e as NostrEvent));
  }

  private processEvent(event: NostrEvent) {
    this.socialGraph.handleEvent(event);
    this.eventsSinceLastSave++;
  }

  getSocialGraph() {
    return this.socialGraph;
  }
}

// Only run if called directly
if (process.argv.includes('--once')) {
  let socialGraph: SocialGraph;
  
  // Load or create social graph for standalone mode
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

  const crawler = new Crawler(socialGraph, new NDK({
    explicitRelayUrls: RELAY_URLS,
  }));
  crawler.initialize();
}
