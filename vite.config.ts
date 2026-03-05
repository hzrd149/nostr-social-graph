import path from "path";
import { defineConfig } from "vitest/config";

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
    ],
  },
});
