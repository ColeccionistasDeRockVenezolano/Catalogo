// CRV · Minifica los clientes de la portada: src/landing/client/*.js → web/public/landing/*.js.
//   node scripts/build-radio-client.mjs [destino de radio.js]    (por defecto web/public/landing/radio.js)
//   node scripts/build-radio-client.mjs --check                  falla si lo publicado no sale de la fuente
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { transform } = require("esbuild");

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

const sourceUrl = name => new URL(`../src/landing/client/${name}`, import.meta.url);
const publishedUrl = name => new URL(`../web/public/landing/${name}`, import.meta.url);

export async function minifyRadioClient(source = readFileSync(sourceUrl("radio.js"), "utf8")) {
  return (await transform(source, { loader: "js", minify: true, target: "es2017" })).code;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const check = process.argv[2] === "--check";
  let stale = 0;
  for (const [source, published] of Object.entries(CLIENTS)) {
    const code = await minifyRadioClient(readFileSync(sourceUrl(source), "utf8"));
    if (check) {
      if (readFileSync(publishedUrl(published), "utf8") !== code) {
        console.error(`distinto: web/public/landing/${published} no sale de src/landing/client/${source}`);
        stale += 1;
      }
      continue;
    }
    const target = published === "radio.js" && process.argv[2] ? process.argv[2] : publishedUrl(published);
    writeFileSync(target, code);
  }
  if (check && stale) process.exit(1);
  if (check) console.log(`${Object.keys(CLIENTS).length} clientes de la portada coinciden con su fuente`);
}
