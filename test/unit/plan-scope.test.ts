import { describe, expect, it } from "vitest";
import { consolidateDraft, enforceScope, settleRegisteredRelations } from "../../src/curation/ai/plan-coherence.js";
import { evidenceGaps } from "../../src/curation/ai/evidence.js";
import type { Database } from "../../src/curation/ai/context.js";
import type { CatalogEvidence, CatalogOperation } from "../../src/curation/ai/types.js";

const artist = { kind: "artist" as const, id: 6912 };
const base = { reason: "Documentado", enabled: true };
const quote = (id: string, text: string, url = `https://example.com/${id}`, label = "Historia"): CatalogEvidence =>
  ({ id, url, quote: text, label, fetchedAt: "2026-10-25T00:00:00Z", origin: "page", contentHash: id });
const taxonomy = [
  { slug: "rock", parent: null }, { slug: "pop", parent: null }, { slug: "pop-rock", parent: "rock" },
  { slug: "pop-latino", parent: "pop" }, { slug: "balada", parent: "pop" }, { slug: "salsa", parent: "fusion-latina" }, { slug: "fusion-latina", parent: null },
  { slug: "guaracha", parent: "fusion-latina" }, { slug: "bossa-nova", parent: "fusion-latina" }, { slug: "nueva-trova", parent: null },
  { slug: "rock-latino", parent: "rock" }, { slug: "musica-tropical", parent: null },
];
const terms: Record<string, string[]> = { "rock-latino": ["latin rock", "rock latino", "Rock latino"], "musica-tropical": ["tropical", "Música tropical"], "bossa-nova": ["bossanova", "Bossa nova"] };
/** Only the reads enforceScope makes: taxonomy, confirmed genres and registered social links. */
const db = (genres: string[] = [], socials: Array<{ platform: string; url: string }> = [], extra: { members?: Array<{ name: string; forms: string | null }>; image?: string | null } = {}): Database => ({
  query: (async (sql: string, params: unknown[] = []) => {
    if (/FROM public\.artist_members m JOIN/u.test(sql)) return { rows: extra.members ?? [] };
    if (/AS current FROM public\./u.test(sql)) return { rows: [{ current: extra.image ?? null }] };
    if (/genre_aliases/u.test(sql)) return { rows: taxonomy.map(({ slug }) => ({ slug, terms: terms[slug] ?? [slug] })) };
    if (/FROM ingest\.genres g LEFT JOIN/u.test(sql)) return { rows: taxonomy };
    if (/FROM public\.artists WHERE id=\$1 UNION/u.test(sql)) return { rows: [{ name: "Jeremías" }] };
    if (/_genres x JOIN/u.test(sql)) return { rows: genres.map(slug => ({ slug })) };
    if (/FROM public\.social_links/u.test(sql)) return { rows: socials.filter(row => row.platform === params[1]) };
    throw new Error(`consulta no prevista: ${sql}`);
  }) as Database["query"],
});
const stats = () => ({ repeated: 0, registered: 0, completed: 0, doubts: 0 });
const run = async (operations: CatalogOperation[], evidence: CatalogEvidence[], database = db()) =>
  enforceScope(database, { summary: "", operations, unresolved: [] }, evidence, stats(), artist);

