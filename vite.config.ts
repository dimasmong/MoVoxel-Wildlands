import { defineConfig } from 'vite';

// Relative base so the static build works on GitHub Pages sub-paths and Vercel alike.
export default defineConfig({
  base: './',
  server: { port: 5178, host: true },
  preview: { port: 4178, host: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
