// RYM «nuevos» · 2.ª lista de géneros sin mapear (2026-10-06): 253 términos que no entraron porque la
// ficha ya tenía otro término reconocido (se descartaban en silencio). Misma regla que generos-sin-mapear.mts:
// alias al padre más cercano, `not_a_genre` lo que no es música, y como géneros nuevos solo los que
// elija Brian (--crear=bolero-beat,neo-psicodelia,dance-pop). Un run de taxonomía; sin --confirm se revierte.
// Después: apply-source-genres con los libros de RYM para que entren como secundarios.
//   ./scripts/with-node22.sh node_modules/.bin/tsx scripts/rym-nuevos-aplicar/generos-sin-mapear-2.mts [--crear=…] [--confirm]
import { writeFileSync } from "node:fs";
import { closeDb } from "../../src/db/client.js";
import { applyTaxonomyOperations, type TaxonomyOperation } from "../../src/genres/admin.js";

/** Candidatos a género propio: si no se crean, su término va como alias al padre. */
const CANDIDATOS: Record<string, { op: TaxonomyOperation; terms: string[] }> = {
  "bolero-beat": {
    op: { op: "create_genre", slug: "bolero-beat", name: "Bolero beat", level: "subgenre", parentSlug: "bolero",
      description: "Bolero con formación de grupo beat (guitarras eléctricas, bajo, batería y órgano), auge en los 60 y 70: Los Terrícolas, Los Pasteles Verdes, Los Ángeles Negros." },
    terms: ["Bolero-Beat"],
  },
  "neo-psicodelia": {
    op: { op: "create_genre", slug: "neo-psicodelia", name: "Neopsicodelia", level: "subgenre", parentSlug: "rock-psicodelico",
      description: "Revival de la psicodelia de los 60 desde los 80 en adelante, cruzado con el rock alternativo y el pop." },
    terms: ["Neo-Psychedelia"],
  },
  "dance-pop": {
    op: { op: "create_genre", slug: "dance-pop", name: "Dance pop", level: "genre", parentSlug: "pop",
      description: "Pop pensado para la pista de baile, con bases electrónicas y estribillos directos." },
    terms: ["Dance-Pop"],
  },
};
const PADRE_DE_CANDIDATO: Record<string, string> = { "bolero-beat": "bolero", "neo-psicodelia": "rock-psicodelico", "dance-pop": "pop" };

