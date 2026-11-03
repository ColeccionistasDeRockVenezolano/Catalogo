#!/usr/bin/env node
// Convierte el arte animado de la cuña de la radio en video, cuadro a cuadro y con reloj
// virtual: nada depende de la velocidad de la máquina y dos renders dan los mismos píxeles.
//
//   node scripts/radio-sweeper-video.mjs bars    <salida>                  barras por cuadro
//   node scripts/radio-sweeper-video.mjs render  <salida> [--workers 4]    maestro sin pérdida
//   node scripts/radio-sweeper-video.mjs frame   <salida> <n> <png>         un cuadro suelto
//   node scripts/radio-sweeper-video.mjs realtime <salida>                 barras offline vs AudioContext real
//   node scripts/radio-sweeper-video.mjs compare <salida> <n> <url>        cuadro vs marcado y CSS servidos
//
// Referencia fijada: 60 Hz, 48 kHz, volumen 100 %, sin la bajada final (en vivo el panel se oculta
// justo cuando empieza, así que esa parte no tiene equivalente visible y sigue al WAV original).
// La fórmula de las barras replica `buildSweeperBars` y `paintSweeper` de src/landing/client/radio.js.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANDING = path.join(ROOT, "web/public/landing");
const ORIGIN = "http://crv-sweeper.invalid";
const FPS = 60, SAMPLE_RATE = 48000, SCALE = 2, WIDTH = 2048, HEIGHT = 682;
const WAV = "radio/sweeper-v2.wav";
const RED = "#b5222a"; // La portada fija --red en línea sobre <body>; roadmap-public.min.css trae otro valor.
const MIME = { ".css": "text/css", ".png": "image/png", ".wav": "audio/wav", ".woff2": "font/woff2", ".html": "text/html" };

const artMarkup = () => {
  const ejs = readFileSync(path.join(ROOT, "src/landing/views/partials/radio-card.ejs"), "utf8");
  const match = ejs.match(/<div class="radio-card__art" data-radio-identifier-art>[\s\S]*?<\/span><\/span>\s*<\/div>/u);
  if (!match) throw new Error("No se encontró el marcado del arte en radio-card.ejs");
  return match[0].replaceAll("<%= basePath %>/static/", "/").replaceAll("<%= radioTexts.stationName %>", "CRV");
};

