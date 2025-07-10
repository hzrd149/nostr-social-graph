import NDK from "@nostr-dev-kit/ndk";
import fs from "fs";
import throttle from "lodash/throttle";
import { SocialGraph, NostrEvent } from "../src";
import { SOCIAL_GRAPH_ROOT, DATA_DIR, SOCIAL_GRAPH_FILE, RELAY_URLS, CRAWL_DISTANCE_DEFAULT } from "../src/constants";
import WebSocket from "ws";

console.log('Starting crawler...');

global.WebSocket = WebSocket as any;

export class Crawler {
  private socialGraph: SocialGraph;
  private ndk: NDK;
  private throttledSave: any;

  constructor(socialGraph: SocialGraph, ndk: NDK) {
    console.log('Creating crawler instance...');
    this.ndk = ndk;
    this.socialGraph = socialGraph;

    this.throttledSave = throttle(async () => {
      try {
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR);
        }
        const serialized = await this.socialGraph.serialize();
        fs.writeFileSync(SOCIAL_GRAPH_FILE, JSON.stringify(serialized));
        console.log("Saved social graph of size", this.socialGraph.size());
      } catch (e) {
        console.error("failed to serialize SocialGraph", e);
        console.log("social graph size", this.socialGraph.size());
      }
    }, 30000); // 30 seconds throttle
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
      this.crawlSocialGraph(SOCIAL_GRAPH_ROOT);
      const removedCount = this.socialGraph.removeMutedNotFollowedUsers();
      console.log("Removing", removedCount, "muted users not followed by anyone");
      this.throttledSave();
    } else {
      console.log('No root follow event found');
      this.socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
    }
  }

  private crawlSocialGraph(myPubKey: string, upToDistance = CRAWL_DISTANCE_DEFAULT) {
    const toFetch = new Set<string>()
    const crawledUsers = new Set<string>()

    console.log(`Starting crawl with distance limit: ${upToDistance}`);
    
    // Iterative approach to avoid recursive stack overflow
    let currentLevelUsers = new Set<string>([myPubKey])
    let currentDistance = 0

    while (currentDistance < upToDistance && currentLevelUsers.size > 0) {
      console.log(`Processing distance ${currentDistance} with ${currentLevelUsers.size} users`);
      
      const nextLevelUsers = new Set<string>()
      
      for (const user of currentLevelUsers) {
        const follows = this.socialGraph.getFollowedByUser(user)
        
        for (const followedUser of follows) {
          // Only add if we haven't crawled this user in this run
          if (!crawledUsers.has(followedUser)) {
            toFetch.add(followedUser)
            crawledUsers.add(followedUser)
            
            // Add to next level if we haven't reached the limit
            if (currentDistance + 1 < upToDistance) {
              nextLevelUsers.add(followedUser)
            }
          }
        }
      }
      
      currentLevelUsers = nextLevelUsers
      currentDistance++
    }

    console.log("crawling", toFetch.size, "users' follow lists")

    const fetchBatch = (authors: string[]) => {
      const sub = this.ndk.subscribe(
        {
          kinds: [3, 10000],
          authors: authors,
        },
        { closeOnEose: true }
      )
      sub.on("event", (e) => this.processEvent(e as NostrEvent))
    }

    const processBatch = () => {
      const batch = [...toFetch].slice(0, 500)
      if (batch.length > 0) {
        fetchBatch(batch)
        batch.forEach((author) => toFetch.delete(author))
        if (toFetch.size > 0) {
          setTimeout(processBatch, 5000)
        }
      }
    }

    processBatch()
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
    this.throttledSave();
  }

  getSocialGraph() {
    return this.socialGraph;
  }
}

// Only run if called directly
if (process.argv.includes('--once')) {
  let socialGraph: SocialGraph;
  
  // Load or create social graph for standalone mode
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

  const crawler = new Crawler(socialGraph, new NDK({
    explicitRelayUrls: RELAY_URLS,
  }));
  crawler.initialize();
}
