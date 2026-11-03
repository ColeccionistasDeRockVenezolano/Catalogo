// CRV · Fase 3: el cliente real de la radio, con el motor real y una emisión corta, en una página aislada.
// No toca la radio, ni la base, ni el dominio, ni web/public: minifica src/landing/client/radio.js en memoria.
//   canciones reales, solape de 3 s y cuña cada 3 piezas. La emisión empieza con la primera visita, para que
//   el primer relevo llegue tras unos 6 min con el segundo reproductor ya preparado, como en el dominio.
//
//   npx tsx scripts/checks/radio-prueba-solape.mts --salida=dir [--puerto=3198] [--ruta=secreto] [--host=127.0.0.1] [--duracion=segundos]
// Con --ruta, todo lo que no cuelgue de ella responde 404: sirve para exponerla un rato por un túnel.
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { radioSnapshot, type RadioStation } from "../../src/shared/radio/engine.js";
// @ts-expect-error: el constructor del cliente es un .mjs sin tipos.
import { minifyRadioClient } from "../build-radio-client.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const opcion = (nombre: string, defecto: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1] ?? defecto;
const host = opcion("host", "127.0.0.1");
const puerto = Number(opcion("puerto", "3198"));
const salida = opcion("salida", "");
const ruta = opcion("ruta", "") ? `/${opcion("ruta", "")}` : "";
if (!salida) { console.error("falta --salida=dir"); process.exit(2); }
mkdirSync(salida, { recursive: true });
const registro = join(salida, "eventos.jsonl");

// Canciones reales del catálogo: con piezas cortas la preparación ocurre con la página
// visible y no se ve el fallo del segundo reproductor que nunca sonó.
// --duracion recorta cada canción para repetir la prueba rápido; por encima de la antelación de la preparación, esta sigue ocurriendo oculta.
const recorte = Number(opcion("duracion", "0"));
const pieza = (videoId: string, startSeconds: number, durationSeconds: number) => ({
  videoId, title: `${videoId} desde ${startSeconds}`, artist: "Prueba", album: "Prueba", year: 2000, trackNumber: 1,
  startSeconds, durationSeconds: recorte || durationSeconds, available: true,
});
const catalogo = join(salida, "catalogo.json");
writeFileSync(catalogo, JSON.stringify({
  version: 3, generatedAt: new Date().toISOString(), availabilityCheckedAt: new Date().toISOString(), channelId: "prueba",
  items: [pieza("rlbxuNzpC9s", 4338, 370), pieza("prWDFZjEil8", 2066, 260), pieza("H3_vxhva6Gg", 2083, 301),
    pieza("BAThGeGAQLQ", 1010, 332), pieza("gBlx_BpQ1ug", 1683, 295), pieza("y1FxXyO1RMc", 799, 277)],
}));
const estacion: RadioStation = {
  catalogPath: catalogo, epochMs: Date.now(), stationName: "Prueba", crossfadeSeconds: 3,
  sweeper: { src: "radio/sweeper-v2.wav", durationSeconds: 13.404422, overlapSeconds: 6, leadSeconds: 4.5, everyPieces: Number(opcion("cada", "3")),
    // --cuna-video=ID:segundo: un video cualquiera ocupa el lugar de la cuña hasta que exista la de verdad en YouTube.
    ...(opcion("cuna-video", "") ? { videoId: opcion("cuna-video", "").split(":")[0]!, videoStartSeconds: Number(opcion("cuna-video", "").split(":")[1] ?? 0) } : {}) },
};

let emisionEmpezada = false;

// Solo aquí: el cliente publica su rastro y sus reproductores para poder registrarlos.
function instrumentar(fuente: string): string {
  const sustituir = (a: string, b: string) => {
    if (fuente.split(a).length !== 2) throw new Error(`no aparece una sola vez: ${a}`);
    fuente = fuente.replace(a, () => b);
  };
  sustituir("  function trace(event, detail) {\n", "  function trace(event, detail) {\n    if (window.__traza) window.__traza(event, detail);\n");
  sustituir("  var activeIndex = 0;\n", "  var activeIndex = 0;\n  window.__decks = function () { return { activo: activeIndex, decks: decks }; };\n");
  // --diagnostico-cuna: música muy baja desde el arranque y cuña al máximo, para saber de oído si sale sonido de ese
  // reproductor. No se cambia el volumen durante la reproducción: el cliente lo tomaría como el elegido por el oyente.
  if (process.argv.includes("--diagnostico-cuna")) {
    sustituir("  var listenerVolume = storedVolume();\n", "  var listenerVolume = 12;\n");
    sustituir("Math.min(100, chosenVolume() * envelope)", "Math.min(100, 100 * envelope)");
    // La cuña propia también va al máximo: es la que suena después de un toque real.
    fuente = fuente.replaceAll("chosenVolume() / 100", "1");
    sustituir("      if (cueDeck.sounded) { try { cueDeck.player.setVolume(level); }", "      if (cueDeck.sounded) { try { if (Date.now() % 2000 < 200) trace('cue_state', { m: cueDeck.player.isMuted() ? 1 : 0, v: cueDeck.player.getVolume(), pos: cueDeck.player.getCurrentTime(), s: cueDeck.player.getPlayerState() }); cueDeck.player.setVolume(level); }");
  }
  // Headless deja quitar el silencio a YouTube sin gesto; el teléfono en pestaña nueva, no. ?bloqueado imita al teléfono.
  fuente = fuente.replace("var quietBlocked = false;", "var quietBlocked = new URLSearchParams(location.search).has('bloqueado');");
  return fuente;
}
const cliente = await minifyRadioClient(instrumentar(readFileSync(join(raiz, "src/landing/client/radio.js"), "utf8")));

