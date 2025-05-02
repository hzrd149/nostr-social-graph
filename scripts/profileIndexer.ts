import NDK from "@nostr-dev-kit/ndk";
import fs from "fs";
import throttle from "lodash/throttle";
import { SocialGraph, NostrEvent } from "../src";
import { SOCIAL_GRAPH_ROOT, DATA_DIR, SOCIAL_GRAPH_FILE, FUSE_INDEX_FILE, DATA_FILE, RELAY_URLS } from "../src/constants";
import WebSocket from "ws";
import Fuse from "fuse.js";

console.log('Starting profile indexer...');

global.WebSocket = WebSocket as any;

type Profile = {
  name: string;
  pubKey: string;
  nip05?: string;
};

export class ProfileIndexer {
  private socialGraph: SocialGraph;
  private ndk: NDK;
  private fuse: Fuse<Profile>;
  private data: string[][];
  private seen: Set<string>;
  private throttledSave: any;

  constructor(socialGraph: SocialGraph, ndk: NDK) {
    console.log('Creating profile indexer instance...');
    this.socialGraph = socialGraph;
    this.ndk = ndk;
    this.fuse = new Fuse<Profile>([], { keys: ["name", "pubKey", "nip05"] });
    this.data = [];
    this.seen = new Set<string>();

    this.throttledSave = throttle(async () => {
      try {
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR);
        }
        
        // Save Fuse index
        const fuseIndex = this.fuse.getIndex();
        fs.writeFileSync(FUSE_INDEX_FILE, JSON.stringify(fuseIndex));
        console.log("Saved Fuse index");
        
        // Save profile data
        fs.writeFileSync(DATA_FILE, JSON.stringify(this.data));
        console.log("Saved profile data of size", this.data.length);
      } catch (e) {
        console.error("Failed to save data:", e);
        console.log("social graph size", this.socialGraph.size());
        console.log("profile data size", this.data.length);
      }
    }, 30000); // 30 seconds throttle
  }

  async initialize() {
    console.log('Initializing profile indexer...');
    try {
      console.log('Connecting to NDK...');
      await this.ndk.connect(5000); // 5 second timeout
      console.log('ndk connected');
    } catch (e) {
      console.error('Failed to connect to NDK:', e);
      return;
    }

    // Start indexing profiles
    await this.fetchProfilesInBatches(this.socialGraph.userIterator(5));
  }

  listen() {
    const sub = this.ndk.subscribe({
      kinds: [0],
      since: Math.floor(Date.now() / 1000),
    });
    sub.on("event", (event) => {
      if (this.socialGraph.getFollowDistance(event.pubkey) < 1000) {
        this.handleProfileEvent(event as NostrEvent);
      }
    });
  }

  private async fetchProfilesInBatches(iterator: IterableIterator<string>) {
    const batchSize = 100;
    let batch: string[] = [];
    
    for (const pubkey of iterator) {
      batch.push(pubkey);
      
      if (batch.length >= batchSize) {
        await this.fetchProfiles(batch);
        this.throttledSave();
        batch = [];
      }
    }
    
    if (batch.length > 0) {
      await this.fetchProfiles(batch);
      this.throttledSave();
    }
  }

  private async fetchProfiles(pubkeys: string[]) {
    try {
      const events = await this.ndk.fetchEvents({
        kinds: [0],
        authors: pubkeys,
      });

      for (const event of events) {
        try {
          this.handleProfileEvent(event as NostrEvent);
        } catch (e) {
          console.error('Failed to parse profile content:', e);
        }
      }
    } catch (e) {
      console.error('Failed to fetch profiles:', e);
    }
  }

  private handleProfileEvent(event: NostrEvent) {
    if (this.seen.has(event.pubkey)) {
      return;
    }
    this.seen.add(event.pubkey);
    try {
      const profile = JSON.parse(event.content);
      const pubKey = event.pubkey;
      const name = (profile.display_name || profile.username || '').trim().slice(0, 100);
      if (!name) return;

      let nip05 = profile.nip05 ? (profile.nip05.split('@')[0].trim().toLowerCase().slice(0, 100)) : undefined;
      if (nip05 === name.toLowerCase()) {
        nip05 = undefined;
      }
    
      console.log(`Handling profile event for ${name} (${pubKey})`);
      this.fuse.remove((profile) => profile.pubKey === pubKey);
      this.fuse.add({ name, pubKey, nip05 });
      const item = [pubKey, name];
      const hasPicture = profile.picture && profile.picture.length < 255;
      if (nip05) {
        item.push(nip05);
      } else if (hasPicture) {
        item.push('');
      }
      if (hasPicture) {
        item.push(profile.picture.trim().replace(/^https:\/\//, ''));
      }
      this.data.push(item);
    } catch (e) {
      // Silently skip invalid profiles
    }
  }

  getFuse() {
    return this.fuse;
  }

  getData() {
    return this.data;
  }
}

// Only run if called directly
if (process.argv.includes('--once')) {
  let socialGraph: SocialGraph;
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
  const ndk = new NDK({
    explicitRelayUrls: RELAY_URLS,
  });
  const indexer = new ProfileIndexer(socialGraph, ndk);
  indexer.initialize();
}
