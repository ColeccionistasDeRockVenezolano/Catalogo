// CRV · Fase 3: en Android el primer gesto, también deslizar, abre el sonido; desktop no cambia.
//
// Usa la página de prueba, el cliente real y Brave sin interfaz. El deslizamiento se envía por CDP. Cada escenario
// es un navegador nuevo: una recarga en una pestaña ya tocada conserva el permiso y da un falso positivo.
// La política estricta es la de una pestaña nueva en el teléfono; sin ella se ve el caso del permiso heredado.
// La pantalla apagada y el oído quedan fuera: se prueban en el teléfono.
//
//   node scripts/checks/radio-sin-gesto-check.mjs <dir de salida> [videoId de la cuña]
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [salida, video = "MPIwJFKsjVE"] = process.argv.slice(2);
if (!salida) { console.error("falta el directorio de salida"); process.exit(2); }

const PUERTO = 3197;
const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const ESCUCHA_MS = 95_000;
const ESTRICTA = ["--autoplay-policy=document-user-activation-required"];
const eventos = join(salida, "eventos.jsonl");
const espera = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

let fallos = 0;
const comprobar = (condicion, texto) => { if (!condicion) fallos += 1; console.log(`${condicion ? "ok" : "FALLO"}  ${texto}`); };

// La clave de la pieza: el reloj del cliente y el del servidor pueden diferir en 1 ms por el truncado.
const fuente = readFileSync("src/landing/client/radio.js", "utf8");
const cuerpo = fuente.match(/function samePiece\(key, other\) \{[\s\S]*?\n {2}\}/)?.[0];
if (!cuerpo) throw new Error("no aparece samePiece en el cliente");
const samePiece = new Function(`${cuerpo}; return samePiece;`)();
const clave = (ms, id = "abcdefghijk", inicio = 5) => `${new Date(Date.UTC(2026, 10, 3, 12) + ms).toISOString()}|${id}|${inicio}`;
comprobar(samePiece(clave(0), clave(1)), "misma pieza con 1 ms de diferencia");
comprobar(!samePiece(clave(0), clave(0, "abcdefghijl")), "otro video no es la misma pieza");
comprobar(!samePiece(clave(0), clave(0, "abcdefghijk", 6)), "otro inicio no es la misma pieza");
comprobar(!samePiece(clave(0), clave(2000)), "la misma canción en otra hora no es la misma pieza");

const servidor = spawn("npx", ["tsx", "scripts/checks/radio-prueba-solape.mts", `--salida=${salida}`, `--puerto=${PUERTO}`, "--ruta=chk", "--duracion=40", "--cada=1", `--cuna-video=${video}:0`], { stdio: "ignore", detached: true });
const apagar = () => { try { process.kill(-servidor.pid); } catch { /* ya terminó */ } };
process.on("exit", apagar);

const url = `http://127.0.0.1:${PUERTO}/chk/`;
for (let intento = 0; ; intento += 1) {
  try { if ((await fetch(url)).ok) break; } catch { /* todavía no escucha */ }
  if (intento > 40) throw new Error("la página de prueba no arrancó");
  await espera(500);
}

const leidas = () => (existsSync(eventos) ? readFileSync(eventos, "utf8").split("\n").filter(Boolean).map((linea) => JSON.parse(linea)) : []);

async function escuchar(nombre, userAgent, gesto, args = [], consulta = "") {
  const antes = leidas().length;
  const navegador = await chromium.launch({ executablePath: "/usr/bin/brave-browser", headless: true, args });
  try {
    const movil = userAgent === ANDROID;
    const contexto = await navegador.newContext({ userAgent, viewport: movil ? { width: 412, height: 800 } : { width: 1280, height: 800 }, hasTouch: movil, isMobile: movil });
    const pagina = await contexto.newPage();
    await pagina.goto(url + consulta);
    await espera(12_000);
    await gesto(pagina, contexto);
    await espera(ESCUCHA_MS);
  } finally { await navegador.close(); }
  await espera(1_000);
  const filas = leidas().slice(antes);
  const tipos = filas.map((fila) => fila.tipo);
  const hay = (tipo) => tipos.filter((otro) => otro === tipo).length;
  console.log(`--- ${nombre}`);
  return { filas, hay, nombres: tipos };
}

const pasar = async (pagina, contexto, pausa) => {
  const cdp = await contexto.newCDPSession(pagina);
  const tocar = (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 200, y }] });
  await tocar("touchStart", 600);
  for (let y = 600; y > 200; y -= 40) { await tocar("touchMove", y); await espera(pausa); }
  await tocar("touchEnd", 200);
};
const deslizar = (pagina, contexto) => pasar(pagina, contexto, 16);
// Más lento que los 0,6 s que tarda el navegador en pausar un video al que se le quitó el silencio antes de tiempo.
const deslizarDespacio = (pagina, contexto) => pasar(pagina, contexto, 200);

