/**
 * Production server: serves the built app (dist/) and the API on one port.
 *   npm run build && npm start      (PORT defaults to 8080)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { handleApi } from './api.ts';

const root = path.resolve(import.meta.dirname, '..', 'dist');
const port = Number(process.env.PORT ?? 8080);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  await handleApi(req, res, async () => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
    let file = path.join(root, urlPath);
    if (!file.startsWith(root)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    } catch {
      file = path.join(root, 'index.html'); // single-page app: unknown paths get the app
    }
    try {
      const body = await readFile(file);
      res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('Not found. Run "npm run build" first.');
    }
  });
}).listen(port, () => console.log(`SPHEREx Sky Motion on http://localhost:${port}`));
