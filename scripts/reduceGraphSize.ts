#!/usr/bin/env ts-node

// Script to shrink socialGraph.json & socialGraph.bin to ~1 MB, keep originals as *.large.*, and
// to generate profileData.json that only contains profiles referenced by the graph.

import fs from 'fs';
import path from 'path';

// Import graph utilities from the library itself
import { SocialGraph } from '../src';
import { SocialGraphUtils } from '../src/SocialGraphUtils';
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
const MAX_NODES: number | undefined = 30000;        // Maximum number of unique users/nodes
const MAX_EDGES: number | undefined = 500000;       // Maximum number of follow/mute relationships
const MAX_DISTANCE: number | undefined = 4;         // Maximum follow distance from root (optional, undefined = no limit)
const MAX_EDGES_PER_NODE: number | undefined = 1000; // Maximum edges per user (prevents any single user from dominating)

/** Format bytes in human readable format */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

  /* ---------------------- DETERMINE LARGEST SOURCE ---------------------- */
  // Always start from the largest available dataset for maximum flexibility
  let sourceGraph: SocialGraph;
  
  if (fs.existsSync(LARGE_BIN_FILE)) {
    console.log('Loading from large binary dataset...');
    const largeBinData = fs.readFileSync(LARGE_BIN_FILE);
    sourceGraph = await SocialGraph.fromBinary(SOCIAL_GRAPH_ROOT, new Uint8Array(largeBinData));
  } else if (fs.existsSync(LARGE_JSON_FILE)) {
    console.log('Loading from large JSON dataset...');
    const largeSerialized = JSON.parse(fs.readFileSync(LARGE_JSON_FILE, 'utf8'));
    sourceGraph = new SocialGraph(SOCIAL_GRAPH_ROOT, largeSerialized);
  } else {
    // Fall back to whatever JSON we have
    const jsonPath = fs.existsSync(JSON_FILE) ? JSON_FILE : null;
    if (!jsonPath) {
      console.warn('No socialGraph data found – aborting.');
      return;
    }
    console.log('Loading from available JSON dataset...');
    const serialized = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    sourceGraph = new SocialGraph(SOCIAL_GRAPH_ROOT, serialized);
  }

  await sourceGraph.recalculateFollowDistances();
  
  // Clean up muted users with zero followers before processing
  console.log('\n🧹 Cleaning up muted users with zero followers...');
  console.time('Cleanup muted users');
  
  const removedCount = await SocialGraphUtils.removeMutedNotFollowedUsers(sourceGraph);
  console.timeEnd('Cleanup muted users');
  
  // Recalculate distances after cleanup to get accurate stats
  if (removedCount > 0) {
    console.log('Recalculating follow distances after cleanup...');
    await sourceGraph.recalculateFollowDistances();
  }
  
  // Show source graph statistics
  const sourceStats = sourceGraph.size();
  console.log(`\n📈 Source Graph Statistics:`);
  console.log(`   Users: ${sourceStats.users.toLocaleString()}`);
  console.log(`   Follows: ${sourceStats.follows.toLocaleString()}`);
  console.log(`   Mutes: ${sourceStats.mutes.toLocaleString()}`);
  console.log(`   Users by Distance:`);
  for (const [distance, count] of Object.entries(sourceStats.sizeByDistance).sort(([a], [b]) => Number(a) - Number(b))) {
    console.log(`     Distance ${distance}: ${count.toLocaleString()} users`);
  }
  
  console.log(`\n🎯 Budget Constraints:`);
  console.log(`   Max Nodes: ${MAX_NODES ? MAX_NODES.toLocaleString() : 'unlimited'}`);
  console.log(`   Max Edges: ${MAX_EDGES ? MAX_EDGES.toLocaleString() : 'unlimited'}`);
  console.log(`   Max Distance: ${MAX_DISTANCE ?? 'unlimited'}`);
  console.log(`   Max Edges per Node: ${MAX_EDGES_PER_NODE ? MAX_EDGES_PER_NODE.toLocaleString() : 'unlimited'}`);
  
  /* ----------------------------- JSON OUTPUT ----------------------------- */
  console.log('\nGenerating budget-limited JSON...');
  ensureDirExists(JSON_FILE);
  
  const writeStream = fs.createWriteStream(JSON_FILE);
  for await (const chunk of sourceGraph.toJsonChunks(MAX_NODES, MAX_EDGES, MAX_DISTANCE, MAX_EDGES_PER_NODE)) {
    writeStream.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk));
  }
  
  await new Promise<void>((resolve, reject) => {
    writeStream.end(() => resolve());
    writeStream.on('error', reject);
  });
  
  const jsonSize = fs.statSync(JSON_FILE).size;
  console.log(`Wrote socialGraph.json (${formatBytes(jsonSize)})`);

  /* ------------------------------- BINARY ------------------------------- */

  console.log('Generating budget-limited binary...');
  // Use the SAME source graph with the SAME budget limits
  const binary = await sourceGraph.toBinary(MAX_NODES, MAX_EDGES, MAX_DISTANCE, MAX_EDGES_PER_NODE);
  
  ensureDirExists(BIN_FILE);
  fs.writeFileSync(BIN_FILE, Buffer.from(binary));
  const binarySize = binary.length;
  console.log(`Wrote socialGraph.bin (${formatBytes(binarySize)})`);
  
  // Load and show reduced graph statistics
  console.log('\nLoading reduced graph to verify statistics...');
  const reducedGraph = await SocialGraph.fromBinary(SOCIAL_GRAPH_ROOT, binary);
  await reducedGraph.recalculateFollowDistances();
  
  const reducedStats = reducedGraph.size();
  console.log(`\n📉 Reduced Graph Statistics:`);
  console.log(`   Users: ${reducedStats.users.toLocaleString()}`);
  console.log(`   Follows: ${reducedStats.follows.toLocaleString()}`);
  console.log(`   Mutes: ${reducedStats.mutes.toLocaleString()}`);
  console.log(`   Users by Distance:`);
  for (const [distance, count] of Object.entries(reducedStats.sizeByDistance).sort(([a], [b]) => Number(a) - Number(b))) {
    console.log(`     Distance ${distance}: ${count.toLocaleString()} users`);
  }
  
  // Show reduction summary
  const userReduction = ((sourceStats.users - reducedStats.users) / sourceStats.users * 100).toFixed(1);
  const followReduction = ((sourceStats.follows - reducedStats.follows) / sourceStats.follows * 100).toFixed(1);
  const muteReduction = ((sourceStats.mutes - reducedStats.mutes) / sourceStats.mutes * 100).toFixed(1);
  
  console.log(`\n🎯 Reduction Summary:`);
  console.log(`   Users: ${sourceStats.users.toLocaleString()} → ${reducedStats.users.toLocaleString()} (${userReduction}% reduction)`);
  console.log(`   Follows: ${sourceStats.follows.toLocaleString()} → ${reducedStats.follows.toLocaleString()} (${followReduction}% reduction)`);
  console.log(`   Mutes: ${sourceStats.mutes.toLocaleString()} → ${reducedStats.mutes.toLocaleString()} (${muteReduction}% reduction)`);
  
  // Show compression summary
  const compressionRatio = ((jsonSize - binarySize) / jsonSize * 100).toFixed(1);
  console.log(`\n📊 File Size Summary:`);
  console.log(`   JSON:   ${formatBytes(jsonSize)}`);
  console.log(`   Binary: ${formatBytes(binarySize)} (${compressionRatio}% smaller)`);

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