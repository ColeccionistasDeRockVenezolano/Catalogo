// CRV · Minifica el cliente de la radio: src/landing/client/radio.js → destino.
//   node scripts/build-radio-client.mjs [destino]    (por defecto web/public/landing/radio.js)
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
}
