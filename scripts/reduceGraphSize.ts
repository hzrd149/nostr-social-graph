#!/usr/bin/env ts-node

// Script to shrink socialGraph.json & socialGraph.bin to ~1 MB, keep originals as *.large.*, and
// to generate profileData.small.json that only contains profiles referenced by the graph.

import fs from 'fs';
import path from 'path';

// Import graph utilities from the library itself
import { SocialGraph } from '../src';
import {
  SOCIAL_GRAPH_ROOT,
  DATA_DIR,
  SOCIAL_GRAPH_FILE as JSON_FILE,
  DATA_FILE as PROFILE_DATA_FILE,
} from '../src/constants';

// Additional paths not defined in constants
const BIN_FILE = path.join(DATA_DIR, 'socialGraph.bin');
const LARGE_JSON_FILE = path.join(DATA_DIR, 'socialGraph.large.json');
const LARGE_BIN_FILE = path.join(DATA_DIR, 'socialGraph.large.bin');
const SMALL_PROFILE_FILE = path.join(DATA_DIR, 'profileData.small.json');

const ONE_MB = 1024 * 1024; // 1 MiB in bytes

/**
 * Detect the graph root pubkey from the serialized graph.
 */
function detectRoot(serialized: any): string {
  try {
    const rootId: number | undefined = serialized?.followLists?.[0]?.[0];
    if (rootId === undefined) return SOCIAL_GRAPH_ROOT;
    const match = serialized.uniqueIds?.find(([, id]: [string, number]) => id === rootId);
    return match ? match[0] : SOCIAL_GRAPH_ROOT;
  } catch {
    return SOCIAL_GRAPH_ROOT;
  }
}

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
  if (fs.existsSync(JSON_FILE) && fs.statSync(JSON_FILE).size > ONE_MB) {
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
  const rootPubKey = detectRoot(originalSerialized);
  const graph = new SocialGraph(rootPubKey, originalSerialized);
  await graph.recalculateFollowDistances();

  // (Re-)serialize with a strict 1 MB limit when necessary
  let serialized = fs.existsSync(JSON_FILE) ? originalSerialized : await graph.serialize(ONE_MB);
  if (!fs.existsSync(JSON_FILE)) {
    ensureDirExists(JSON_FILE);
    fs.writeFileSync(JSON_FILE, JSON.stringify(serialized));
    console.log(`Wrote reduced socialGraph.json (${fs.statSync(JSON_FILE).size} bytes)`);
  }

  /* ------------------------------- BINARY ------------------------------- */
  if (fs.existsSync(BIN_FILE) && fs.statSync(BIN_FILE).size > ONE_MB) {
    console.log(`Shrinking socialGraph.bin (size ${fs.statSync(BIN_FILE).size} bytes)…`);
    fs.renameSync(BIN_FILE, LARGE_BIN_FILE);
  }

  // Always regenerate the binary from the (possibly) reduced JSON
  let currentLimit = ONE_MB;
  let binary: Uint8Array;
  // We'll try up to 5 iterations to reach the size goal
  for (let attempt = 0; attempt < 5; attempt++) {
    const tmpGraph = new SocialGraph(rootPubKey, serialized);
    binary = await tmpGraph.toBinary();
    if (binary.length <= ONE_MB) break;
    // Too big – tighten JSON limit and retry
    currentLimit = Math.floor(currentLimit * 0.9);
    serialized = await graph.serialize(currentLimit);
  }
  ensureDirExists(BIN_FILE);
  fs.writeFileSync(BIN_FILE, Buffer.from(binary!));
  console.log(`Wrote socialGraph.bin (${binary!.length} bytes)`);

  /* ------------------------ profileData.small.json ----------------------- */
  if (fs.existsSync(PROFILE_DATA_FILE)) {
    const profiles: string[][] = JSON.parse(fs.readFileSync(PROFILE_DATA_FILE, 'utf8'));
    const allowedPubKeys = new Set<string>(serialized.uniqueIds.map((u: [string, number]) => u[0]));
    const filtered = profiles.filter((p) => allowedPubKeys.has(p[0]));
    ensureDirExists(SMALL_PROFILE_FILE);
    fs.writeFileSync(SMALL_PROFILE_FILE, JSON.stringify(filtered));
    console.log(`Wrote profileData.small.json with ${filtered.length} profiles`);
  } else {
    console.warn('profileData.json not found – skipping profileData.small.json generation.');
  }
}

// Run
main().catch((err) => {
  console.error(err);
  process.exit(1);
}); 