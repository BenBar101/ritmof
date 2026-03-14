import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ── Security note: environment variable inlining ──────────────────────────────
// VITE_DROPBOX_APP_KEY is intentionally exposed to the browser via Vite's
// standard import.meta.env substitution (compile-time string replacement).
// This is correct for public-client OAuth PKCE apps — the App Key alone cannot
// complete the code exchange without the code_verifier stored in sessionStorage.
// See src/api/dropbox.js for the full residual threat model.
//
// IMPORTANT: This config does NOT define a `define` block for any secret
// environment variable. Do not add `define({ 'process.env.VITE_DROPBOX_APP_KEY': ... })`
// or similar patterns — that would double-expose the key and make it accessible
// to dynamically-evaluated code that cannot read import.meta.env.
//
// If you need to pass env vars to a Node.js plugin, use `process.env.X` inside
// the plugin function (server-side only) and never pass the value into `define`.
// ─────────────────────────────────────────────────────────────────────────────

// GitHub Pages: set VITE_BASE_PATH to your repo name with slashes, e.g. /my-repo/
// Leave unset for local dev or custom domain (defaults to /).
const base = process.env.VITE_BASE_PATH || '/';
const CACHE_VERSION = `v${Date.now()}`;

export default defineConfig({
  base,
  define: {
    "self.__RITMOL_CACHE_VERSION__": JSON.stringify(CACHE_VERSION),
  },
  plugins: [
    react(),
    {
      name: 'sw-cache-version',
      closeBundle() {
        const swPath = resolve(__dirname, 'sw.js');
        const outPath = resolve(__dirname, 'dist', 'sw.js');
        const content = readFileSync(swPath, 'utf-8')
          .replace(/self\.__RITMOL_CACHE_VERSION__\s*\|\|\s*"v__BUILD_HASH__"/, JSON.stringify(CACHE_VERSION));
        writeFileSync(outPath, content);
      },
    },
    {
      name: 'html-base',
      transformIndexHtml(html) {
        const baseTag = base !== '/' ? `<base href="${base}">` : '';
        return baseTag ? html.replace(/<head>/, `<head>${baseTag}`) : html;
      },
    },
  ],
  build: {
    outDir: 'dist',
    // Never ship sourcemaps to production. Sourcemaps expose the full
    // original source including security comments, sessionStorage key names,
    // sanitization logic, and internal function names.
    sourcemap: false,
    // Inline all assets under 10 kB so the app works from a single HTML file
    // when loaded from a local Syncthing folder (file:// protocol).
    assetsInlineLimit: 10240,
    rollupOptions: {
      // Single output chunk — prevents split chunks from requiring a second
      // network fetch when the app is served from GitHub Pages or used offline.
      output: { manualChunks: undefined },
    },
  },
});