describe("cada dato en su ficha y campo", () => {
  it("un @usuario de red no es un alias del artista", async () => {
    const handle: CatalogOperation = { ...base, key: "a", label: "Añadir variante de nombre: Jeremías Música", evidenceIds: ["E1"], op: "add_alias", target: artist, alias: "Jeremías Música", aliasType: "name_variant", isPrimary: false };
    const name: CatalogOperation = { ...handle, key: "b", label: "Añadir alias: Jeremías", alias: "Jeremías" };
    const result = await run([handle, name], [quote("E1", "Síguelo en Instagram como @Jeremias.Musica. Jeremías vuelve a los escenarios.")]);
    expect(result.operations.map(op => op.key)).toEqual(["b"]);
    expect(result.unresolved[0]).toMatch(/usuario de red social/u);
  });
  it("un sitio de fans no es la web oficial", async () => {
    const fans: CatalogOperation = { ...base, key: "w", label: "Registrar sitio web de fans: jeremiasonline.com", evidenceIds: ["E1"], op: "replace_fields", target: artist, values: { websiteUrl: "http://www.jeremiasonline.com/" } };
    const result = await run([fans], [quote("E1", "Club de fans: http://www.jeremiasonline.com/")]);
    expect(result.operations).toEqual([]);
    expect(result.unresolved[0]).toMatch(/no es el sitio oficial/u);
  });
  it("una portada de disco no es la foto del artista", async () => {
    const cover: CatalogOperation = { ...base, key: "p", label: "Portada de Un Día Más en el Gran Circo (632×632 px)", evidenceIds: ["E1"], op: "replace_fields", target: artist, values: { pictureUrl: "https://is1-ssl.mzstatic.com/x.jpg" } };
    const result = await run([cover], [quote("E1", "URL: https://is1-ssl.mzstatic.com/x.jpg")]);
    expect(result.operations).toEqual([]);
    expect(result.unresolved[0]).toMatch(/portada de un disco/u);
  });
  it("el lugar de nacimiento no es el origen del proyecto, aunque venga como encabezado con fecha", async () => {
    const origin = (key: string, id: string): CatalogOperation => ({ ...base, key, label: "Cambiar ciudad de origen: Londres, Inglaterra", evidenceIds: [id], op: "replace_fields", target: artist, values: { originCity: "Londres, Inglaterra" } });
    const result = await run([origin("o1", "E1"), origin("o2", "E2"), origin("o3", "E3")], [
      quote("E1", "Jeremías (Londres, Inglaterra, 19 de septiembre de 1973) es un cantautor."),
      quote("E2", "El pequeño Carlos Eduardo, nacido en Londres porque sus padres estudiaban allá."),
      quote("E3", "La banda se formó en Londres, Inglaterra, en 1999."),
    ]);
    expect(result.operations.map(op => op.key)).toEqual(["o3"]);
  });
  it("el primer disco no fecha el inicio del proyecto", async () => {
    const formed: CatalogOperation = { ...base, key: "f", label: "Establecer inicio de actividad: 2001", evidenceIds: ["E1"], op: "replace_fields", target: artist, values: { formedYear: 2001 } };
    const result = await run([formed], [quote("E1", "En el año 2001 se hace conocer como cantante, promocionando su primer trabajo discográfico")]);
    expect(result.operations).toEqual([]);
  });
  it("no deja una membresía como pasada sin fecha de fin", async () => {
    const end: CatalogOperation = { ...base, key: "m", label: "Corregir el rol del vínculo", evidenceIds: ["E1"], op: "replace_relation", kind: "artist_membership", id: 11224, values: { role: "Titular del proyecto", isCurrent: false } };
    const dated: CatalogOperation = { ...end, key: "n", values: { isCurrent: false, toYear: 2010 } };
    const result = await run([end, dated], [quote("E1", "Titular del proyecto hasta 2010")]);
    expect(result.operations.map(op => op.key)).toEqual(["n"]);
  });
  it("géneros: el ya confirmado se retira; la rama general de uno más específico y el término inexistente pasan a dudas; una rama sin hijo en la ficha se queda", async () => {
    const genre = (key: string, genreSlug: string): CatalogOperation => ({ ...base, key, label: `Añadir género: ${genreSlug}`, evidenceIds: ["E1"], op: "assign_genre", target: artist, genreSlug, role: "secondary" });
    const result = await run([genre("g1", "balada"), genre("g2", "rock"), genre("g3", "pop-espanol"), genre("g4", "salsa"), genre("g5", "pop")],
      [quote("E1", "rock, pop, balada, salsa y pop en español")], db(["balada", "pop-latino"]));
    expect(result.operations.map(op => op.key)).toEqual(["g2", "g4"]);
    expect(result.unresolved.join("\n")).toMatch(/pop: es la rama general de «(balada|pop-latino)»/u);
    expect(result.unresolved.join("\n")).toMatch(/no existe en la taxonomía/u);
  });
  it("redes: la misma ya registrada se retira y otra distinta de la misma plataforma queda en dudas", async () => {
    const social = (key: string, url: string): CatalogOperation => ({ ...base, key, label: `Añadir Instagram: ${url}`, evidenceIds: ["E1"], op: "add_social_link", target: artist, platform: "instagram", url });
    const registered = db([], [{ platform: "instagram", url: "https://instagram.com/soyjeremiasmusic/" }]);
    const result = await run([social("s1", "https://www.instagram.com/soyjeremiasmusic"), social("s2", "https://www.instagram.com/jeremias.musica")], [quote("E1", "instagram")], registered);
    expect(result.operations).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toMatch(/decidir cuál es la oficial/u);
  });
});

