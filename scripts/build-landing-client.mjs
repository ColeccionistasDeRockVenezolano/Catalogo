// CRV · Genera los recursos minificados de la portada desde su fuente.
//   node scripts/build-landing-client.mjs [destino de radio.js]    (por defecto web/public/landing/radio.js)
//   node scripts/build-landing-client.mjs --check                  falla si lo publicado no sale de la fuente
//
// JS: src/landing/client/*.js → web/public/landing/*.js
// Iconos: lucide-public.entry.js y el paquete lucide → web/public/landing/vendor
// CSS: web/public/landing/roadmap.css → roadmap-public.min.css
//
// src/landing/roadmap-critical.min.css no se genera: su lista de clases de la 1.1.39 no se conserva.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { build, transform } = require("esbuild");
const { PurgeCSS } = require("purgecss");

// fuente en src/landing/client → archivo publicado en web/public/landing
const CLIENTS = {
  "radio.js": "radio.js",
  "first-touch.js": "radio-first-touch.js",
  "i18n-client.js": "i18n-client.js",
  "icons.js": "icons.js",
  "nav.js": "nav.js",
  "public-loader.js": "public-loader.js",
  "roadmap.js": "roadmap.js",
  "visit-counter.js": "visit-counter.js",
};

const pathOf = relative => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const read = relative => readFileSync(pathOf(relative), "utf8");

export async function minifyRadioClient(source = read("src/landing/client/radio.js")) {
  return (await transform(source, { loader: "js", minify: true, target: "es2017" })).code;
}

async function lucideBundle() {
  const result = await build({
    entryPoints: [pathOf("src/landing/client/lucide-public.entry.js")],
    absWorkingDir: pathOf("web"),
    nodePaths: [pathOf("web/node_modules")],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["chrome100"],
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

async function publicCss() {
  const views = "src/landing/views";
  const client = "src/landing/client";
  const content = [
    `${views}/roadmap.ejs`, `${views}/partials/*.ejs`,
    ...["roadmap", "radio", "visit-counter", "nav", "icons", "i18n-client", "public-loader"].map(name => `${client}/${name}.js`),
  ].map(pathOf);
  const [purged] = await new PurgeCSS().purge({
    content,
    css: [pathOf("web/public/landing/roadmap.css")],
    // Las familias llegan por variables CSS del tema, que PurgeCSS no ve.
    fontFace: false,
    keyframes: true,
    safelist: {
      standard: [
        /^is-/, /^has-/, /^task--/, /^task-status--/, /^kicker--/, /^pbar--/,
        /^pbar-fill--/, /^cat-block--/, /^record-total--/, /^radio-card/,
        /^visits/, /^assignee/, /^social-/, /^hero-account/, /^lines-pagination/,
      ],
    },
  });
  return (await transform(purged.css, { loader: "css", minify: true, target: "chrome100" })).code;
}

async function outputs(radioTarget) {
  const list = [];
  for (const [source, published] of Object.entries(CLIENTS)) {
    const target = `web/public/landing/${published}`;
    list.push({ target, writeTo: published === "radio.js" && radioTarget ? radioTarget : pathOf(target), code: await minifyRadioClient(read(`src/landing/client/${source}`)) });
  }
  const others = {
    "web/public/landing/vendor/lucide-public.min.js": await lucideBundle(),
    "web/public/landing/vendor/lucide.min.js": read("web/node_modules/lucide/dist/umd/lucide.min.js"),
    "web/public/landing/roadmap-public.min.css": await publicCss(),
  };
  for (const [target, code] of Object.entries(others)) list.push({ target, writeTo: pathOf(target), code });
  return list;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const check = process.argv[2] === "--check";
  const list = await outputs(check ? null : process.argv[2]);
  if (check) {
    const stale = list.filter(({ target, code }) => read(target) !== code);
    for (const { target } of stale) console.error(`distinto: ${target} no sale de su fuente`);
    if (stale.length) process.exit(1);
    console.log(`${list.length} recursos de la portada coinciden con su fuente`);
  } else {
    for (const { writeTo, code } of list) writeFileSync(writeTo, code);
  }
}