const primerToque = await minifyRadioClient(readFileSync(join(raiz, "src/landing/client/first-touch.js"), "utf8"));

const pagina = `<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin">
<title>Prueba de radio</title><style>
body{margin:0;padding:16px;background:#111;color:#eee;font:16px system-ui}button{font:inherit;padding:14px;margin:0 8px 12px 0;min-height:48px}
.radio-card__screen{position:relative;width:100%;max-width:480px;height:200px;background:#000;margin-bottom:8px}
.radio-card__screen iframe{position:absolute;inset:0;display:block;width:100%;height:100%;border:0}
.radio-card__screen iframe[data-radio-deck="active"]{z-index:1}
.is-sweeper .radio-card__screen iframe{visibility:hidden;pointer-events:none}
.radio-card__screen iframe[data-radio-deck="standby"],.radio-card__screen iframe:not(#radioPlayer):not([data-radio-deck="active"]){opacity:0;pointer-events:none}
pre{font-size:12px;white-space:pre-wrap}</style><script src="${ruta}/radio-first-touch.js"></script>
<p id="gesto" style="font-size:20px;font-weight:bold"></p><p>Úsala como el dominio. Cuando suene, espera 10 s y apaga la pantalla.</p>
<aside id="radio" data-radio-state="ready" data-radio-sweeper="true" data-radio-static-base="${ruta}/static" data-radio-live-label="Prueba" data-radio-project-name="Prueba"
 data-radio-api="${ruta}/api/radio/now" data-radio-listener-api="${ruta}/api/radio/listener" data-radio-unavailable-api="${ruta}/api/radio/unavailable" data-radio-diagnostic-api="${ruta}/api/radio/diagnostic">
<button type="button" data-radio-sync><span>Sintonizar</span></button><p data-radio-status></p>
<div class="radio-card__screen"><div data-radio-identifier hidden><strong data-radio-identifier-next></strong></div>
<iframe id="radioPlayer" title="Radio" data-src="https://www.youtube.com/embed/KLXp1um-404?enablejsapi=1&amp;playsinline=1&amp;rel=0&amp;autoplay=1&amp;controls=0&amp;fs=0&amp;disablekb=1&amp;iv_load_policy=3&amp;origin=__ORIGEN__" width="560" height="315" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
<p><b data-radio-title></b> <span data-radio-artist></span></p><p>Sigue: <span data-radio-next></span></p></aside><pre id="v"></pre><div style="height:2500px;background:linear-gradient(#222,#555)"></div>
<script>
const textos={"radio.sound":"Toca para activar el sonido","radio.muted":"En silencio: toca para activar el sonido","radio.join":"Sintonizar","radio.synced":"Sonando","radio.resync":"Volver al vivo","radio.ready":"Lista","radio.loading":"Cargando…","radio.shared":"Sonando","radio.identifier":"Cuña","radio.error":"Error","radio.paused":"En pausa","radio.reconnecting":"Reconectando…"};
window.HerraI18n={t:(k)=>textos[k]||k};
const sesion=Math.random().toString(36).slice(2,10);let pendientes=[];const v=document.getElementById("v");
function enviar(){if(!pendientes.length)return;const lote=pendientes;pendientes=[];
 fetch("${ruta}/eventos",{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify(lote)}).catch(()=>{pendientes=lote.concat(pendientes)})}
function ev(tipo,datos){const f={t:new Date().toISOString(),sesion,tipo,oculta:document.hidden,...datos};pendientes.push(f);v.textContent=f.t.slice(11,19)+" "+tipo+" "+JSON.stringify(datos||{}).slice(0,200)+"\\n"+v.textContent.slice(0,1500);enviar()}
function foto(d){try{const p=d.player;return{estado:p.getPlayerState(),video:p.getVideoData().video_id,tiempo:Math.round(p.getCurrentTime()),cargado:Math.round(p.getVideoLoadedFraction()*100),mudo:p.isMuted(),vol:p.getVolume(),prep:!!d.prepared,cola:!!d.tailPlaying}}catch(e){return{}}}
window.__traza=(tipo,datos)=>{if(tipo!=="silence_tick")ev("c:"+tipo,datos||{})};
ev("carga",{ua:navigator.userAgent,nav:(performance.getEntriesByType("navigation")[0]||{}).type,historial:history.length,referrer:document.referrer});
const gesto=()=>{const g=navigator.userActivation?navigator.userActivation.hasBeenActive:null;document.getElementById("gesto").textContent=g?"Hubo toque completo":"Sin toque completo";return g};gesto();setInterval(gesto,1000);
for(const n of["touchstart","touchend","pointerup","pointercancel","click","scroll"]){let hechos=0;window.addEventListener(n,()=>{if(hechos++<3)ev("gesto_"+n,{activo:navigator.userActivation&&navigator.userActivation.isActive,y:Math.round(scrollY)})},{capture:true,passive:true})}
for(const n of["visibilitychange","freeze","resume","pagehide","pageshow"])document.addEventListener(n,()=>ev(n));
for(const n of["online","offline"])window.addEventListener(n,()=>ev(n));
setInterval(()=>{const f=window.__decks&&window.__decks();if(f)ev("latido",{gesto:gesto(),activo:f.activo,a:foto(f.decks[0]),b:foto(f.decks[1]),radio:document.getElementById("radio").getAttribute("data-radio-state")})},5000);
const marco=document.getElementById("radioPlayer");marco.dataset.src=marco.dataset.src.replace("__ORIGEN__",encodeURIComponent(location.origin));
</script><script src="${ruta}/public-loader.js" data-radio-client="${ruta}/radio.js"></script></html>`;

