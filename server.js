const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
    '.woff2':'font/woff2',
};

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
    let filePath = path.join(__dirname, pathname);

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    const ext = path.extname(filePath);

    // En-têtes requis pour SharedArrayBuffer (multithreading)
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.writeHead(200);
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`Serveur SPH demarre sur http://localhost:${PORT}`);
    console.log('SharedArrayBuffer active (COOP/COEP headers OK)');
    console.log('Ctrl+C pour arreter');
});
