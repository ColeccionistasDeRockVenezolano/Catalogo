// CRV · Fichas de Hippito y sus Chatarritas desde la captura completa de
// Hermes (data/raw/deep-hippito-2026-10-25/posts.jsonl), leídas con el mismo
// adaptador del pipeline (src/adapters/hippito.ts). Una línea por entrada:
// título interpretado (artista, disco, sello, catálogo, año), portada, pistas
// con su intérprete (recopilatorios) y compositores en gris.
//
//   HIPPITO_POSTS=data/raw/deep-hippito-2026-10-25/posts.jsonl HIPPITO_OUT=<salida.jsonl> \
//     ./scripts/with-node22.sh npx tsx scripts/hippito-posts-parse.mts
import { readFileSync, writeFileSync } from "node:fs";
import { HippitoYSusChatarritasAdapter, parseHippitoTitle } from "../src/adapters/hippito.js";

const POSTS = process.env["HIPPITO_POSTS"] ?? "data/raw/deep-hippito-2026-10-25/posts.jsonl";
const OUT = process.env["HIPPITO_OUT"];
if (!OUT) throw new Error("falta HIPPITO_OUT");

class Reader extends HippitoYSusChatarritasAdapter {
  read(html: string, title: string, url: string) { return this.extractEntry(html, title, url); }
}
// Entradas venezolanas cuyo título no sigue «Artista - Título (Sello CAT / País Año)»:
// se reescriben a la convención para que el adaptador las lea igual que las demás.
// Las extranjeras (Historia de la Música Rock, Rolling Stones, Robin Gibb…) quedan fuera.
const TITLE_FIX: Record<string, string> = {
  "Joseíto Romero: Cinco décadas de guitarra eléctrica (2012)": "Joseíto Romero - Cinco décadas de guitarra eléctrica (Venezuela 2012)",
  "Carlos Alberto Quintero - Volver a sentir (IAEM FD2522006676)  / 2007)": "Carlos Alberto Quintero - Volver a sentir (IAEM FD2522006676 / Venezuela 2007)",
  "Fenomenal (Fonodisco Discorona, C.A. / Venezuela 2014)Armando Biart - ": "Armando Biart - Fenomenal (Fonodisco Discorona / Venezuela 2014)",
  "Serie Rock Clásicos de Venezuela Vol. 1: SYMA (Venezuela 2016)": "SYMA - Serie Rock Clásicos de Venezuela Vol. 1 (Venezuela 2016)",
  "Serie Rock Clásicos de Venezuela Vol. 2: Los Bonnevilles (Venezuela 2016)": "Los Bonnevilles - Serie Rock Clásicos de Venezuela Vol. 2 (Venezuela 2016)",
  "Los Supersónicos - Los Verdaderos Pioneros del Surf en Suramérica": "Los Supersónicos - Los Verdaderos Pioneros del Surf en Suramérica (Venezuela)",
  "La Historia Sonora del Rock en Venezuela - Azúcar, Cacao y Leche": "Azúcar, Cacao y Leche - La Historia Sonora del Rock en Venezuela (Venezuela)",
};
const reader = new Reader();
const lines: string[] = [];
let parsed = 0;
for (const line of readFileSync(POSTS, "utf8").split("\n").filter(Boolean)) {
  const post = JSON.parse(line) as { id: string; url: string; title: string; categories: string[]; content_html: string; published: string };
  const fixed = TITLE_FIX[post.title];
  if (fixed) post.title = fixed;
  const facts = parseHippitoTitle(post.title);
  if (!facts) { lines.push(JSON.stringify({ url: post.url, title: post.title, parsed: false })); continue; }
  parsed += 1;
  const records = reader.read(post.content_html, post.title, post.url);
  const value = (fields: ReadonlyArray<{ field: string; value?: unknown }>, name: string) => fields.find((field) => field.field === name)?.value;
  const album = records.find((record) => record.entityKind === "album")!;
  const tracks: Array<{ n: number; title: string; performer: string | null; credits: Array<{ name: string; role: string }> }> = [];
  for (const record of records) {
    if (record.entityKind === "track") {
      tracks.push({ n: Number(value(record.fields, "track_number")), title: String(value(record.fields, "title")), performer: null, credits: [] });
    } else if (record.entityKind === "track_credit") {
      const track = [...tracks].reverse().find((item) => item.title === value(record.fields, "track_title"));
      if (!track) continue;
      const role = String(value(record.fields, "credit_role"));
      if (role === "intérprete") track.performer = String(value(record.fields, "credited_name"));
      else track.credits.push({ name: String(value(record.fields, "credited_name")), role });
    }
  }
  lines.push(JSON.stringify({
    url: post.url, title: post.title, parsed: true, titleFixed: Boolean(fixed), published: post.published, categories: post.categories,
    artist: facts.artist, various: facts.various, album: facts.album, year: facts.year ?? null, label: facts.label ?? null,
    catalog: facts.catalog ?? null, country: (facts as { country?: string }).country ?? null,
    cover: value(album.fields, "cover_url") ?? null, tracks,
  }));
}
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(JSON.stringify({ posts: lines.length, parsed }));
