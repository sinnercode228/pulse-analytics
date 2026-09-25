import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * GitHub Pages serves the demo from https://<user>.github.io/<repo>/, so the
 * production build uses the repo name as base. Override with PAGES_BASE=/.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.PAGES_BASE ?? '/pulse-analytics/') : '/',
  plugins: [react()],
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', ws: true },
      '/p.js': 'http://127.0.0.1:8787',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes('node_modules/uplot')
            ? 'uplot'
            : id.includes('node_modules/react')
              ? 'react'
              : undefined,
      },
    },
  },
}));
