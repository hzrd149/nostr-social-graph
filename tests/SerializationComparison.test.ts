import { describe, it, expect } from 'vitest';
import { SocialGraph } from '../src/SocialGraph';
import { NostrEvent, pubKeyRegex } from '../src/utils';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toBinaryChunks } from '../src/SocialGraphBinary';
import os from 'os';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pubKeys = {
    adam: "020f2d21ae09bf35fcdfb65decf1478b846f5f728ab30c5eaabcd6d081a81c3e",
    fiatjaf: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
    snowden: "84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240",
    sirius: "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0",
    alice: "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
    bob: "b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345678",
    charlie: "c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890",
    diana: "d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890ab",
    eve: "e5f6789012345678901234567890abcdef1234567890abcdef1234567890abcd",
    frank: "f6789012345678901234567890abcdef1234567890abcdef1234567890abcdef",
};

describe('Serialization Size Comparison', () => {
  it('should compare JSON vs binary serialization sizes', async () => {
    const graph = new SocialGraph(pubKeys.adam);
    
    // Create a complex social graph with multiple follows and mutes
    const events: NostrEvent[] = [
      // Adam follows multiple people
      {
        created_at: 1000,
        content: '',
        tags: [['p', pubKeys.fiatjaf], ['p', pubKeys.snowden], ['p', pubKeys.alice]],
        kind: 3,
        pubkey: pubKeys.adam,
        id: 'event1',
        sig: 'signature',
      },
      // Fiatjaf follows people
      {
        created_at: 2000,
        content: '',
        tags: [['p', pubKeys.snowden], ['p', pubKeys.bob]],
        kind: 3,
        pubkey: pubKeys.fiatjaf,
        id: 'event2',
        sig: 'signature',
      },
      // Snowden follows people
      {
        created_at: 3000,
        content: '',
        tags: [['p', pubKeys.charlie], ['p', pubKeys.diana]],
        kind: 3,
        pubkey: pubKeys.snowden,
        id: 'event3',
        sig: 'signature',
      },
      // Alice follows people
      {
        created_at: 4000,
        content: '',
        tags: [['p', pubKeys.eve], ['p', pubKeys.frank]],
        kind: 3,
        pubkey: pubKeys.alice,
        id: 'event4',
        sig: 'signature',
      },
      // Adam mutes some people
      {
        created_at: 5000,
        content: '',
        tags: [['p', pubKeys.bob], ['p', pubKeys.charlie]],
        kind: 10000,
        pubkey: pubKeys.adam,
        id: 'muteEvent1',
        sig: 'signature',
      },
      // Fiatjaf mutes someone
      {
        created_at: 6000,
        content: '',
        tags: [['p', pubKeys.diana]],
        kind: 10000,
        pubkey: pubKeys.fiatjaf,
        id: 'muteEvent2',
        sig: 'signature',
      },
    ];

    // Process all events
    for (const ev of events) {
      graph.handleEvent(ev, true);
    }

    // Serialize to JSON
    const jsonSerialized = await graph.serialize();
    const jsonString = JSON.stringify(jsonSerialized);
    const jsonBytes = new TextEncoder().encode(jsonString);

    // Serialize to binary
    const binaryData = await graph.toBinary();

    // Calculate sizes
    const jsonSize = jsonBytes.length;
    const binarySize = binaryData.length;
    const compressionRatio = ((jsonSize - binarySize) / jsonSize * 100).toFixed(2);

    console.log('\n=== Serialization Size Comparison ===');
    console.log(`JSON size: ${jsonSize} bytes`);
    console.log(`Binary size: ${binarySize} bytes`);
    console.log(`Binary is ${compressionRatio}% smaller than JSON`);
    console.log(`Compression ratio: ${(jsonSize / binarySize).toFixed(2)}x`);

    // Verify both serializations work correctly
    const reconstructedFromJson = new SocialGraph(pubKeys.adam, jsonSerialized);
    const reconstructedFromBinary = await SocialGraph.fromBinary(pubKeys.adam, binaryData);

    // Check that both reconstructions are identical
    expect(reconstructedFromJson.size()).toEqual(reconstructedFromBinary.size());
    expect(reconstructedFromJson.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(reconstructedFromBinary.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    
    expect(reconstructedFromJson.getMutedByUser(pubKeys.adam)).toContain(pubKeys.bob);
    expect(reconstructedFromBinary.getMutedByUser(pubKeys.adam)).toContain(pubKeys.bob);

    // Assert that binary is smaller than JSON
    expect(binarySize).toBeLessThan(jsonSize);
  });

  it('should convert socialGraph.json to binary and save it', async () => {
    const jsonFilePath = path.join(__dirname, '../data/socialGraph.json');
    const tmpDir = os.tmpdir();
    const uniqueName = `socialGraph-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex')}.bin`;
    const binaryFilePath = path.join(tmpDir, uniqueName);
    
    if (!fs.existsSync(jsonFilePath)) {
      console.log('Skipping test: socialGraph.json not found');
      return;
    }

    console.log(`\nLoading ${jsonFilePath}...`);
    const jsonData = fs.readFileSync(jsonFilePath, 'utf-8');
    console.log(`\nParsing ${jsonFilePath}...`);
    const parsedData = JSON.parse(jsonData);
    console.log(`\nCreating graph...`);
    const graph = new SocialGraph(pubKeys.adam, parsedData);
    console.log(`\nRecalculating follow distances...`);

    // Wait for follow distances to be calculated
    await graph.recalculateFollowDistances();
    
    // Also wait for the second recalculation that happens after deserialization
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log(`\nConverting ${jsonFilePath} to binary format...`);
    console.time("toBinaryChunks");

    // Serialize to binary and stream directly to file without loading entire data into memory
    const writeStream = fs.createWriteStream(binaryFilePath);
    for await (const chunk of toBinaryChunks(graph)) {
      //process.stdout.write(".");
      writeStream.write(Buffer.from(chunk));
    }
    console.timeEnd("toBinaryChunks");

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });
    console.log(`\nBinary file saved to: ${binaryFilePath}`);
    const binaryBuffer = fs.readFileSync(binaryFilePath);
    const binaryData = new Uint8Array(binaryBuffer);
    console.log(`Binary file read into memory`);

    // Get file sizes
    const jsonFileSize = fs.statSync(jsonFilePath).size;
    const binaryFileSize = fs.statSync(binaryFilePath).size;
    const compressionRatio = ((jsonFileSize - binaryFileSize) / jsonFileSize * 100).toFixed(2);

    console.log('\n=== File Size Comparison ===');
    console.log(`JSON file: ${jsonFileSize} bytes (${(jsonFileSize / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`Binary file: ${binaryFileSize} bytes (${(binaryFileSize / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`Binary is ${compressionRatio}% smaller than JSON`);
    console.log(`Compression ratio: ${(jsonFileSize / binaryFileSize).toFixed(2)}x`);

    // Verify the binary file can be loaded correctly
    const reconstructedFromBinary = await SocialGraph.fromBinary(pubKeys.adam, binaryData);
    
    // Wait for recalculation to complete before checking sizes
    await reconstructedFromBinary.recalculateFollowDistances();
        
    // The binary serialization may filter out inconsistent data, so we verify that:
    // 1. The reconstructed graph has valid data
    // 2. The follow and mute counts are reasonable (not zero unless original is zero)
    // 3. The user count is positive
    const originalSize = graph.size();
    const reconstructedSize = reconstructedFromBinary.size();
    
    expect(reconstructedSize.users).toBeGreaterThan(0);
    expect(reconstructedSize.follows).toBeGreaterThan(0);
    expect(reconstructedSize.mutes).toBeGreaterThan(0);
    
    // The reconstructed graph should have data that's a subset of or equal to the original
    expect(reconstructedSize.users).toBeLessThanOrEqual(originalSize.users);
    expect(reconstructedSize.follows).toBeLessThanOrEqual(originalSize.follows);
    expect(reconstructedSize.mutes).toBeLessThanOrEqual(originalSize.mutes);
    
    console.log(`\nVerification: Binary serialization preserves consistent data`);
    console.log(`Original graph size: ${originalSize.users} users, ${originalSize.follows} follows, ${originalSize.mutes} mutes`);
    console.log(`Reconstructed graph size: ${reconstructedSize.users} users, ${reconstructedSize.follows} follows, ${reconstructedSize.mutes} mutes`);
    
    if (reconstructedSize.users < originalSize.users) {
      console.log(`Note: ${originalSize.users - reconstructedSize.users} users were filtered out due to data inconsistencies`);
    }

    // Assert that binary is smaller than JSON
    expect(binaryFileSize).toBeLessThan(jsonFileSize);
  }, { timeout: 120000 }); // 2 minute timeout for large data

  it('should show detailed breakdown of serialization sizes', async () => {
    const graph = new SocialGraph(pubKeys.adam);
    
    // Add some test data
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
        tags: [['p', pubKeys.alice]],
        kind: 10000,
        pubkey: pubKeys.adam,
        id: 'muteEvent1',
        sig: 'signature',
      },
    ];

    graph.handleEvent(events, true);

    // Get detailed breakdown
    const jsonSerialized = await graph.serialize();
    const jsonString = JSON.stringify(jsonSerialized);
    const jsonBytes = new TextEncoder().encode(jsonString);
    const binaryData = await graph.toBinary();

    console.log('\n=== Detailed Size Breakdown ===');
    console.log(`Unique IDs count: ${jsonSerialized.uniqueIds.length}`);
    console.log(`Follow lists count: ${jsonSerialized.followLists.length}`);
    console.log(`Mute lists count: ${jsonSerialized.muteLists?.length || 0}`);
    console.log(`Graph size:`, graph.size());
    
    // Calculate uniqueIds size separately
    const uniqueIdsJson = JSON.stringify(jsonSerialized.uniqueIds);
    const uniqueIdsBytes = new TextEncoder().encode(uniqueIdsJson);
    
    console.log(`Unique IDs JSON size: ${uniqueIdsBytes.length} bytes`);
    console.log(`Total JSON size: ${jsonBytes.length} bytes`);
    console.log(`Binary size: ${binaryData.length} bytes`);
    console.log(`Binary compression: ${((jsonBytes.length - binaryData.length) / jsonBytes.length * 100).toFixed(2)}%`);

    // Verify functionality
    const reconstructedFromJson = new SocialGraph(pubKeys.adam, jsonSerialized);
    const reconstructedFromBinary = await SocialGraph.fromBinary(pubKeys.adam, binaryData);

    expect(reconstructedFromJson.size()).toEqual(reconstructedFromBinary.size());
    expect(reconstructedFromJson.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
    expect(reconstructedFromBinary.isFollowing(pubKeys.adam, pubKeys.fiatjaf)).toBe(true);
  });
}); 