describe("alias, lugares y redes que compiten", () => {
  const alias = (key: string, value: string, id = "E1"): CatalogOperation => ({ ...base, key, label: `Añadir alias: ${value}`, evidenceIds: [id], op: "add_alias", target: artist, alias: value, aliasType: "name_variant", isPrimary: false });
  it("una aclaración entre paréntesis o unas iniciales sin fuente no son alias; un apodo citado sí", async () => {
    const result = await run([alias("a", "Jeremías (ESP)"), alias("b", "M.J."), alias("c", "J.L.", "E2"), alias("d", "El Profeta", "E3")], [
      quote("E1", "Ese que va por ahí (2006) Jeremías (ESP). Tu (Remix) [feat. Jeremías] - Single M.J."),
      quote("E2", "Carlos, conocido como J.L. entre sus amigos"), quote("E3", "le dicen El Profeta"),
    ]);
    expect(result.operations.map(op => op.key)).toEqual(["c", "d"]);
  });
  it("un lugar que las citas no nombran pasa a dudas", async () => {
    const origin: CatalogOperation = { ...base, key: "o", label: "Cambiar ciudad de origen: Londres", evidenceIds: ["E1"], op: "replace_fields", target: artist, values: { originCity: "Londres" } };
    const result = await run([origin], [quote("E1", "Cantante y compositor venezolano de origen británico.")]);
    expect(result.operations).toEqual([]);
    expect(result.unresolved[0]).toMatch(/no nombran Londres/u);
  });
  it("una propuesta con dos campos no desplaza la de otro dato, y una URL inválida no gana la plataforma", () => {
    const person = { kind: "person" as const, id: 15368 };
    const social = (key: string, url: string): CatalogOperation => ({ ...base, key, label: `Facebook ${key}`, evidenceIds: ["E1"], op: "add_social_link", target: artist, platform: "facebook", url });
    const { draft } = consolidateDraft({ summary: "", unresolved: [], operations: [
      { ...base, key: "real", label: "Registrar nombre real", evidenceIds: ["E1"], op: "replace_fields", target: person, values: { realName: "Carlos Eduardo López Ávila", nationality: "Venezolana" } },
      { ...base, key: "nace", label: "Ciudad de nacimiento", evidenceIds: ["E2"], op: "replace_fields", target: person, values: { birthCity: "Londres" } },
      social("malo", "https://www.facebook.com/Jeremías Música"), social("bueno", "https://www.facebook.com/jeremiasmusic"), social("igual", "https://facebook.com/jeremiasmusic/"),
    ] });
    const set = draft.operations.flatMap(op => op.op === "replace_fields" ? Object.keys(op.values) : op.op === "add_social_link" ? [op.url] : []);
    expect(set).toEqual(["realName", "nationality", "birthCity", "https://www.facebook.com/jeremiasmusic"]);
    expect(draft.unresolved.join("\n")).toMatch(/no es una dirección válida/u);
  });
});

