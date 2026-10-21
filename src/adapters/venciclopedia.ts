// CRV · Adapter de Venciclopedia (venciclopedia.org), wiki venezolana.
//
// Fuente aprobada por Brian el 2026-10-20 con instrucción expresa de tratarla
// como fuente de verdad de alto nivel. Lo que la hace fiable no es el sitio en
// sí (2.390 artículos, pocos editores) sino que su discografía está
// ESTRUCTURADA: fichas `{{record}}`/`{{disco}}` con sello, nº de catálogo,
// formato físico y año; `{{pistas}}` con títulos, autores y duraciones; y
// categorías `Discos de <artista>`, `Discos de <año>` y `Discos de <sello>`.
//
// Nada se adivina del texto libre: el artista sale de las categorías (no de la
// prosa), el sello del campo `sello` de la plantilla, y un dato que la fuente no
// declara no se emite. El adapter no escribe en PostgreSQL: solo produce
// RawRecords con su evidencia.
import type { SourceAdapter, PageRef, RawRecord, StoredPage, Evidence } from "./contracts.js";
import { VENCI_KNOWN_LABELS } from "./venciclopedia-labels.js";

const API_PATH = "/api.php";
const ADAPTER_VERSION = "1.0.0";
const EXTRACTOR = "venciclopedia-wiki";
/** UA propio y honesto: el sitio es una wiki pequeña y conviene identificarse. */
const META_USER_AGENT = "CRV-research/1.0 (+https://github.com/coleccionistas-de-rock-venezolano)";
/** Lotes de 20 títulos: con 50 la URL supera el límite del servidor. */
const BATCH_SIZE = 20;

/** Plantillas que delimitan el universo musical de la wiki. */
const TEMPLATES = ["Plantilla:Record", "Plantilla:Disco", "Plantilla:Grupo musical", "Plantilla:Pistas", "Plantilla:Créditos"];
/** Categorías que aportan artistas y agrupaciones. */
const MEMBER_CATEGORIES = [
  "Categoría:Músicos de Venezuela", "Categoría:Cantantes de Venezuela", "Categoría:Compositores de Venezuela",
  "Categoría:Compositores de música clásica de Venezuela", "Categoría:Guitarristas de Venezuela",
  "Categoría:Directores de orquesta de Venezuela", "Categoría:Arpistas de Venezuela",
  "Categoría:Grupos de música rock", "Categoría:Grupos de rock alternativo",
  "Categoría:Grupos de rock progresivo", "Categoría:Grupos de rock industrial",
];

// ── Parser de wikitexto ─────────────────────────────────────────────────────
// MediaWiki anida plantillas ({{csv|A|B}}, {{fecha|||1990|link=iso}}) y los
// valores llegan dentro de ellas: sin resolverlas, `sello` y `fecha` salen
// vacíos y el dato se pierde en silencio.

/** Divide por `sep` solo en el nivel superior (respeta {{ }} y [[ ]]). */
function splitTop(value: string, sep = "|"): string[] {
  const out: string[] = [];
  let depth = 0;
  let buffer = "";
  for (let i = 0; i < value.length; i += 1) {
    const two = value.slice(i, i + 2);
    if (two === "{{" || two === "[[") { depth += 1; buffer += two; i += 1; continue; }
    if (two === "}}" || two === "]]") { depth -= 1; buffer += two; i += 1; continue; }
    if (value[i] === sep && depth === 0) { out.push(buffer); buffer = ""; continue; }
    buffer += value[i];
  }
  out.push(buffer);
  return out;
}

interface Template { name: string; params: Record<string, string>; }

