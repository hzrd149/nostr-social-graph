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

const GRAPH_JSON_SIZE_LIMIT = 1024 * 1536; // 1.5 MiB in bytes

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
  if (fs.existsSync(JSON_FILE) && fs.statSync(JSON_FILE).size > GRAPH_JSON_SIZE_LIMIT) {
    console.log(`Shrinking socialGraph.json (size ${fs.statSync(JSON_FILE).size} bytes)…`);
    fs.renameSync(JSON_FILE, LARGE_JSON_FILE);
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
  let serialized = fs.existsSync(JSON_FILE) ? originalSerialized : await graph.serialize(GRAPH_JSON_SIZE_LIMIT);
  if (!fs.existsSync(JSON_FILE)) {
    ensureDirExists(JSON_FILE);
    fs.writeFileSync(JSON_FILE, JSON.stringify(serialized));
    console.log(`Wrote reduced socialGraph.json (${fs.statSync(JSON_FILE).size} bytes)`);
  }

  /* ------------------------------- BINARY ------------------------------- */
  if (fs.existsSync(BIN_FILE) && fs.statSync(BIN_FILE).size > GRAPH_JSON_SIZE_LIMIT) {
    console.log(`Shrinking socialGraph.bin (size ${fs.statSync(BIN_FILE).size} bytes)…`);
    fs.renameSync(BIN_FILE, LARGE_BIN_FILE);
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

  let binarySerialized = sourceSerialized;
  let currentLimit = 2 * GRAPH_JSON_SIZE_LIMIT;
  let binary: Uint8Array;

  // We'll try up to 5 iterations to reach the size goal
  for (let attempt = 0; attempt < 5; attempt++) {
    const tmpGraph = new SocialGraph(SOCIAL_GRAPH_ROOT, binarySerialized);
    binary = await tmpGraph.toBinary();
    if (binary.length <= GRAPH_JSON_SIZE_LIMIT) break;

    // Too big – tighten JSON limit and retry
    currentLimit = Math.floor(currentLimit * 0.9);
    binarySerialized = await tmpGraph.serialize(currentLimit);
  }
  ensureDirExists(BIN_FILE);
  fs.writeFileSync(BIN_FILE, Buffer.from(binary!));
  console.log(`Wrote socialGraph.bin (${binary!.length} bytes)`);

  /* ------------------------ profileData.small.json ----------------------- */
  if (fs.existsSync(PROFILE_DATA_FILE)) {
    const profiles: string[][] = JSON.parse(fs.readFileSync(PROFILE_DATA_FILE, 'utf8'));
    const allowedPubKeys = new Set<string>(binarySerialized.uniqueIds.map((u: [string, number]) => u[0]));
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