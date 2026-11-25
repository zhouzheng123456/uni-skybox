/**
 * 零依赖静态服务，供本地跑 demo。
 * 用法：node scripts/serve.mjs [root] [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || process.env.PORT || 5173);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.glsl': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

    let filePath = resolve(join(root, urlPath));

    if (isAbsolute(filePath) && !filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    try {
        const info = await stat(filePath);
        if (info.isDirectory()) {
            filePath = join(filePath, 'index.html');
        }
    } catch (error) {
        res.writeHead(404).end('Not Found: ' + urlPath);
        return;
    }

    try {
        const data = await readFile(filePath);
        res.writeHead(200, {
            'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    } catch (error) {
        res.writeHead(404).end('Not Found: ' + urlPath);
    }
}).listen(port, () => {
    console.log(`[uni-skybox] demo: http://localhost:${port}/demo/`);
});