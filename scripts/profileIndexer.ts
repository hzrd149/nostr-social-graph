import NDK from "@nostr-dev-kit/ndk";
import fs from "fs";
import throttle from "lodash/throttle";
import { SocialGraph, NostrEvent } from "../src";
import { SOCIAL_GRAPH_ROOT, DATA_DIR, SOCIAL_GRAPH_FILE, FUSE_INDEX_FILE, DATA_FILE, RELAY_URLS, PROFILE_PICTURE_URL_MAX_LENGTH, PROFILE_NAME_MAX_LENGTH } from "../src/constants";
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
  private data: Map<string, string[]>;
  private latestProfileTimestamps: Map<string, number>;
  private throttledSave: any;

  constructor(socialGraph: SocialGraph, ndk: NDK) {
    console.log('Creating profile indexer instance...');
    this.socialGraph = socialGraph;
    this.ndk = ndk;
    this.latestProfileTimestamps = new Map<string, number>();
    this.data = new Map<string, string[]>();

    // Initialize data and Fuse index
    if (fs.existsSync(DATA_FILE) && fs.existsSync(FUSE_INDEX_FILE)) {
      try {
        console.log('Loading existing profile data and index...');
        const rawData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        // Convert array to Map
        this.data = new Map(rawData.map((item: string[]) => [item[0], item]));
        const fuseIndex = JSON.parse(fs.readFileSync(FUSE_INDEX_FILE, 'utf-8'));
        
        // Convert data to Profile objects for Fuse
        const profiles: Profile[] = Array.from(this.data.values()).map(item => ({
          name: item[1],
          pubKey: item[0],
          nip05: item[2] || undefined
        }));
        
        this.fuse = new Fuse<Profile>(profiles, { keys: ["name", "pubKey", "nip05"] });
        console.log(`Loaded ${this.data.size} profiles and Fuse index`);
      } catch (e) {
        console.error('Failed to load existing data:', e);
        this.fuse = new Fuse<Profile>([], { keys: ["name", "pubKey", "nip05"] });
        this.data = new Map();
      }
    } else {
      this.fuse = new Fuse<Profile>([], { keys: ["name", "pubKey", "nip05"] });
      this.data = new Map();
    }

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
        const dataArray = Array.from(this.data.values());
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataArray));
        console.log("Saved profile data of size", this.data.size);
      } catch (e) {
        console.error("Failed to save data:", e);
        console.log("social graph size", this.socialGraph.size());
        console.log("profile data size", this.data.size);
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

  private shouldRejectNip05(nip05: string, name: string): boolean {
    return nip05.length === 1 || 
           nip05.startsWith("npub1") || 
           name.toLowerCase().replace(/\s+/g, '').includes(nip05);
  }

  private handleProfileEvent(event: NostrEvent) {
    const currentTimestamp = this.latestProfileTimestamps.get(event.pubkey);
    if (currentTimestamp && event.created_at <= currentTimestamp) {
      return;
    }
    this.latestProfileTimestamps.set(event.pubkey, event.created_at);
    try {
      const profile = JSON.parse(event.content);
      const pubKey = event.pubkey;
      const name = (profile.display_name || profile.username || '').trim().slice(0, PROFILE_NAME_MAX_LENGTH);
      if (!name) return;

      let nip05 = profile.nip05 ? (profile.nip05.split('@')[0].trim().toLowerCase().slice(0, PROFILE_NAME_MAX_LENGTH)) : undefined;
      if (nip05 && this.shouldRejectNip05(nip05, name)) {
        nip05 = undefined;
      }
    
      console.log(`Handling profile event for ${name} (${pubKey})`);
      this.fuse.remove((profile) => profile.pubKey === pubKey);
      this.fuse.add({ name, pubKey, nip05 });
      
      const item = [pubKey, name];
      const hasPicture = profile.picture && profile.picture.length < PROFILE_PICTURE_URL_MAX_LENGTH;
      if (nip05) {
        item.push(nip05);
      } else if (hasPicture) {
        item.push('');
      }
      if (hasPicture) {
        item.push(profile.picture.trim().replace(/^https:\/\//, ''));
      }
      this.data.set(pubKey, item);
    } catch (e) {
      console.error('Failed to parse profile event:', e);
      // Silently skip invalid profiles
    }
  }

  getFuse() {
    return this.fuse;
  }

  getData(maxBytes?: number, noPictures?: boolean) {
    let data = Array.from(this.data.values());
    
    if (noPictures) {
      data = data.map(item => {
        // Get first three items [pubKey, name, nip05]
        const baseItems = item.slice(0, 3);
        // Find the last non-empty item
        let lastNonEmptyIndex = baseItems.length - 1;
        while (lastNonEmptyIndex >= 0 && !baseItems[lastNonEmptyIndex]) {
          lastNonEmptyIndex--;
        }
        return baseItems.slice(0, lastNonEmptyIndex + 1);
      });
    }

    if (!maxBytes) {
      return data;
    }

    let currentSize = 2; // Start with '[' and will end with ']'
    const result: string[][] = [];
    
    for (const item of data) {
      // Calculate size of this item: comma + array brackets + string lengths + quotes
      const itemSize = (result.length ? 1 : 0) + // comma if not first
        2 + // array brackets
        item.reduce((sum, str) => sum + 2 + str.length, 0); // quotes + string length
      
      if (currentSize + itemSize > maxBytes) {
        break;
      }
      currentSize += itemSize;
      result.push(item);
    }
    
    return result;
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
