import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Content script: single self-contained IIFE, appended to dist/ after the main build.
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'A2CContent',
      fileName: () => 'content.js',
    },
  },
});
