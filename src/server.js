// 아주 작은 웹서버(바깥 부품 없음). 결과 파일만 보여 준다.
//   node src/server.js        → http://127.0.0.1:3320
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { p } from './lib/paths.js';

const PORT = Number(process.env.PORT || 3320), HOST = process.env.HOST || '127.0.0.1';
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === "/favicon.ico") { res.writeHead(204); return res.end(); }
  let file = null;
  if (url === '/' || url === '/index.html') file = p('web/index.html');
  else if (url === '/today.json') file = p('web/today.json');
  else if (/^\/sample\/\d+\.txt$/.test(url)) file = p('fixtures/sample_docs', path.basename(url));
  if (!file || !fs.existsSync(file)) { res.writeHead(404, { 'content-type': TYPES['.txt'] }); return res.end('없음'); }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, HOST, () => console.log(`뉴스풀이 화면: http://${HOST}:${PORT}`));
