import fs from "fs";
import NDK from "@nostr-dev-kit/ndk";
import WebSocket from "ws";
import { SocialGraph, fromBinary } from "../src";
import { Crawler } from "./crawler";
import { ProfileIndexer } from "./profileIndexer";
import { publishProfileSearchIndex } from "./publishProfileSearchIndex";
import { SOCIAL_GRAPH_LARGE_BIN, SOCIAL_GRAPH_ROOT, RELAY_URLS } from "../src/constants";

global.WebSocket = WebSocket as any;

type ProductionCrawlOptions = {
  skipSocialGraphCrawl?: boolean;
  forceSocialGraphCrawl?: boolean;
};

export type ProductionCrawlResult = {
  profileCount: number;
  searchIndexRoot: ReturnType<ProfileIndexer['getSearchIndexRoot']>;
  searchIndexNhash: string | null;
  publishedSearchIndexNhash?: string | null;
};

async function loadSocialGraph(): Promise<SocialGraph> {
  if (fs.existsSync(SOCIAL_GRAPH_LARGE_BIN)) {
    try {
      const socialGraphData = fs.readFileSync(SOCIAL_GRAPH_LARGE_BIN);
      const graph = await fromBinary(SOCIAL_GRAPH_ROOT, socialGraphData);
      await graph.recalculateFollowDistances();
      console.log("Loaded social graph of size", graph.size());
      return graph;
    } catch (e) {
      console.error("Error deserializing social graph:", e);
    }
  }

  const graph = new SocialGraph(SOCIAL_GRAPH_ROOT);
  console.log("Created new social graph");
  return graph;
}

export async function runProductionCrawl(
  options: ProductionCrawlOptions = {}
): Promise<ProductionCrawlResult> {
  const ndk = new NDK({
    explicitRelayUrls: RELAY_URLS,
  });

  let socialGraph = await loadSocialGraph();
  const shouldCrawlSocialGraph = options.skipSocialGraphCrawl !== true;
  const shouldForceCrawl = options.forceSocialGraphCrawl === true;

  if (shouldCrawlSocialGraph && (shouldForceCrawl || !fs.existsSync(SOCIAL_GRAPH_LARGE_BIN))) {
    console.log("Starting social graph crawl...");
    const crawler = new Crawler(socialGraph, ndk);
    await crawler.initialize();
    await crawler.flush();
    socialGraph = crawler.getSocialGraph();
  } else {
    await socialGraph.recalculateFollowDistances();
  }

  console.log("Starting profile crawl...");
  const indexer = new ProfileIndexer(socialGraph, ndk);
  await indexer.initialize();
  await indexer.flush();
  const profileCount = indexer.getProfileCount();
  const searchIndexRoot = indexer.getSearchIndexRoot();
  const searchIndexNhash = indexer.getSearchIndexNhash();
  let publishedSearchIndexNhash: string | null = null;
  if (process.env.PUBLISH_PROFILE_SEARCH_INDEX === "true") {
    const publishResult = await publishProfileSearchIndex({
      root: searchIndexRoot ?? undefined,
    });
    publishedSearchIndexNhash = publishResult.nhash;
    console.log("Profile search index published:", publishResult.nhash);
  }
  console.log("Profile crawl complete. Indexed profiles:", profileCount);
  return { profileCount, searchIndexRoot, searchIndexNhash, publishedSearchIndexNhash };
}

if (process.argv.includes("--run")) {
  const skipSocialGraphCrawl = process.env.SKIP_SOCIAL_GRAPH_CRAWL === "true";
  const forceSocialGraphCrawl = process.env.FORCE_SOCIAL_GRAPH_CRAWL === "true";

  runProductionCrawl({ skipSocialGraphCrawl, forceSocialGraphCrawl })
    .then((result) => {
      if (result.searchIndexNhash) {
        console.log("Profile search index nhash:", result.searchIndexNhash);
      } else {
        console.log("Profile search index nhash: unavailable");
      }
    })
    .catch((error) => {
      console.error("Production crawl failed:", error);
      process.exit(1);
    });
}
