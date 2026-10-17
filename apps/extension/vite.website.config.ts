import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: '../../demo/workspace',
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'workspace.html') },
  },
});
