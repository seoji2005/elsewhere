import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const main = resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.vrm': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': /-[\w-]{8,}\.[\w]+$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(main ? Number(process.argv[2] ?? 4173) : 0, '127.0.0.1', resolve);
});
export const distURL = `http://127.0.0.1:${server.address().port}/`;
if (main) console.log(`Serving dist: ${distURL}`);
else server.unref(); // Imported by browser tools; do not keep their process alive after Chromium closes.
