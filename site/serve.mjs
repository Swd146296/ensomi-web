// Local static server for trying the page: public/ at /, and optionally a model directory at /model/.
//   node site/serve.mjs [port] [model-dir]
// With a model directory, open http://127.0.0.1:<port>/?model=/model/onnx/ to load it instead of Hugging Face.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 8080);
const site = resolve(import.meta.dirname, '../public'), model = process.argv[3] && resolve(process.argv[3]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };

createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const [root, rest] = model && path.startsWith('/model/') ? [model, path.slice('/model'.length)] : [site, path];
    let file = join(root, normalize(rest));
    try {
        if (statSync(file).isDirectory()) file = join(file, 'index.html');
        statSync(file);
    }
    catch {
        response.writeHead(404).end('Not found');
        return;
    }
    // The same cross-origin isolation as public/_headers, so WebAssembly threads work locally.
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' });
    createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${port}/` + (model ? `?model=/model/onnx/  (model directory: ${model})` : ''));
});
