// Serves this demo folder at http://127.0.0.1:18891 (index.html = with Sem, before.html = without).
const fs = require('node:fs'), path = require('node:path')
require('node:http').createServer((q, r) => {
  const f = path.join(__dirname, path.basename(new URL(q.url, 'http://x').pathname) || 'index.html')
  if (!fs.existsSync(f) || !f.endsWith('.html')) { r.writeHead(404).end(); return }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(f))
}).listen(18891, '127.0.0.1', () => console.log('http://127.0.0.1:18891'))
