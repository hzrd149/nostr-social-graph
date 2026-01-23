import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@msgpack/msgpack': path.resolve(
        __dirname,
        '../node_modules/@msgpack/msgpack/dist.esm/index.mjs'
      ),
    },
  },
  build: {
    rollupOptions: {
      input: 'index.html',
    },
    outDir: 'dist',
  },
});