const PAGE = () => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/roadmap-public.min.css">
<style>html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important}
#stage{width:${WIDTH}px;height:${HEIGHT}px}</style></head>
<body style="--red:${RED}"><div id="stage" class="radio-card__identifier-stage">${artMarkup()}</div></body></html>`;

async function openPage(browser) {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") return route.fulfill({ contentType: "text/html", body: PAGE() });
    const file = path.join(LANDING, pathname);
    if (!file.startsWith(LANDING) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: MIME[path.extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
  await installArt(page);
  return { context, page };
}

// Crea las barras y deja las animaciones CSS congeladas, listas para buscar por tiempo.
async function installArt(page) {
  await page.evaluate(async () => {
    const COUNT = 31;
    const seed = (index, side) => { const v = Math.sin((index + 1) * 78.233 + side * 91.27) * 43758.5453; return v - Math.floor(v); };
    const art = document.querySelector("[data-radio-identifier-art]");
    art.style.transform = "translate(-50%, -50%) scale(1.0000)";
    const items = [];
    for (const [name, side] of [["left", 0], ["right", 1]]) {
      const host = art.querySelector(`[data-radio-wave="${name}"]`);
      for (let i = 0; i < COUNT; i += 1) {
        const bar = document.createElement("span");
        bar.className = "radio-card__bar";
        bar.setAttribute("aria-hidden", "true");
        host.appendChild(bar);
        const x = side === 0 ? i / (COUNT - 1) : 1 - i / (COUNT - 1);
        const envelope = Math.pow(Math.max(0, 1 - Math.abs(x - 0.81) / 0.84), 1.7);
        const peak = 12 + 190 * envelope * (0.34 + 0.66 * seed(i, side));
        bar.style.setProperty("--bar-h", `${Math.round(peak * 0.77)}px`);
        bar.style.setProperty("--bar-o", (0.07 + 0.89 * Math.pow(envelope, 0.8)).toFixed(2));
        items.push({ bar, peak, index: i });
      }
    }
    window.__sweeper = {
      items,
      heightsFrom(bins) {
        return items.map((item) => {
          const freq = Math.min(bins.length - 1, Math.round(4 + (item.index / COUNT) * (bins.length * 0.30)));
          const height = 4 + item.peak * (0.12 + (bins[freq] / 255) * 1.35);
          return Math.min(220, Math.max(3, height)).toFixed(1);
        });
      },
      seek(seconds, heights) {
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = seconds * 1000; }
        items.forEach((item, i) => item.bar.style.setProperty("--bar-h", `${heights[i]}px`));
      },
    };
    await document.fonts.load("900 228px 'Noto Sans Display'", "adio CRV");
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
    if (!document.fonts.check("900 228px 'Noto Sans Display'", "adio CRV")) throw new Error("Fuente del logotipo sin cargar");
  });
}

// Una lectura del analizador por cuadro de 60 Hz, como el requestAnimationFrame en vivo: el suavizado
// avanza con cada lectura. Las barras se repintan solo si pasaron 32 ms, o sea uno de cada dos cuadros.
async function computeBars(page, frames, duration) {
  return page.evaluate(async ({ frames, fps, sampleRate, wav, duration }) => {
    const bytes = await (await fetch(`/${wav}`)).arrayBuffer();
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate) + sampleRate, sampleRate);
    const buffer = await ctx.decodeAudioData(bytes);
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(0);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const out = [];
    let clock = -Infinity, current = null;
    const paint = (n) => {
      const stamp = (n * 1000) / fps;
      if (stamp - clock >= 32) { clock = stamp; current = window.__sweeper.heightsFrom(bins); }
      out.push(current);
    };
    paint(0);
    for (let n = 1; n < frames; n += 1) {
      ctx.suspend(n / fps).then(() => { analyser.getByteFrequencyData(bins); paint(n); ctx.resume(); });
    }
    await ctx.startRendering();
    return { rows: out, wavSeconds: buffer.duration, sampleRate: ctx.sampleRate };
  }, { frames, fps: FPS, sampleRate: SAMPLE_RATE, wav: WAV, duration });
}

const launch = () => chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--force-color-profile=srgb"] });

function wavSeconds() {
  // Se lee de la cabecera para no depender de la configuración en vivo.
  const data = readFileSync(path.join(LANDING, WAV));
  const fmt = data.indexOf("fmt ");
  const byteRate = data.readUInt32LE(fmt + 16);
  const chunk = data.indexOf("data");
  return data.readUInt32LE(chunk + 4) / byteRate;
}

async function loadBars(out) {
  const file = path.join(out, "barras.json");
  if (!existsSync(file)) throw new Error(`Falta ${file}: ejecutar antes el modo bars`);
  return JSON.parse(readFileSync(file, "utf8"));
}

// La densidad emulada es por sesión CDP: la sesión que captura debe declararla también.
async function captureSession(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
  return cdp;
}

async function capture(page, cdp, seconds, heights) {
  await page.evaluate(([t, h]) => new Promise((resolve) => {
    window.__sweeper.seek(t, h);
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }), [seconds, heights]);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 } });
  const png = Buffer.from(data, "base64");
  const size = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (size[0] !== WIDTH * SCALE || size[1] !== HEIGHT * SCALE) throw new Error(`Captura de ${size.join("x")}, se esperaba ${WIDTH * SCALE}x${HEIGHT * SCALE}`);
  return png;
}

async function renderSegment(rows, first, last, target, label) {
  const encoder = spawn("nice", ["-n", "10", "ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
    "-vf", "format=rgb24", "-c:v", "libx264rgb", "-crf", "0", "-preset", "veryfast", target], { stdio: ["pipe", "inherit", "inherit"] });
  const finished = new Promise((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg terminó con ${code} en ${target}`))));
  });
  const browser = await launch();
  const { page, context } = await openPage(browser);
  const cdp = await captureSession(context, page);
  const started = Date.now();
  for (let n = first; n < last; n += 1) {
    const png = await capture(page, cdp, n / FPS, rows[n]);
    if (!encoder.stdin.write(png)) await new Promise((resolve) => encoder.stdin.once("drain", resolve));
    if ((n - first) % 50 === 0) console.log(`[${label}] cuadro ${n} (${((n - first + 1) / ((Date.now() - started) / 1000)).toFixed(2)} c/s)`);
  }
  encoder.stdin.end();
  await browser.close();
  await finished;
}

const [mode, out, ...rest] = process.argv.slice(2);
if (!mode || !out) { console.error("Uso: radio-sweeper-video.mjs bars|render|frame|realtime|compare <salida> ..."); process.exit(2); }
mkdirSync(out, { recursive: true });

