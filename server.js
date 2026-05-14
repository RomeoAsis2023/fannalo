const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };
http.createServer((req, res) => {
  let p = req.url === '/' ? '/index.html' : req.url;
  p = path.join('.', p);
  try {
    const c = fs.readFileSync(p);
    const ext = path.extname(p);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(c);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(3001, () => console.log('Server on http://localhost:3001'));
