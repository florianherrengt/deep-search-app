import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // deep-search-core ships without `sideEffects: false`, which blocks
  // tree-shaking of its cheerio/parse5 HTML-parsing path when callers only
  // need search providers or type imports. Marking the package side-effect
  // free here lets Rollup drop ~300 KB of HTML-parsing code from the main
  // bundle (it instead lands in a lazy chunk loaded on first extraction).
  build: {
    rollupOptions: {
      treeshake: {
        moduleSideEffects: (id) =>
          id.includes("node_modules/deep-search-core/") ? false : undefined,
      },
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