if (mode === "bars") {
  const duration = wavSeconds();
  const frames = Math.ceil(duration * FPS);
  const browser = await launch();
  const { page } = await openPage(browser);
  const result = await computeBars(page, frames, duration);
  await browser.close();
  writeFileSync(path.join(out, "barras.json"), JSON.stringify({ fps: FPS, sampleRate: result.sampleRate, duration, frames, rows: result.rows }));
  console.log(JSON.stringify({ frames, duration, wavSeconds: result.wavSeconds, sampleRate: result.sampleRate, filas: result.rows.length, distintas: new Set(result.rows.map(String)).size }));
} else if (mode === "render") {
  const { rows } = await loadBars(out);
  const workers = Number(rest[rest.indexOf("--workers") + 1]) || 4;
  const parts = path.join(out, "partes");
  rmSync(parts, { recursive: true, force: true });
  mkdirSync(parts);
  const size = Math.ceil(rows.length / workers);
  const jobs = Array.from({ length: workers }, (_, w) => ({ first: w * size, last: Math.min(rows.length, (w + 1) * size), file: path.join(parts, `p${w}.mkv`), label: `w${w}` }));
  await Promise.all(jobs.map((job) => renderSegment(rows, job.first, job.last, job.file, job.label)));
  const list = path.join(parts, "lista.txt");
  writeFileSync(list, jobs.map((job) => `file '${job.file.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
  const master = path.join(out, "sweeper-maestro-video-4096x1364.mkv");
  await new Promise((resolve, reject) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", master], { stdio: "inherit" })
    .on("close", (code) => (code === 0 ? resolve() : reject(new Error(`concat terminó con ${code}`)))));
  rmSync(parts, { recursive: true, force: true });
  console.log(`Maestro: ${master}`);
} else if (mode === "frame") {
  const { rows } = await loadBars(out);
  const n = Number(rest[0]);
  const browser = await launch();
  const { page, context } = await openPage(browser);
  const png = await capture(page, await captureSession(context, page), n / FPS, rows[n]);
  await browser.close();
  writeFileSync(rest[1], png);
  console.log(JSON.stringify({ n, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex") }));
} else if (mode === "realtime") {
  // Barras con AudioContext en tiempo real frente a las offline; comparación de la misma serie.
  const { rows } = await loadBars(out);
  const browser = await launch();
  const { page } = await openPage(browser);
  const live = await page.evaluate(async ({ sampleRate, wav }) => {
    const ctx = new AudioContext({ sampleRate });
    const buffer = await ctx.decodeAudioData(await (await fetch(`/${wav}`)).arrayBuffer());
    const gain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    await ctx.resume();
    const beganAt = ctx.currentTime + 0.05;
    source.start(beganAt);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const samples = [];
    await new Promise((resolve) => {
      const tick = () => {
        const t = ctx.currentTime - beganAt;
        if (t >= buffer.duration) return resolve();
        if (t >= 0) { analyser.getByteFrequencyData(bins); samples.push({ t, h: window.__sweeper.heightsFrom(bins) }); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { samples, rate: ctx.sampleRate };
  }, { sampleRate: SAMPLE_RATE, wav: WAV });
  await browser.close();
  const a = [], b = [];
  let absolute = 0;
  for (const { t, h } of live.samples) {
    const row = rows[Math.min(rows.length - 1, Math.round(t * FPS))];
    h.forEach((value, i) => { a.push(Number(value)); b.push(Number(row[i])); absolute += Math.abs(Number(value) - Number(row[i])); });
  }
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a), mb = mean(b);
  const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
  const correlation = cov / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
  const elapsed = live.samples.at(-1).t - live.samples[0].t;
  console.log(JSON.stringify({ lecturas: live.samples.length, hz: +((live.samples.length - 1) / elapsed).toFixed(1), sampleRate: live.rate, correlacion: +correlation.toFixed(4), errorMedioPx: +(absolute / a.length).toFixed(2) }));
} else if (mode === "compare") {
  // Mismo estado sobre el marcado y el CSS que sirve la portada; sus scripts no se ejecutan.
  const { rows } = await loadBars(out);
  const n = Number(rest[0]);
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: SCALE, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const request = route.request();
    if (["script", "media", "websocket", "xhr", "fetch"].includes(request.resourceType())) return route.abort();
    if (new URL(request.url()).origin !== new URL(rest[1]).origin) return route.abort();
    return route.continue();
  });
  await page.goto(rest[1], { waitUntil: "load" });
  await page.evaluate(([w, h]) => {
    const art = document.querySelector("[data-radio-identifier-art]");
    const stage = document.createElement("div");
    stage.className = "radio-card__identifier-stage";
    stage.style.cssText = `width:${w}px;height:${h}px`;
    stage.appendChild(art);
    document.documentElement.style.cssText = "margin:0;padding:0;background:#000;overflow:hidden";
    document.body.className = "";
    for (const [key, value] of [["margin", "0"], ["padding", "0"], ["background", "#000"], ["overflow", "hidden"]]) document.body.style.setProperty(key, value);
    document.body.replaceChildren(stage);
  }, [WIDTH, HEIGHT]);
  await installArt(page);
  const png = await capture(page, await captureSession(context, page), n / FPS, rows[n]);
  await browser.close();
  writeFileSync(rest[2], png);
  console.log(JSON.stringify({ n, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex") }));
} else {
  console.error(`Modo desconocido: ${mode}`);
  process.exit(2);
}