const cuna = join(raiz, "web/public/landing/radio/sweeper-v2.wav");
createServer((peticion, respuesta) => {
  const url = (peticion.url ?? "").split("?")[0]!;
  const json = (dato: unknown) => { respuesta.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); respuesta.end(JSON.stringify(dato)); };
  if (peticion.method === "POST") {
    let cuerpo = "";
    peticion.on("data", (trozo) => { if (cuerpo.length < 200000) cuerpo += trozo; });
    peticion.on("end", () => {
      if (url === `${ruta}/eventos`) {
        try { for (const fila of JSON.parse(cuerpo)) appendFileSync(registro, `${JSON.stringify(fila)}\n`); } catch { respuesta.writeHead(400); return respuesta.end(); }
        respuesta.writeHead(204); return respuesta.end();
      }
      if (url === `${ruta}/api/radio/listener`) return json({ listeners: 1 });
      if (url === `${ruta}/api/radio/unavailable`) { appendFileSync(registro, `${JSON.stringify({ t: new Date().toISOString(), tipo: "aviso_no_disponible", cuerpo })}\n`); return json({ excluded: false }); }
      if (url === `${ruta}/api/radio/diagnostic`) { appendFileSync(registro, `${JSON.stringify({ t: new Date().toISOString(), tipo: "diagnostico", cuerpo: cuerpo.slice(0, 20000) })}\n`); return json({ ok: true }); }
      respuesta.writeHead(404); respuesta.end();
    });
    return;
  }
  if (url === `${ruta}/`) {
    if (!emisionEmpezada) { emisionEmpezada = true; estacion.epochMs = Date.now(); }
    respuesta.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return respuesta.end(pagina);
  }
  // El cargador real del dominio: en Android arranca la radio solo, sin gesto. Con el botón no sería la misma prueba.
  if (url === `${ruta}/public-loader.js`) { respuesta.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); return respuesta.end(readFileSync(join(raiz, "web/public/landing/public-loader.js"))); }
  if (url === `${ruta}/radio-first-touch.js`) { respuesta.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); return respuesta.end(primerToque); }
  if (url === `${ruta}/radio.js`) { respuesta.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); return respuesta.end(cliente); }
  if (url === `${ruta}/api/radio/now`) return json(radioSnapshot(estacion, Date.now(), 1));
  if (url === `${ruta}/static/radio/sweeper-v2.wav`) {
    const datos = readFileSync(cuna), total = statSync(cuna).size;
    const rango = /bytes=(\d+)-(\d*)/u.exec(peticion.headers.range ?? "");
    if (rango) {
      const inicio = Number(rango[1]), fin = rango[2] ? Number(rango[2]) : total - 1;
      respuesta.writeHead(206, { "content-type": "audio/wav", "cache-control": "public, max-age=3600", "accept-ranges": "bytes", "content-range": `bytes ${inicio}-${fin}/${total}`, "content-length": fin - inicio + 1 });
      return respuesta.end(datos.subarray(inicio, fin + 1));
    }
    respuesta.writeHead(200, { "content-type": "audio/wav", "accept-ranges": "bytes", "content-length": total, "cache-control": "public, max-age=3600" });
    return respuesta.end(datos);
  }
  respuesta.writeHead(404); respuesta.end();
}).listen(puerto, host, () => console.log(`http://${host}:${puerto}${ruta}/`));