describe("géneros de una canción y textos con identificadores de citas", () => {
  it("un género dicho solo de un sencillo no es del artista, aunque la cita sea un recorte del pasaje", async () => {
    const genre = (key: string, genreSlug: string, ids: string[]): CatalogOperation => ({ ...base, key, label: `Añadir género: ${genreSlug}`, evidenceIds: ids, op: "assign_genre", target: artist, genreSlug, role: "secondary" });
    const evidence = [
      quote("E960", "tiene como base rítmica la guaracha y toques de salsa vieja"),
      quote("E1390", "un sencillo refrescante que tiene como base rítmica la guaracha y toques de salsa vieja"),
      quote("E959", "tiene el raro balance de rock, pop, trova, salsa y bossanova"),
    ];
    const result = await run([genre("g", "guaracha", ["E960"]), genre("s", "salsa", ["E960", "E959"]), genre("b", "bossa-nova", ["E959"])], evidence, db());
    expect(result.operations.map(op => op.key)).toEqual(["s", "b"]);
    expect(result.unresolved[0]).toMatch(/de un sencillo o una canción/u);
  });
  it("una nota que solo enumera citas no desplaza a la nota útil del mismo campo", () => {
    const notes = (key: string, text: string): CatalogOperation => ({ ...base, key, label: `Notas ${key}`, evidenceIds: ["E1"], op: "replace_fields", target: artist, values: { notes: text } });
    const { draft } = consolidateDraft({ summary: "", unresolved: [], operations: [
      notes("vacia", "Investigación biográfica CRV: síntesis de fuentes E14, E28/E1590, E242, E404/E1815, E407, E1457/E1818, E1466."),
      notes("util", "Regresó a los escenarios el 26 de enero de 2017 tras casi ocho años de ausencia."),
    ] });
    expect(draft.operations.map(op => op.key)).toEqual(["util"]);
  });
  it("quita los identificadores de citas del texto y descarta el que solo los enumera", () => {
    const notes = (key: string, text: string): CatalogOperation => ({ ...base, key, label: "Notas", evidenceIds: ["E1"], op: "replace_fields", target: artist, values: { notes: text } });
    const empty = consolidateDraft({ summary: "", unresolved: [], operations: [notes("vacia", "Investigación biográfica CRV: síntesis de fuentes E14, E28/E1590, E242, E404/E1815.")] }).draft;
    expect(empty.operations).toEqual([]);
    expect(empty.unresolved[0]).toMatch(/solo enumera identificadores/u);
    const useful = consolidateDraft({ summary: "", unresolved: [], operations: [notes("util", "Regresó a los escenarios el 26 de enero de 2017 (E979, E980), tras casi ocho años de ausencia, con «La Mujer Perfecta» E1868.")] }).draft;
    const kept = useful.operations[0]!;
    expect(kept.op === "replace_fields" && kept.values["notes"]).toBe("Regresó a los escenarios el 26 de enero de 2017, tras casi ocho años de ausencia, con «La Mujer Perfecta».");
  });
});

