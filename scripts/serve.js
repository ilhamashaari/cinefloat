/* ==========================================================================
   scripts/serve.js — a zero-dependency static server for testing CineFloat in
   a normal browser:   npm run web   →   http://localhost:5173
   (Double-clicking index.html also works, but YouTube trailers refuse to play
   on file:// pages, so use this server when you want to test trailers.)
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
const PUBLIC = new Set(['index.html', 'config.js', 'css', 'js', 'assets']); // nothing else is ever served

http.createServer((req, res) => {
  const send = (code, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };

  // config.js contains your token, so refuse look-alike hostnames (DNS rebinding)
  // and requests that were triggered by some other website.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return send(403, 'Forbidden host');
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return send(403, 'Cross-site requests are blocked');

  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { return send(400, 'Bad request'); }
  if (rel === '/') rel = '/index.html';

  const file = path.normalize(path.join(ROOT, rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !PUBLIC.has(top)) return send(404, 'Not found');

  fs.readFile(file, (err, data) =>
    err ? send(404, 'Not found') : send(200, data, TYPES[path.extname(file)] || 'application/octet-stream'));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`CineFloat is running at http://localhost:${PORT}   (Ctrl+C to stop)`);
});
