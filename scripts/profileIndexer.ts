import NDK from "@nostr-dev-kit/ndk";
import fs from "fs";
import throttle from "lodash/throttle";
import { SocialGraph, NostrEvent } from "../src";
import { SOCIAL_GRAPH_ROOT, MAX_SOCIAL_GRAPH_SERIALIZE_SIZE, DATA_DIR, SOCIAL_GRAPH_FILE, FUSE_INDEX_FILE, DATA_FILE, RELAY_URLS } from "../src/constants";
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
        fs.writeFileSync(SOCIAL_GRAPH_FILE, JSON.stringify(this.socialGraph.serialize(MAX_SOCIAL_GRAPH_SERIALIZE_SIZE)));
        console.log("Saved social graph of size", this.socialGraph.size());
      } catch (e) {
        console.error("failed to serialize SocialGraph", e);
        console.log("social graph size", this.socialGraph.size());
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
    this.throttledSave();
  }

  private async fetchProfilesInBatches(iterator: IterableIterator<string>) {
    const batchSize = 10;
    let batch: string[] = [];
    
    for (const pubkey of iterator) {
      batch.push(pubkey);
      
      if (batch.length >= batchSize) {
        await this.fetchProfiles(batch);
        batch = [];
      }
    }
    
    if (batch.length > 0) {
      await this.fetchProfiles(batch);
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
          const content = JSON.parse(event.content);
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
  const socialGraph = new SocialGraph(SOCIAL_GRAPH_ROOT);
  const ndk = new NDK({
    explicitRelayUrls: RELAY_URLS,
  });
  const indexer = new ProfileIndexer(socialGraph, ndk);
  indexer.initialize();
}
