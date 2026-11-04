import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:5100', changeOrigin: true },
      '/hubs': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:5100', ws: true },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], exclude: ['**/node_modules/**', '**/e2e/**'] },
});
