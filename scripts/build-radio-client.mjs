// CRV · Minifica los clientes de la radio: src/landing/client/{radio,first-touch}.js → web/public/landing.
//   node scripts/build-radio-client.mjs [destino de radio.js]    (por defecto web/public/landing/radio.js)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const { transform } = require("esbuild");

export async function minifyRadioClient(source = readFileSync(new URL("../src/landing/client/radio.js", import.meta.url), "utf8")) {
  return (await transform(source, { loader: "js", minify: true, target: "es2017" })).code;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const destino = process.argv[2] ?? new URL("../web/public/landing/radio.js", import.meta.url);
  writeFileSync(destino, await minifyRadioClient());
  writeFileSync(new URL("../web/public/landing/radio-first-touch.js", import.meta.url), await minifyRadioClient(readFileSync(new URL("../src/landing/client/first-touch.js", import.meta.url), "utf8")));
}
