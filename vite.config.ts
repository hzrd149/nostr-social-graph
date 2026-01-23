import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@msgpack/msgpack': path.resolve(
        __dirname,
        'node_modules/@msgpack/msgpack/dist.esm/index.mjs'
      ),
    },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'nostr-social-graph',
      // The file name for the generated bundle (entry point of your library)
      fileName: (format) => `nostr-social-graph.${format}.js`,
    },
    outDir: 'dist',
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/docs/**',
      '**/e2e/**',
      '**/.{idea,git,cache,output,temp}/**'
    ]
  }
});