/** Busca `{{name ...}}` con límite de palabra: `{{disco` no debe casar `{{discografia`. */
function findTemplates(text: string, name: string): Template[] {
  const found: Template[] = [];
  const lower = text.toLowerCase();
  const key = `{{${name.toLowerCase()}`;
  let from = 0;
  for (;;) {
    const start = lower.indexOf(key, from);
    if (start < 0) break;
    const next = lower.slice(start + key.length, start + key.length + 1);
    if (next && /[a-z0-9_/]/i.test(next)) { from = start + key.length; continue; }
    let depth = 0;
    let i = start;
    for (; i < text.length - 1; i += 1) {
      const two = text.slice(i, i + 2);
      if (two === "{{") { depth += 1; i += 1; continue; }
      if (two === "}}") { depth -= 1; i += 1; if (depth === 0) break; continue; }
    }
    const raw = text.slice(start, i + 1);
    const inner = raw.slice(2, -2);
    const params: Record<string, string> = {};
    for (const part of splitTop(inner).slice(1)) {
      const eq = part.indexOf("=");
      if (eq > 0) params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    }
    found.push({ name, params });
    from = i + 1;
  }
  return found;
}

/** Resuelve plantillas de valor: {{csv|A|B}} → "A, B"; {{fecha|||1990}} → "1990". */
function resolveTemplates(value: string, depth = 0): string {
  if (!value || depth > 6) return value;
  const replaced = value.replace(/\{\{([^{}]*)\}\}/g, (_all, inner: string) => {
    const parts = splitTop(inner);
    const name = (parts[0] ?? "").trim().toLowerCase();
    const positional = parts.slice(1).filter((part) => !part.includes("=")).map((part) => part.trim()).filter(Boolean);
    if (["csv", "lista", "hlist", "flatlist", "genero", "género"].includes(name)) return positional.join(", ");
    if (name === "fecha") return positional.join("-");
    if (["bandera", "flag", "banderas", "país", "pais", "flagicon"].includes(name)) return "";
    return positional[0] ?? "";
  });
  return replaced === value ? replaced : resolveTemplates(replaced, depth + 1);
}

