// CRV · POST sin cuerpo por el gateway, tal como llega por Cloudflare.
//
// El navegador manda `content-length: 0`, pero por el túnel esa cabecera puede no
// llegar al gateway. Un ensayo con navegador contra localhost no ve esa diferencia;
// por eso aquí se escribe la petición a mano por un socket.
//
//   node scripts/checks/gateway-sin-cuerpo.mjs http://127.0.0.1:3141
// Solo contra staging: entra con la cuenta de prueba y cierra esa sesión.
import net from "node:net";
import { limpiarFixtures, prepararFixtures } from "./lib/fixtures.mjs";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3141");
if (!["127.0.0.1", "localhost"].includes(base.hostname)) throw new Error("Solo contra un gateway local de staging.");
const DOMINIO = "coleccionistasderockvenezolano.com";
const comunes = { host: DOMINIO, origin: `https://${DOMINIO}`, "cf-connecting-ip": "203.0.113.9", "cf-ipcountry": "VE" };

/** Petición cruda: solo lleva las cabeceras indicadas, sin las que añadiría fetch. */
function crudo(metodo, ruta, cabeceras = {}, cuerpo = "") {
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(base.port), base.hostname);
    let r = "";
    s.on("data", (d) => { r += d; });
    s.on("end", () => resolve({ status: Number(r.split(" ")[1]), crudo: r, cuerpo: r.slice(r.indexOf("\r\n\r\n") + 4) }));
    s.on("error", reject);
    const lineas = Object.entries({ ...comunes, ...cabeceras, connection: "close" }).map(([k, v]) => `${k}: ${v}`);
    s.write(`${metodo} ${ruta} HTTP/1.1\r\n${lineas.join("\r\n")}\r\n\r\n${cuerpo}`);
  });
}

async function entrar() {
  const cuerpo = JSON.stringify({ username: "fase1-admin", password: "Fase1Admin2026" });
  const r = await crudo("POST", "/api/auth/login", { "content-type": "application/json", "content-length": Buffer.byteLength(cuerpo) }, cuerpo);
  const cookie = /set-cookie: (crv_session=[^;]+)/iu.exec(r.crudo)?.[1];
  if (!cookie) throw new Error(`Sin sesión de prueba (${r.status}).`);
  const me = await crudo("GET", "/api/auth/me", { cookie });
  const csrf = /"csrf":"([^"]+)"/u.exec(me.cuerpo)?.[1] ?? "";
  return { cookie, csrf };
}

const CASOS = [
  ["chunked y vacío, como por el túnel", { "transfer-encoding": "chunked" }, "0\r\n\r\n"],
  ["sin cabeceras de longitud", {}, ""],
  ["con content-length: 0, como el navegador", { "content-length": 0 }, ""],
];
prepararFixtures();
let fallos = 0;
const comprobar = (ok, texto, dato) => { console.log(`${ok ? "ok  " : "FALLO"} ${texto}${dato === undefined ? "" : ` (${dato})`}`); if (!ok) fallos++; };

try {
  for (const [nombre, extra, cuerpo] of CASOS) {
    const s = await entrar();
    const salida = await crudo("POST", "/api/auth/logout", { cookie: s.cookie, "x-crv-csrf": s.csrf, ...extra }, cuerpo);
    comprobar(salida.status === 204, `cerrar sesión ${nombre}`, salida.status);
    const despues = await crudo("GET", "/api/auth/me", { cookie: s.cookie });
    comprobar(salida.status !== 204 || !despues.cuerpo.includes('"csrf"') || despues.status === 401, "la sesión ya no vale", despues.status);
  }
} finally {
  limpiarFixtures();
}
if (fallos) process.exit(1);
