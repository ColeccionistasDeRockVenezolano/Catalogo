/* global window, document -- las funciones de page.evaluate y addInitScript corren en la página */
// CRV · Fase 3: lo que el dominio debe darle al reproductor de la radio para que suene.
// Solo lee y escucha como un visitante; se puede pasar contra producción.
//   - Cada reproductor de YouTube, también el de reserva, debe llevar Referer (sin él: error 153).
//   - La cuña debe llegar como audio y con rangos (sin ellos Safari no la reproduce ni se puede saltar).
//   - Atraviesa un cambio de pieza con cuña, con la pestaña visible o simulando pantalla apagada.
//
//   node scripts/checks/radio-reproductor-dominio.mjs [--oculta] [--minutos=20] [--salida=dir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const DOMINIO = "https://coleccionistasderockvenezolano.com";
const oculta = process.argv.includes("--oculta");
const opcion = (nombre, defecto) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1] ?? defecto;
const minutos = Number(opcion("minutos", "20"));
const salida = opcion("salida", "");

const ok = [];
const fallos = [];
const cumple = (condicion, nombre, detalle = "") => { (condicion ? ok : fallos).push(detalle && !condicion ? `${nombre}: ${detalle}` : nombre); };

const cuña = `${DOMINIO}/landing/radio/sweeper-v2.wav`;
const rango = await fetch(cuña, { headers: { range: "bytes=0-1" } });
cumple(rango.headers.get("content-type") === "audio/wav", "la cuña llega como audio/wav", String(rango.headers.get("content-type")));
cumple(rango.status === 206 && /^bytes 0-1\/\d+$/u.test(rango.headers.get("content-range") ?? ""), "la cuña admite rangos", `${rango.status} ${rango.headers.get("content-range")}`);
await rango.body?.cancel();
const portada = await fetch(`${DOMINIO}/`);
cumple(portada.headers.get("referrer-policy") === "strict-origin-when-cross-origin", "la portada deja llegar el Referer a YouTube", String(portada.headers.get("referrer-policy")));
for (const bandera of ["gb", "sg", "ve", "us"]) cumple((await fetch(`${DOMINIO}/landing/flags/${bandera}.svg`, { method: "HEAD" })).status === 200, `bandera ${bandera}`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-VE", hasTouch: true, isMobile: true });
await contexto.addInitScript((simularOculta) => {
  window.__radio = { audios: [], errores: [], yt: {} };
  // Lo que cada reproductor informa de sí mismo: estado, tiempo, video y errores.
  window.addEventListener("message", (mensaje) => {
    if (!/youtube/u.test(mensaje.origin)) return;
    let datos;
    try { datos = JSON.parse(mensaje.data); } catch { return; }
    if (datos.event === "onError") window.__radio.errores.push({ codigo: datos.info, en: Date.now() });
    const info = datos.info;
    if (datos.event !== "infoDelivery" || !info || typeof info !== "object") return;
    const fuente = [...document.querySelectorAll("iframe")].findIndex((marco) => marco.contentWindow === mensaje.source);
    const actual = window.__radio.yt[fuente] ?? (window.__radio.yt[fuente] = {});
    if (info.playerState !== undefined) actual.estado = info.playerState;
    if (info.currentTime !== undefined) { actual.tiempo = info.currentTime; actual.tiempoEn = Date.now(); }
    if (info.videoData?.video_id) actual.video = info.videoData.video_id;
    if (info.muted !== undefined) actual.silenciado = info.muted;
    if (info.volume !== undefined) actual.volumen = info.volume;
  });
  const Original = window.Audio;
  window.Audio = function (src) {
    const audio = new Original(src);
    const registro = { src: String(src), eventos: [] };
    window.__radio.audios.push(registro);
    for (const evento of ["play", "playing", "ended", "error", "pause"]) {
      audio.addEventListener(evento, () => registro.eventos.push({ evento, t: Math.round(audio.currentTime * 10) / 10, en: Date.now(), error: audio.error?.code }));
    }
    return audio;
  };
  if (simularOculta) {
    Object.defineProperty(document, "hidden", { get: () => window.__radio.oculta === true });
    Object.defineProperty(document, "visibilityState", { get: () => (window.__radio.oculta === true ? "hidden" : "visible") });
  }
}, oculta);
const pagina = await contexto.newPage();
const insertos = [];
const diagnosticos = [];
pagina.on("request", async (peticion) => {
  if (/youtube(-nocookie)?\.com\/embed\//u.test(peticion.url())) {
    const cabeceras = await peticion.allHeaders().catch(() => ({}));
    insertos.push({ url: peticion.url().split("?")[0], referer: cabeceras.referer ?? null });
  }
  if (peticion.url().endsWith("/api/radio/diagnostic")) diagnosticos.push(peticion.postData()?.slice(0, 2000));
});
await pagina.goto(`${DOMINIO}/`, { waitUntil: "load" });
await pagina.waitForFunction(() => document.getElementById("radio")?.getAttribute("data-radio-requested") === "true", null, { timeout: 15000 }).catch(() => undefined);
await pagina.waitForTimeout(3000);
const unirse = pagina.locator("[data-radio-sync]");
if (await unirse.isVisible().catch(() => false)) await unirse.click({ timeout: 5000 }).catch(() => undefined);
const enVivo = await pagina.waitForFunction(() => document.getElementById("radio")?.getAttribute("data-radio-state") === "live", null, { timeout: 60000 }).then(() => true, () => false);
cumple(enVivo, "el reproductor llega al aire", String(await pagina.locator("#radio").getAttribute("data-radio-state")));
await pagina.waitForTimeout(5000);
cumple(insertos.length >= 2, "se crean los dos reproductores", String(insertos.length));
const sinReferer = insertos.filter((i) => !i.referer);
cumple(sinReferer.length === 0, "todos los reproductores llevan Referer", `${sinReferer.length} de ${insertos.length} sin Referer`);
if (oculta) await pagina.evaluate(() => { window.__radio.oculta = true; document.dispatchEvent(new Event("visibilitychange")); });

// Se escucha hasta pasar por una cuña y por la pieza que le sigue.
const linea = [];
const inicio = Date.now();
let vistaCuña = null;
let finCuña = null;
let previa = null;
while (Date.now() - inicio < minutos * 60_000) {
  await pagina.waitForTimeout(1500);
  const foto = await pagina.evaluate(async () => {
    const radio = document.getElementById("radio");
    const ahora = await fetch("/api/radio/now", { cache: "no-store" }).then((r) => r.json());
    return {
      en: Date.now(), estado: radio?.getAttribute("data-radio-state"), clases: radio?.className ?? "", estadoTexto: document.querySelector("[data-radio-status]")?.textContent ?? "",
      titulo: ahora.current?.title, fase: ahora.phase, inicio: ahora.startsAt, sweeperSlot: ahora.sweeperSlot, sonando: [...document.querySelectorAll("iframe")].filter((f) => f.src.includes("youtube")).map((f) => f.src.match(/embed\/([^?]+)/)?.[1]),
      video: ahora.current?.videoId, yt: window.__radio.yt,
    };
  });
  linea.push(foto);
  // El servidor anuncia la cuña al final de la pieza: se cuenta al cruzar a la siguiente.
  if (!vistaCuña && (foto.fase === "sweeper" || foto.clases.includes("is-sweeper") || (previa?.sweeperSlot && previa.inicio !== foto.inicio))) vistaCuña = foto.en;
  if (vistaCuña && !finCuña && foto.fase === "music" && foto.en - vistaCuña > 3_000) finCuña = foto.en;
  previa = foto;
  if (finCuña && foto.en - finCuña > 45_000) break;
}
cumple(Boolean(vistaCuña), "pasó una cuña durante la escucha");
const despues = linea.filter((f) => finCuña && f.en > finCuña + 15_000);
cumple(despues.length > 0 && despues.every((f) => f.estado === "live"), "tras la cuña la radio sigue al aire", JSON.stringify(despues.at(-1)));
const ultima = despues.at(-1);
const suenaLoQueToca = ultima && Object.values(ultima.yt).some((r) => r.estado === 1 && r.video === ultima.video && ultima.en - r.tiempoEn < 5_000);
cumple(Boolean(suenaLoQueToca), "tras la cuña un reproductor está sonando la pieza del servidor", JSON.stringify(ultima));
const errorVisible = linea.find((f) => /sincronizar|synchron/iu.test(f.estadoTexto));
cumple(!errorVisible, "no aparece «No pudimos sincronizar»", JSON.stringify(errorVisible));
const radio = await pagina.evaluate(() => window.__radio);
const erroresYt = [...radio.errores.map((e) => JSON.stringify(e)), ...diagnosticos.filter((d) => /player_error/u.test(d ?? ""))];
cumple(erroresYt.length === 0, "ningún reproductor informa de error", erroresYt.join(" | ").slice(0, 800));
if (oculta) {
  const eventos = radio.audios.flatMap((a) => a.eventos);
  cumple(eventos.some((e) => e.evento === "playing"), "con pantalla apagada la cuña suena", JSON.stringify(radio.audios).slice(0, 800));
  cumple(!eventos.some((e) => e.evento === "error"), "la cuña no da error de audio", JSON.stringify(eventos).slice(0, 800));
}
if (salida) {
  mkdirSync(salida, { recursive: true });
  writeFileSync(join(salida, `escucha${oculta ? "-oculta" : ""}.json`), JSON.stringify({ ok, fallos, insertos, diagnosticos, radio, linea }, null, 1));
}
await browser.close();
for (const nombre of ok) console.log(`ok    ${nombre}`);
for (const nombre of fallos) console.log(`FALLA ${nombre}`);
console.log(`${ok.length}/${ok.length + fallos.length}`);
process.exit(fallos.length ? 1 : 0);