describe("organizaciones y sitios oficiales", () => {
  it("un portal de música no es el sitio oficial; el dominio con el nombre del artista o una cita que lo llama oficial sí", async () => {
    const site = (key: string, url: string, id: string): CatalogOperation => ({ ...base, key, label: "Añadir sitio oficial del artista", evidenceIds: [id], op: "add_social_link", target: artist, platform: "website", url });
    const result = await run([site("portal", "https://www.buenamusica.com/jeremias", "E1"), site("propio", "https://www.jeremiasmusica.com", "E2"), site("citado", "https://ejemplo.com/j", "E3")], [
      quote("E1", "Imagen: https://www.buenamusica.com/media/fotos/cantantes/biografia/jeremias.jpg"), quote("E2", "jeremiasmusica.com"), quote("E3", "Su sitio oficial: https://ejemplo.com/j"),
    ]);
    expect(result.operations.map(op => op.key)).toEqual(["propio", "citado"]);
  });
  it("no crea una organización que el catálogo ya tiene; un nombre parcial pide elegir", async () => {
    const orgs = [{ id: 322, name: "Universal" }, { id: 4847, name: "Universal Music Latino" }, { id: 4271, name: "Sonográfica" }];
    const database: Database = { query: (async (sql: string, params: unknown[] = []) => {
      if (/SELECT 1 FROM public\.(persons|organizations) WHERE/u.test(sql)) return { rows: [{}], rowCount: 1 };
      if (/FROM public\.organizations o/u.test(sql)) { const needle = String(params[0]).replace(/%/gu, ""); return { rows: orgs.filter(org => org.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().includes(needle)) }; }
      throw new Error(`consulta no prevista: ${sql}`);
    }) as Database["query"] };
    const org = (key: string, name: string): CatalogOperation => ({ ...base, key, label: `Crear sello: ${name}`, evidenceIds: ["E1"], op: "create_entity", kind: "organization", values: { name } });
    const credit: CatalogOperation = { ...base, key: "rel", label: "Vincular con Sonografica", evidenceIds: ["E1"], op: "create_relation", kind: "person_organization", endpoints: { personId: { kind: "person", id: 15368 }, organizationId: { kind: "organization", key: "sono" } }, values: { role: "sello" } };
    const settled = await settleRegisteredRelations(database, { summary: "", unresolved: [], operations: [org("univ", "Universal Music"), org("sono", "Sonografica"), credit] }, stats());
    expect(settled.operations.map(op => op.key)).toEqual(["rel"]);
    const relation = settled.operations[0]!;
    expect(relation.op === "create_relation" && relation.endpoints["organizationId"]).toEqual({ kind: "organization", id: 4271 });
    expect(settled.unresolved[0]).toMatch(/ya tiene 322 Universal, 4847 Universal Music Latino/u);
  });
});

