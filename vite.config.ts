import fs from "fs";
import path from "path";
import { defineConfig } from "vitest/config";

// Tests that depend on the external hashtree repo (../../hashtree/) are
// excluded when that repo isn't checked out alongside this one.
const hashtreeAvailable = fs.existsSync(
  path.resolve(__dirname, "../../hashtree/ts/packages/hashtree/src/types.ts"),
);
const hashtreeTestExcludes = hashtreeAvailable
  ? []
  : [
      "tests/ProfileSearchIndex.test.ts",
      "tests/profileSearchIndexNhash.test.ts",
      "tests/publishProfileSearchIndex.test.ts",
    ];

export default defineConfig({
  resolve: {
    alias: {
      "@msgpack/msgpack": path.resolve(
        __dirname,
        "node_modules/@msgpack/msgpack/dist.esm/index.mjs",
      ),
    },
  },
  build: {
    lib: {
      entry: "src/index.ts",
      name: "nostr-social-graph",
      formats: ["es", "cjs"],
      fileName: (format) =>
        format === "cjs"
          ? "nostr-social-graph.cjs"
          : "nostr-social-graph.es.js",
    },
    outDir: "dist",
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/docs/**",
      "**/e2e/**",
      "**/.{idea,git,cache,output,temp}/**",
      ...hashtreeTestExcludes,
    ],
  },
});
