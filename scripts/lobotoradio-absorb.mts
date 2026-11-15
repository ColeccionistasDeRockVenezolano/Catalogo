// CRV · Absorción de Lobotoradio (captura del 2026-10-26), 2026-11-12.
//
// El cotejo del 2026-10-26 solo aplicó fusiones; la captura nunca se absorbió.
// Esta pasada rellena lo que falta, con la lectura normalizada de
// `scripts/lobotoradio-absorb-parse.py` (nombres de las bandas cuyo encabezado
// es el logo, logos bajados el 2026-11-12, membresías recuperadas, créditos
// tipados y autorías L:/M: del cotejo).
//
// Reglas (las mismas de RHV y del catálogo):
//   · solo se rellena lo vacío; una foto o portada distinta va a Curaduría;
//   · banda/artista: identidad por nombre, nombre completo o alias; varias
//     fichas posibles se desempatan por ciudad o discos en común; si no, se
//     informa. Una banda ausente se crea solo si su origen es venezolano y no
//     se parece (≥ 0,88) a otra del catálogo;
//   · personas: solo se reutiliza una ficha ligada a un proyecto común (banda
//     o disco ya resuelto); una firma parecida dentro del proyecto va a
//     revisión, no se crea. Sin proyecto común no se toca nada;
//   · discos: cruce SOLO por título exacto (sin tildes ni artículos) dentro
//     del artista; un título parecido (≥ 0,6) queda propuesto; uno nuevo se
//     crea si el artista es del catálogo y el disco es venezolano;
//   · pistas solo en discos nuevos o sin pistas; nunca se renumeran; la
//     duración se completa en pistas de título exacto y único;
//   · autorías L:/M: y créditos por pista solo con título exacto y único;
//   · los enlaces a RYM no se guardan (no se nombra en público).
//
//   LOBO_FICHAS=…/fichas.json LOBO_OUT=…/dir ./scripts/with-node22.sh npx tsx scripts/lobotoradio-absorb.mts [--confirm]
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { persistClaim, type ClaimToPersist } from "../src/claims/persistence.js";
import { normalizeIdentity, normalizeIdentitySecondary } from "../src/normalization/claims.js";
import { predictableNameVariants } from "../src/normalization/entity-name.js";
import { excludedArtist } from "../src/catalog/editorial-scope.js";
import { audiovisualAlbumConflict } from "../src/youtube/audiovisuals.js";
import { instrumentsOf } from "../src/discography/instruments.js";
import { proposeImageCandidate } from "../src/merge/image-candidates.js";

const TAG = "lobotoradio-2026-11-12";
const SLUG = "lobotoradio";
const CAPTURE = "raw/lobotoradio-2026-10-26";
const LOGOS = "raw/lobotoradio-logos-2026-11-12";
const OPERATOR = "claude-code (encargo de Brian)";
const NOTE = "Absorción de Lobotoradio (captura 2026-10-26): fotos, logos, biografías, origen, años, alias, enlaces, membresías, datos de personas, discos, pistas, créditos, autorías y sellos; solo rellena vacíos";
const VA_ARTIST_ID = 257;
const FICHAS = process.env["LOBO_FICHAS"];
const OUT = process.env["LOBO_OUT"];
if (!FICHAS || !OUT) throw new Error("Faltan LOBO_FICHAS y LOBO_OUT");
const CONFIRM = process.argv.includes("--confirm");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEDIA_STORE = path.join(ROOT, "web/public/media");