describe("solo lo documentado llega como propuesta", () => {
  it("un alta conserva lo citado y suelta lo que la cita no dice; su vínculo de fundador vale con «creó su propia compañía»", async () => {
    const org: CatalogOperation = { ...base, key: "avila", label: "Crear organización: Avila Records", evidenceIds: ["E34"], op: "create_entity", kind: "organization", values: { name: "Avila Records", organizationType: "production_company", notes: "Compañía creada por el artista según la fuente citada." } };
    const founder: CatalogOperation = { ...base, key: "fundador", label: "Vincular como fundador", evidenceIds: ["E34"], op: "create_relation", kind: "person_organization", endpoints: { personId: { kind: "person", id: 15368 }, organizationId: { kind: "organization", key: "avila" } }, values: { role: "fundador", fromYear: 2000 } };
    const result = await run([org, founder], [quote("E34", "En el 2000, López creó su propia compañía productora (Avila Records)")]);
    expect(result.operations.map(op => op.key)).toEqual(["avila", "fundador"]);
    const created = result.operations[0]!;
    expect(created.op === "create_entity" && created.values).toEqual({ name: "Avila Records", organizationType: "production_company" });
    expect(result.unresolved[0]).toMatch(/se propone sin notas/u);
  });
  it("un género se cita como frase y una red por su dirección, no por palabras sueltas ni por el nombre visible", async () => {
    const genre = (key: string, genreSlug: string, id: string): CatalogOperation => ({ ...base, key, label: `Añadir género: ${genreSlug}`, evidenceIds: [id], op: "assign_genre", target: artist, genreSlug, role: "secondary" });
    const social = (key: string, platform: Extract<CatalogOperation, { op: "add_social_link" }>["platform"], url: string, handle: string): CatalogOperation => ({ ...base, key, label: `Añadir ${platform}`, evidenceIds: ["E3"], op: "add_social_link", target: artist, platform, url, handle });
    const result = await run([
      genre("latino", "rock-latino", "E1"), genre("tropical", "musica-tropical", "E2"), genre("bossa", "bossa-nova", "E4"),
      social("fb", "facebook", "https://www.facebook.com/JeremiasMusica", "Jeremías Música"), social("x", "x", "https://x.com/Jeremias_Musica", "Jeremias_Musica"),
    ], [
      quote("E1", "by Jeremías 2006 · Universal Music Latino Rock"),
      quote("E2", "paseándose entre el pop, la balada y el pop tropical"),
      quote("E4", "tiene el raro balance de rock, pop, trova, salsa y bossanova"),
      quote("E3", "Twitter: Jeremias_Musica // Facebook: Jeremías Música"),
    ]);
    expect(result.operations.map(op => op.key)).toEqual(["tropical", "bossa", "x"]);
    expect(result.unresolved.join("\n")).toMatch(/no respaldan género «rock-latino»/u);
    expect(result.unresolved.join("\n")).toMatch(/no respaldan red facebook no citada/u);
  });
  it("lo que la cita no respalda pasa a dudas, con lo que dependa de ello", async () => {
    const genre: CatalogOperation = { ...base, key: "trova", label: "Añadir género: Nueva trova", evidenceIds: ["E1"], op: "assign_genre", target: artist, genreSlug: "nueva-trova", role: "secondary" };
    const status: CatalogOperation = { ...base, key: "activo", label: "Registrar estado activo", evidenceIds: ["E1"], op: "replace_fields", target: artist, values: { status: "activo" } };
    const org: CatalogOperation = { ...base, key: "inventada", label: "Crear sello", evidenceIds: ["E1"], op: "create_entity", kind: "organization", values: { name: "Sello Inventado" } };
    const link: CatalogOperation = { ...base, key: "enlace", label: "Vincular con el sello", evidenceIds: ["E1"], op: "create_relation", kind: "person_organization", endpoints: { personId: { kind: "person", id: 15368 }, organizationId: { kind: "organization", key: "inventada" } }, values: { role: "sello" } };
    const result = await run([genre, status, org, link], [quote("E1", "tiene el raro balance de rock, pop, trova, salsa y bossanova; retoma su carrera")]);
    expect(result.operations).toEqual([]);
    expect(result.unresolved.join("\n")).toMatch(/no respaldan género «nueva-trova»/u);
    expect(result.unresolved.join("\n")).toMatch(/depende de una propuesta sin respaldo/u);
  });
});

describe("respaldo de una red social", () => {
  const op = (url: string, handle?: string): CatalogOperation => ({ ...base, key: "s", label: "Añadir Instagram", evidenceIds: ["E1"], op: "add_social_link", target: artist, platform: "instagram", url, ...(handle ? { handle } : {}) });
  it("vale la propia página del perfil, su dirección o su @usuario en la cita", () => {
    expect(evidenceGaps(op("https://www.instagram.com/soyjeremiasmusic/"), [quote("E1", "Perfil", "https://instagram.com/soyjeremiasmusic")])).toEqual([]);
    expect(evidenceGaps(op("https://www.instagram.com/soyjeremiasmusic"), [quote("E1", "Síguelo en instagram.com/soyjeremiasmusic")])).toEqual([]);
    expect(evidenceGaps(op("https://www.instagram.com/jeremias.musica", "@Jeremias.Musica"), [quote("E1", "Su Instagram es @Jeremias.Musica")])).toEqual([]);
  });
  it("otra red del texto no respalda esta", () => {
    expect(evidenceGaps(op("https://www.instagram.com/otro"), [quote("E1", "Síguelo en instagram.com/soyjeremiasmusic")])).toEqual(["red instagram no citada"]);
  });
});