const MAPA: Record<string, string[]> = {
  "pop": ["Alt-Pop", "Sophisti-Pop", "Progressive Pop", "Europop", "City Pop", "J-Pop", "K-Pop", "Brill Building", "Neo-Acoustic",
    "Tontipop", "Novelty"],
  "dream-pop": ["Ambient Pop"],
  "art-pop": ["Baroque Pop"],
  "jangle-pop": ["Twee Pop"],
  "emo": ["Emo-Pop"],
  "dance": ["Hi-NRG", "Eurodance", "Bubblegum Dance", "Latin Freestyle", "Eurobeat"],
  "disco": ["Nu-Disco", "Electro-Disco", "Italo-Disco", "Boogie"],
  "easy-listening": ["Space Age Pop", "Lounge"],
  "pop-latino": ["MPB"],
  "pop-psicodelico": ["Tropicanibalismo"],
  "flamenco": ["Flamenco Pop"],
  "bolero": ["Bolero español", "Bolero son"],
  "soul": ["Neo-Soul", "Psychedelic Soul", "Latin Soul", "Detroit Sound", "Romanian Popcorn"],
  "r-and-b": ["Hip Hop Soul", "Trap Soul", "New Jack Swing"],
  "funk": ["Purple Sound", "Afro-Funk"],
  "folk": ["Avant-Folk", "Free Folk", "Anti-Folk", "Chamber Folk", "Freak Folk", "Folktronica"],
  "country": ["Americana", "Country Rock"],
  "ambient": ["Ambient Americana", "Ambient Dub"],
  "dark-ambient": ["Ritual Ambient"],
  "rock": ["Roots Rock", "Heartland Rock", "Big Music"],
  "rock-alternativo": ["Geek Rock"],
  "indie-rock": ["Noise Pop", "Shimokita-kei", "Baggy"],
  "rock-progresivo": ["Avant-Prog"],
  "surf-rock": ["Indie Surf", "Surf Punk", "Vocal Surf"],
  "garage-rock": ["Garage Punk"],
  "punk-rock": ["Skate Punk"],
  "post-punk": ["Post-Punk Revival", "Art Punk", "Dance-Punk", "Dance-Punk Revival"],
  "coldwave": ["Minimal Wave"],
  "darkwave": ["Neoclassical Darkwave"],
  "ska": ["2 Tone"],
  "reggae": ["Reggae Rock"],
  "blues": ["Electric Blues"],
  "musica-cristiana": ["Christian Rock"],
  "grindcore": ["Noisegrind"],
  "hardcore-punk": ["Emoviolence"],
  "metalcore": ["Mathcore"],
  "power-metal": ["US Power Metal"],
  "black-metal": ["Dissonant Black Metal"],
  "sludge-metal": ["Atmospheric Sludge Metal"],
  "slamming-brutal-death-metal": ["Slam Death Metal"],
  "industrial": ["Post-Industrial", "Industrial Rock"],
  "ebm": ["Electro-Industrial", "New Beat"],
  "noise": ["Vapornoise"],
  "electroacustica": ["Epic Collage", "Tape Music"],
  "turntablism": ["Turntable Music"],
  "hip-hop": ["Chopped and Screwed", "Jersey Club Rap", "Disco Rap", "Memphis Rap", "Dirty South", "Nerdcore Hip Hop",
    "Arabesque Rap", "Dungeon Rap", "Electro Hop", "Grime", "Atlanta Bass"],
  "boom-bap": ["Mid-School Hip Hop"],
  "gangsta-rap": ["G-Funk"],
  "trap": ["Rage", "PluggnB", "Dark Plugg", "Ambient Plugg", "Afro Trap", "Vaportrap"],
  "drill": ["Chicago Drill", "Jersey Drill"],
  "urbano-latino": ["Beat bruxaria", "Funk carioca", "Rasteirinha"],
  "cumbia": ["Digital Cumbia"],
  "latin-electronic-fusion": ["Tribal Guarachero"],
  "drum-and-bass": ["Drill and Bass", "Deep Drum and Bass", "Drumfunk"],
  "dubstep": ["Post-Dubstep"],
  "trance": ["Hard Trance", "Euro Trance", "Tech Trance", "Ambient Trance"],
  "techno": ["Freetekno", "Wonky Techno", "Peak Time Techno", "Hypertechno"],
  "house": ["Tropical House", "Fidget House", "Outsider House", "Microhouse", "Melodic House", "Dutch House", "Garage House",
    "Ghetto House", "Funky House", "Bubbling", "Bounce Beat", "Ballroom"],
  "electronica": ["Witch House", "Gabber", "Nu Style Gabber", "Happy Hardcore", "Freeform Hardcore", "Hardcore Breaks", "Acidcore",
    "Flashcore", "Raggacore", "Industrial Hardcore", "Hardstyle", "Rawstyle", "Hard Dance", "Hardbass", "Jungle Terror", "Krushclub",
    "Nerdcore Techno", "Progressive Breaks", "Acid Breaks", "Balearic Beat", "Footwork", "Baltimore Club", "Flex Dance Music",
    "UK Garage", "2-Step", "Bassline", "UK Funky", "Midtempo Bass", "Complextro", "Dariacore", "Hardwave", "Weightless",
    "Bubblegum Bass", "Batida", "Electro Swing", "Nightcore", "Chiptune", "Bitpop", "Tracker", "Sequencer", "Moogsploitation",
    "Hauntology", "Dreampunk", "Eccojams", "YTPMV", "Vapor", "Slushwave", "Broken Transmission", "Bérite Club", "Nervous Music"],
  "jazz": ["Third Stream", "Spiritual Jazz", "Afro-Jazz", "Modal Jazz", "Chamber Jazz", "ECM-Style Jazz", "Soul Jazz", "Bop"],
  "musica-clasica": ["Post-Minimalism", "Totalism", "Stochastic Music", "Brazilian Classical Music", "Western Classical Music",
    "Theme and Variation", "Fugue", "Overture", "Serenade", "Orchestral Song", "Lied", "Choral Symphony"],
  "musica-sacra": ["Cantata", "Requiem", "Christian Liturgical Music"],
  "musica-coral": ["A cappella"],
  "opera": ["Opera buffa", "Opéra-comique", "Verismo"],
  "banda-sonora": ["Video Game Music", "Epic Music", "Musical Theatre and Entertainment"],
  "musica-navidena": ["Carols"],
  "musica-tropical": ["Pachanga", "Danzón", "Rumba cubana", "Conga", "Rhumba"],
  "son": ["Cuban Charanga"],
  "tango": ["Milonga"],
  "musica-tradicional": ["Tamborito", "Tonada chilena", "Pasillo", "Doble paso", "Vals criollo", "Zamba", "Mexican Music",
    "Indigenous Andean Music", "Indigenous American Traditional Music", "Spanish Folk Music", "Welsh Folk Music", "Work Song"],
  "world-ethnic": ["Balinese Gamelan", "Sephardic Music"],
  "nueva-cancion": ["Nueva canción española"],
  "cantautor": ["Chanson à texte"],
  "not_a_genre": ["Satire", "Speeches", "Radio Drama", "Jingles", "Rain Sounds", "Musical Comedy"],
};

const crear = (process.argv.find((a) => a.startsWith("--crear="))?.slice(8) ?? "").split(",").filter(Boolean);
for (const c of crear) if (!CANDIDATOS[c]) throw new Error(`candidato desconocido: ${c}`);
const mapa: Record<string, string[]> = Object.fromEntries(Object.entries(MAPA).map(([k, v]) => [k, [...v]]));
for (const [slug, { terms }] of Object.entries(CANDIDATOS)) {
  const destino = crear.includes(slug) ? slug : PADRE_DE_CANDIDATO[slug]!;
  (mapa[destino] ??= []).push(...terms);
}
const notes = "término de Rate Your Music sin mapear (2.ª lista, 2026-10-06): alias al padre más cercano";
const ops: TaxonomyOperation[] = [
  ...crear.map((c) => CANDIDATOS[c]!.op),
  ...Object.entries(mapa).flatMap(([target, terms]) => terms.map((alias) => ({ op: "set_alias" as const, alias, target, notes }))),
];
const report = await applyTaxonomyOperations(ops, {
  actor: "claude-code (delegado por Brian)",
  reason: `Géneros de RYM «nuevos» sin mapear, 2.ª lista: ${crear.length ? `se crean ${crear.join(", ")}; ` : ""}el resto como alias al padre (Brian 2026-10-06)`,
}, { confirm: process.argv.includes("--confirm") });
writeFileSync("reports/rym-nuevos-aplicacion-2026-10-05/generos-sin-mapear-2-mapa.json", JSON.stringify({ crear, mapa }, null, 1));
console.log(JSON.stringify({ mode: report.mode, runId: report.runId, operaciones: report.operations.length,
  términos: Object.values(mapa).flat().length, creados: crear }));
await closeDb();