// ── Tipos de la lectura ─────────────────────────────────────────────────────
interface Period { raw: string; from: number | null; to: number | null; current: boolean }
interface LocalImage { url: string; file: string; sha256: string }
interface PersonLike {
  kind: "banda" | "artist"; slug: string; url: string; name: string; fullName: string | null; aliases: string[];
  origin: string | null; formed: number | null; ended: number | null; gender: string | null; unknownKind: boolean;
  birth: string | null; birthPlace: string | null; death: string | null; deathPlace: string | null; deceased: boolean;
  instruments: string[]; genres: string[]; links: Array<{ text: string; href: string }>;
  groups: Array<{ name: string; url: string; period: Period | null }>; bio: string | null;
  photo: LocalImage[]; photoUrl: string | null; logoUrl: string | null;
  discography: Array<{ section: string; title: string; url: string; year: string | null }>;
}
interface Credit { section: string; roles: Array<{ role: string; positions: string[] }>; name: string; href: string | null; positions: string[]; raw: string }
interface Release {
  slug: string; url: string; title: string; artists: Array<{ name: string; url: string }>; country: string | null; year: number | null;
  formats: string[]; label: { name: string; url: string | null } | null; catalog: string | null; genres: string[];
  tracks: Array<{ num: string; title: string; seconds: number | null }>; credits: Credit[]; cover: LocalImage[]; coverUrl: string | null;
}
interface Company { slug: string; url: string; name: string; type: string | null; address: string | null; description: string | null; logo: LocalImage[] }
interface Authorship { releaseSlug: string; trackNumber: string; trackTitle: string; role: string; name: string; targetKind: string; targetUrl: string; quote: string }
const data = JSON.parse(readFileSync(FICHAS, "utf8")) as { bands: PersonLike[]; persons: PersonLike[]; releases: Release[]; companies: Company[] };
const authorship = JSON.parse(readFileSync(path.join(ROOT, "reports/lobotoradio-cotejo-2026-10-26/authorship-typed.json"), "utf8")) as Authorship[];
const logoFiles = new Map<string, string>();
for (const line of readFileSync(path.join(ROOT, "data", LOGOS, "media.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const item = JSON.parse(line) as { kind: string; slug: string; file: string; status: number };
  if (item.status === 200) logoFiles.set(`${item.kind}/${item.slug}`, `${LOGOS}/${item.file}`);
}

// ── Utilidades ──────────────────────────────────────────────────────────────
const fold = (value: string): string => value.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
const titleKey = (value: string): string => fold(value).replace(/&|\band\b|\by\b/g, " ").replace(/^\s*(los|las|el|la|the)\s+/u, "").replace(/[^a-z0-9]+/g, "");
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b; const shorter = a.length >= b.length ? b : a;
  if (shorter.length >= 6 && longer.includes(shorter)) return 0.9;
  const grams = (text: string): Set<string> => { const set = new Set<string>(); for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2)); return set; };
  const left = grams(longer); const right = grams(shorter);
  let shared = 0; for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size || 1);
}
const personKey = (name: string): string => fold(name).replace(/[«»"“”'’´`.]/g, "").replace(/\s+/g, " ").trim();
const tokens = (name: string): string[] => personKey(name).split(/[^a-z0-9]+/).filter((t) => t.length > 1);
const urlKey = (url: string): string => url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
function fit(value: string, bytes: number): string { let out = value; while (Buffer.byteLength(out, "utf8") > bytes) out = out.slice(0, -1); return out; }
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const INDEPENDENT = /^(?:independiente|independent|autoproducci[oó]n|autoproducido|autoeditado|sin sello|n\/?a|s\/s)$/i;
const splitPlace = (raw: string | null): { city: string | null; country: string | null } => {
  if (!raw) return { city: null, country: null };
  const parts = raw.split(/\s*,\s*/).filter(Boolean);
  if (parts.length === 1) return { city: null, country: parts[0]! };
  return { city: parts.slice(0, -1).join(", "), country: parts.at(-1)! };
};
const isVenezuelan = (raw: string | null): boolean => /venezuela/i.test(raw ?? "");

// Tipo y formato desde «LP · vinilo · estudio · 33 ⅓ · 12 in».
function releaseType(formats: string[]): string {
  const f = formats.map((x) => fold(x));
  if (f.includes("sencillo")) return "single";
  if (f.includes("ep")) return "ep";
  if (f.includes("demo")) return "demo";
  if (f.includes("en vivo")) return "live_album";
  if (f.includes("recopilacion")) return "compilation";
  if (f.includes("banda sonora")) return "soundtrack";
  return "studio_album";
}
function mediaFormat(formats: string[]): string | null {
  const f = formats.map((x) => fold(x));
  if (f.includes("lp")) return "LP";
  if (f.includes("cd")) return "CD";
  if (f.includes("casete")) return "Cassette";
  if (f.includes("digital")) return "Digital";
  if (f.includes("vinilo")) { const inch = formats.find((x) => /^\d+ in$/.test(x)); return inch ? `${inch.replace(" in", "")}"` : "Vinyl"; }
  if (f.includes("dvd")) return "DVD";
  return null;
}

// Rol del sitio → vocabulario del catálogo (Musicians / Guest Musicians y créditos técnicos en inglés).
const INSTRUMENT_EN: ReadonlyArray<[RegExp, string]> = [
  [/^(?:voz|voces|voz principal|voz lider|canto)$/, "Lead Vocals"], [/^(?:coros?|voces de apoyo|segunda voz)$/, "Backing Vocals"],
  [/^(?:guitarras?)$/, "Guitars"], [/^guitarra (?:lider|principal|solista)$/, "Lead Guitar"], [/^guitarra ritmica$/, "Rhythm Guitar"],
  [/^guitarra acustica$/, "Acoustic Guitar"], [/^guitarra electrica$/, "Electric Guitar"], [/^(?:bajo|bajo electrico)$/, "Bass"],
  [/^contrabajo$/, "Double Bass"], [/^(?:bateria|baterias)$/, "Drums"], [/^(?:percusion|percusiones)$/, "Percussion"],
  [/^(?:teclados?)$/, "Keyboards"], [/^piano$/, "Piano"], [/^(?:sintetizador(?:es)?)$/, "Synthesizer"], [/^organo$/, "Organ"],
  [/^(?:programacion(?:es)?|secuencias)$/, "Programming"], [/^(?:saxo|saxofon|saxofones)$/, "Sax"], [/^saxofon tenor$/, "Tenor Sax"],
  [/^saxofon alto$/, "Alto Sax"], [/^saxofon baritono$/, "Baritone Sax"], [/^saxofon soprano$/, "Soprano Sax"], [/^trompetas?$/, "Trumpet"],
  [/^(?:trombon|trombones)$/, "Trombone"], [/^flautas?$/, "Flute"], [/^clarinete$/, "Clarinet"], [/^(?:violin|violines)$/, "Violin"],
  [/^viola$/, "Viola"], [/^(?:violonchelo|chelo)$/, "Cello"], [/^cuatro$/, "Cuatro"], [/^arpa$/, "Harp"], [/^maracas$/, "Maracas"],
  [/^armonica$/, "Harmonica"], [/^acordeon$/, "Accordion"], [/^mandolina$/, "Mandolin"], [/^congas?$/, "Congas"], [/^bongos?$/, "Bongos"],
  [/^timbales?$/, "Timbales"], [/^(?:efectos)$/, "Effects"], [/^(?:scratch|tornamesas?|dj)$/, "Turntables"], [/^rap$/, "Rap"],
  [/^(?:samplers?|samples?)$/, "Samples"], [/^corno$/, "French Horn"], [/^clavinet$/, "Clavinet"], [/^tambora$/, "Tambora"], [/^kalimba$/, "Kalimba"], [/^cabasa$/, "Cabasa"], [/^guira$/, "Güira"], [/^moog$/, "Moog Synthesizer"], [/^vibrafono$/, "Vibraphone"], [/^corno frances$/, "French Horn"], [/^tuba$/, "Tuba"],
  [/^fliscorno$/, "Flugelhorn"], [/^oboe$/, "Oboe"], [/^fagot$/, "Bassoon"], [/^guiro$/, "Güiro"], [/^pandereta$/, "Tambourine"],
  [/^cajon$/, "Cajón"], [/^tres$/, "Tres"], [/^bandola$/, "Bandola"], [/^melodica$/, "Melodica"], [/^(?:narracion|locucion)$/, "Narration"],
  [/^(?:musico|musicos)$/, "Musician"], [/^(?:palmas|palmadas)$/, "Handclaps"], [/^tambores$/, "Drums (tambores)"], [/^timbal$/, "Timbales"],
  [/^metales$/, "Horns"], [/^cuerdas$/, "Strings"], [/^tumbadoras?$/, "Congas"], [/^secuenciador(?:es)?$/, "Sequencer"], [/^(?:interpretacion|interprete)$/, "Performer"],
  [/^platillos$/, "Cymbals"], [/^voces$/, "Vocals"], [/^guitarra (?:solista|solo)$/, "Lead Guitar"], [/^voz gutural$/, "Screams"], [/^vocoder$/, "Vocoder"], [/^theremin$/, "Theremin"],
];
const untranslated = new Map<string, number>();
function instrumentEn(raw: string): string {
  const base = fold(raw).replace(/\[.*?\]/g, "").replace(/[.()]/g, "").replace(/\s+/g, " ").trim();
  const hit = INSTRUMENT_EN.find(([pattern]) => pattern.test(base))?.[1];
  if (!hit) untranslated.set(`instr:${base}`, (untranslated.get(`instr:${base}`) ?? 0) + 1);
  const qualifier = /\[(.*?)\]/.exec(raw)?.[1];
  const label = hit ?? raw.replace(/\s*\[.*?\]/g, "").replace(/^./, (c) => c.toUpperCase());
  return qualifier ? `${label} (${qualifier})` : label;
}
type CreditType = "producer" | "mixing" | "mastering" | "recording" | "artwork" | "photography" | "other" | "composer" | "writer";
const TECH: ReadonlyArray<[RegExp, CreditType, string]> = [
  [/^producido por \[ejecutivo\]$/, "producer", "Executive Producer"], [/^producido por \[musical\]$/, "producer", "Musical Producer"],
  [/^producido por \[asistente\]$/, "producer", "Assistant Producer"], [/^coproducido por/, "producer", "Co-produced by"],
  [/^producido por/, "producer", "Produced by"], [/^realizado por/, "producer", "Realization"],
  [/^mezclado por \[asistente\]$/, "mixing", "Assistant Mixing Engineer"], [/^mezclado por/, "mixing", "Mixed by"],
  [/^masterizado por/, "mastering", "Mastered by"], [/^grabado por \[asistente\]$/, "recording", "Assistant Engineer"],
  [/^grabado por \[(?:ingeniero|tecnico de grabacion)\]$/, "recording", "Recording Engineer"], [/^grabado por/, "recording", "Recorded by"],
  [/^editado por/, "mixing", "Edited by"], [/^fotografias por/, "photography", "Photography"],
  [/^diseno grafico \[logotipo\]$/, "artwork", "Logo"], [/^diseno grafico \[(?:ilustracion(?:es)?|ilustracion de caratula)\]$/, "artwork", "Illustration"],
  [/^diseno grafico \[(?:concepto de caratula|caratula|arte)\]$/, "artwork", "Cover Art"], [/^diseno grafico/, "artwork", "Graphic Design"],
  [/^arreglos por \[cuerdas\]$/, "other", "String Arrangements"], [/^arreglos por \[metales\]$/, "other", "Horn Arrangements"],
  [/^arreglos por/, "other", "Arrangements"], [/^dirigido por \[musical\]$/, "other", "Musical Director"],
  [/^dirigido por \[artistico\]$/, "other", "Artistic Director"], [/^dirigido por/, "other", "Directed by"],
  [/^gerencia/, "other", "Management"], [/^compuesto por \[letra\]$/, "writer", "Lyrics"], [/^compuesto por \[musica\]$/, "composer", "Music"],
  [/^compuesto por/, "composer", "Composed by"],
  // Empresas
  [/^grabado en/, "recording", "Recorded at"], [/^mezclado en/, "mixing", "Mixed at"], [/^masterizado en/, "mastering", "Mastered at"],
  [/^(?:cortado en|lacquer cut)/, "mastering", "Lacquer Cut at"], [/^fabricado por/, "other", "Manufactured by"],
  [/^fabricado para/, "other", "Manufactured for"], [/^distribuido por/, "other", "Distributed by"], [/^impreso por/, "other", "Printed by"],
  [/^producido para/, "other", "Produced for"], [/^preproducido por/, "producer", "Pre-production"], [/^cortado por/, "mastering", "Lacquer Cut by"],
  [/^equipo tecnico/, "other", "Technical Crew"], [/^liner notes/, "other", "Liner Notes"], [/^coordinado por/, "other", "Coordination"],
  [/^maquillaje por/, "other", "Make-up"], [/^supervisado por/, "other", "Supervised by"], [/^programacion por/, "other", "Programming"],
  [/^a&r/, "other", "A&R"], [/^concepto por/, "other", "Concept"], [/^musicos?$/, "other", "Musician"], [/^editado en/, "other", "Published by"],
];
function technical(raw: string): { type: CreditType; role: string } | null {
  const key = fold(raw).replace(/\s+/g, " ").trim();
  if (/^agradecimientos|^sello$|^dedicado a|^cortesia de|^licencia por/.test(key)) return null;
  const hit = TECH.find(([pattern]) => pattern.test(key));
  if (hit) return { type: hit[1], role: hit[2] };
  untranslated.set(`tech:${key}`, (untranslated.get(`tech:${key}`) ?? 0) + 1);
  return { type: "other", role: raw.replace(/^./, (c) => c.toUpperCase()) };
}
const ORG_TYPE: Record<string, string> = { estudio: "recording_studio", sello: "record_label", disquera: "record_label", productora: "production_company", distribuidora: "distributor" };
const SOCIAL: Record<string, { kind: "social" | "streaming"; platform: string }> = {
  facebook: { kind: "social", platform: "facebook" }, instagram: { kind: "social", platform: "instagram" }, x: { kind: "social", platform: "x" },
  twitter: { kind: "social", platform: "x" }, tiktok: { kind: "social", platform: "tiktok" }, oficial: { kind: "social", platform: "website" },
  spotify: { kind: "streaming", platform: "spotify" }, bandcamp: { kind: "streaming", platform: "bandcamp" }, soundcloud: { kind: "streaming", platform: "soundcloud" },
  deezer: { kind: "streaming", platform: "deezer" }, apple: { kind: "streaming", platform: "apple_music" }, tidal: { kind: "streaming", platform: "tidal" },
  youtube: { kind: "streaming", platform: "youtube" }, amazon: { kind: "streaming", platform: "amazon_music" },
};

// ── Informe ─────────────────────────────────────────────────────────────────
const report = {
  mode: CONFIRM ? "confirm" : "dry-run", runId: 0,
  artists: { matched: 0, created: 0, ambiguous: [] as unknown[], unmatched: [] as unknown[], similarSkipped: [] as unknown[], excluded: [] as string[], originConflict: [] as unknown[], filled: {} as Record<string, number>, imageCandidates: 0, documents: 0 },
  persons: { matched: 0, created: 0, noContext: 0, ambiguous: [] as unknown[], doubtful: [] as unknown[], filled: {} as Record<string, number>, conflicts: [] as unknown[], pictureKept: 0 },
  members: { created: 0, periodsFilled: 0, detail: 0 },
  albums: { matched: 0, created: 0, unresolvedArtist: [] as unknown[], ambiguous: [] as unknown[], proposed: [] as unknown[], notVenezuelan: [] as unknown[], audiovisualConflict: [] as unknown[], filled: {} as Record<string, number>, coverCandidates: 0, tracklistDiffers: [] as unknown[] },
  tracks: { created: 0, durations: 0 },
  credits: { album: {} as Record<string, number>, track: 0, unresolvedTarget: 0, skippedExisting: 0 },
  authorship: { credited: 0, already: 0, trackMissing: 0, albumMissing: 0, targetMissing: 0 },
  organizations: { matched: 0, created: 0, filled: {} as Record<string, number>, createdList: [] as string[] },
  links: { social: 0, streaming: 0 }, claims: { inserted: 0, reused: 0 }, rawPages: 0,
  createdArtists: [] as Array<{ id: number; name: string; url: string }>,
  createdPersons: [] as Array<{ id: number; name: string; url: string; why: string; homonyms: number[] }>,
  createdAlbums: [] as Array<{ id: number; artist: string; title: string; year: number | null; type: string; tracks: number }>,
  genreLedger: 0,
};
const bump = (bucket: Record<string, number>, key: string): void => { bucket[key] = (bucket[key] ?? 0) + 1; };
const ledger: Array<Record<string, unknown>> = [];
const copies: Array<{ from: string; to: string }> = [];

async function apply(client: PoolClient, runId: number, sourceId: number): Promise<void> {
  await client.query("SET LOCAL lock_timeout = '30s'");
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => (await client.query<T>(sql, params)).rows;

  // ── Crudo: una raw_page por ficha ──
  const rawPageId = new Map<string, number>();
  const dirOf: Record<string, string> = { banda: "bandas", artist: "artistas", release: "discos", empresa: "empresa" };
  const addRaw = async (kind: string, slug: string, url: string): Promise<void> => {
    const stored = `${CAPTURE}/${dirOf[kind]}/${slug}.html.gz`;
    const file = path.join(ROOT, "data", stored);
    if (!existsSync(file)) return;
    const bytes = readFileSync(file);
    const row = (await q<{ id: string }>(`
      INSERT INTO ingest.raw_pages(source_id,url,canonical_url,http_status,content_type,sha256,byte_size,stored_path,fetched_at,run_id)
      VALUES($1,$2,$2,200,'text/html; charset=UTF-8 (gzip)',$3,$4,$5,'2026-10-26T12:00:00Z',$6)
      ON CONFLICT (source_id,sha256) DO UPDATE SET url=EXCLUDED.url RETURNING id::text`, [sourceId, url, sha(bytes), bytes.length, stored, runId]))[0]!;
    rawPageId.set(url, Number(row.id)); report.rawPages += 1;
  };
  for (const b of data.bands) await addRaw("banda", b.slug, b.url);
  for (const p of data.persons) await addRaw("artist", p.slug, p.url);
  for (const r of data.releases) await addRaw("release", r.slug, r.url);
  for (const c of data.companies) await addRaw("empresa", c.slug, c.url);
  const claim = async (url: string, kind: ClaimToPersist["entityKind"], identity: string, field: string, value: unknown, targets: Partial<ClaimToPersist>): Promise<void> => {
    if (value === null || value === undefined || value === "") return;
    const persisted = await persistClaim({
      entityKind: kind, identity: normalizeIdentity(identity), identitySecondary: normalizeIdentitySecondary(identity), originalIdentity: identity,
      field, rawValue: value, normalizedValue: value, rawHash: sha(JSON.stringify(["v2", kind, identity, field, value])),
      extractor: "lobotoradio", extractorVersion: "2", evidence: { url }, sourceId, ...(rawPageId.has(url) ? { rawPageId: rawPageId.get(url)! } : {}), runId, confidence: "medium", ...targets,
    }, client);
    if (persisted.inserted) report.claims.inserted += 1; else report.claims.reused += 1;
  };
  // Copia de un archivo de la captura a /crv/media (solo al confirmar).
  const publishImage = (relative: string, folder: string, base: string): string => {
    const ext = path.extname(relative) || ".webp";
    // Sufijo propio: nunca coincide con un archivo previo de la misma ficha.
    const name = `${base}-lobotoradio${ext}`;
    copies.push({ from: path.join(ROOT, "data", relative), to: path.join(MEDIA_STORE, folder, name) });
    return `/crv/media/${folder}/${name}`;
  };

  // ── Índices del catálogo ──
  const artistRows = await q<{ id: string; name: string; artist_type: string; biography: string | null; picture_url: string | null; logo_url: string | null; origin_city: string | null; origin_country: string | null; formed_year: number | null; disbanded_year: number | null }>(
    "SELECT id::text,name,artist_type::text,biography,picture_url,logo_url,origin_city,origin_country,formed_year,disbanded_year FROM public.artists");
  const artistById = new Map(artistRows.map((row) => [Number(row.id), row]));
  const byVariant = new Map<string, Set<number>>();
  const addVariant = (name: string, id: number): void => { for (const v of predictableNameVariants(name)) (byVariant.get(v) ?? byVariant.set(v, new Set()).get(v)!).add(id); };
  for (const row of artistRows) addVariant(row.name, Number(row.id));
  for (const row of await q<{ artist_id: string; alias: string }>("SELECT artist_id::text,alias FROM ingest.artist_aliases")) addVariant(row.alias, Number(row.artist_id));
  const compactIndex = artistRows.map((row) => ({ id: Number(row.id), key: titleKey(row.name) }));
  const aliasesOf = new Map<number, Set<string>>();
  for (const row of await q<{ artist_id: string; alias: string }>("SELECT artist_id::text,alias FROM ingest.artist_aliases")) (aliasesOf.get(Number(row.artist_id)) ?? aliasesOf.set(Number(row.artist_id), new Set()).get(Number(row.artist_id))!).add(normalizeIdentity(row.alias));

  const albumRows = await q<{ id: string; artist_id: string; title: string; release_year: number | null; album_type: string; label_id: string | null; cover_url: string | null; catalog_id: string | null; media_format: string | null }>(
    "SELECT id::text,artist_id::text,title,release_year,album_type::text,label_id::text,cover_url,catalog_id,media_format FROM public.albums");
  const albumsByArtist = new Map<number, typeof albumRows>();
  for (const row of albumRows) (albumsByArtist.get(Number(row.artist_id)) ?? albumsByArtist.set(Number(row.artist_id), []).get(Number(row.artist_id))!).push(row);
  const albumArtist = new Map(albumRows.map((row) => [Number(row.id), Number(row.artist_id)]));

  const personRows = await q<{ id: string; name: string; real_name: string | null; biography: string | null; picture_url: string | null; birth_date_value: string | null; death_date_value: string | null; birth_city: string | null; is_deceased: boolean | null; gender: string | null }>(
    "SELECT id::text,name,real_name,biography,picture_url,birth_date_value,death_date_value,birth_city,is_deceased,gender FROM public.persons");
  const personById = new Map(personRows.map((row) => [Number(row.id), row]));
  const personByVariant = new Map<string, Set<number>>();
  const addPersonVariant = (name: string, id: number): void => { for (const v of predictableNameVariants(name)) (personByVariant.get(v) ?? personByVariant.set(v, new Set()).get(v)!).add(id); };
  for (const row of personRows) { addPersonVariant(row.name, Number(row.id)); if (row.real_name) addPersonVariant(row.real_name, Number(row.id)); }
  for (const row of await q<{ person_id: string; alias: string }>("SELECT person_id::text,alias FROM ingest.person_aliases")) addPersonVariant(row.alias, Number(row.person_id));
  // Proyectos de cada persona: artistas (miembro o acreditado) y discos.
  const personArtists = new Map<number, Set<number>>();
  const personAlbums = new Map<number, Set<number>>();
  const artistPersons = new Map<number, Set<number>>();
  const link = (personId: number, artistId: number, albumId?: number): void => {
    (personArtists.get(personId) ?? personArtists.set(personId, new Set()).get(personId)!).add(artistId);
    (artistPersons.get(artistId) ?? artistPersons.set(artistId, new Set()).get(artistId)!).add(personId);
    if (albumId) (personAlbums.get(personId) ?? personAlbums.set(personId, new Set()).get(personId)!).add(albumId);
  };
  for (const row of await q<{ person_id: string; artist_id: string; album_id: string | null }>(`
      SELECT c.person_id::text, al.artist_id::text, al.id::text album_id FROM public.album_credits c JOIN public.albums al ON al.id=c.album_id WHERE c.person_id IS NOT NULL
      UNION SELECT c.person_id::text, al.artist_id::text, al.id::text FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums al ON al.id=t.album_id WHERE c.person_id IS NOT NULL
      UNION SELECT m.person_id::text, m.artist_id::text, NULL FROM public.artist_members m`)) {
    link(Number(row.person_id), Number(row.artist_id), row.album_id ? Number(row.album_id) : undefined);
  }
  const memberships = new Map<string, { id: number; from: number | null; to: number | null }>();
  for (const row of await q<{ id: string; artist_id: string; person_id: string; from_year: number | null; to_year: number | null }>("SELECT id::text,artist_id::text,person_id::text,from_year,to_year FROM public.artist_members")) {
    memberships.set(`${row.artist_id}|${row.person_id}`, { id: Number(row.id), from: row.from_year, to: row.to_year });
  }
  const orgRows = await q<{ id: string; name: string; organization_type: string; picture_url: string | null; country: string | null; biography: string | null }>("SELECT id::text,name,organization_type::text,picture_url,country,biography FROM public.organizations");
  const orgById = new Map(orgRows.map((row) => [Number(row.id), row]));
  const orgByVariant = new Map<string, Set<number>>();
  const addOrg = (name: string, id: number): void => { for (const v of predictableNameVariants(name)) (orgByVariant.get(v) ?? orgByVariant.set(v, new Set()).get(v)!).add(id); };
  for (const row of orgRows) addOrg(row.name, Number(row.id));
  for (const row of await q<{ organization_id: string; alias: string }>("SELECT organization_id::text,alias FROM ingest.organization_aliases")) addOrg(row.alias, Number(row.organization_id));
  const socialPlatforms = new Set((await q<{ k: string }>("SELECT artist_id||'|'||platform k FROM public.social_links")).map((row) => row.k));
  const streamingPlatforms = new Set((await q<{ k: string }>("SELECT 'a'||artist_id||'|'||platform k FROM public.streaming_links WHERE artist_id IS NOT NULL")).map((row) => row.k));
  const knownUrls = new Set((await q<{ url: string }>("SELECT url FROM public.social_links UNION SELECT url FROM public.streaming_links")).map((row) => urlKey(row.url)));

  const releaseByUrl = new Map(data.releases.map((r) => [r.url, r]));
  const companyByUrl = new Map(data.companies.map((c) => [c.url, c]));
  const bandByUrl = new Map(data.bands.map((b) => [b.url, b]));
  const personByUrl = new Map(data.persons.map((p) => [p.url, p]));

  // ══ 1. Bandas y artistas ═════════════════════════════════════════════════
  const artistOf = new Map<string, number>(); // url de banda o persona-solista → artista
  const candidatesFor = (names: string[]): number[] => {
    const found = new Set<number>();
    for (const name of names) for (const v of predictableNameVariants(name)) for (const id of byVariant.get(v) ?? []) found.add(id);
    return [...found];
  };
  const overlap = (ficha: PersonLike, artistId: number): number => {
    const titles = new Set((albumsByArtist.get(artistId) ?? []).map((row) => titleKey(row.title)));
    return ficha.discography.filter((d) => titles.has(titleKey(d.title))).length;
  };
  for (const band of data.bands) {
    const names = [band.name, ...(band.fullName ? [band.fullName] : []), ...band.aliases];
    let candidates = candidatesFor(names);
    const place = splitPlace(band.origin);
    if (candidates.length > 1) {
      const scored = candidates.map((id) => ({ id, score: overlap(band, id) * 10 + ((artistById.get(id)?.origin_city ?? "").split(",")[0] === (place.city ?? "").split(",")[0] && place.city ? 1 : 0) }));
      const best = Math.max(...scored.map((s) => s.score));
      const top = scored.filter((s) => s.score === best);
      if (best > 0 && top.length === 1) candidates = [top[0]!.id];
    }
    if (candidates.length > 1) { report.artists.ambiguous.push({ url: band.url, name: band.name, candidates: candidates.map((id) => `${id} ${artistById.get(id)?.name}`) }); continue; }
    let artistId: number;
    if (candidates.length === 1) {
      artistId = candidates[0]!;
      const row = artistById.get(artistId)!;
      // Un homónimo de otro país sin discos en común no es la misma banda.
      if (place.country && row.origin_country && fold(row.origin_country) !== fold(place.country) && overlap(band, artistId) === 0) {
        report.artists.originConflict.push({ url: band.url, name: band.name, artistId, catalog: `${row.origin_city ?? ""} ${row.origin_country}`, site: band.origin });
        continue;
      }
      report.artists.matched += 1;
    } else {
      const hasContent = band.discography.length > 0 || band.bio || band.groups.length > 0;
      if (!isVenezuelan(band.origin) || !hasContent) { report.artists.unmatched.push({ url: band.url, name: band.name, origin: band.origin, discs: band.discography.length }); continue; }
      if (await excludedArtist(client as never, { name: band.name })) { report.artists.excluded.push(band.name); continue; }
      const key = titleKey(band.name);
      const near = compactIndex.filter((row) => key.length >= 4 && similarity(key, row.key) >= 0.88);
      if (near.length) { report.artists.similarSkipped.push({ url: band.url, name: band.name, near: near.map((row) => `${row.id} ${artistById.get(row.id)?.name}`) }); continue; }
      artistId = Number((await q<{ id: string }>(`INSERT INTO public.artists(name,artist_type,origin_city,origin_country,formed_year,disbanded_year,notes)
        VALUES($1,'band',$2,$3,$4,$5,$6) RETURNING id::text`,
      [fit(band.name, 200), place.city ? fit(place.city, 120) : null, place.country ? fit(place.country, 120) : null, band.formed, band.ended, `Alta desde Lobotoradio: ${band.url}`]))[0]!.id);
      const row = { id: String(artistId), name: band.name, artist_type: "band", biography: null, picture_url: null, logo_url: null, origin_city: place.city, origin_country: place.country, formed_year: band.formed, disbanded_year: band.ended };
      artistById.set(artistId, row); addVariant(band.name, artistId); compactIndex.push({ id: artistId, key });
      report.artists.created += 1; report.createdArtists.push({ id: artistId, name: band.name, url: band.url });
      await claim(band.url, "artist", band.name, "name", band.name, { artistId });
    }
    artistOf.set(band.url, artistId);
    await fillArtist(band, artistId);
  }

  async function fillArtist(ficha: PersonLike, artistId: number): Promise<void> {
    const row = artistById.get(artistId)!;
    const place = splitPlace(ficha.origin);
    const set = async (column: string, value: unknown, field = column): Promise<void> => {
      await client.query(`UPDATE public.artists SET ${column}=$2 WHERE id=$1 AND ${column} IS NULL`, [artistId, value]);
      (row as Record<string, unknown>)[column] = value; bump(report.artists.filled, field);
      await claim(ficha.url, "artist", row.name, field, value, { artistId });
    };
    if (ficha.kind === "banda") {
      if (!row.biography?.trim() && ficha.bio) {
        await client.query("UPDATE public.artists SET biography=$2 WHERE id=$1 AND (biography IS NULL OR biography='')", [artistId, ficha.bio]);
        row.biography = ficha.bio; bump(report.artists.filled, "biography");
        await claim(ficha.url, "artist", row.name, "biography", ficha.bio, { artistId });
      }
      if (row.origin_city === null && place.city && (row.origin_country === null || fold(row.origin_country) === fold(place.country ?? ""))) await set("origin_city", fit(place.city, 120));
      if (row.origin_country === null && place.country) await set("origin_country", fit(place.country, 120));
      if (row.formed_year === null && ficha.formed) await set("formed_year", ficha.formed);
      if (row.disbanded_year === null && ficha.ended && (row.formed_year === null || ficha.ended >= row.formed_year)) await set("disbanded_year", ficha.ended);
      // Nombre completo y alias de la ficha → alias del artista.
      for (const [alias, type] of [[ficha.fullName, "name_variant"], ...ficha.aliases.map((a) => [a, "nickname"])] as Array<[string | null, string]>) {
        if (!alias || normalizeIdentity(alias) === normalizeIdentity(row.name) || aliasesOf.get(artistId)?.has(normalizeIdentity(alias))) continue;
        const inserted = await client.query(`INSERT INTO ingest.artist_aliases(artist_id,alias,alias_type,normalized_alias,is_primary,confidence,source_id,raw_page_id,notes)
          VALUES($1,$2,$3,$4,false,'medium',$5,$6,$7) ON CONFLICT DO NOTHING`,
        [artistId, fit(alias, 200), type, fit(normalizeIdentity(alias), 200), sourceId, rawPageId.get(ficha.url) ?? null, `Según Lobotoradio (${TAG}): ${ficha.url}`]);
        if (inserted.rowCount) { bump(report.artists.filled, "alias"); addVariant(alias, artistId); (aliasesOf.get(artistId) ?? aliasesOf.set(artistId, new Set()).get(artistId)!).add(normalizeIdentity(alias)); }
      }
      // Biografía de la fuente como documento citable.
      if (ficha.bio) {
        const inserted = await client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,tags,metadata)
          VALUES($1,$2,'biography',$3,$4,$5,$6,$7::jsonb) ON CONFLICT (artist_id,source_key) DO NOTHING`,
        [artistId, `${TAG}:bio:${ficha.slug}`, "Biografía — Lobotoradio", ficha.bio, ficha.url, [TAG], JSON.stringify({ campaign: TAG })]);
        report.artists.documents += inserted.rowCount ?? 0;
      }
    }
    // Foto: vacía → la copia de la captura; distinta → Curaduría.
    const photo = ficha.photo[0];
    if (photo) {
      if (!row.picture_url) {
        const url = publishImage(photo.file, "artist", `${artistId}`);
        await set("picture_url", url);
      } else if (await proposeImageCandidate(client, { kind: "artist", targetId: artistId, currentUrl: row.picture_url, candidateUrl: photo.url, sourceId, pageUrl: ficha.url, origin: TAG, runId }) === "proposed") {
        report.artists.imageCandidates += 1;
      }
    }
    const logo = logoFiles.get(`${ficha.kind}/${ficha.slug}`);
    if (logo && !row.logo_url) await set("logo_url", publishImage(logo, "artist", `${artistId}-logo`));
    // Enlaces (RYM nunca).
    for (const item of ficha.links) {
      const kind = SOCIAL[item.text.toLowerCase()];
      if (!kind || knownUrls.has(urlKey(item.href))) continue;
      if (kind.kind === "social") {
        if (socialPlatforms.has(`${artistId}|${kind.platform}`)) continue;
        await client.query(`INSERT INTO public.social_links(artist_id,platform,url,method,source,verified,notes) VALUES($1,$2,$3,'scrape',$4,false,$5)`, [artistId, kind.platform, item.href, TAG, `Enlace de la ficha de Lobotoradio: ${ficha.url}`]);
        socialPlatforms.add(`${artistId}|${kind.platform}`); report.links.social += 1;
      } else {
        if (streamingPlatforms.has(`a${artistId}|${kind.platform}`)) continue;
        await client.query(`INSERT INTO public.streaming_links(artist_id,platform,url,method,source,verified,notes) VALUES($1,$2,$3,'scrape',$4,false,$5)`, [artistId, kind.platform, item.href, TAG, `Enlace de la ficha de Lobotoradio: ${ficha.url}`]);
        streamingPlatforms.add(`a${artistId}|${kind.platform}`); report.links.streaming += 1;
      }
      knownUrls.add(urlKey(item.href));
    }
    if (ficha.genres.length) ledger.push({ url: ficha.url, name: ficha.name, origin: ficha.origin, snapshot: `data/${CAPTURE}/${ficha.kind === "banda" ? "bandas" : "artistas"}/${ficha.slug}.html.gz`, caseId: `artist:${artistId}`, kind: "artist", entityId: String(artistId), title: row.name, source: "lobotoradio", rawGenres: ficha.genres });
  }

  // ══ 2. Discos: artista principal ═════════════════════════════════════════
  // Una persona del sitio que es artista principal de un disco es solista: se busca como artista.
  const releaseArtist = new Map<string, number>();
  artistOf.set("https://www.lobotoradio.com/bandas/varios-artistas", VA_ARTIST_ID);
  for (const rel of data.releases) {
    if (rel.artists.length !== 1) { report.albums.unresolvedArtist.push({ url: rel.url, title: rel.title, why: `${rel.artists.length} artistas principales` }); continue; }
    const main = rel.artists[0]!;
    let artistId = artistOf.get(main.url);
    if (artistId === undefined && main.url.includes("/artistas/")) {
      const person = personByUrl.get(main.url);
      const names = [main.name, ...(person?.fullName ? [person.fullName] : []), ...(person?.aliases ?? [])];
      const found = candidatesFor(names).filter((id) => artistById.get(id)?.artist_type !== "band" || overlap(person ?? { discography: [] } as unknown as PersonLike, id) > 0);
      if (found.length === 1) { artistId = found[0]!; artistOf.set(main.url, artistId); if (person) await fillArtist(person, artistId); }
      else if (found.length > 1) { report.albums.unresolvedArtist.push({ url: rel.url, title: rel.title, artist: main.name, why: "varios artistas posibles", found }); continue; }
    }
    if (artistId === undefined) { report.albums.unresolvedArtist.push({ url: rel.url, title: rel.title, artist: main.name, why: "artista no resuelto" }); continue; }
    releaseArtist.set(rel.url, artistId);
  }

  // ══ 3. Organizaciones ════════════════════════════════════════════════════
  const orgCache = new Map<string, number | null>();
  const resolveOrg = async (name: string, url: string | null, forceType?: string): Promise<number | null> => {
    const display = name.replace(/\s+/g, " ").trim();
    if (!display || INDEPENDENT.test(display) || display.length > 120) return null;
    const cacheKey = url ?? normalizeIdentity(display);
    if (orgCache.has(cacheKey)) return orgCache.get(cacheKey)!;
    const company = url ? companyByUrl.get(url) : undefined;
    const ids = new Set<number>();
    for (const v of predictableNameVariants(company?.name || display)) for (const id of orgByVariant.get(v) ?? []) ids.add(id);
    let id: number;
    const type = forceType ?? ORG_TYPE[company?.type ?? ""] ?? "other";
    if (ids.size >= 1) { id = Math.min(...ids); report.organizations.matched += 1; }
    else {
      const place = splitPlace(company?.address ?? null);
      id = Number((await q<{ id: string }>(`INSERT INTO public.organizations(name,organization_type,country,notes) VALUES($1,$2::organization_type,$3,$4) RETURNING id::text`,
        [fit(company?.name || display, 200), type, place.country ? fit(place.country, 120) : null, `Citada en Lobotoradio (${TAG})${url ? `: ${url}` : ""}`]))[0]!.id);
      orgById.set(id, { id: String(id), name: company?.name || display, organization_type: type, picture_url: null, country: place.country, biography: null });
      addOrg(company?.name || display, id);
      report.organizations.created += 1; report.organizations.createdList.push(company?.name || display);
    }
    if (company) {
      const row = orgById.get(id)!;
      if (row.organization_type === "other" && ORG_TYPE[company.type ?? ""]) {
        await client.query("UPDATE public.organizations SET organization_type=$2::organization_type WHERE id=$1 AND organization_type='other'", [id, ORG_TYPE[company.type!]]);
        row.organization_type = ORG_TYPE[company.type!]!; bump(report.organizations.filled, "organization_type");
      }
      const place = splitPlace(company.address);
      if (!row.country && place.country) { await client.query("UPDATE public.organizations SET country=$2 WHERE id=$1 AND country IS NULL", [id, fit(place.country, 120)]); row.country = place.country; bump(report.organizations.filled, "country"); }
      if (!row.biography && company.description && company.description.length >= 40) { await client.query("UPDATE public.organizations SET biography=$2 WHERE id=$1 AND biography IS NULL", [id, company.description]); row.biography = company.description; bump(report.organizations.filled, "biography"); }
      if (!row.picture_url && company.logo[0]) {
        const urlLogo = publishImage(company.logo[0].file, "organization", `${id}`);
        await client.query("UPDATE public.organizations SET picture_url=$2 WHERE id=$1 AND picture_url IS NULL", [id, urlLogo]); row.picture_url = urlLogo; bump(report.organizations.filled, "picture_url");
      }
      await claim(company.url, "organization", row.name, "name", company.name, { organizationId: id });
    }
    orgCache.set(cacheKey, id);
    return id;
  };

  // ══ 4. Personas ══════════════════════════════════════════════════════════
  const personOf = new Map<string, number>(); // url de persona → persona del catálogo
  const contextOf = (p: PersonLike): { artists: Set<number>; albums: Set<number> } => {
    const artists = new Set<number>(); const albums = new Set<number>();
    for (const g of p.groups) { const id = artistOf.get(g.url); if (id !== undefined) artists.add(id); }
    const own = artistOf.get(p.url); if (own !== undefined) artists.add(own);
    for (const d of p.discography) { const a = releaseArtist.get(d.url); if (a !== undefined) artists.add(a); }
    return { artists, albums };
  };
  const strongSame = (a: string, b: string): boolean => {
    const ta = tokens(a); const tb = tokens(b);
    if (!ta.length || !tb.length) return false;
    const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    return short.length >= 2 && short.every((t) => long.includes(t));
  };
  // Persona en el contexto de unos artistas: exacta, fuerte (subconjunto de nombres) o dudosa.
  const findPerson = (names: string[], artists: Set<number>): { id?: number; ambiguous?: number[]; doubtful?: number[] } => {
    const exact = new Set<number>();
    for (const name of names) for (const v of predictableNameVariants(name)) for (const id of personByVariant.get(v) ?? []) {
      if ([...(personArtists.get(id) ?? [])].some((a) => artists.has(a))) exact.add(id);
    }
    if (exact.size === 1) return { id: [...exact][0]! };
    if (exact.size > 1) return { ambiguous: [...exact] };
    const pool = new Set<number>(); for (const a of artists) for (const id of artistPersons.get(a) ?? []) pool.add(id);
    const strong = [...pool].filter((id) => { const row = personById.get(id)!; return names.some((n) => strongSame(n, row.name) || (row.real_name && strongSame(n, row.real_name))); });
    if (strong.length === 1) return { id: strong[0]! };
    if (strong.length > 1) return { ambiguous: strong };
    const doubtful = [...pool].filter((id) => names.some((n) => similarity(titleKey(n), titleKey(personById.get(id)!.name)) >= 0.8));
    return doubtful.length ? { doubtful } : {};
  };
  const createPerson = async (p: { name: string; url: string }, artistId: number | undefined, why: string): Promise<number> => {
    const homonyms = new Set<number>(); for (const v of predictableNameVariants(p.name)) for (const h of personByVariant.get(v) ?? []) homonyms.add(h);
    const id = Number((await q<{ id: string }>("INSERT INTO public.persons(name,notes) VALUES($1,$2) RETURNING id::text", [fit(p.name, 200), `${why} según Lobotoradio: ${p.url}`]))[0]!.id);
    personById.set(id, { id: String(id), name: p.name, real_name: null, biography: null, picture_url: null, birth_date_value: null, death_date_value: null, birth_city: null, is_deceased: null, gender: null });
    addPersonVariant(p.name, id);
    if (artistId !== undefined) link(id, artistId);
    report.persons.created += 1; report.createdPersons.push({ id, name: p.name, url: p.url, why, homonyms: [...homonyms].slice(0, 5) });
    await claim(p.url, "person", p.name, "name", p.name, { personId: id });
    return id;
  };
  // Persona del sitio: resolución global (fichas con proyecto común).
  for (const p of data.persons) {
    if (p.unknownKind) continue;
    const ctx = contextOf(p);
    if (!ctx.artists.size) { report.persons.noContext += 1; continue; }
    const names = [p.name, ...(p.fullName ? [p.fullName] : []), ...p.aliases];
    const hit = findPerson(names, ctx.artists);
    if (hit.ambiguous) { report.persons.ambiguous.push({ url: p.url, name: p.name, candidates: hit.ambiguous.map((id) => `${id} ${personById.get(id)?.name}`) }); continue; }
    if (hit.doubtful) { report.persons.doubtful.push({ url: p.url, name: p.name, near: hit.doubtful.map((id) => `${id} ${personById.get(id)?.name}`) }); continue; }
    let personId: number;
    if (hit.id !== undefined) { personId = hit.id; report.persons.matched += 1; }
    else {
      // Sin ficha: se crea solo si integra una banda resuelta (la membresía la justifica).
      const band = p.groups.map((g) => artistOf.get(g.url)).find((id) => id !== undefined);
      if (band === undefined) { report.persons.noContext += 1; continue; }
      personId = await createPerson(p, band, "Integrante");
    }
    personOf.set(p.url, personId);
    await fillPerson(p, personId);
  }

  async function fillPerson(p: PersonLike, personId: number): Promise<void> {
    const row = personById.get(personId)!;
    const set = async (column: string, value: unknown): Promise<void> => {
      await client.query(`UPDATE public.persons SET ${column}=$2 WHERE id=$1 AND ${column} IS NULL`, [personId, value]);
      (row as Record<string, unknown>)[column] = value; bump(report.persons.filled, column);
      await claim(p.url, "person", row.name, column, value, { personId });
    };
    if (p.fullName && !row.real_name && normalizeIdentity(p.fullName) !== normalizeIdentity(row.name)) await set("real_name", fit(p.fullName, 200));
    const dateConflict = (current: string | null, value: string): boolean => current !== null && !value.startsWith(current) && !current.startsWith(value);
    if (p.birth) {
      if (row.birth_date_value === null) {
        await client.query("UPDATE public.persons SET birth_date_value=$2, birth_date=$3 WHERE id=$1 AND birth_date_value IS NULL", [personId, p.birth, /^\d{4}-\d\d-\d\d$/.test(p.birth) ? p.birth : null]);
        row.birth_date_value = p.birth; bump(report.persons.filled, "birth_date"); await claim(p.url, "person", row.name, "birth_date", p.birth, { personId });
      } else if (dateConflict(row.birth_date_value, p.birth)) report.persons.conflicts.push({ personId, name: row.name, field: "birth", catalog: row.birth_date_value, site: p.birth, url: p.url });
      else if (p.birth.length > row.birth_date_value.length) {
        await client.query("UPDATE public.persons SET birth_date_value=$2, birth_date=$3 WHERE id=$1", [personId, p.birth, /^\d{4}-\d\d-\d\d$/.test(p.birth) ? p.birth : null]);
        row.birth_date_value = p.birth; bump(report.persons.filled, "birth_date_precision");
      }
    }
    if (p.birthPlace && !row.birth_city) { const place = splitPlace(p.birthPlace); if (place.city) await set("birth_city", fit(place.city, 120)); }
    if (p.deceased && row.is_deceased !== true) {
      await client.query("UPDATE public.persons SET is_deceased=true WHERE id=$1", [personId]); row.is_deceased = true; bump(report.persons.filled, "is_deceased");
      await claim(p.url, "person", row.name, "is_deceased", true, { personId });
    }
    if (p.death) {
      if (row.death_date_value === null) {
        await client.query("UPDATE public.persons SET death_date_value=$2, death_date=$3 WHERE id=$1 AND death_date_value IS NULL", [personId, p.death, /^\d{4}-\d\d-\d\d$/.test(p.death) ? p.death : null]);
        row.death_date_value = p.death; bump(report.persons.filled, "death_date"); await claim(p.url, "person", row.name, "death_date", p.death, { personId });
      } else if (dateConflict(row.death_date_value, p.death)) report.persons.conflicts.push({ personId, name: row.name, field: "death", catalog: row.death_date_value, site: p.death, url: p.url });
    }
    if (p.gender && !row.gender) await set("gender", p.gender);
    if (p.bio && !row.biography?.trim()) {
      await client.query("UPDATE public.persons SET biography=$2 WHERE id=$1 AND (biography IS NULL OR biography='')", [personId, p.bio]);
      row.biography = p.bio; bump(report.persons.filled, "biography"); await claim(p.url, "person", row.name, "biography", p.bio, { personId });
    }
    const photo = p.photo[0];
    if (photo) {
      if (!row.picture_url) {
        const url = publishImage(photo.file, "person", `${personId}`);
        await client.query("UPDATE public.persons SET picture_url=$2 WHERE id=$1 AND picture_url IS NULL", [personId, url]); row.picture_url = url;
        bump(report.persons.filled, "picture_url"); await claim(p.url, "person", row.name, "picture_url", url, { personId });
      } else report.persons.pictureKept += 1;
    }
    for (const alias of p.aliases) {
      if (normalizeIdentity(alias) === normalizeIdentity(row.name)) continue;
      const inserted = await client.query(`INSERT INTO ingest.person_aliases(person_id,alias,alias_type,normalized_alias,is_primary,confidence,source_id,raw_page_id,notes)
        VALUES($1,$2,'nickname',$3,false,'medium',$4,$5,$6) ON CONFLICT DO NOTHING`, [personId, fit(alias, 200), fit(normalizeIdentity(alias), 200), sourceId, rawPageId.get(p.url) ?? null, `Apodo según Lobotoradio: ${p.url}`]);
      if (inserted.rowCount) bump(report.persons.filled, "alias");
    }
    if (p.fullName && normalizeIdentity(p.fullName) !== normalizeIdentity(row.name)) {
      const inserted = await client.query(`INSERT INTO ingest.person_aliases(person_id,alias,alias_type,normalized_alias,is_primary,confidence,source_id,raw_page_id,notes)
        VALUES($1,$2,'name_variant',$3,false,'medium',$4,$5,$6) ON CONFLICT DO NOTHING`, [personId, fit(p.fullName, 200), fit(normalizeIdentity(p.fullName), 200), sourceId, rawPageId.get(p.url) ?? null, `Nombre completo según Lobotoradio: ${p.url}`]);
      if (inserted.rowCount) bump(report.persons.filled, "alias_full_name");
    }
  }

  // ══ 5. Membresías (las dos direcciones del sitio) ════════════════════════
  const pairs = new Map<string, { band: string; person: string; period: Period | null; instruments: string[] }>();
  for (const band of data.bands) for (const g of band.groups) pairs.set(`${band.url}|${g.url}`, { band: band.url, person: g.url, period: g.period, instruments: [] });
  for (const p of data.persons) for (const g of p.groups) {
    const key = `${g.url}|${p.url}`;
    const prior = pairs.get(key);
    pairs.set(key, { band: g.url, person: p.url, period: prior?.period ?? g.period, instruments: p.groups.length === 1 ? p.instruments : [] });
  }
  for (const pair of pairs.values()) {
    const artistId = artistOf.get(pair.band); const personId = personOf.get(pair.person);
    if (artistId === undefined || personId === undefined) continue;
    const key = `${artistId}|${personId}`;
    const existing = memberships.get(key);
    const from = pair.period?.from ?? null; const to = pair.period?.current ? null : pair.period?.to ?? null;
    const note = `Membresía según Lobotoradio${pair.period ? ` (${pair.period.raw})` : ""}: ${pair.band}`;
    if (!existing) {
      const role = pair.instruments.length ? pair.instruments.map(instrumentEn).join(" & ") : "integrante";
      const id = Number((await q<{ id: string }>("INSERT INTO public.artist_members(artist_id,person_id,role,from_year,to_year,is_current,notes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text",
        [artistId, personId, fit(role, 200), from, to !== null && from !== null && to < from ? null : to, pair.period?.current ?? false, note]))[0]!.id);
      memberships.set(key, { id, from, to }); link(personId, artistId); report.members.created += 1;
      await claim(pair.band, "artist_membership", `${artistById.get(artistId)?.name}::${personById.get(personId)?.name}`, "membership", { from, to, raw: pair.period?.raw ?? null }, { artistMembershipId: id });
      const instruments = instrumentsOf(pair.instruments.join(", "));
      if (instruments.length) { await client.query("INSERT INTO ingest.membership_details(artist_member_id,instruments,run_id) VALUES($1,$2,$3) ON CONFLICT (artist_member_id) DO NOTHING", [id, instruments, runId]); report.members.detail += 1; }
    } else if (existing.from === null && existing.to === null && from !== null) {
      await client.query("UPDATE public.artist_members SET from_year=$2,to_year=$3,notes=concat_ws(' · ',notes,$4::text) WHERE id=$1 AND from_year IS NULL AND to_year IS NULL", [existing.id, from, to, note]);
      existing.from = from; existing.to = to; report.members.periodsFilled += 1;
    }
  }

  // ══ 6. Discos, pistas, créditos ══════════════════════════════════════════
  const albumOf = new Map<string, number>();
  const trackIndex = async (albumId: number): Promise<Map<string, number[]>> => {
    const map = new Map<string, number[]>();
    for (const row of await q<{ id: string; title: string }>("SELECT id::text,title FROM public.tracks WHERE album_id=$1", [albumId])) (map.get(titleKey(row.title)) ?? map.set(titleKey(row.title), []).get(titleKey(row.title))!).push(Number(row.id));
    return map;
  };
  // Persona acreditada en un disco: la global si existe; si no, en el contexto del artista del disco.
  const creditPerson = async (name: string, href: string | null, artistId: number): Promise<number | null> => {
    if (href && personOf.has(href)) return personOf.get(href)!;
    const ficha = href ? personByUrl.get(href) : undefined;
    if (ficha?.unknownKind) return null;
    const names = [name, ...(ficha?.fullName ? [ficha.fullName] : []), ...(ficha?.aliases ?? [])];
    const hit = findPerson(names, new Set([artistId]));
    if (hit.id !== undefined) { if (href) personOf.set(href, hit.id); return hit.id; }
    if (hit.ambiguous || hit.doubtful) { report.credits.unresolvedTarget += 1; return null; }
    const id = await createPerson({ name: ficha?.name ?? name, url: href ?? "" }, artistId, "Acreditado");
    if (href) { personOf.set(href, id); if (ficha) await fillPerson(ficha, id); }
    return id;
  };
  for (const rel of data.releases) {
    const artistId = releaseArtist.get(rel.url);
    if (artistId === undefined) continue;
    const artist = artistById.get(artistId)!;
    const key = titleKey(rel.title);
    const existing = albumsByArtist.get(artistId) ?? [];
    const type = releaseType(rel.formats);
    const same = existing.filter((row) => titleKey(row.title) === key);
    let target: typeof albumRows[number] | undefined;
    if (same.length === 1) target = same[0];
    else if (same.length > 1) {
      const byType = same.filter((row) => row.album_type === type);
      const byYear = (byType.length ? byType : same).filter((row) => rel.year !== null && row.release_year === rel.year);
      if (byType.length === 1) target = byType[0]; else if (byYear.length === 1) target = byYear[0];
      else { report.albums.ambiguous.push({ url: rel.url, artist: artist.name, title: rel.title, candidates: same.map((row) => Number(row.id)) }); continue; }
    }
    let albumId: number; let created = false;
    if (target) {
      albumId = Number(target.id); report.albums.matched += 1;
      const set = async (column: string, value: unknown, cast = ""): Promise<void> => {
        await client.query(`UPDATE public.albums SET ${column}=$2${cast} WHERE id=$1 AND ${column} IS NULL`, [albumId, value]);
        (target as Record<string, unknown>)[column] = value; bump(report.albums.filled, column);
        await claim(rel.url, "album", `${artist.name}::${rel.title}`, column, value, { albumId });
      };
      if (target.release_year === null && rel.year !== null) await set("release_year", rel.year);
      if (target.album_type === "other") {
        await client.query("UPDATE public.albums SET album_type=$2::album_type WHERE id=$1 AND album_type='other'", [albumId, type]); target.album_type = type; bump(report.albums.filled, "album_type");
        await claim(rel.url, "album", `${artist.name}::${rel.title}`, "album_type", type, { albumId });
      }
      if (target.catalog_id === null && rel.catalog) await set("catalog_id", fit(rel.catalog, 80));
      if (target.media_format === null && mediaFormat(rel.formats)) await set("media_format", mediaFormat(rel.formats));
      if (target.label_id === null && rel.label) { const org = await resolveOrg(rel.label.name, rel.label.url, "record_label"); if (org !== null) await set("label_id", org); }
    } else {
      // Título parecido del mismo artista: propuesto, no se crea.
      const near = existing.map((row) => ({ row, score: similarity(key, titleKey(row.title)) })).filter((item) => item.score >= 0.6).sort((a, b) => b.score - a.score)[0];
      if (near) { report.albums.proposed.push({ url: rel.url, artist: artist.name, artistId, title: rel.title, year: rel.year, near: near.row.title, nearId: Number(near.row.id), nearYear: near.row.release_year, score: Number(near.score.toFixed(2)) }); continue; }
      // Mismas pistas con otro título («Joudy Ju» = «EP»): el mismo disco u otra edición; se propone, no se crea.
      const siteKeys = new Set(rel.tracks.map((t) => titleKey(t.title)).filter(Boolean));
      let sameTracks: { id: number; title: string; year: number | null; shared: number } | null = null;
      for (const row of existing) {
        const other = await trackIndex(Number(row.id));
        const shared = [...siteKeys].filter((k) => other.has(k)).length;
        if (shared >= 2 && shared >= 0.5 * Math.min(siteKeys.size, other.size) && (!sameTracks || shared > sameTracks.shared)) sameTracks = { id: Number(row.id), title: row.title, year: row.release_year, shared };
      }
      if (sameTracks) { report.albums.proposed.push({ url: rel.url, artist: artist.name, artistId, title: rel.title, year: rel.year, near: sameTracks.title, nearId: sameTracks.id, nearYear: sameTracks.year, why: `${sameTracks.shared} de ${siteKeys.size} pistas en común` }); continue; }
      if (rel.country && !isVenezuelan(rel.country) && !isVenezuelan(artist.origin_country)) { report.albums.notVenezuelan.push({ url: rel.url, artist: artist.name, title: rel.title, country: rel.country }); continue; }
      if (await audiovisualAlbumConflict(client as never, artistId, rel.title)) { report.albums.audiovisualConflict.push({ url: rel.url, artist: artist.name, title: rel.title }); continue; }
      const labelId = rel.label ? await resolveOrg(rel.label.name, rel.label.url, "record_label") : null;
      albumId = Number((await q<{ id: string }>(`INSERT INTO public.albums(artist_id,title,release_year,album_type,label_id,catalog_id,media_format,notes)
        VALUES($1,$2,$3,$4::album_type,$5,$6,$7,$8) RETURNING id::text`,
      [artistId, fit(rel.title, 250), rel.year, type, labelId, rel.catalog ? fit(rel.catalog, 80) : null, mediaFormat(rel.formats), `Fuente: Lobotoradio — ${rel.url}`]))[0]!.id);
      target = { id: String(albumId), artist_id: String(artistId), title: rel.title, release_year: rel.year, album_type: type, label_id: labelId === null ? null : String(labelId), cover_url: null, catalog_id: rel.catalog, media_format: mediaFormat(rel.formats) };
      existing.push(target); albumsByArtist.set(artistId, existing); albumArtist.set(albumId, artistId);
      created = true; report.albums.created += 1;
      await claim(rel.url, "album", `${artist.name}::${rel.title}`, "title", rel.title, { albumId });
      if (rel.year !== null) await claim(rel.url, "album", `${artist.name}::${rel.title}`, "release_year", rel.year, { albumId });
    }
    albumOf.set(rel.url, albumId);
    // Portada
    const cover = rel.cover[0];
    if (cover) {
      if (!target.cover_url) {
        const url = publishImage(cover.file, "album", `${albumId}`);
        await client.query("UPDATE public.albums SET cover_url=$2 WHERE id=$1 AND cover_url IS NULL", [albumId, url]); target.cover_url = url;
        bump(report.albums.filled, "cover_url"); await claim(rel.url, "album", `${artist.name}::${rel.title}`, "cover_url", url, { albumId });
      } else if (await proposeImageCandidate(client, { kind: "album", targetId: albumId, currentUrl: target.cover_url, candidateUrl: cover.url, sourceId, pageUrl: rel.url, origin: TAG, runId }) === "proposed") report.albums.coverCandidates += 1;
    }
    // Pistas: solo en discos sin pistas; la duración en títulos exactos y únicos.
    let tracks = await trackIndex(albumId);
    const has = [...tracks.values()].reduce((n, ids) => n + ids.length, 0);
    if (has === 0 && rel.tracks.length) {
      let number = 0;
      for (const t of rel.tracks) {
        if (!t.title) continue;
        number += 1;
        const side = /^([A-H])\d+$/i.exec(t.num)?.[1];
        const id = Number((await q<{ id: string }>("INSERT INTO public.tracks(album_id,disc_number,track_number,title,duration_seconds,notes) VALUES($1,1,$2,$3,$4,$5) RETURNING id::text",
          [albumId, number, fit(t.title, 250), t.seconds, side ? `Lado ${side.toUpperCase()}` : null]))[0]!.id);
        report.tracks.created += 1;
        await claim(rel.url, "track", `${artist.name}::${rel.title}::1-${number}`, "title", t.title, { trackId: id });
      }
      tracks = await trackIndex(albumId);
    } else if (has > 0 && rel.tracks.length) {
      if (has !== rel.tracks.length) report.albums.tracklistDiffers.push({ albumId, artist: artist.name, title: rel.title, catalog: has, site: rel.tracks.length });
      for (const t of rel.tracks) {
        const ids = tracks.get(titleKey(t.title)) ?? [];
        if (ids.length !== 1 || t.seconds === null) continue;
        const updated = await client.query("UPDATE public.tracks SET duration_seconds=$2 WHERE id=$1 AND duration_seconds IS NULL", [ids[0], t.seconds]);
        report.tracks.durations += updated.rowCount ?? 0;
      }
    }
    if (created) report.createdAlbums.push({ id: albumId, artist: artist.name, title: rel.title, year: rel.year, type, tracks: rel.tracks.length });
    if (rel.genres.length) ledger.push({ url: rel.url, name: rel.title, snapshot: `data/${CAPTURE}/discos/${rel.slug}.html.gz`, caseId: `album:${albumId}`, kind: "album", entityId: String(albumId), title: rel.title, source: "lobotoradio", rawGenres: rel.genres });

    // Créditos del disco.
    const credited = new Set((await q<{ k: string }>(`SELECT COALESCE('p'||person_id,'a'||artist_id,'o'||organization_id)||'|'||credit_type k FROM public.album_credits WHERE album_id=$1`, [albumId])).map((row) => row.k));
    const posLabel = new Map<string, string>(); // «A1»/«3» → número de pista del catálogo
    const trackRows = await q<{ id: string; track_number: number; title: string }>("SELECT id::text,track_number,title FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number", [albumId]);
    rel.tracks.forEach((t, i) => { const ids = tracks.get(titleKey(t.title)) ?? []; if (ids.length === 1) { const row = trackRows.find((r) => Number(r.id) === ids[0]); if (row) posLabel.set(t.num || String(i + 1), String(row.track_number).padStart(2, "0")); } });
    const trackIdByPos = new Map<string, number>();
    rel.tracks.forEach((t, i) => { const ids = tracks.get(titleKey(t.title)) ?? []; if (ids.length === 1) trackIdByPos.set(t.num || String(i + 1), ids[0]!); });
    for (const credit of rel.credits) {
      const isMusician = credit.section === "Músicos" || credit.section === "Músicos invitados";
      const entries = isMusician
        ? credit.roles.map((r) => ({ type: (credit.section === "Músicos invitados" ? "guest" : "musician") as string, role: instrumentEn(r.role), positions: r.positions }))
        : credit.roles.map((r) => { const t = technical(r.role); return t ? { ...t, positions: r.positions } : null; }).filter((x): x is { type: CreditType; role: string; positions: string[] } => x !== null);
      if (!entries.length) continue;
      let target: { column: "person_id" | "artist_id" | "organization_id"; id: number } | null = null;
      if (credit.section === "Empresas" || (credit.href ?? "").includes("/empresa/")) { const org = await resolveOrg(credit.name, credit.href, undefined); if (org !== null) target = { column: "organization_id", id: org }; }
      else if ((credit.href ?? "").includes("/bandas/")) { const a = artistOf.get(credit.href!); if (a !== undefined) target = { column: "artist_id", id: a }; }
      else { const p = await creditPerson(credit.name, credit.href, artistId); if (p !== null) { target = { column: "person_id", id: p }; link(p, artistId, albumId); } }
      if (!target) { report.credits.unresolvedTarget += 1; continue; }
      const prefix = target.column === "person_id" ? "p" : target.column === "artist_id" ? "a" : "o";
      for (const entry of entries) {
        const rawPositions = [...new Set([...entry.positions, ...credit.positions])];
        const positions = rawPositions.map((pos) => posLabel.get(pos) ?? pos);
        const k = `${prefix}${target.id}|${entry.type}`;
        if (credited.has(k)) { report.credits.skippedExisting += 1; continue; }
        credited.add(k);
        const role = positions.length ? `${entry.role} (track ${positions.join(", ")})` : entry.role;
        const row = (await q<{ id: string }>(`INSERT INTO public.album_credits(album_id,${target.column},credit_type,role,notes) VALUES($1,$2,$3::credit_type,$4,$5) RETURNING id::text`,
          [albumId, target.id, entry.type, fit(role, 200), `Según Lobotoradio: ${rel.url}`]))[0]!;
        bump(report.credits.album, entry.type);
        await claim(rel.url, "album_credit", `${artist.name}::${rel.title}::${credit.name}`, "credit", { section: credit.section, raw: credit.raw }, { albumCreditId: Number(row.id) });
        // Pistas nombradas por posición → crédito de pista (D8).
        for (const pos of rawPositions) {
          const trackId = trackIdByPos.get(pos);
          if (!trackId) continue;
          const dup = await q(`SELECT 1 FROM public.track_credits WHERE track_id=$1 AND ${target.column}=$2 AND credit_type=$3::credit_type`, [trackId, target.id, entry.type]);
          if (dup.length) continue;
          await client.query(`INSERT INTO public.track_credits(track_id,${target.column},credit_type,role,notes) VALUES($1,$2,$3::credit_type,$4,$5)`, [trackId, target.id, entry.type, fit(entry.role, 200), `Según Lobotoradio: ${rel.url}`]);
          report.credits.track += 1;
        }
      }
    }
  }

  // ══ 7. Autorías L:/M: por pista ══════════════════════════════════════════
  const tracksCache = new Map<number, Map<string, number[]>>();
  for (const a of authorship) {
    const rel = releaseByUrl.get(`https://www.lobotoradio.com/discos/${a.releaseSlug}`) ?? data.releases.find((r) => r.slug === a.releaseSlug);
    const albumId = rel ? albumOf.get(rel.url) : undefined;
    if (!rel || albumId === undefined) { report.authorship.albumMissing += 1; continue; }
    const tracks = tracksCache.get(albumId) ?? tracksCache.set(albumId, await trackIndex(albumId)).get(albumId)!;
    const ids = tracks.get(titleKey(a.trackTitle)) ?? [];
    if (ids.length !== 1) { report.authorship.trackMissing += 1; continue; }
    const artistId = albumArtist.get(albumId)!;
    const href = (a.targetUrl ?? "").replace(/\/+$/, "");
    let column: "person_id" | "artist_id" | "organization_id"; let id: number | null = null;
    if (a.targetKind === "artist" || href.includes("/bandas/")) { column = "artist_id"; id = artistOf.get(href) ?? null; }
    else if (a.targetKind === "organization" || href.includes("/empresa/")) { column = "organization_id"; id = await resolveOrg(a.name, href || null); }
    else { column = "person_id"; id = await creditPerson(a.name, href || null, artistId); }
    if (id === null) { report.authorship.targetMissing += 1; continue; }
    const type: CreditType = a.role === "lyrics" ? "writer" : "composer";
    const role = a.role === "lyrics" ? "Lyrics" : a.role === "music" ? "Music" : "composer";
    // Una autoría sin función ya cubierta por cualquier crédito de autor; una L/M, por uno de su tipo.
    const prior = (await q<{ t: string }>(`SELECT credit_type::text t FROM public.track_credits WHERE track_id=$1 AND ${column}=$2 AND credit_type IN ('composer','writer')`, [ids[0], id])).map((r) => r.t);
    if (a.role === "authorship_unspecified" ? prior.length > 0 : prior.includes(type)) { report.authorship.already += 1; continue; }
    const row = (await q<{ id: string }>(`INSERT INTO public.track_credits(track_id,${column},credit_type,role,notes) VALUES($1,$2,$3::credit_type,$4,$5) RETURNING id::text`,
      [ids[0], id, type, role, `Autoría según Lobotoradio: ${rel.url}`]))[0]!;
    if (column === "person_id") link(id, artistId, albumId);
    report.authorship.credited += 1;
    await claim(rel.url, "track_credit", `${rel.title}::${a.trackTitle}::${a.name}`, "authorship", { role: a.role, quote: a.quote }, { trackCreditId: Number(row.id) });
  }
}

// ── Ejecución ───────────────────────────────────────────────────────────────
const outcome = await withOperatorRun({ name: "lobotoradio:absorb", operator: OPERATOR, note: NOTE, params: { campaign: TAG, confirm: CONFIRM } }, async (context) => {
  report.runId = context.runId;
  const source = await context.client.query<{ id: string }>(`INSERT INTO ingest.sources(slug,name,url,site_type,access_strategy,requires_js,trust_level,enabled,public_display,notes)
    VALUES($1,'Lobotoradio','https://www.lobotoradio.com/','wordpress','Captura completa del 2026-10-26 (fichas de personas, bandas, discos, empresas y eventos)',false,'medium',false,false,$2)
    ON CONFLICT (slug) DO UPDATE SET updated_at=now() RETURNING id::text`, [SLUG, `Absorción ${TAG}`]);
  await apply(context.client, context.runId, Number(source.rows[0]!.id));
}, { rollbackOnly: !CONFIRM });
report.runId = outcome.runId;
if (CONFIRM) {
  for (const { from, to } of copies) { mkdirSync(path.dirname(to), { recursive: true }); if (!existsSync(to)) copyFileSync(from, to); }
}
report.genreLedger = ledger.length;
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, CONFIRM ? "genre-ledger.jsonl" : "genre-ledger-dry-run.jsonl"), ledger.map((row) => JSON.stringify(row)).join("\n") + "\n");
(report as Record<string, unknown>)["untranslated"] = Object.fromEntries([...untranslated].sort((a, b) => b[1] - a[1]));
(report as Record<string, unknown>)["imageCopies"] = copies.length;
const file = path.join(OUT, CONFIRM ? "aplicacion.json" : "aplicacion-dry-run.json");
writeFileSync(file, JSON.stringify(report, null, 1));
const count = (value: unknown): unknown => Array.isArray(value) ? value.length : value;
const summary = Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, count(b)])) : count(v)]));
delete (summary as Record<string, unknown>)["untranslated"];
console.log(JSON.stringify(summary, null, 1));
console.log(`-> ${file}`);
await closeDb();
