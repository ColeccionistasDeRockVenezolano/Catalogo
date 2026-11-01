// CRV · Paridad de contenido de la Fase 2B con la portada viva.
//
// Solo GET: no ejecuta JavaScript, así que no dispara el contador de visitas de
// Herra (que es un POST). Compara el texto visible de la portada, /colaborar y
// /login entre el dominio y la instancia raíz de staging.
//
// Uso: node scripts/checks/fase2b-paridad.mjs [--vivo https://…] [--raiz http://127.0.0.1:3141]
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const arg = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};
const VIVO = arg("vivo", "https://coleccionistasderockvenezolano.com").replace(/\/$/u, "");
const RAIZ = arg("raiz", "http://127.0.0.1:3141").replace(/\/$/u, "");
const OUT = path.join(os.homedir(), "crv-staging/reports/independencia/fase2b-paridad");
await mkdir(OUT, { recursive: true });

function texto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function frases(html) {
  return new Set(texto(html).split(/(?<=[.!?·»])\s+/u).map((f) => f.trim()).filter((f) => f.length > 18));
}

const informe = { cuando: new Date().toISOString(), vivo: VIVO, raiz: RAIZ, paginas: {}, diferencias: [] };

for (const ruta of ["/", "/colaborar", "/login"]) {
  const [vivo, raiz] = await Promise.all([
    fetch(`${VIVO}${ruta}`, { headers: { accept: "text/html" } }).then((r) => r.text()).catch(() => ""),
    fetch(`${RAIZ}${ruta}`, { headers: { accept: "text/html" } }).then((r) => r.text()).catch(() => ""),
  ]);
  const fv = frases(vivo);
  const fr = frases(raiz);
  const soloVivo = [...fv].filter((f) => !fr.has(f));
  const soloRaiz = [...fr].filter((f) => !fv.has(f));
  informe.paginas[ruta] = {
    frasesVivo: fv.size, frasesRaiz: fr.size,
    soloVivo: soloVivo.slice(0, 12), soloRaiz: soloRaiz.slice(0, 12),
    soloVivoTotal: soloVivo.length, soloRaizTotal: soloRaiz.length,
  };
  for (const f of soloVivo.slice(0, 8)) informe.diferencias.push(`${ruta} · solo en el dominio: ${f.slice(0, 140)}`);
  for (const f of soloRaiz.slice(0, 8)) informe.diferencias.push(`${ruta} · solo en la raíz: ${f.slice(0, 140)}`);
}

await writeFile(path.join(OUT, "informe.json"), JSON.stringify(informe, null, 2));
console.log(JSON.stringify({
  vivo: VIVO, raiz: RAIZ,
  paginas: Object.fromEntries(Object.entries(informe.paginas).map(([ruta, datos]) => [ruta, {
    frasesVivo: datos.frasesVivo, frasesRaiz: datos.frasesRaiz,
    soloVivo: datos.soloVivoTotal, soloRaiz: datos.soloRaizTotal,
  }])),
}));
for (const linea of informe.diferencias) console.log("DIF:", linea);
