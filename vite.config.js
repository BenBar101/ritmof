import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages: set VITE_BASE_PATH to your repo name with slashes, e.g. /my-repo/
// Leave unset for local dev or custom domain (defaults to /).
const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
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
    rollupOptions: {
      output: { manualChunks: undefined }
    }
  }
});
