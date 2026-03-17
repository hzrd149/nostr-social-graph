import { describe, it, expect } from 'vitest';
import { SocialGraph } from '../src/SocialGraph';
import { NostrEvent } from '../src/utils';
import * as Binary from '../src/SocialGraphBinary';

// Helper function to decode varint from binary data
function decodeVarint(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
    let value = 0;
    let shift = 0;
    let bytesRead = 0;
    
    for (let i = offset; i < bytes.length; i++) {
        const byte = bytes[i];
        value |= (byte & 0x7F) << shift;
        bytesRead++;
        
        if ((byte & 0x80) === 0) {
            break;
        }
        shift += 7;
    }
    
    return { value, bytesRead };
}

const pubKeys = {
    adam: "020f2d21ae09bf35fcdfb65decf1478b846f5f728ab30c5eaabcd6d081a81c3e",
    fiatjaf: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
    snowden: "84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240",
    sirius: "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0",
    bob: "4132aeeee5c7b3497d260c922758e804a9cf9c0933d3e333bfd15f7695db3852",
};

describe('SocialGraph Binary Serialization', () => {
  it('should serialize and deserialize empty graph', async () => {
    const graph = new SocialGraph(pubKeys.adam);
    
    const binary = await graph.toBinary();
    const reconstructed = await SocialGraph.fromBinary(pubKeys.adam, binary);
    
    expect(reconstructed.getRoot()).toBe(pubKeys.adam);
    expect(reconstructed.getFollowDistance(pubKeys.adam)).toBe(0);
    expect(reconstructed.size()).toEqual(graph.size());
  });

  it('should serialize and deserialize graph with follows', async () => {
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

    const binary = await graph.toBinary();
    const reconstructed = await SocialGraph.fromBinary(pubKeys.adam, binary);
    
    // Check follow relationships
    expect(reconstructed.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(reconstructed.isFollowing(pubKeys.fiatjaf, pubKeys.snowden)).toBe(true);
    
    // Check follow distances
    expect(reconstructed.getFollowDistance(pubKeys.adam)).toBe(0);
    expect(reconstructed.getFollowDistance(pubKeys.fiatjaf)).toBe(1);
    expect(reconstructed.getFollowDistance(pubKeys.snowden)).toBe(2);
    
    // Check sizes match
    expect(reconstructed.size()).toEqual(graph.size());
  });

  it('should serialize and deserialize graph with mutes', async () => {
    const graph = new SocialGraph(pubKeys.adam);
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

    const binary = await graph.toBinary();
    const reconstructed = await SocialGraph.fromBinary(pubKeys.adam, binary);
    
    // Check follow relationship
    expect(reconstructed.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    
    // Check mute relationship
    expect(reconstructed.getMutedByUser(pubKeys.adam)).toContain(pubKeys.snowden);
    expect(reconstructed.getUserMutedBy(pubKeys.snowden)).toContain(pubKeys.adam);
    
    // Check sizes match
    expect(reconstructed.size()).toEqual(graph.size());
  });

  it('should serialize and deserialize graph with both follows and mutes', async () => {
    const graph = new SocialGraph(pubKeys.adam);
    const followEvent: NostrEvent = {
      created_at: 1000,
      content: '',
      tags: [['p', pubKeys.fiatjaf], ['p', pubKeys.snowden]],
      kind: 3,
      pubkey: pubKeys.adam,
      id: 'followEvent',
      sig: 'signature',
    };
    const muteEvent: NostrEvent = {
      created_at: 2000,
      content: '',
      tags: [['p', pubKeys.sirius]],
      kind: 10000,
      pubkey: pubKeys.adam,
      id: 'muteEvent',
      sig: 'signature',
    };
    graph.handleEvent(followEvent, true);
    graph.handleEvent(muteEvent, true);

    const binary = await graph.toBinary();
    const reconstructed = await SocialGraph.fromBinary(pubKeys.adam, binary);
    
    // Check follow relationships
    expect(reconstructed.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(reconstructed.isFollowing(pubKeys.adam, pubKeys.snowden)).toBe(true);
    
    // Check mute relationship
    expect(reconstructed.getMutedByUser(pubKeys.adam)).toContain(pubKeys.sirius);
    expect(reconstructed.getUserMutedBy(pubKeys.sirius)).toContain(pubKeys.adam);
    
    // Check follow distances
    expect(reconstructed.getFollowDistance(pubKeys.adam)).toBe(0);
    expect(reconstructed.getFollowDistance(pubKeys.fiatjaf)).toBe(1);
    expect(reconstructed.getFollowDistance(pubKeys.snowden)).toBe(1);
    
    // Check sizes match
    expect(reconstructed.size()).toEqual(graph.size());
  });

  it('should handle binary chunks correctly', async () => {
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

    // Test chunked serialization
    const chunks: Uint8Array[] = [];
    for await (const chunk of graph.toBinaryChunks()) {
      chunks.push(chunk);
    }
    
    // Combine chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Test direct binary serialization
    const directBinary = await graph.toBinary();
    
    // Both should be equal
    expect(combined).toEqual(directBinary);
    
    // Both should deserialize to the same graph
    const reconstructedFromChunks = await SocialGraph.fromBinary(pubKeys.adam, combined);
    const reconstructedFromDirect = await SocialGraph.fromBinary(pubKeys.adam, directBinary);
    
    expect(reconstructedFromChunks.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(reconstructedFromDirect.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(reconstructedFromChunks.size()).toEqual(reconstructedFromDirect.size());
  });

  it('should handle binary stream correctly', async () => {
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

    const binary = await graph.toBinary();
    
    // Create a stream from the binary data
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(binary);
        controller.close();
      }
    });
    
    const reconstructed = await SocialGraph.fromBinaryStream(pubKeys.adam, stream);
    
    expect(reconstructed.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(reconstructed.size()).toEqual(graph.size());
  });

  it('should preserve timestamps during binary serialization', async () => {
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
      kind: 10000,
      pubkey: pubKeys.adam,
      id: 'event2',
      sig: 'signature',
    };
    graph.handleEvent(event1, true);
    graph.handleEvent(event2, true);

    const binary = await graph.toBinary();
    const reconstructed = await SocialGraph.fromBinary(pubKeys.adam, binary);
    
    // Check that timestamps are preserved
    expect(reconstructed.getFollowListCreatedAt(pubKeys.adam)).toBe(1000);
    expect(reconstructed.getFollowListCreatedAt(pubKeys.adam)).toBe(graph.getFollowListCreatedAt(pubKeys.adam));
  });

  it('should handle different root users correctly', async () => {
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

    const binary = await graph.toBinary();
    
    // Reconstruct with different root
    const reconstructed = await SocialGraph.fromBinary(pubKeys.sirius, binary);
    
    expect(reconstructed.getRoot()).toBe(pubKeys.sirius);
    expect(reconstructed.getFollowDistance(pubKeys.sirius)).toBe(0);
    expect(reconstructed.getFollowDistance(pubKeys.adam)).toBe(1000); // Not reachable from sirius
    expect(reconstructed.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true); // Follow relationship preserved
  });

  it('should preserve mute relationship for a single mute event', async () => {
    const graph = new SocialGraph(pubKeys.adam);
    const muteEvent: NostrEvent = {
      created_at: 1000,
      content: '',
      tags: [['p', pubKeys.bob]],
      kind: 10000,
      pubkey: pubKeys.adam,
      id: 'muteEvent1',
      sig: 'signature',
    };
    graph.handleEvent(muteEvent, true);

    // Check original graph
    expect(graph.getMutedByUser(pubKeys.adam)).toContain(pubKeys.bob);

    // Serialize and deserialize
    const binary = await graph.toBinary();
    const reconstructed = await SocialGraph.fromBinary(pubKeys.adam, binary);

    // Check reconstructed graph
    expect(reconstructed.getMutedByUser(pubKeys.adam)).toContain(pubKeys.bob);
  });

  it('should include version number in binary format', async () => {
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

    const binary = await graph.toBinary();
    
    // Check that the first bytes contain the version number (now varint encoded)
    const version = decodeVarint(binary, 0);
    expect(version.value).toBe(Binary.BINARY_FORMAT_VERSION);
    
    // Verify the binary still works correctly
    const reconstructed = await SocialGraph.fromBinary(pubKeys.adam, binary);
    expect(reconstructed.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
  });


}); 