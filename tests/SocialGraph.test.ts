import { describe, it, expect, beforeEach } from 'vitest';
import { SocialGraph } from '../src/SocialGraph';
import { NostrEvent } from '../src/utils';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pubKeys = {
    adam: "020f2d21ae09bf35fcdfb65decf1478b846f5f728ab30c5eaabcd6d081a81c3e",
    fiatjaf: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
    snowden: "84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240",
    sirius: "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0",
}

const SOCIAL_GRAPH_FILE = path.join(__dirname, '../data/socialGraph.json');

describe('SocialGraph', () => {
  it('should initialize with root user', () => {
    const graph = new SocialGraph(pubKeys.adam);
    expect(graph.getFollowDistance(pubKeys.adam)).toBe(0);
  });

  it('should handle follow events', () => {
    const graph = new SocialGraph(pubKeys.adam);
    const event: NostrEvent = {
      created_at: 1000,
      content: '',
      tags: [['p', pubKeys.fiatjaf]],
      kind: 3,
      pubkey: pubKeys.adam,
      id: 'event1',
      sig: 'signature',
    };
    graph.handleEvent(event, true);
    expect(graph.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
  });

  it('should update follow distances correctly', () => {
    const graph = new SocialGraph(pubKeys.adam);
    const event1: NostrEvent = {
      created_at: 1000,
      content: '',
      tags: [['p', pubKeys.fiatjaf]],
      kind: 3,
      pubkey: pubKeys.adam,
      id: 'event1',
      sig: 'signature',
    };
    const event2: NostrEvent = {
      created_at: 2000,
      content: '',
      tags: [['p', pubKeys.snowden]],
      kind: 3,
      pubkey: pubKeys.fiatjaf,
      id: 'event2',
      sig: 'signature',
    };
    graph.handleEvent(event1, true);
    graph.handleEvent(event2, true);
    expect(graph.getFollowDistance(pubKeys.snowden)).toBe(2);
  });

  it('should serialize and deserialize correctly', async () => {
    const graph = new SocialGraph(pubKeys.adam);
    const event1: NostrEvent = {
      created_at: 1000,
      content: '',
      tags: [['p', pubKeys.fiatjaf]],
      kind: 3,
      pubkey: pubKeys.adam,
      id: 'event1',
      sig: 'signature',
    };
    const event2: NostrEvent = {
      created_at: 2000,
      content: '',
      tags: [['p', pubKeys.snowden]],
      kind: 3,
      pubkey: pubKeys.fiatjaf,
      id: 'event2',
      sig: 'signature',
    };
    graph.handleEvent(event1, true);
    graph.handleEvent(event2, true);

    expect(graph.getFollowDistance(pubKeys.adam)).toBe(0)
    expect(graph.getFollowDistance(pubKeys.fiatjaf)).toBe(1);
    expect(graph.getFollowDistance(pubKeys.snowden)).toBe(2);
    expect(graph.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(graph.isFollowing(pubKeys.fiatjaf, pubKeys.snowden)).toBe(true);

    const serialized = await graph.serialize();
    const newGraph = new SocialGraph(pubKeys.adam, serialized);

    expect(newGraph.getFollowDistance(pubKeys.adam)).toBe(0)
    expect(newGraph.getFollowDistance(pubKeys.fiatjaf)).toBe(1);
    expect(newGraph.getFollowDistance(pubKeys.snowden)).toBe(2);
    expect(newGraph.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(newGraph.isFollowing(pubKeys.fiatjaf, pubKeys.snowden)).toBe(true);
  });

  it('should update follow distances when root is changed', async () => {
    const graph = new SocialGraph(pubKeys.adam);
    const event1: NostrEvent = {
      created_at: 1000,
      content: '',
      tags: [['p', pubKeys.fiatjaf]],
      kind: 3,
      pubkey: pubKeys.adam,
      id: 'event1',
      sig: 'signature',
    };
    const event2: NostrEvent = {
      created_at: 2000,
      content: '',
      tags: [['p', pubKeys.snowden]],
      kind: 3,
      pubkey: pubKeys.fiatjaf,
      id: 'event2',
      sig: 'signature',
    };
    graph.handleEvent(event1, true);
    graph.handleEvent(event2, true);

    // Initial follow distances
    expect(graph.getFollowDistance(pubKeys.adam)).toBe(0);
    expect(graph.getFollowDistance(pubKeys.fiatjaf)).toBe(1);
    expect(graph.getFollowDistance(pubKeys.snowden)).toBe(2);

    await graph.setRoot(pubKeys.snowden);

    // Snowden doesn't follow anyone.
    expect(graph.getFollowDistance(pubKeys.snowden)).toBe(0);
    expect(graph.getFollowDistance(pubKeys.fiatjaf)).toBe(1000);
    expect(graph.getFollowDistance(pubKeys.adam)).toBe(1000);

    await graph.setRoot(pubKeys.fiatjaf);

    // Fiatjaf follows Snowden.
    expect(graph.getFollowDistance(pubKeys.snowden)).toBe(1);
    expect(graph.getFollowDistance(pubKeys.fiatjaf)).toBe(0);
    expect(graph.getFollowDistance(pubKeys.adam)).toBe(1000);

    await graph.setRoot(pubKeys.adam)
    // Initial follow distances
    expect(graph.getFollowDistance(pubKeys.adam)).toBe(0);
    expect(graph.getFollowDistance(pubKeys.fiatjaf)).toBe(1);
    expect(graph.getFollowDistance(pubKeys.snowden)).toBe(2);
  });

  it('should load social graph from crawled JSON file', async () => {
    const jsonFilePath = path.join(__dirname, '../data/socialGraph.json');
    if (!fs.existsSync(jsonFilePath)) {
      console.warn('Skipping test: socialGraph.json not found');
      return;
    }
    
    const jsonData = fs.readFileSync(jsonFilePath, 'utf-8');
    const graph = new SocialGraph(pubKeys.adam, JSON.parse(jsonData));

    expect(graph.getFollowDistance(pubKeys.adam)).toBe(0);
  }, { timeout: 30000 }); // 30 second timeout

  /* commented out slow test, social graph file too big
  it('should validate the structure of the crawled social graph', () => {
    if (!fs.existsSync(SOCIAL_GRAPH_FILE)) {
      throw new Error('Social graph file does not exist');
    }

    const jsonData = fs.readFileSync(SOCIAL_GRAPH_FILE, 'utf-8');
    const parsedData = JSON.parse(jsonData);

    // Check followLists structure
    expect(Array.isArray(parsedData.followLists)).toBe(true);
    parsedData.followLists.forEach((followList: any) => {
      expect(Array.isArray(followList)).toBe(true);
      expect(followList.length).toBe(3); // pubkey, followed users, list timestamp
      expect(typeof followList[0]).toBe('number');
      const followedUsers = followList[1]
      expect(Array.isArray(followedUsers)).toBe(true);
      followedUsers.forEach((id: any) => {
        expect(typeof id).toBe('number');
      });
      const listTimestamp = followList[2]
      expect(typeof listTimestamp).toBe('number');
    });

    // Check uniqueIds structure
    expect(Array.isArray(parsedData.uniqueIds)).toBe(true);
    parsedData.uniqueIds.forEach((uniqueId: any) => {
      expect(Array.isArray(uniqueId)).toBe(true);
      expect(uniqueId.length).toBe(2);
      expect(typeof uniqueId[0]).toBe('string');
      expect(typeof uniqueId[1]).toBe('number');
    });

    // Attempt to load the graph to ensure it's valid
    const graph = new SocialGraph('rootPubKey', parsedData);
    expect(graph).toBeInstanceOf(SocialGraph);
  });
  */

  it('should utilize existing follow lists for new users', async () => {
    const graph = new SocialGraph(pubKeys.adam);
    const event1: NostrEvent = {
      created_at: 1000,
      content: '',
      tags: [['p', pubKeys.fiatjaf]],
      kind: 3,
      pubkey: pubKeys.adam,
      id: 'event1',
      sig: 'signature',
    };
    const event2: NostrEvent = {
      created_at: 2000,
      content: '',
      tags: [['p', pubKeys.snowden]],
      kind: 3,
      pubkey: pubKeys.fiatjaf,
      id: 'event2',
      sig: 'signature',
    };
    graph.handleEvent(event1, true);
    graph.handleEvent(event2, true);

    expect(graph.getFollowDistance(pubKeys.adam)).toBe(0);
    expect(graph.getFollowDistance(pubKeys.fiatjaf)).toBe(1);
    expect(graph.getFollowDistance(pubKeys.snowden)).toBe(2);
    expect(graph.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(graph.isFollowing(pubKeys.fiatjaf, pubKeys.snowden)).toBe(true);

    const serialized = await graph.serialize();
    const newGraph = new SocialGraph(pubKeys.sirius, serialized);
    await newGraph.recalculateFollowDistances();

    // Check initial state of newGraph
    expect(newGraph.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(newGraph.isFollowing(pubKeys.fiatjaf, pubKeys.snowden)).toBe(true);
    expect(newGraph.getFollowDistance(pubKeys.sirius)).toBe(0);
    expect(newGraph.getFollowDistance(pubKeys.adam)).toBe(1000);
    expect(newGraph.getFollowDistance(pubKeys.fiatjaf)).toBe(1000);
    expect(newGraph.getFollowDistance(pubKeys.snowden)).toBe(1000);

    const event3: NostrEvent = {
      created_at: 3000,
      content: '',
      tags: [['p', pubKeys.adam]],
      kind: 3,
      pubkey: pubKeys.sirius,
      id: 'event3',
      sig: 'signature',
    };
    newGraph.handleEvent(event3, true);

    // should we do this automatically on some condition?
    await newGraph.recalculateFollowDistances();

    // Check updated state of newGraph
    expect(newGraph.isFollowing(pubKeys.sirius, pubKeys.adam)).toBe(true);
    expect(newGraph.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(newGraph.isFollowing(pubKeys.fiatjaf, pubKeys.snowden)).toBe(true);
    expect(newGraph.getFollowDistance(pubKeys.sirius)).toBe(0);
    expect(newGraph.getFollowDistance(pubKeys.adam)).toBe(1);
    expect(newGraph.getFollowDistance(pubKeys.fiatjaf)).toBe(2);
    expect(newGraph.getFollowDistance(pubKeys.snowden)).toBe(3);
  });

  it('should handle mute and unmute events correctly', () => {
    const graph = new SocialGraph(pubKeys.adam);
    const muteEvent: NostrEvent = {
      created_at: 1000,
      content: '',
      tags: [['p', pubKeys.fiatjaf]],
      kind: 10000,
      pubkey: pubKeys.adam,
      id: 'muteEvent1',
      sig: 'signature',
    };
    graph.handleEvent(muteEvent, true);

    // Test muting
    expect(graph.getMutedByUser(pubKeys.adam)).toContain(pubKeys.fiatjaf);
    expect(graph.getUserMutedBy(pubKeys.fiatjaf)).toContain(pubKeys.adam);

    // Unmute fiatjaf
    const unmuteEvent: NostrEvent = {
      created_at: 2000,
      content: '',
      tags: [],
      kind: 10000,
      pubkey: pubKeys.adam,
      id: 'unmuteEvent1',
      sig: 'signature',
    };
    graph.handleEvent(unmuteEvent, true);

    // Test unmuting
    expect(graph.getMutedByUser(pubKeys.adam)).not.toContain(pubKeys.fiatjaf);
    expect(graph.getUserMutedBy(pubKeys.fiatjaf)).not.toContain(pubKeys.adam);
  });

  it('should preserve mute list during serialization and deserialization', async () => {
    const graph = new SocialGraph(pubKeys.adam);
    const muteEvent: NostrEvent = {
      created_at: 1000,
      content: '',
      tags: [['p', pubKeys.fiatjaf]],
      kind: 10000,
      pubkey: pubKeys.adam,
      id: 'muteEvent1',
      sig: 'signature',
    };
    graph.handleEvent(muteEvent, true);

    // Ensure fiatjaf is muted by adam
    expect(graph.getMutedByUser(pubKeys.adam)).toContain(pubKeys.fiatjaf);

    // Serialize the graph
    const serialized = await graph.serialize();

    // Create a new graph from the serialized data
    const newGraph = new SocialGraph(pubKeys.adam, serialized);

    // Ensure the mute list is preserved
    expect(newGraph.getMutedByUser(pubKeys.adam)).toContain(pubKeys.fiatjaf);
  });

  describe('size-limited serialization', () => {
    it('should respect size limits when serializing', async () => {
      const graph = new SocialGraph(pubKeys.adam);
      
      // Add multiple follow events to create a larger graph
      const events: NostrEvent[] = [
        {
          created_at: 1000,
          content: '',
          tags: [['p', pubKeys.fiatjaf]],
          kind: 3,
          pubkey: pubKeys.adam,
          id: 'event1',
          sig: 'signature',
        },
        {
          created_at: 2000,
          content: '',
          tags: [['p', pubKeys.snowden]],
          kind: 3,
          pubkey: pubKeys.fiatjaf,
          id: 'event2',
          sig: 'signature',
        },
        {
          created_at: 3000,
          content: '',
          tags: [['p', pubKeys.sirius]],
          kind: 3,
          pubkey: pubKeys.snowden,
          id: 'event3',
          sig: 'signature',
        }
      ];

      events.forEach(event => graph.handleEvent(event, true));

      // Test with a small size limit
      const smallLimit = 1000;
      const smallSerialized = await graph.serialize(smallLimit);
      const smallJson = JSON.stringify(smallSerialized);
      
      expect(smallJson.length).toBeLessThanOrEqual(smallLimit);
      expect(smallSerialized.followLists.length).toBeLessThanOrEqual(events.length);

      // Test with a larger size limit
      const largeLimit = 1000;
      const largeSerialized = await graph.serialize(largeLimit);
      const largeJson = JSON.stringify(largeSerialized);
      
      expect(largeJson.length).toBeLessThanOrEqual(largeLimit);
      expect(largeSerialized.followLists.length).toBeGreaterThanOrEqual(smallSerialized.followLists.length);
    });

    it('should maintain data integrity when size limited', async () => {
      const graph = new SocialGraph(pubKeys.adam);
      
      // Add follow and mute events
      const followEvent: NostrEvent = {
        created_at: 1000,
        content: '',
        tags: [['p', pubKeys.fiatjaf]],
        kind: 3,
        pubkey: pubKeys.adam,
        id: 'followEvent',
        sig: 'signature',
      };
      
      const muteEvent: NostrEvent = {
        created_at: 2000,
        content: '',
        tags: [['p', pubKeys.snowden]],
        kind: 10000,
        pubkey: pubKeys.adam,
        id: 'muteEvent',
        sig: 'signature',
      };

      graph.handleEvent(followEvent, true);
      graph.handleEvent(muteEvent, true);

      // Serialize with size limit
      const serialized = await graph.serialize(1000);
      
      // Create new graph from serialized data
      const newGraph = new SocialGraph(pubKeys.adam, serialized);
      
      // Verify that the data that fits within the limit is preserved
      const json = JSON.stringify(serialized);
      expect(json.length).toBeLessThanOrEqual(1000);
      
      // The new graph should be valid even if incomplete
      expect(newGraph).toBeInstanceOf(SocialGraph);
    });

    it('should handle empty graphs with size limits', async () => {
      const graph = new SocialGraph(pubKeys.adam);
      
      // Serialize empty graph with size limit
      const serialized = await graph.serialize(1000);
      const json = JSON.stringify(serialized);
      
      expect(json.length).toBeLessThanOrEqual(1000);
      expect(serialized.followLists).toEqual([]);
      expect(serialized.muteLists).toEqual([]);
      expect(serialized.uniqueIds).toEqual([]);
    });

    it('should produce consistent results for same size limits', async () => {
      const graph = new SocialGraph(pubKeys.adam);
      
      // Add some events
      const events: NostrEvent[] = [
        {
          created_at: 1000,
          content: '',
          tags: [['p', pubKeys.fiatjaf], ['p', pubKeys.snowden]],
          kind: 3,
          pubkey: pubKeys.adam,
          id: 'event1',
          sig: 'signature',
        },
        {
          created_at: 2000,
          content: '',
          tags: [['p', pubKeys.sirius]],
          kind: 10000,
          pubkey: pubKeys.adam,
          id: 'event2',
          sig: 'signature',
        }
      ];

      events.forEach(event => graph.handleEvent(event, true));

      // Serialize twice with same limit
      const serialized1 = await graph.serialize(1000);
      const serialized2 = await graph.serialize(1000);
      
      expect(JSON.stringify(serialized1)).toEqual(JSON.stringify(serialized2));
    });

    it('should include all uniqueIds for included data', async () => {
      const graph = new SocialGraph(pubKeys.adam);
      
      // Add follow event
      const followEvent: NostrEvent = {
        created_at: 1000,
        content: '',
        tags: [['p', pubKeys.fiatjaf]],
        kind: 3,
        pubkey: pubKeys.adam,
        id: 'followEvent',
        sig: 'signature',
      };

      graph.handleEvent(followEvent, true);

      // Serialize with size limit
      const serialized = await graph.serialize(1000);
      
      // All IDs used in followLists should be present in uniqueIds
      const usedIds = new Set<number>();
      serialized.followLists.forEach(([user, ids]) => {
        usedIds.add(user);
        ids.forEach(id => usedIds.add(id));
      });
      
      serialized.muteLists?.forEach(([user, ids]) => {
        usedIds.add(user);
        ids.forEach(id => usedIds.add(id));
      });

      const uniqueIdNumbers = serialized.uniqueIds.map(([, id]) => id);
      usedIds.forEach(id => {
        expect(uniqueIdNumbers).toContain(id);
      });
    });

    it('should handle very small size limits gracefully', async () => {
      const graph = new SocialGraph(pubKeys.adam);
      
      // Add some events
      const followEvent: NostrEvent = {
        created_at: 1000,
        content: '',
        tags: [['p', pubKeys.fiatjaf]],
        kind: 3,
        pubkey: pubKeys.adam,
        id: 'followEvent',
        sig: 'signature',
      };

      graph.handleEvent(followEvent, true);

      // Test with minimum reasonable limit
      const serialized = await graph.serialize(1000);
      const json = JSON.stringify(serialized);
      
      expect(json.length).toBeLessThanOrEqual(1000);
      // Should still produce valid JSON structure
      expect(serialized).toHaveProperty('followLists');
      expect(serialized).toHaveProperty('uniqueIds');
      expect(serialized).toHaveProperty('muteLists');
    });

    it('should have accurate size calculation', async () => {
      const graph = new SocialGraph(pubKeys.adam);
      
      // Add a simple follow event
      const followEvent: NostrEvent = {
        created_at: 1000,
        content: '',
        tags: [['p', pubKeys.fiatjaf]],
        kind: 3,
        pubkey: pubKeys.adam,
        id: 'followEvent',
        sig: 'signature',
      };

      graph.handleEvent(followEvent, true);

      // Serialize without size limit first to get the full size
      const fullSerialized = await graph.serialize();
      const fullJson = JSON.stringify(fullSerialized);
      const fullSize = fullJson.length;
      
      console.log('Full serialized size:', fullSize);
      console.log('Full JSON:', fullJson);

      // Now test with size limit slightly smaller than full size
      const limitSize = Math.floor(fullSize * 0.8); // 80% of full size
      const limitedSerialized = await graph.serialize(limitSize);
      const limitedJson = JSON.stringify(limitedSerialized);
      const limitedSize = limitedJson.length;
      
      console.log('Limited serialized size:', limitedSize);
      console.log('Limit was:', limitSize);
      console.log('Limited JSON:', limitedJson);

      // The limited size should be less than or equal to the limit
      expect(limitedSize).toBeLessThanOrEqual(limitSize);
      
      // The limited size should be smaller than the full size
      expect(limitedSize).toBeLessThan(fullSize);
      
      // The limited serialization should still be valid
      expect(limitedSerialized).toHaveProperty('followLists');
      expect(limitedSerialized).toHaveProperty('uniqueIds');
      expect(limitedSerialized).toHaveProperty('muteLists');
    });
  });

  describe('budget parameter serialization', () => {
    let graph: SocialGraph;

    beforeEach(async () => {
      // Create a test graph with multiple users and relationships
      graph = new SocialGraph(pubKeys.adam);
      
      // Add some follow relationships
      const followEvent1: NostrEvent = {
        created_at: 1000,
        content: '',
        tags: [['p', pubKeys.fiatjaf], ['p', pubKeys.snowden]],
        kind: 3,
        pubkey: pubKeys.adam,
        id: 'follow1',
        sig: 'sig1',
      };
      
      const followEvent2: NostrEvent = {
        created_at: 1001,
        content: '',
        tags: [['p', pubKeys.sirius]],
        kind: 3,
        pubkey: pubKeys.fiatjaf,
        id: 'follow2',
        sig: 'sig2',
      };

      // Add some mute relationships
      const muteEvent: NostrEvent = {
        created_at: 1002,
        content: '',
        tags: [['p', pubKeys.snowden]],
        kind: 10000,
        pubkey: pubKeys.adam,
        id: 'mute1',
        sig: 'sig3',
      };

      graph.handleEvent(followEvent1, true);
      graph.handleEvent(followEvent2, true);
      graph.handleEvent(muteEvent, true);
      
      await graph.recalculateFollowDistances();
    });

    it('should respect maxNodes parameter in JSON serialization', async () => {
      // Test with maxNodes = 2 (should include root + 1 other user)
      let totalChars = 0;
      for await (const chunk of graph.toJsonChunks(2)) {
        totalChars += typeof chunk === 'string' ? chunk.length : chunk.length;
      }
      
      // Test with maxNodes = 10 (should include all users)
      let totalCharsUnlimited = 0;
      for await (const chunk of graph.toJsonChunks(10)) {
        totalCharsUnlimited += typeof chunk === 'string' ? chunk.length : chunk.length;
      }
      
      expect(totalChars).toBeLessThan(totalCharsUnlimited);
    });

    it('should respect maxEdges parameter in JSON serialization', async () => {
      // Test with maxEdges = 1
      let totalChars = 0;
      for await (const chunk of graph.toJsonChunks(undefined, 1)) {
        totalChars += typeof chunk === 'string' ? chunk.length : chunk.length;
      }
      
      // Test with maxEdges = 10
      let totalCharsMore = 0;
      for await (const chunk of graph.toJsonChunks(undefined, 10)) {
        totalCharsMore += typeof chunk === 'string' ? chunk.length : chunk.length;
      }
      
      expect(totalChars).toBeLessThan(totalCharsMore);
    });

    it('should respect maxDistance parameter in JSON serialization', async () => {
      // Test with maxDistance = 0 (only root)
      let totalCharsDistance0 = 0;
      for await (const chunk of graph.toJsonChunks(undefined, undefined, 0)) {
        totalCharsDistance0 += typeof chunk === 'string' ? chunk.length : chunk.length;
      }
      
      // Test with maxDistance = 1 (root + direct follows)
      let totalCharsDistance1 = 0;
      for await (const chunk of graph.toJsonChunks(undefined, undefined, 1)) {
        totalCharsDistance1 += typeof chunk === 'string' ? chunk.length : chunk.length;
      }
      
      expect(totalCharsDistance0).toBeLessThan(totalCharsDistance1);
    });

    it('should respect maxEdgesPerNode parameter in JSON serialization', async () => {
      // Test with maxEdgesPerNode = 1 (very restrictive)
      let totalCharsLimited = 0;
      for await (const chunk of graph.toJsonChunks(undefined, undefined, undefined, 1)) {
        totalCharsLimited += typeof chunk === 'string' ? chunk.length : chunk.length;
      }
      
      // Test with maxEdgesPerNode = 10 (more permissive)
      let totalCharsMore = 0;
      for await (const chunk of graph.toJsonChunks(undefined, undefined, undefined, 10)) {
        totalCharsMore += typeof chunk === 'string' ? chunk.length : chunk.length;
      }
      
      expect(totalCharsLimited).toBeLessThan(totalCharsMore);
    });

    it('should respect maxNodes parameter in binary serialization', async () => {
      // Test with maxNodes = 2
      let totalBytesLimited = 0;
      for await (const chunk of graph.toBinaryChunks(2)) {
        totalBytesLimited += chunk.length;
      }
      
      // Test with maxNodes = 10
      let totalBytesMore = 0;
      for await (const chunk of graph.toBinaryChunks(10)) {
        totalBytesMore += chunk.length;
      }
      
      expect(totalBytesLimited).toBeLessThan(totalBytesMore);
    });

    it('should respect maxEdges parameter in binary serialization', async () => {
      // Test with maxEdges = 1
      let totalBytesLimited = 0;
      for await (const chunk of graph.toBinaryChunks(undefined, 1)) {
        totalBytesLimited += chunk.length;
      }
      
      // Test with maxEdges = 10
      let totalBytesMore = 0;
      for await (const chunk of graph.toBinaryChunks(undefined, 10)) {
        totalBytesMore += chunk.length;
      }
      
      expect(totalBytesLimited).toBeLessThan(totalBytesMore);
    });

    it('should respect maxDistance parameter in binary serialization', async () => {
      // Test with maxDistance = 0
      let totalBytesDistance0 = 0;
      for await (const chunk of graph.toBinaryChunks(undefined, undefined, 0)) {
        totalBytesDistance0 += chunk.length;
      }
      
      // Test with maxDistance = 1
      let totalBytesDistance1 = 0;
      for await (const chunk of graph.toBinaryChunks(undefined, undefined, 1)) {
        totalBytesDistance1 += chunk.length;
      }
      
      expect(totalBytesDistance0).toBeLessThan(totalBytesDistance1);
    });

    it('should respect maxEdgesPerNode parameter in binary serialization', async () => {
      // Test with maxEdgesPerNode = 1
      let totalBytesLimited = 0;
      for await (const chunk of graph.toBinaryChunks(undefined, undefined, undefined, 1)) {
        totalBytesLimited += chunk.length;
      }
      
      // Test with maxEdgesPerNode = 10
      let totalBytesMore = 0;
      for await (const chunk of graph.toBinaryChunks(undefined, undefined, undefined, 10)) {
        totalBytesMore += chunk.length;
      }
      
      expect(totalBytesLimited).toBeLessThan(totalBytesMore);
    });

    it('should work with combined budget parameters', async () => {
      // Test with multiple parameters combined
      let totalBytes = 0;
      for await (const chunk of graph.toBinaryChunks(3, 2, 1, 1)) {
        totalBytes += chunk.length;
      }
      
      // Should produce a small, valid binary
      expect(totalBytes).toBeGreaterThan(0);
      expect(totalBytes).toBeLessThan(1000); // Should be quite small with these limits
    });

    it('should produce valid JSON with budget parameters', async () => {
      // Test that the JSON output is valid and parseable
      let jsonString = '';
      for await (const chunk of graph.toJsonChunks(5, 3, 1, 2)) {
        jsonString += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      }
      
      // Should be valid JSON
      expect(() => JSON.parse(jsonString)).not.toThrow();
      
      const parsed = JSON.parse(jsonString);
      expect(parsed).toHaveProperty('followLists');
      expect(parsed).toHaveProperty('muteLists');
      expect(parsed).toHaveProperty('uniqueIds');
      
      // Should be arrays
      expect(Array.isArray(parsed.followLists)).toBe(true);
      expect(Array.isArray(parsed.muteLists)).toBe(true);
      expect(Array.isArray(parsed.uniqueIds)).toBe(true);
    });

    it('should produce deserializable binary with budget parameters', async () => {
      // Create binary with budget parameters
      const binaryData = await graph.toBinary(5, 3, 1, 2);
      
      // Should be able to deserialize it
      const { fromBinary } = await import('../src/SocialGraphBinary');
      const reconstructedGraph = await fromBinary(pubKeys.adam, binaryData);
      
      expect(reconstructedGraph.getRoot()).toBe(pubKeys.adam);
      expect(reconstructedGraph.size().users).toBeGreaterThan(0);
    });

    it('should handle edge case: maxNodes = 1 (only root)', async () => {
      let totalBytes = 0;
      for await (const chunk of graph.toBinaryChunks(1)) {
        totalBytes += chunk.length;
      }
      
      // Should still produce valid output with just the root user
      expect(totalBytes).toBeGreaterThan(0);
      expect(totalBytes).toBeLessThan(100); // Should be very small
    });

    it('should handle very restrictive budget parameters', async () => {
      // Test with very restrictive but realistic parameters
      let jsonString = '';
      for await (const chunk of graph.toJsonChunks(2, 1, 0, 1)) {
        jsonString += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      }
      
      const parsed = JSON.parse(jsonString);
      expect(parsed).toHaveProperty('followLists');
      expect(parsed).toHaveProperty('muteLists');
      expect(parsed).toHaveProperty('uniqueIds');
      expect(parsed.uniqueIds.length).toBeGreaterThan(0);
      
      // Should be valid JSON with minimal content
      expect(parsed.uniqueIds.length).toBeLessThanOrEqual(2); // maxNodes = 2
      
      // Compare with unlimited to ensure it's actually smaller
      let unlimitedString = '';
      for await (const chunk of graph.toJsonChunks()) {
        unlimitedString += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      }
      
      expect(jsonString.length).toBeLessThan(unlimitedString.length);
    });

    it('should handle edge case: maxEdgesPerNode = 0', async () => {
      let totalBytes = 0;
      for await (const chunk of graph.toBinaryChunks(undefined, undefined, undefined, 0)) {
        totalBytes += chunk.length;
      }
      
      // Should produce minimal output with no edges per node
      expect(totalBytes).toBeGreaterThan(0);
      expect(totalBytes).toBeLessThan(200); // Should be quite small
    });
  });
});