import NDK from "@nostr-dev-kit/ndk";
import fs from "fs";
import path from "path";
import throttle from "lodash/throttle";
import { SocialGraph, NostrEvent } from "../src";
import { SOCIAL_GRAPH_ROOT, MAX_SOCIAL_GRAPH_SERIALIZE_SIZE, DATA_DIR, SOCIAL_GRAPH_FILE, RELAY_URLS } from "../src/constants";
import WebSocket from "ws";

console.log('Starting crawler...');

global.WebSocket = WebSocket as any;

export class Crawler {
  private socialGraph: SocialGraph;
  private ndk: NDK;
  private throttledSave: any;

  constructor(socialGraph: SocialGraph) {
    console.log('Creating crawler instance...');
    this.socialGraph = socialGraph;
    this.ndk = new NDK({
      explicitRelayUrls: RELAY_URLS,
    });

    this.throttledSave = throttle(async () => {
      try {
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR);
        }
        fs.writeFileSync(SOCIAL_GRAPH_FILE, JSON.stringify(this.socialGraph.serialize(MAX_SOCIAL_GRAPH_SERIALIZE_SIZE)));
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
      this.getMissingFollowLists(SOCIAL_GRAPH_ROOT);
      const removedCount = this.socialGraph.removeMutedNotFollowedUsers();
      console.log("Removing", removedCount, "muted users not followed by anyone");
      this.throttledSave();
    } else {
      console.log('No root follow event found');
      this.socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
    }
  }

  private getMissingFollowLists(myPubKey: string) {
    const myFollows = this.socialGraph.getFollowedByUser(myPubKey);
    const missingFollows = new Set<string>();
    const missingMutes = new Set<string>();

    for (const k of myFollows) {
      if (this.socialGraph.getFollowedByUser(k).size === 0) {
        missingFollows.add(k);
      }
      if (this.socialGraph.getMutedByUser(k).size === 0) {
        missingMutes.add(k);
      }
    }

    console.log("fetching", missingFollows.size, "missing follow lists");
    console.log("fetching", missingMutes.size, "missing mute lists");

    const fetchBatch = (authors: string[], kind: number) => {
      const sub = this.ndk.subscribe(
        {
          kinds: [kind],
          authors: authors,
        },
        { closeOnEose: true }
      );
      sub.on("event", (e) => this.processEvent(e as NostrEvent));
    };

    const processMissing = (missingSet: Set<string>, kind: number) => {
      const batch = [...missingSet].slice(0, 500);
      if (batch.length > 0) {
        fetchBatch(batch, kind);
        batch.forEach((author) => missingSet.delete(author));
        if (missingSet.size > 0) {
          setTimeout(() => processMissing(missingSet, kind), 5000);
        }
      }
    };

    processMissing(missingFollows, 3);
    processMissing(missingMutes, 10000);
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
  const socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
  const crawler = new Crawler(socialGraph);
  crawler.initialize();
}
