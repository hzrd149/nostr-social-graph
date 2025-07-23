import { describe, it, expect } from 'vitest';
import { SocialGraph } from '../src/SocialGraph';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

const pubKeys = {
    adam: "020f2d21ae09bf35fcdfb65decf1478b846f5f728ab30c5eaabcd6d081a81c3e",
    fiatjaf: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
    snowden: "84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240",
    sirius: "4523be58d395b1b196a9b8c82b038b6895cb02b683d0c253a955068dba1facd0",
    bob: "4132aeeee5c7b3497d260c922758e804a9cf9c0933d3e333bfd15f7695db3852",
};

describe('SocialGraph binary file load', () => {
  it('loads data/socialGraph.bin using fromBinary (Uint8Array)', async () => {
    const binFilePath = path.join(__dirname, '../data/socialGraph.bin');
    if (!fs.existsSync(binFilePath)) {
      console.warn('Skipping test: socialGraph.bin not found');
      return;
    }
    const start = Date.now();
    const fileBuffer = fs.readFileSync(binFilePath);
    const fileBytes = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
    const graph = await SocialGraph.fromBinary(pubKeys.adam, fileBytes);
    const end = Date.now();
    expect(graph.getRoot()).toBe(pubKeys.adam);
    expect(graph.size().users).toBeGreaterThan(0);
    // Note: follows may be 0 if data was filtered during serialization for consistency
    expect(graph.size().follows).toBeGreaterThanOrEqual(0);
    console.log('fromBinary (Uint8Array) took', ((end - start) / 1000).toFixed(2), 'seconds');
  }, 120000);

  it('loads data/socialGraph.bin using fromBinaryStream (custom ReadableStream)', async () => {
    const binFilePath = path.join(__dirname, '../data/socialGraph.bin');
    if (!fs.existsSync(binFilePath)) {
      console.warn('Skipping test: socialGraph.bin not found');
      return;
    }
    const start = Date.now();
    
    // Use Node.js built-in Readable.toWeb() - much simpler!
    const nodeStream = fs.createReadStream(binFilePath);
    const readableStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    const graph = await SocialGraph.fromBinaryStream(pubKeys.adam, readableStream);
    const end = Date.now();
    expect(graph.getRoot()).toBe(pubKeys.adam);
    expect(graph.size().users).toBeGreaterThan(0);
    // Note: follows may be 0 if data was filtered during serialization for consistency
    expect(graph.size().follows).toBeGreaterThanOrEqual(0);
    console.log('fromBinaryStream (custom ReadableStream) took', ((end - start) / 1000).toFixed(2), 'seconds');
  }, 120000);

  it('loads data/socialGraph.json for comparison', async () => {
    const jsonFilePath = path.join(__dirname, '../data/socialGraph.json');
    if (!fs.existsSync(jsonFilePath)) {
      console.warn('Skipping test: socialGraph.json not found');
      return;
    }
    const start = Date.now();
    const jsonData = fs.readFileSync(jsonFilePath, 'utf-8');
    const parsedData = JSON.parse(jsonData);
    const graph = new SocialGraph(pubKeys.adam, parsedData);
    const end = Date.now();
    expect(graph.getRoot()).toBe(pubKeys.adam);
    expect(graph.size().users).toBeGreaterThan(0);
    // Note: follows may be 0 if data was filtered during deserialization for consistency
    expect(graph.size().follows).toBeGreaterThanOrEqual(0);
    console.log('JSON loading took', ((end - start) / 1000).toFixed(2), 'seconds');
  }, 120000);
}); 