const mudaAlFinal = (filas) => {
  const ultimo = filas.filter((fila) => fila.tipo === "latido").at(-1);
  return ultimo ? (ultimo.activo === 0 ? ultimo.a : ultimo.b)?.mudo : undefined;
};

try {
  const sinTocar = await escuchar("Android, pestaña nueva, sin tocar", ANDROID, async () => {}, ESTRICTA, "?bloqueado");
  comprobar(mudaAlFinal(sinTocar.filas) === true, "la música sigue en silencio, esperando el gesto");
  comprobar(sinTocar.hay("c:swap") >= 1, `la emisión avanza (${sinTocar.hay("c:swap")} relevos)`);
  comprobar(sinTocar.hay("c:sweeper_start") === 0 && sinTocar.hay("c:cue_sound") === 0, "sin gesto no suena ninguna cuña");

  const desliza = await escuchar("Android, pestaña nueva, deslizando despacio", ANDROID, deslizarDespacio, ESTRICTA, "?bloqueado");
  const fin = desliza.filas.find((fila) => fila.tipo === "gesto_touchend");
  const pointerup = desliza.filas.find((fila) => fila.tipo === "gesto_pointerup");
  const desbloqueos = desliza.filas.filter((fila) => fila.tipo === "c:sound_unlock");
  comprobar(pointerup?.activo === true && desliza.hay("gesto_pointercancel") === 0, "el deslizamiento es un gesto completo");
  comprobar((fin?.y ?? 0) > 200, `el dedo mueve la página (${fin?.y} px)`);
  comprobar(desbloqueos.length >= 1 && desbloqueos.every((fila) => fila.active !== 0), "el sonido no se abre antes de que el gesto cuente");
  comprobar(mudaAlFinal(desliza.filas) === false, "la música suena con sonido");
  comprobar(desliza.hay("c:sweeper_start") >= 1, `suena la cuña propia (${desliza.hay("c:sweeper_start")})`);
  comprobar(desliza.hay("c:cue_sound") === 0, "no hace falta la cuña por YouTube");
  comprobar(desliza.hay("c:swap") >= 1, `hay relevo (${desliza.hay("c:swap")})`);

  const segundo = await escuchar("Android, segundo deslizamiento nativo", ANDROID, async (pagina, contexto) => { await deslizar(pagina, contexto); await espera(1_000); await deslizar(pagina, contexto); }, ESTRICTA, "?bloqueado");
  comprobar(segundo.hay("gesto_pointercancel") === 1, "tras el primer gesto el desplazamiento vuelve a ser el nativo");

  const android = await escuchar("Android, permiso heredado, sin tocar", ANDROID, async () => {});
  comprobar(android.hay("c:quiet_unmute") >= 1, "arranca con sonido sin gesto");
  comprobar(android.hay("c:cue_ready") === 1, "la cuña por YouTube queda preparada");
  comprobar(android.hay("c:cue_sound") >= 1, `la cuña suena (${android.hay("c:cue_sound")})`);
  comprobar(android.hay("c:cue_fail") === 0 && android.hay("c:cue_load_fail") === 0, "sin fallos de la cuña");
  comprobar(android.hay("c:sweeper_start") === 0, "no intenta la cuña propia");
  const inicio = android.filas.find((fila) => fila.tipo === "c:cue_on");
  const relevo = inicio && android.filas.find((fila) => fila.tipo === "c:swap" && fila.t > inicio.t);
  const hueco = relevo ? (Date.parse(relevo.t) - Date.parse(inicio.t)) / 1000 : NaN;
  comprobar(Math.abs(hueco - 7.4) < 1, `la siguiente canción entra a su hora (${hueco.toFixed(1)} s tras la cuña)`);

  const sinClic = await escuchar("Desktop sin clic", DESKTOP, async () => {});
  const propios = sinClic.nombres.filter((tipo) => /^c:(quiet_|cue_)/.test(tipo));
  comprobar(propios.length === 0, `no usa el camino de Android (${propios.length} rastros)`);
  comprobar(sinClic.hay("c:sweeper_start") === 0, "sin clic no suena la cuña propia");

  const conClic = await escuchar("Desktop con clic", DESKTOP, async (pagina) => { await pagina.mouse.click(640, 700); });
  const propiosClic = conClic.nombres.filter((tipo) => /^c:(quiet_|cue_)/.test(tipo));
  comprobar(propiosClic.length === 0, `no usa el camino de Android (${propiosClic.length} rastros)`);
  comprobar(conClic.hay("c:sweeper_start") >= 1, `suena la cuña propia (${conClic.hay("c:sweeper_start")})`);
  comprobar(conClic.hay("c:swap") >= 1, `hay relevo (${conClic.hay("c:swap")})`);
} finally { apagar(); }

console.log(fallos ? `\n${fallos} comprobaciones fallaron` : "\ntodo correcto");
process.exit(fallos ? 1 : 0);