describe("dos reescrituras de la misma biografía", () => {
  it("compiten por el mismo dato aunque una rellene también las notas", () => {
    const bio = (key: string, values: Record<string, string>): CatalogOperation => ({ ...base, key, label: `Biografía ${key}`, evidenceIds: ["E1"], op: "replace_fields", target: artist, values });
    const { draft } = consolidateDraft({ summary: "", unresolved: [], operations: [bio("a", { biography: "Texto breve." }), bio("b", { biography: "Texto más largo y completo.", notes: "Datos." })] });
    expect(draft.operations.map(op => op.key)).toEqual(["b"]);
    expect(draft.unresolved[0]).toMatch(/^Otra propuesta para el mismo dato/u);
  });
});

describe("revisión formal de Caramelos (plan 86)", () => {
  const band = { kind: "artist" as const, id: 58 };
  const runBand = (operations: CatalogOperation[], evidence: CatalogEvidence[], database: Database) =>
    enforceScope(database, { summary: "", operations, unresolved: [] }, evidence, stats(), band);
  it("en un grupo, el nombre de un integrante no es otro nombre de la banda; en un proyecto solista sí puede serlo", async () => {
    const alias: CatalogOperation = { ...base, key: "a", label: "Añadir variante de nombre: Asier Cazalis", evidenceIds: ["E1"], op: "add_alias", target: band, alias: "Asier Cazalis", aliasType: "name_variant", isPrimary: false };
    const evidence = [quote("E1", "la boda del vocalista de Caramelos de Cianuro, Asier Cazalis")];
    const group = await runBand([alias], evidence, db([], [], { members: [{ name: "Asier Cazalis", forms: null }, { name: "Pável Tello", forms: null }] }));
    expect(group.operations).toEqual([]);
    expect(group.unresolved[0]).toMatch(/nombre de un integrante \(Asier Cazalis\)/u);
    const solo = await runBand([alias], evidence, db([], [], { members: [{ name: "Asier Cazalis", forms: null }] }));
    expect(solo.operations.map(op => op.key)).toEqual(["a"]);
  });
  it("una foto nueva no sustituye en silencio la que la ficha ya tiene", async () => {
    const photo: CatalogOperation = { ...base, key: "f", label: "Actualizar imagen del artista", evidenceIds: ["E1"], op: "replace_fields", target: band, values: { pictureUrl: "https://www.buenamusica.com/media/fotos/caramelos.jpg" } };
    const evidence = [quote("E1", "/image: https://www.buenamusica.com/media/fotos/caramelos.jpg")];
    const kept = await runBand([photo], evidence, db([], [], { image: "/crv/media/artist/58.jpg" }));
    expect(kept.operations).toEqual([]);
    expect(kept.unresolved[0]).toMatch(/ya tiene foto; la nueva .* va como candidata en Imágenes/u);
  });
  it("dos correcciones de la misma membresía compiten fecha a fecha", () => {
    const from: CatalogOperation = { ...base, key: "inicio", label: "Corregir inicio de Luis Golding: 1991", evidenceIds: ["E1"], op: "replace_relation", kind: "artist_membership", id: 12853, values: { fromYear: 1991, toYear: 1994, isCurrent: false } };
    const until: CatalogOperation = { ...base, key: "fin", label: "Corregir fin de Luis Golding: 2005", evidenceIds: ["E2"], op: "replace_relation", kind: "artist_membership", id: 12853, values: { toYear: 2005, isCurrent: false } };
    const other: CatalogOperation = { ...until, key: "etapa2", label: "Rol de la segunda etapa", id: 12856, values: { role: "Bajo, coros", isCurrent: false } };
    const result = consolidateDraft({ summary: "", operations: [from, until, other], unresolved: [] });
    expect(result.draft.operations.map(op => op.key)).toEqual(["inicio", "etapa2"]);
    expect(result.draft.unresolved[0]).toMatch(/Otra propuesta para el mismo dato que «Corregir inicio de Luis Golding: 1991»: Corregir fin de Luis Golding: 2005/u);
  });
});
