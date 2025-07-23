#!/usr/bin/env ts-node

// Script to shrink socialGraph.json & socialGraph.bin to ~1 MB, keep originals as *.large.*, and
// to generate profileData.json that only contains profiles referenced by the graph.

import fs from 'fs';
import path from 'path';

// Import graph utilities from the library itself
import { SocialGraph } from '../src';
import {
  SOCIAL_GRAPH_ROOT,
  DATA_DIR,
  SOCIAL_GRAPH_FILE as JSON_FILE,
  SOCIAL_GRAPH_LARGE_FILE as LARGE_JSON_FILE,
  DATA_FILE as PROFILE_DATA_FILE,
} from '../src/constants';

// Additional paths not defined in constants
const BIN_FILE = path.join(DATA_DIR, 'socialGraph.bin');
const LARGE_BIN_FILE = path.join(DATA_DIR, 'socialGraph.large.bin');
const SMALL_PROFILE_FILE = path.join(DATA_DIR, 'profileData.json');

// Budget limits for reasonable output sizes (targeting ~1-2MB files)
const MAX_NODES = 50000;  // Maximum number of unique users/nodes
const MAX_EDGES = 100000; // Maximum number of follow/mute relationships

/** Ensure a directory exists */
function ensureDirExists(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.warn(`Data directory '${DATA_DIR}' not found – nothing to shrink.`);
    return;
  }

  /* -------------------------------- JSON -------------------------------- */
  if (fs.existsSync(JSON_FILE)) {
    const currentSize = fs.statSync(JSON_FILE).size;
    // If file is larger than ~2MB, consider it "large" and back it up
    if (currentSize > 2 * 1024 * 1024) {
      console.log(`Backing up large socialGraph.json (size ${currentSize} bytes)…`);
      fs.renameSync(JSON_FILE, LARGE_JSON_FILE);
    }
  }

  // Pick whichever JSON we now have (small or large) to build the graph
  const jsonPath = fs.existsSync(JSON_FILE) ? JSON_FILE : fs.existsSync(LARGE_JSON_FILE) ? LARGE_JSON_FILE : null;
  if (!jsonPath) {
    console.warn('No socialGraph.json found – aborting.');
    return;
  }
  const originalSerialized = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const graph = new SocialGraph(SOCIAL_GRAPH_ROOT, originalSerialized);
  await graph.recalculateFollowDistances();
  await graph.removeMutedNotFollowedUsers();

  // (Re-)serialize with a strict 1 MB limit when necessary
  if (!fs.existsSync(JSON_FILE)) {
    console.log('Streaming reduced JSON to file...');
    ensureDirExists(JSON_FILE);
    
    // Use chunked streaming for better memory efficiency
    const writeStream = fs.createWriteStream(JSON_FILE);
    for await (const chunk of graph.toJsonChunks(MAX_NODES, MAX_EDGES)) {
      writeStream.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk));
    }
    
    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });
    
    console.log(`Wrote reduced socialGraph.json (${fs.statSync(JSON_FILE).size} bytes)`);
  }

  /* ------------------------------- BINARY ------------------------------- */
  if (fs.existsSync(BIN_FILE)) {
    const currentSize = fs.statSync(BIN_FILE).size;
    // If file is larger than ~2MB, consider it "large" and back it up
    if (currentSize > 2 * 1024 * 1024) {
      console.log(`Backing up large socialGraph.bin (size ${currentSize} bytes)…`);
      fs.renameSync(BIN_FILE, LARGE_BIN_FILE);
    }
  }

  // Determine the most complete source graph we have available.
  let sourceSerialized: any;
  if (fs.existsSync(LARGE_BIN_FILE)) {
    // Prefer the large binary as it contains the fullest data
    const largeBinData = fs.readFileSync(LARGE_BIN_FILE);
    const fullGraph = await SocialGraph.fromBinary(SOCIAL_GRAPH_ROOT, new Uint8Array(largeBinData));
    sourceSerialized = await fullGraph.serialize(); // No size limit
  } else if (fs.existsSync(LARGE_JSON_FILE)) {
    // Fall back to the large JSON
    sourceSerialized = JSON.parse(fs.readFileSync(LARGE_JSON_FILE, 'utf8'));
  } else {
    // Finally, use whatever JSON we initially read (may already be reduced)
    sourceSerialized = originalSerialized;
  }

  // Create graph from the most complete source and generate binary with size limit
  const sourceGraph = new SocialGraph(SOCIAL_GRAPH_ROOT, sourceSerialized);
  await sourceGraph.recalculateFollowDistances();
  
  console.log('Generating budget-limited binary...');
  // Use budget-aware binary serialization with reasonable limits
  const binary = await sourceGraph.toBinary(MAX_NODES, MAX_EDGES);
  
  ensureDirExists(BIN_FILE);
  fs.writeFileSync(BIN_FILE, Buffer.from(binary));
  console.log(`Wrote socialGraph.bin (${binary.length} bytes)`);

  /* ------------------------ profileData.small.json ----------------------- */
  if (fs.existsSync(PROFILE_DATA_FILE)) {
    const profiles: string[][] = JSON.parse(fs.readFileSync(PROFILE_DATA_FILE, 'utf8'));
    // Read the generated JSON file to get the actual IDs that were included
    const generatedData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    const allowedPubKeys = new Set<string>(generatedData.uniqueIds.map((u: [string, number]) => u[0]));
    const filtered = profiles.filter((p) => allowedPubKeys.has(p[0]));
    ensureDirExists(SMALL_PROFILE_FILE);
    fs.writeFileSync(SMALL_PROFILE_FILE, JSON.stringify(filtered));
    console.log(`Wrote profileData.json with ${filtered.length} profiles`);
  } else {
    console.warn('profileData.large.json not found – skipping profileData.json generation.');
  }
}

// Run
main().catch((err) => {
  console.error(err);
  process.exit(1);
}); 