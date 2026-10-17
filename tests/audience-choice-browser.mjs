import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + pathname);
  if (relative(root, file).startsWith('..')) { response.writeHead(403); response.end(); return; }
  try {
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(content);
  } catch { response.writeHead(404); response.end('Not Found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const fakeQnaModule = String.raw