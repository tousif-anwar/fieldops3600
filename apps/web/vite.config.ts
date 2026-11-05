import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Cache the shared application runtime and keep the charting engine out
        // of routes that do not render charts. Fluent UI remains tree-shaken in
        // the route chunks that actually use each component.
        manualChunks: {
          "app-vendor": [
            "react",
            "react-dom",
            "react-router-dom",
            "@tanstack/react-query",
            "oidc-client-ts",
          ],
          charts: ["recharts"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:5100",
        changeOrigin: true,
      },
      "/hubs": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:5100",
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
