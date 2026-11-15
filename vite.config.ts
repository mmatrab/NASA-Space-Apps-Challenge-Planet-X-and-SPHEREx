import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { handleApi } from './server/api.ts';

/** Serves /api/* from the same dev server, so `npm run dev` is all that is needed. */
const api = (): Plugin => ({
  name: 'spherex-api',
  configureServer(server) {
    server.middlewares.use((req, res, next) => void handleApi(req, res, next));
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => void handleApi(req, res, next));
  },
});

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), api()],
});
