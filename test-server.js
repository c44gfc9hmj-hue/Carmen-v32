// Local test server that reuses the production worker.js logic exactly.
// Serves static files from disk via a fake ASSETS binding and routes /health,
// /search, /chat, /analyze, /synthesize through the worker's fetch handler.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './worker.js';

const DIR = resolve(fileURLToPath(new URL('public/', import.meta.url)));
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const env = {
  API_KEY: process.env.API_KEY || undefined,
  MODEL: process.env.MODEL,
  API_URL: process.env.API_URL,
  ASSETS: {
    async fetch(req) {
      const u = new URL(req.url);
      let path = decodeURIComponent(u.pathname);
      if (path === '/' || path === '') path = '/index.html';
      const full = resolve(DIR, '.' + path);
      if (!full.startsWith(DIR)) return new Response('Forbidden', { status: 403 });
      try {
        const body = await readFile(full);
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jsonc': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };
        return new Response(body, { status: 200, headers: { 'content-type': types[extname(full)] || 'application/octet-stream' } });
      } catch { return new Response('Not found', { status: 404 }); }
    },
  },
};

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const url = `http://${host}${req.url}`;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) { const val = Array.isArray(v) ? v.join(', ') : v; if (val != null) headers.set(k, val); }
    const init = { method: req.method, headers };
    if (body && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
    const request = new Request(url, init);
    const response = await worker.fetch(request, env);
    const buf = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e?.stack || e));
  }
});

server.listen(PORT, () => console.log(`Carmen test server on http://localhost:${PORT}`));
