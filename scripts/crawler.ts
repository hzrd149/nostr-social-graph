import NDK from "@nostr-dev-kit/ndk";
import fs from "fs";
import debounce from "lodash/debounce";
import { SocialGraph, NostrEvent, fromBinary, toBinary } from "../src";
import { SOCIAL_GRAPH_ROOT, DATA_DIR, SOCIAL_GRAPH_LARGE_BIN, RELAY_URLS, CRAWL_DISTANCE_DEFAULT } from "../src/constants";
import { parseCrawlDistance } from "./crawlDistance";
import WebSocket from "ws";

console.log('Starting crawler...');

global.WebSocket = WebSocket as any;

const DEFAULT_CRAWL_BATCH_SIZE = 500;
const DEFAULT_CRAWL_BATCH_IDLE_MS = 2000;
const DEFAULT_CRAWL_BATCH_MAX_MS = 15000;
const DEFAULT_CRAWL_BATCH_CONCURRENCY = 2;
const DEFAULT_CRAWL_BATCH_DELAY_MS = 0;
const DEFAULT_CRAWL_BATCH_EOSE_GRACE_MS = 250;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export class Crawler {
  private socialGraph: SocialGraph;
  private ndk: NDK;
  private debouncedSave: any;
  private eventsSinceLastSave = 0;
  private batchSize: number;
  private batchIdleMs: number;
  private batchMaxMs: number;
  private batchConcurrency: number;
  private batchDelayMs: number;
  private batchEoseGraceMs: number;

  private onCrawlComplete?: () => void;

  constructor(socialGraph: SocialGraph, ndk: NDK) {
    console.log('Creating crawler instance...');
    this.ndk = ndk;
    this.socialGraph = socialGraph;
    this.batchSize = parsePositiveInt(process.env.CRAWL_BATCH_SIZE, DEFAULT_CRAWL_BATCH_SIZE);
    this.batchIdleMs = parsePositiveInt(process.env.CRAWL_BATCH_IDLE_MS, DEFAULT_CRAWL_BATCH_IDLE_MS);
    this.batchMaxMs = parsePositiveInt(process.env.CRAWL_BATCH_MAX_MS, DEFAULT_CRAWL_BATCH_MAX_MS);
    this.batchConcurrency = Math.max(
      1,
      parsePositiveInt(process.env.CRAWL_BATCH_CONCURRENCY, DEFAULT_CRAWL_BATCH_CONCURRENCY)
    );
    this.batchDelayMs = parsePositiveInt(process.env.CRAWL_BATCH_DELAY_MS, DEFAULT_CRAWL_BATCH_DELAY_MS);
    this.batchEoseGraceMs = parsePositiveInt(process.env.CRAWL_BATCH_EOSE_GRACE_MS, DEFAULT_CRAWL_BATCH_EOSE_GRACE_MS);

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
      const crawlDistance = parseCrawlDistance(
        process.env.SOCIAL_GRAPH_CRAWL_DISTANCE ?? process.env.CRAWL_DISTANCE,
        CRAWL_DISTANCE_DEFAULT
      );
      await this.crawlSocialGraph(SOCIAL_GRAPH_ROOT, crawlDistance);
      const removedCount = this.socialGraph.removeMutedNotFollowedUsers();
      console.log("Removing", removedCount, "muted users not followed by anyone");
      this.debouncedSave();
    } else {
      console.log('No root follow event found');
      this.socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
    }
  }

  private async crawlSocialGraph(myPubKey: string, upToDistance?: number) {
    const allCrawledUsers = new Set<string>()
    allCrawledUsers.add(myPubKey)

    const distanceLabel = upToDistance === undefined ? 'all' : upToDistance;
    console.log(`Starting iterative crawl with distance limit: ${distanceLabel}`);

    // Process each distance level sequentially, waiting for fetches to complete
    for (let currentDistance = 0; currentDistance < (upToDistance ?? Number.POSITIVE_INFINITY); currentDistance++) {
      if (upToDistance === undefined) {
        const sizeByDistance = this.socialGraph.size().sizeByDistance;
        const distances = Object.keys(sizeByDistance).map(Number);
        const maxKnownDistance = distances.length ? Math.max(...distances) : 0;
        if (currentDistance > maxKnownDistance) {
          break;
        }
      }

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

    // Trigger callback when crawl completes
    if (this.onCrawlComplete) {
      console.log("Triggering post-crawl callback...");
      this.onCrawlComplete();
    }
  }

  setOnCrawlComplete(callback: () => void) {
    this.onCrawlComplete = callback;
  }

  private fetchUsersInBatches(users: string[], distance: number): Promise<void> {
    if (users.length === 0) {
      return Promise.resolve();
    }

    const totalBatches = Math.ceil(users.length / this.batchSize);
    let nextBatchIndex = 0;
    let inFlight = 0;
    let resolved = false;

    return new Promise((resolve) => {
      const finishIfDone = () => {
        if (!resolved && nextBatchIndex >= totalBatches && inFlight === 0) {
          resolved = true;
          console.log(`Distance ${distance}: All batches processed.`);
          resolve();
        }
      };

      const scheduleNext = () => {
        setTimeout(launchNext, this.batchDelayMs);
      };

      const launchNext = () => {
        while (inFlight < this.batchConcurrency && nextBatchIndex < totalBatches) {
          const batchStart = nextBatchIndex * this.batchSize;
          const batch = users.slice(batchStart, batchStart + this.batchSize);
          const batchNumber = nextBatchIndex + 1;
          nextBatchIndex++;
          inFlight++;

          const remaining = Math.max(users.length - nextBatchIndex * this.batchSize, 0);
          console.log(
            `Distance ${distance} - Batch ${batchNumber}/${totalBatches}: fetching ${batch.length} users, ${remaining} remaining`
          );

          this.fetchBatch(batch, distance, batchNumber, totalBatches)
            .catch((error) => {
              console.error(`Batch ${batchNumber} failed:`, error);
            })
            .finally(() => {
              inFlight--;
              finishIfDone();
              if (nextBatchIndex < totalBatches) {
                scheduleNext();
              }
            });
        }

        finishIfDone();
      };

      launchNext();
    });
  }

  private fetchBatch(
    authors: string[],
    distance: number,
    batchNumber: number,
    totalBatches: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const sub = this.ndk.subscribe(
        {
          kinds: [3, 10000],
          authors: authors,
        },
        { closeOnEose: true }
      );

      let eventsInBatch = 0;
      let finished = false;
      let idleTimer: NodeJS.Timeout | null = null;
      let maxTimer: NodeJS.Timeout | null = null;
      let eoseReceived = false;

      const finish = (reason: string) => {
        if (finished) return;
        finished = true;
        if (idleTimer) clearTimeout(idleTimer);
        if (maxTimer) clearTimeout(maxTimer);
        sub.stop();
        console.log(`Batch ${batchNumber}/${totalBatches} finished (${reason}) – processed ${eventsInBatch} events`);
        this.debouncedSave();
        resolve();
      };

      const scheduleIdle = (delayMs: number) => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish(eoseReceived ? 'eose' : 'idle'), delayMs);
      };

      scheduleIdle(this.batchIdleMs);
      if (this.batchMaxMs > 0) {
        maxTimer = setTimeout(() => finish('max'), this.batchMaxMs);
      }

      sub.on("event", (e) => {
        eventsInBatch++;
        this.processEvent(e as NostrEvent);
        scheduleIdle(this.batchIdleMs);
      });

      sub.on("eose", () => {
        eoseReceived = true;
        const graceMs = Math.min(this.batchIdleMs, this.batchEoseGraceMs);
        scheduleIdle(graceMs);
      });
    });
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

  async flush(): Promise<void> {
    if (typeof this.debouncedSave?.flush === 'function') {
      this.debouncedSave.flush();
    }
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
