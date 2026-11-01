// CRV · Ensayo de la vuelta atrás de la Fase 2B.
//
// La 2B cambia el destino del hostname en Cloudflare (:3020 → :3140). Aquí se
// ensaya el mismo gesto con un proxy local desechable: arranca en :3145
// apuntando a la instancia raíz (:3141) y, a los pocos segundos, cambia el
// destino a otra instancia local (por omisión el catálogo en :3130/crv/). Se
// mide cuánto tarda la primera respuesta servida por el destino nuevo.
//
// No toca Cloudflare ni el dominio: es un ensayo local del procedimiento.
//
// Uso: node scripts/checks/fase2b-vuelta-atras.mjs
import http from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const OUT = path.join(os.homedir(), "crv-staging/reports/independencia/fase2b-vuelta");
await mkdir(OUT, { recursive: true });
const PUERTO = 3145;

const destinos = {
  A: { host: "127.0.0.1", port: 3141, prefijo: "", etiqueta: "raíz de staging (:3141)" },
  B: { host: "127.0.0.1", port: 3130, prefijo: "/crv", etiqueta: "catálogo (:3130/crv)" },
};
let actual = "A";

const proxy = http.createServer((req, res) => {
  const destino = destinos[actual];
  const ruta = `${destino.prefijo}${req.url ?? "/"}`;
  const upstream = http.request({
    host: destino.host, port: destino.port, method: req.method, path: ruta, headers: req.headers,
  }, (respuesta) => {
    res.writeHead(respuesta.statusCode ?? 502, { ...respuesta.headers, "x-ensayo-origen": actual });
    respuesta.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(502); res.end("sin destino"); });
  req.pipe(upstream);
});

function pedir() {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const solicitud = http.get({ host: "127.0.0.1", port: PUERTO, path: "/roadmap", timeout: 5000 }, (respuesta) => {
      const origen = respuesta.headers["x-ensayo-origen"];
      respuesta.resume();
      respuesta.on("end", () => resolve({ origen, status: respuesta.statusCode, ms: Date.now() - inicio }));
    });
    solicitud.on("error", () => resolve({ origen: null, status: 0, ms: Date.now() - inicio }));
    solicitud.on("timeout", () => { solicitud.destroy(); resolve({ origen: null, status: 0, ms: Date.now() - inicio }); });
  });
}

await new Promise((resolve) => proxy.listen(PUERTO, "127.0.0.1", resolve));

const antes = await pedir();
const inicioCambio = Date.now();
actual = "B";
let despues = null;
// Sondeo corto: la primera respuesta que ya venga del destino nuevo.
while (Date.now() - inicioCambio < 10_000) {
  const intento = await pedir();
  if (intento.origen === "B") { despues = { ...intento, msCambio: Date.now() - inicioCambio }; break; }
}
// Y una comprobación de que la vuelta atrás a A también responde.
const inicioVuelta = Date.now();
actual = "A";
let vuelta = null;
while (Date.now() - inicioVuelta < 10_000) {
  const intento = await pedir();
  if (intento.origen === "A") { vuelta = { ...intento, msCambio: Date.now() - inicioVuelta }; break; }
}

proxy.close();
const informe = {
  cuando: new Date().toISOString(),
  antes, despues, vuelta,
  veredicto: {
    origenInicial: antes.origen,
    trasCambio: despues?.origen ?? null,
    msCambio: despues?.msCambio ?? null,
    msVuelta: vuelta?.msCambio ?? null,
  },
};
await writeFile(path.join(OUT, "informe.json"), JSON.stringify(informe, null, 2));
console.log(JSON.stringify(informe.veredicto));
process.exit(informe.veredicto.trasCambio === "B" && informe.veredicto.msCambio !== null ? 0 : 1);