/** Texto limpio de wikitexto: sin refs, enlaces, plantillas ni etiquetas. */
function clean(value: string | undefined): string {
  if (!value) return "";
  return resolveTemplates(value)
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/'''/g, "")
    .replace(/''/g, "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[|,]+|[|,]+$/g, "");
}

function firstYear(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const match = clean(value).match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Duración "3:05" o "1:02:33" a segundos. Cero es válido; basura no. */
function durationToSeconds(raw: string): number | undefined {
  const value = clean(raw);
  if (!value) return undefined;
  const parts = value.split(":").map((piece) => piece.trim());
  if (parts.some((piece) => !/^\d{1,3}$/.test(piece))) return undefined;
  const numbers = parts.map(Number);
  if (numbers.length === 2) return numbers[0]! * 60 + numbers[1]!;
  if (numbers.length === 3) return numbers[0]! * 3600 + numbers[1]! * 60 + numbers[2]!;
  return undefined;
}

// ── Clasificación de categorías ──────────────────────────────────────────────
// `Discos de X` se usa en la wiki para CUATRO cosas: artista, sello, año y
// género/tipo. Confundirlas inventaría artistas llamados «Salsa».

const DECADE_OR_YEAR = /^(?:19|20)\d{2}$|^(?:los )?a[ñn]os (?:19|20)\d0s$/i;
const TYPE_LABELS = new Set([
  "estudio", "en vivo", "covers", "remixes", "compilacion", "recopilacion", "estudio debut", "ep", "eps",
  "sencillos", "sencillo", "demos", "demo", "banda sonora", "bandas sonoras", "varios artistas",
  "mezclas", "independientes", "estudio y en vivo", "reedicion", "disco de estudio", "otros",
]);
const GENRE_LABELS = new Set([
  "pop", "rock", "salsa", "bolero", "balada", "gaita", "jazz", "clasica", "folk", "cumbia", "guaguanco",
  "instrumental", "humor", "fusion", "funk", "disco", "punk", "metal", "reggaeton", "rap", "trova",
  "joropo", "danzon", "son", "mambo", "guaracha", "chachacha", "descarga", "boogaloo", "aguinaldo",
  "parranda", "tambor", "navidena", "infantil", "protesta", "latino", "latin jazz", "synth-pop",
  "synthpop", "new wave", "italo disco", "funk latino", "pop rock", "post-punk", "dark wave", "malpop",
]);

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function splitList(value: string): string[] {
  return value.split(/[,;/]/).map((item) => clean(item)).filter(Boolean);
}

/** Categorías `Discos de X` de una página, ya sin el prefijo. */
function releaseCategories(categories: string[]): string[] {
  const out: string[] = [];
  for (const category of categories) {
    const match = category.match(/^discos? de (.+)$/i);
    if (match?.[1]) out.push(match[1].trim());
  }
  return out;
}

/** Sellos derivados de la propia fuente: todo valor del campo `sello`. */
const KNOWN_LABELS = new Set<string>(VENCI_KNOWN_LABELS.map(fold));

// ── Formatos y tipos ────────────────────────────────────────────────────────
// Se alinean con el vocabulario que ya usa el catálogo (medio formato Discogs):
// "Vinyl LP", "Vinyl 7\"", "CD", "Cassette", "Digital". El detalle completo de
// la fuente queda en la evidencia del claim, no en la columna.

function mediaFormat(raw: string): string | undefined {
  const value = clean(raw);
  if (!value) return undefined;
  const folded = fold(value);
  if (/digital|streaming|mp3|flac/.test(folded)) return "Digital";
  if (/casete|cassette|cinta/.test(folded)) return "Cassette";
  if (/cd/.test(folded) && !/vinilo|vinyl|lp/.test(folded)) return "CD";
  if (/7\s*in|7"?|45\s*rpm/.test(folded)) return 'Vinyl 7"';
  if (/12\s*in|12"?|33/.test(folded)) return /lp/.test(folded) ? "Vinyl LP" : 'Vinyl 12"';
  if (/vinilo|vinyl|lp/.test(folded)) return "Vinyl LP";
  return undefined;
}

const ALBUM_TYPES: Array<[RegExp, string]> = [
  [/^ep$|^eps$|extended play/, "ep"],
  [/^sencillo$|^single$/, "single"],
  [/en vivo|directo|live/, "live_album"],
  [/recopilaci|compilaci|grandes exitos|exitos/, "compilation"],
  [/banda sonora|soundtrack/, "soundtrack"],
  [/demo/, "demo"],
  [/remix/, "remix"],
  [/colaboraci/, "collaboration_album"],
  [/estudio|studio/, "studio_album"],
];

function albumType(raw: string): string | undefined {
  const value = fold(clean(raw));
  if (!value) return undefined;
  for (const [pattern, type] of ALBUM_TYPES) if (pattern.test(value)) return type;
  return undefined;
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export interface WikiPage {
  title: string;
  categories: string[];
  content: string;
  timestamp?: string;
}

export function parseWikiPages(body: string): WikiPage[] {
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return []; }
  const pages = (payload as { query?: { pages?: unknown } }).query?.pages;
  if (!Array.isArray(pages)) return [];
  const out: WikiPage[] = [];
  for (const raw of pages as Array<Record<string, unknown>>) {
    const title = raw["title"];
    if (typeof title !== "string" || raw["missing"] !== undefined) continue;
    const revisions = raw["revisions"] as Array<Record<string, unknown>> | undefined;
    const slots = revisions?.[0]?.["slots"] as { main?: { content?: string } } | undefined;
    const content = slots?.main?.content ?? "";
    if (!content) continue;
    const categoryRows = raw["categories"];
    const categories = Array.isArray(categoryRows)
      ? (categoryRows as Array<{ title?: string }>).map((item) => (item.title ?? "").replace(/^Categor[íi]a:/, "")).filter(Boolean)
      : [];
    const timestamp = revisions?.[0]?.["timestamp"];
    out.push({ title, categories, content, ...(typeof timestamp === "string" ? { timestamp } : {}) });
  }
  return out;
}

function evidenceFor(url: string, selector: string, text: string, position?: number): Evidence {
  const base: Evidence = { url, selector, excerpt: text.slice(0, 20_000) };
  return position === undefined ? base : { ...base, position };
}

export class VenciclopediaAdapter implements SourceAdapter {
  readonly slug = "venciclopedia";
  readonly requiresBrowser = false as const;
  /** 504 páginas del universo musical en lotes de 20. */
  readonly crawlLimit = 900;

  /** Frontera finita: plantillas musicales + categorías de artistas. */
  async *listPages(rootUrl: string): AsyncIterable<PageRef> {
    const base = new URL(rootUrl);
    const titles = new Set<string>();
    for (const template of TEMPLATES) {
      for (const title of await this.listEmbedded(base, template)) titles.add(title);
    }
    for (const category of MEMBER_CATEGORIES) {
      for (const title of await this.listCategory(base, category)) titles.add(title);
    }
    const sorted = [...titles].sort();
    for (let index = 0; index < sorted.length; index += BATCH_SIZE) {
      const batch = sorted.slice(index, index + BATCH_SIZE);
      const url = new URL(API_PATH, base);
      url.searchParams.set("action", "query");
      url.searchParams.set("prop", "revisions|categories");
      url.searchParams.set("rvslots", "main");
      url.searchParams.set("rvprop", "content|timestamp");
      url.searchParams.set("cllimit", "500");
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      url.searchParams.set("redirects", "1");
      url.searchParams.set("titles", batch.join("|"));
      yield { url: url.toString(), kind: "json" };
    }
  }

  private async listEmbedded(base: URL, template: string): Promise<string[]> {
    return this.collect(base, "embeddedin", (params) => params.set("eititle", template), "embeddedin", (row) => row.title);
  }

  private async listCategory(base: URL, category: string): Promise<string[]> {
    return this.collect(base, "categorymembers", (params) => {
      params.set("cmtitle", category);
      params.set("cmnamespace", "0");
    }, "categorymembers", (row) => row.title);
  }

  /** Recorre una lista de la API con su `continue`, acotada por crawlLimit. */
  private async collect(
    base: URL,
    list: string,
    configure: (params: URLSearchParams) => void,
    key: string,
    pick: (row: { title?: string; ns?: number }) => string | undefined,
  ): Promise<string[]> {
    const out: string[] = [];
    let cont: Record<string, string> = {};
    for (let guard = 0; guard < 20; guard += 1) {
      const url = new URL(API_PATH, base);
      url.searchParams.set("action", "query");
      url.searchParams.set("list", list);
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      configure(url.searchParams);
      url.searchParams.set(`${list === "embeddedin" ? "eilimit" : "cmlimit"}`, "500");
      for (const [name, value] of Object.entries(cont)) url.searchParams.set(name, value);
      const payload = await this.queryJson(url);
      if (!payload) break;
      const rows = payload.query?.[key];
      if (Array.isArray(rows)) {
        for (const row of rows as Array<{ title?: string; ns?: number }>) {
          if (row.ns !== undefined && row.ns !== 0) continue;
          const title = pick(row);
          if (title) out.push(title);
        }
      }
      if (!payload.continue) break;
      cont = payload.continue;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return out;
  }

  /**
   * Petición de metadatos con reintentos. Sin esto la frontera sale corta y
   * silenciosa: en la primera pasada del 2026-10-20 el servidor cortó tras 16
   * peticiones seguidas y el barrido se quedó en 20 de 27 lotes sin avisar.
   */
  private async queryJson(url: URL): Promise<{ query?: Record<string, unknown>; continue?: Record<string, string> } | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(url, { headers: { "user-agent": META_USER_AGENT } });
        if (response.ok) return (await response.json()) as { query?: Record<string, unknown>; continue?: Record<string, string> };
        if (response.status < 500 && response.status !== 429) return null;
      } catch {
        // red o timeout: se reintenta
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
    }
    return null;
  }

  /** HTML no se usa: la API entrega el wikitexto en JSON. */
  extract(): RawRecord[] {
    return [];
  }

  extractSnapshot(page: StoredPage): RawRecord[] {
    const records: RawRecord[] = [];
    for (const wiki of parseWikiPages(page.body)) {
      const url = `https://www.venciclopedia.org/index.php?title=${encodeURIComponent(wiki.title)}`;
      records.push(...this.artistRecord(wiki, url));
      records.push(...this.releaseRecords(wiki, url));
    }
    return records;
  }

  /** `{{grupo musical}}` → ficha de artista con lo que la plantilla declara. */
  private artistRecord(wiki: WikiPage, url: string): RawRecord[] {
    const [template] = findTemplates(wiki.content, "grupo musical");
    if (!template) return [];
    const name = clean(template.params["nombre"]) || wiki.title;
    if (!name) return [];
    const fields: RawRecord["fields"] = [{ field: "name", value: name, evidence: evidenceFor(url, "grupo musical|nombre", name) }];
    const typeHint = fold(clean(template.params["tipo_artista"]) || clean(template.params["tipo"]));
    if (/solista|musico|cantante|compositor/.test(typeHint)) fields.push({ field: "artist_type", value: "solo_artist", evidence: evidenceFor(url, "grupo musical|tipo_artista", typeHint) });
    else if (/duo/.test(typeHint)) fields.push({ field: "artist_type", value: "duo", evidence: evidenceFor(url, "grupo musical|tipo_artista", typeHint) });
    else if (/proyecto/.test(typeHint)) fields.push({ field: "artist_type", value: "project", evidence: evidenceFor(url, "grupo musical|tipo_artista", typeHint) });
    else if (/banda|grupo|agrupacion/.test(typeHint) || template.params["creacion"] || template.params["origen"]) fields.push({ field: "artist_type", value: "band", evidence: evidenceFor(url, "grupo musical|tipo_artista", typeHint || "banda") });

    const origin = clean(template.params["origen"]);
    if (origin) fields.push({ field: "origin_city", value: origin, evidence: evidenceFor(url, "grupo musical|origen", origin) });
    const formed = firstYear(template.params["creacion"], template.params["formacion"], template.params["formación"], template.params["fundacion"]);
    if (formed) fields.push({ field: "formed_year", value: Number(formed), evidence: evidenceFor(url, "grupo musical|creacion", formed) });
    const disbanded = firstYear(template.params["disolucion"], template.params["disolución"], template.params["separacion"]);
    if (disbanded) fields.push({ field: "disbanded_year", value: Number(disbanded), evidence: evidenceFor(url, "grupo musical|disolucion", disbanded) });
    return [{ entityKind: "artist", identity: name.slice(0, 250), fields, extractor: EXTRACTOR, extractorVersion: ADAPTER_VERSION }];
  }

  /**
   * Fichas de disco + su tracklist. El artista NO se lee de la prosa: sale de
   * las categorías `Discos de <artista>`, descartando años, sellos, tipos y
   * géneros. Si la fuente no permite decidirlo, no se emite el disco.
   */
  private releaseRecords(wiki: WikiPage, url: string): RawRecord[] {
    const templates = [...findTemplates(wiki.content, "record"), ...findTemplates(wiki.content, "disco")];
    if (templates.length === 0) return [];
    const records: RawRecord[] = [];
    const baseTitle = wiki.title.replace(/\s*\((?:disco|álbum|album)[^)]*\)\s*$/i, "").trim();

    templates.forEach((template, index) => {
      const title = clean(template.params["nombre"]) || clean(template.params["título"]) || baseTitle;
      if (!title) return;
      const declaredArtist = clean(template.params["artista"]) || clean(template.params["intérprete"]) || clean(template.params["interprete"]);
      const artist = this.resolveArtist(wiki, template, title, declaredArtist);
      if (!artist) return; // sin artista demostrable: mejor no afirmar nada

      const fields: RawRecord["fields"] = [
        { field: "title", value: title, evidence: evidenceFor(url, "record|nombre", title) },
      ];
      const year = firstYear(template.params["fecha"], template.params["lanzamiento"], template.params["grabado"],
        template.params["grabación"], template.params["año"], ...wiki.categories.filter((c) => DECADE_OR_YEAR.test(c.replace(/^Discos? de /i, ""))));
      if (year) fields.push({ field: "release_year", value: Number(year), evidence: evidenceFor(url, "record|fecha", year) });
      const catalog = clean(template.params["catálogo"] ?? template.params["catalogo"]);
      if (catalog) fields.push({ field: "catalog_id", value: catalog.slice(0, 80), evidence: evidenceFor(url, "record|catálogo", catalog) });
      const formatRaw = clean(template.params["formato"]);
      const format = mediaFormat(formatRaw);
      if (format) fields.push({ field: "media_format", value: format, evidence: evidenceFor(url, "record|formato", formatRaw || format) });
      const type = albumType(clean(template.params["edición"] ?? template.params["edicion"] ?? template.params["tipo"]));
      if (type) fields.push({ field: "album_type", value: type, evidence: evidenceFor(url, "record|edición", clean(template.params["edición"] ?? template.params["tipo"])) });
      // Contexto trazable: no hay columna en el core para sello ni estudio, pero
      // el claim queda con su evidencia para que el aplicador resuelva label_id
      // contra organizations y no se pierda de dónde salió cada nombre.
      const labelRaw = clean(template.params["sello"]);
      if (labelRaw) fields.push({ field: "label", value: labelRaw, evidence: evidenceFor(url, "record|sello", labelRaw) });
      const studioRaw = clean(template.params["estudio"]);
      if (studioRaw) fields.push({ field: "recording_studio", value: studioRaw, evidence: evidenceFor(url, "record|estudio", studioRaw) });

      const identity = `${artist}::${title}`.slice(0, 250);
      records.push({ entityKind: "album", identity, fields, extractor: EXTRACTOR, extractorVersion: ADAPTER_VERSION });

      // La tracklist se asocia a la primera ficha de la página: cuando una
      // página documenta dos ediciones, las pistas son del cuerpo del artículo.
      // `discos` declara cuántos soportes tiene la edición: sin ese dato, los
      // lados A/B de un LP son un solo disco y la numeración es continua.
      const declaredDiscs = Number(clean(template.params["discos"]).replace(/\D/g, "")) || 1;
      const tracks = this.tracksFor(wiki, declaredDiscs > 1);
      if (index === 0 && tracks.length > 0) {
        let disc = 1;
        let number = 0;
        for (const track of tracks) {
          if (track.discStart) { disc = track.discStart; number = 0; }
          number = track.number ?? number + 1;
          const trackFields: RawRecord["fields"] = [
            { field: "title", value: track.title, evidence: evidenceFor(url, "pistas|título", track.title, number) },
            { field: "track_number", value: number, evidence: evidenceFor(url, "pistas|pista", track.rawNumber ?? String(number), number) },
            { field: "disc_number", value: disc, evidence: evidenceFor(url, "pistas|lado", String(disc), number) },
          ];
          if (track.seconds !== undefined) {
            trackFields.push({ field: "duration_seconds", value: track.seconds, evidence: evidenceFor(url, "pistas|duración", track.duration ?? String(track.seconds), number) });
          }
          records.push({
            entityKind: "track",
            identity: `${artist}::${title}::${number}`.slice(0, 250),
            fields: trackFields, extractor: EXTRACTOR, extractorVersion: ADAPTER_VERSION,
          });
        }
      }
    });
    return records;
  }

  /** Artista demostrable para una ficha de disco. */
  private resolveArtist(wiki: WikiPage, template: Template, title: string, declared: string): string | undefined {
    // 1. El campo `artista` de la plantilla, cuando nombra a otro que al disco.
    if (declared && fold(declared) !== fold(title)) return declared;
    const label = clean(template.params["sello"]);
    const labelParts = new Set(splitList(label).map(fold));
    const genres = new Set([...splitList(template.params["genero"] ?? ""), ...splitList(template.params["género"] ?? "")].map(fold));
    const candidates: string[] = [];
    for (const raw of releaseCategories(wiki.categories)) {
      const folded = fold(raw);
      if (!folded) continue;
      if (DECADE_OR_YEAR.test(raw)) continue;
      if (TYPE_LABELS.has(folded) || GENRE_LABELS.has(folded) || genres.has(folded)) continue;
      if (labelParts.has(folded) || KNOWN_LABELS.has(folded)) continue;
      if (folded.startsWith("musica")) continue;
      if (!candidates.some((item) => fold(item) === folded)) candidates.push(raw);
    }
    if (candidates.length === 1) return candidates[0];
    // 2. Recopilatorio con muchos nombres: el marcador del catálogo, aprobado en C3.
    if (candidates.length >= 3) return "Various Artists";
    if (candidates.length === 2) return candidates[0];
    // 3. Sin categoría utilizable, el título "(disco de X)" es explícito.
    const parenthetical = wiki.title.match(/\((?:disco|álbum|album) de ([^)]+)\)/i);
    if (parenthetical?.[1]) return parenthetical[1].trim();
    return declared && fold(declared) !== fold(title) ? declared : undefined;
  }

  /**
   * Pistas de `{{pistas}}`. `multiDisc` viene del campo `discos` de la ficha:
   * solo entonces el lado o el CD abren un disco nuevo. Un LP con cara A y
   * cara B es UN disco con numeración continua.
   */
  private tracksFor(wiki: WikiPage, multiDisc: boolean): Array<{ title: string; seconds?: number; duration?: string; number?: number; rawNumber?: string; discStart?: number }> {
    const out: Array<{ title: string; seconds?: number; duration?: string; number?: number; rawNumber?: string; discStart?: number }> = [];
    let discCursor = 1;
    for (const block of findTemplates(wiki.content, "pistas")) {
      const side = clean(block.params["lado"]).toUpperCase();
      const medium = clean(block.params["cd"] ?? block.params["CD"]);
      if (multiDisc) {
        if (medium) {
          const parsed = Number(medium.replace(/\D/g, ""));
          if (Number.isFinite(parsed) && parsed > 0) discCursor = parsed;
        }
        // A/B → 1, C/D → 2, E/F → 3.
        if (/^[A-F]$/.test(side)) discCursor = Math.floor((side.charCodeAt(0) - 65) / 2) + 1;
      }
      for (let index = 1; index <= 60; index += 1) {
        const title = clean(block.params[`título${index}`] ?? block.params[`titulo${index}`]);
        if (!title) continue;
        const duration = clean(block.params[`duración${index}`] ?? block.params[`duracion${index}`]);
        const rawNumber = clean(block.params[`pista${index}`]);
        const declaredNumber = /^\d+$/.test(rawNumber) ? Number(rawNumber) : undefined;
        const seconds = durationToSeconds(duration);
        out.push({
          title,
          ...(seconds === undefined ? {} : { seconds }),
          ...(duration ? { duration } : {}),
          ...(declaredNumber === undefined ? {} : { number: declaredNumber }),
          ...(rawNumber ? { rawNumber } : {}),
          ...(multiDisc && index === 1 ? { discStart: discCursor } : {}),
        });
      }
    }
    return out;
  }

  /**
   * Identidad de la edición que documenta una página, tenga ficha `{{record}}`
   * o no. Las páginas de disco sin ficha (solo tracklist y créditos) también
   * son una edición: su título es el de la página y el artista sale de las
   * categorías, igual que en una ficha normal.
   */
  releaseIdentity(page: WikiPage): { artist: string; title: string } | undefined {
    const [template] = [...findTemplates(page.content, "record"), ...findTemplates(page.content, "disco")];
    const base = page.title.replace(/\s*\((?:disco|álbum|album)[^)]*\)\s*$/i, "").trim();
    const title = template ? (clean(template.params["nombre"]) || clean(template.params["título"]) || base) : base;
    if (!title) return undefined;
    const declared = template ? (clean(template.params["artista"]) || clean(template.params["intérprete"])) : "";
    const artist = this.resolveArtist(page, template ?? { name: "record", params: {} }, title, declared);
    return artist ? { artist, title } : undefined;
  }

  /** Solo el dominio de la fuente y sus rutas de contenido. */
  isAllowedUrl(candidate: string, rootUrl: string): boolean {
    try {
      const url = new URL(candidate);
      const root = new URL(rootUrl);
      if (url.host !== root.host) return false;
      return url.pathname === API_PATH || url.pathname === "/index.php" || url.pathname === "/";
    } catch {
      return false;
    }
  }
}
