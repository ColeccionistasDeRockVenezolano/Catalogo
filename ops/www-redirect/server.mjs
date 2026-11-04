import http from 'node:http';
import { pathToFileURL } from 'node:url';

// Destino fijo: ni Host ni una URL absoluta del cliente pueden cambiar el origen.
export function createRedirectServer() {
  return http.createServer((req, res) => {
    const raw = req.url ?? '/';
    const path = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
    res.writeHead(308, {
      Location: `https://coleccionistasderockvenezolano.com${path}`,
      'Cache-Control': 'no-store',
      'Content-Length': '0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createRedirectServer();
  server.listen(Number(process.env.PORT ?? 3020), '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
