import { describe, expect, it } from "vitest";
import { aliveOnly, findLinks, foreignCredits, givenCompatible, incompatibleNames, namesakeFamily, namesakeRelative, pickProjects, nameForms, searchQueries, validateMixedGroups, validateWebVerdict, webVerdictSchema, type PersonContext, type WebVerdict } from "../../src/ambiguity/person-web-verification.js";
import { assertPublicPageUrl, cleanPageContent, decodeWebPage, relevantFirst } from "../../src/ambiguity/web-search.js";

const page = { url: "https://example.org/persona", title: "Biografía", content: "Antonio Toño Casas fundó Wahala en 1997. Tony Casas, su hijo, toca el bajo en Rawayana.", contentHash: "0".repeat(64), fetchedAt: "2026-10-06" };
describe("verificación web de personas", () => {
  it("solo acepta citas literales de páginas guardadas", () => {
    const proposal: WebVerdict = { verdict: "different", rationale: "Padre e hijo", uncertainties: [], evidence: [
      { source: 0, quote: "Tony Casas, su hijo, toca el bajo en Rawayana.", supports: "different" },
    ] };
    const context = { names: ["Toño Casas", "Tony Casas"] as [string, string], sharedProjects: [],
      projectsA: ["Wahala"], projectsB: ["Rawayana"], eraConflict: null };
    expect(validateWebVerdict(proposal, [page], context).verdict).toBe("different");
    expect(validateWebVerdict({ ...proposal, evidence: [{ ...proposal.evidence[0]!, quote: "Son la misma persona" }] }, [page]).verdict).toBe("unknown");
  });
  it("no toma una cita de otra página ni una afirmación sin cita", () => {
    expect(validateWebVerdict({ verdict: "same", rationale: "", uncertainties: [], evidence: [{ source: 1, quote: "Antonio Toño Casas fundó Wahala", supports: "same" }] }, [page]).verdict).toBe("unknown");
  });
  it("tolera la grafía index/text del modelo, pero exige verificar la frase", () => {
    const parsed = webVerdictSchema.parse({ verdict: "different", rationale: "Padre e hijo", evidence: [
      { index: 0, text: "Tony Casas, su hijo, toca el bajo en Rawayana.", supports: "different" },
    ] });
    expect(validateWebVerdict(parsed, [page], { names: ["Toño Casas", "Tony Casas"], sharedProjects: [],
      projectsA: ["Wahala"], projectsB: ["Rawayana"] }).verdict).toBe("different");
  });
  it("no separa por créditos de una sola persona aunque el modelo diga distintas", () => {
    const proposal: WebVerdict = { verdict: "different", rationale: "Músicos de época diferente", uncertainties: [], evidence: [
      { source: 0, quote: "Alfredo Gil tocó trompeta en Los Melódicos", supports: "different" },
    ] };
    const sources = [{ ...page, content: "Alfredo Gil tocó trompeta en Los Melódicos" }];
    expect(validateWebVerdict(proposal, sources, { names: ["Alfredo Gil", "Alfredo Gil"], sharedProjects: [],
      projectsA: ["Los Melódicos"], projectsB: ["Dying For Redemption"], eraConflict: "crédito antes de nacer" }).verdict).toBe("unknown");
  });
  it("impide leer direcciones internas publicadas como resultados web", async () => {
    await expect(assertPublicPageUrl("http://127.0.0.1:5433/private")).rejects.toThrow();
    await expect(assertPublicPageUrl("http://localhost:8080/")).rejects.toThrow();
    await expect(assertPublicPageUrl("http://[::]/")).rejects.toThrow();
  });
  it("lee el latin1 de Sincopa y verifica citas con acentos y comillas distintas", () => {
    const raw = new Uint8Array([60, 109, 101, 116, 97, 32, 99, 104, 97, 114, 115, 101, 116, 61, 34, 105, 115, 111, 45, 56, 56, 53, 57, 45, 49, 34, 62, 77, 101, 108, 243, 100, 105, 99, 111, 115]);
    const content = decodeWebPage(raw, "text/html", "https://sincopa.com/test.htm");
    expect(content).toContain("Melódicos");
    const validated = validateWebVerdict({ verdict: "different", rationale: "Dos personas", uncertainties: [], evidence: [
      { source: 0, quote: '"Los Melodicos" grabaron en 1978', supports: "different" },
    ] }, [{ ...page, content: "«Los Melódicos» grabaron en 1978." }]);
    expect(validated.evidence).toHaveLength(1);
    expect(validated.verdict).toBe("unknown");
  });
  it("requiere dos sitios para proponer misma persona, salvo una fuente que una ambos nombres y el proyecto", () => {
    const proposal: WebVerdict = { verdict: "same", rationale: "Alias", uncertainties: [], evidence: [
      { source: 0, quote: "Giordano Di Marzo conocido como Yordano en Sietecuero", supports: "same" },
    ] };
    const pages = [{ ...page, content: "Giordano Di Marzo conocido como Yordano en Sietecuero" },
      { ...page, url: "https://other.org/bio", content: "Giordano Di Marzo conocido como Yordano en Sietecuero" }];
    expect(validateWebVerdict(proposal, pages).verdict).toBe("unknown");
    expect(validateWebVerdict(proposal, pages, { names: ["Giordano Di Marzo", "Yordano"], sharedProjects: ["Sietecuero"] }).verdict).toBe("same");
    expect(validateWebVerdict({ ...proposal, evidence: [...proposal.evidence, { ...proposal.evidence[0]!, source: 1 }] }, pages).verdict).toBe("same");
  });
  it("busca por proyecto, país, rol y década cuando los nombres coinciden", () => {
    const a = { id: 1, name: "Víctor Valerio", birthDate: null, deathDate: null, projects: [{ name: "Niuno Niotro", role: "bajo", year: 2010 }], sourceUrls: [] };
    const b = { id: 2, name: "Víctor Valerio", birthDate: null, deathDate: null, projects: [{ name: "Los Melódicos", role: "ingeniero", year: 1978 }], sourceUrls: [] };
    expect(searchQueries(a, b)).toEqual([
      '"Víctor Valerio" "Niuno Niotro" "Los Melódicos" Venezuela',
      // Sin «Venezuela» en las de un proyecto: los buscadores soltaban la frase rara y traían abogados.
      '"Víctor Valerio" "Niuno Niotro"', '"Víctor Valerio" "Los Melódicos"',
      // 32 años entre los créditos: se busca la edad del más joven (banda colegial, «con 15 años»).
      '"Niuno Niotro" colegio OR liceo OR edad',
      '"Víctor Valerio" "Niuno Niotro" bajo 2010',
      '"Víctor Valerio" "Los Melódicos" ingeniero 1970',
    ]);
  });
});

// Reglas añadidas tras la prueba difícil (reports/person-web-verification-dificil-2026-10-06.json).
const at = (url: string, content: string, title = "") => ({ url, title, content, contentHash: "0".repeat(64), fetchedAt: "2026-10-06" });
describe("verificación web de personas: el código decide", () => {
  it("apellidos: errata y nombre completo caben; apellidos distintos no", () => {
    expect(incompatibleNames("Neguito Borjas", "Abdenago de Jesús Borjas Urdaneta")).toBe(false);
    expect(incompatibleNames("Rafael Grego", "Rafael Greco")).toBe(false);
    expect(incompatibleNames("Edgar Quinteor", "Édgar Enrique Quintero Castillo")).toBe(false);
    expect(incompatibleNames("José Romero Bello", "José Pedro Romero Ignacio")).toBe(true);
    expect(incompatibleNames('José "Cheo" Rodríguez', "José Luis Pardo")).toBe(true);
    expect(incompatibleNames("Kenny", "Kenny O'Brien")).toBe(false);
  });
  it("formas del nombre: apodo + apellido y nombre + último apellido; mononimos cortos no", () => {
    expect(nameForms('Carlos "Nené" Quintero')).toEqual(expect.arrayContaining(["carlos nene quintero", "nene quintero", "carlos quintero"]));
    expect(nameForms("Édgar Enrique Quintero Castillo")).toEqual(expect.arrayContaining(["edgar quintero", "edgar castillo"]));
    expect(nameForms("Kenny")).toEqual(["kenny"]);
    expect(nameForms("Pit")).toEqual([]);
  });
  it("liga nombre y proyecto solo si están cerca, o si el título de la página es del proyecto", () => {
    const far = at("https://a.org/x", `Rafael Greco tocó la batería. ${"relleno ".repeat(60)} Patafunk lanzó Dubdelic.`);
    const near = at("https://b.org/y", "Rafael Greco grabó Dubdelic con Patafunk en 2008.");
    const titled = at("https://sincopa.com/z.htm", "Créditos: batería Rafael Greco", "Patafunk - Dubdelic");
    expect(findLinks([far], ["rafael greco"], ["patafunk"])).toHaveLength(0);
    expect(findLinks([near, titled], ["rafael greco"], ["patafunk"]).map((link) => link.url)).toEqual(["https://b.org/y", "https://sincopa.com/z.htm"]);
  });
  it("quita el «Gordon 296» de Lobotoradio para que no parezca un apellido", () => {
    expect(cleanPageContent("https://lobotoradio.com/x", "José Romero Gordon 296 tipo: músico")).toBe("José Romero tipo: músico");
    expect(cleanPageContent("https://otro.org/x", "José Romero Gordon 296 tipo: músico")).toBe("José Romero Gordon 296 tipo: músico");
  });
  it("una evidencia mal formada se descarta sin tumbar la respuesta", () => {
    const parsed = webVerdictSchema.parse({ verdict: "mixed", rationale: "x", uncertainties: "una sola duda", evidence: [
      { source: 0, quote: "a".repeat(2000), year: null, fullName: null }, "basura", { source: -3 },
    ], groups: [{ label: "A", projects: null, birthYear: "1922", deathYear: null }, 7] });
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]!.quote).toHaveLength(600);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups![0]!.birthYear).toBe(1922);
    expect(parsed.uncertainties).toEqual(["una sola duda"]);
  });
  it("toma la cita de la página donde está aunque el modelo dé otro índice", () => {
    const pages = [at("https://a.org/x", "Nada que ver."), at("https://b.org/y", "Jesús Chu Quintero tocó con Vytas Brenner en 1975.")];
    const validated = validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Jesús Chu Quintero tocó con Vytas Brenner", supports: "same" }] }, pages);
    expect(validated.evidence.map((item) => item.url)).toEqual(["https://b.org/y"]);
  });
  it("misma persona: la web liga el nombre con el proyecto común; «son» en inglés no es parentesco", () => {
    const pages = [at("https://a.org/x", "Rudy Pagliuca produced Malanga; his songs are on the album."),
      at("https://b.org/y", "Rodolfo Rudy Pagliuca, productor de Malanga y Viniloversus.")];
    const context = { names: ["Rudy Pagliuca", 'Rodolfo "Rudy" Pagliuca'] as [string, string], sharedProjects: ["Malanga"],
      projectsA: ["Malanga"], projectsB: ["Malanga", "Viniloversus"] };
    const proposal: WebVerdict = { verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Rudy Pagliuca produced Malanga", supports: "different" }] };
    expect(validateWebVerdict(proposal, pages, context).verdict).toBe("same");
  });
  it("una cita de padre e hijo veta la fusión aunque compartan proyecto", () => {
    const pages = [at("https://a.org/x", "Antonio Casas, padre de Tony Casas, fundó Wahala; Tony toca en Rawayana y Wahala.")];
    const context = { names: ["Antonio Casas", "Antonio Casas"] as [string, string], sharedProjects: ["Wahala"],
      projectsA: ["Wahala"], projectsB: ["Rawayana", "Wahala"] };
    const proposal: WebVerdict = { verdict: "same", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Antonio Casas, padre de Tony Casas, fundó Wahala", supports: "same" }] };
    expect(validateWebVerdict(proposal, pages, context).verdict).not.toBe("same");
  });
  it("distintas: apellidos incompatibles y cada ficha ligada a lo suyo", () => {
    const pages = [at("https://a.org/x", "José Cheo Rodríguez, trompeta de Desorden Público."),
      at("https://b.org/y", "José Luis Pardo, «Cheo», cantante de Los Melódicos.")];
    const context = { names: ['José "Cheo" Rodríguez', "José Luis Pardo"] as [string, string], sharedProjects: [],
      projectsA: ["Desorden Público"], projectsB: ["Los Melódicos"] };
    expect(validateWebVerdict({ verdict: "unknown", rationale: "x", uncertainties: [], evidence: [] }, pages, context).verdict).toBe("different");
    // Sin que la web nombre a la segunda ficha, no se separa.
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [] }, pages.slice(0, 1), context).verdict).toBe("unknown");
  });
});

describe("fichas mezcladas", () => {
  const romero: PersonContext = { id: -1, name: "José Romero", birthDate: null, deathDate: null, sourceUrls: [], projects: [
    { name: "Adilia Castillo", year: 1965, role: "arreglos" }, { name: "Desorden Público", year: 2000, role: "integrante: bajo" },
    { name: "Lapamariposa", year: 2013, role: "bajo" }] };
  const pages = [at("https://cancioneros.com/romero", "José Romero Bello (1922-1998) acompañó a Adilia Castillo."),
    at("https://lobotoradio.com/jose-romero", "José Romero: bajo. Bandas: Desorden Público, Lapamariposa.")];
  const group = (label: string, projects: string[], source: number, quote: string, extra: Record<string, unknown> = {}) => ({ label, projects, source, quote, ...extra });
  it("separa cuando un grupo murió años antes de los créditos del otro", () => {
    const proposal = webVerdictSchema.parse({ verdict: "mixed", rationale: "Dos José Romero", evidence: [], groups: [
      group("Romero Bello", ["Adilia Castillo"], 0, "José Romero Bello (1922-1998) acompañó a Adilia Castillo.", { deathYear: 1998 }),
      group("rockero", ["Desorden Público", "Lapamariposa"], 1, "Bandas: Desorden Público, Lapamariposa.")] });
    const result = validateMixedGroups(proposal, pages, romero, { eraSplit: false });
    expect(result.verdict).toBe("mixed");
    expect(result.rationale).toContain("murió en 1998");
  });
  it("no separa sin contradicción citada ni con grupos de un mismo sitio", () => {
    const proposal = webVerdictSchema.parse({ verdict: "mixed", rationale: "x", evidence: [], groups: [
      group("A", ["Adilia Castillo"], 0, "José Romero Bello (1922-1998) acompañó a Adilia Castillo."),
      group("B", ["Desorden Público"], 1, "Bandas: Desorden Público, Lapamariposa.")] });
    expect(validateMixedGroups(proposal, pages, romero, { eraSplit: false }).verdict).toBe("unknown");
  });
  it("descarta un grupo cuyo nombre completo es de otra persona del disco", () => {
    const gil: PersonContext = { id: -2, name: "Alfredo Gil", birthDate: null, deathDate: null, sourceUrls: [], projects: [
      { name: "Los Melódicos", year: 1980, role: "trompeta" }, { name: "Dying for Redemption", year: 2007, role: "integrante: voz" }] };
    const gilPages = [at("https://a.org/x", "Leopoldo Betancourt (1950) tocó piano con Los Melódicos."),
      at("https://b.org/y", "Alfredo Gil, voz de Dying for Redemption desde 2007.")];
    const proposal = webVerdictSchema.parse({ verdict: "mixed", rationale: "x", evidence: [], groups: [
      group("pianista", ["Los Melódicos"], 0, "Leopoldo Betancourt (1950) tocó piano con Los Melódicos.", { fullName: "Leopoldo Betancourt", birthYear: 1950 }),
      group("metal", ["Dying for Redemption"], 1, "Alfredo Gil, voz de Dying for Redemption desde 2007.", { fullName: "Alfredo Gil" })] });
    expect(validateMixedGroups(proposal, gilPages, gil, { eraSplit: false }).verdict).toBe("unknown");
  });
});

describe("reglas de la ronda 20/20 (2026-10-06)", () => {
  const webPage = (url: string, title: string, content: string) => ({ url, title, content, contentHash: "0".repeat(64), fetchedAt: "2026-10-06" });
  it("el parentesco solo cuenta si nombra a dos parientes que se llaman como la ficha", () => {
    expect(namesakeFamily("José Romero Bello (1922-1998), father of arpa player Joseito Romero", ["José Romero"])).toBe(true);
    expect(namesakeFamily("Toño Casas, de Wahala, es el padre de Tony Casas, bajista de Rawayana", ["Antonio Casas"])).toBe(true);
    // Un hermano con otro nombre no es la pregunta (Neguito Borjas), ni el que funda la banda con él (Chu Quintero).
    expect(namesakeFamily("Abdenago Neguito Borjas, brother of Heberto Beto Borjas and Oscar Borjas", ['Abdenago "Neguito" Borjas'])).toBe(false);
    expect(namesakeFamily("Carlos Nené Quintero together with his brother Jesús Chú Quintero", ['Jesús "Chu" Quintero'])).toBe(false);
  });
  it("saca el nombre que distingue al pariente, si lo hay", () => {
    expect(namesakeRelative("José Romero Bello. Tuvo un hijo, José (Joseíto Romero), arpista", ["José Romero"])).toBe("joseito");
    expect(namesakeRelative("Ezequiel Serrano hijo es hijo del maestro Ezequiel Serrano", ["Ezequiel Serrano"])).toBe("");
  });
  it("nombres de pila compatibles: diminutivos e hipocorísticos sí, otro nombre no", () => {
    expect(givenCompatible("Joseito Romero", "José Romero")).toBe(true);
    expect(givenCompatible("Toño Casas", "Antonio Casas")).toBe(true);
    expect(givenCompatible("Pacho González", "Francisco González")).toBe(true);
    expect(givenCompatible('Carlos "Nené" Quintero', 'Jesús "Chu" Quintero')).toBe(false);
  });
  it("después de morir solo cuentan los créditos que exigen estar vivo", () => {
    expect(aliveOnly("Mixed by")).toBe(true);
    expect(aliveOnly("Producer")).toBe(true);
    expect(aliveOnly("integrante: bajo")).toBe(true);
    // Una recopilación póstuma sí lo trae cantando o como compositor.
    expect(aliveOnly("Vocals")).toBe(false);
    expect(aliveOnly("composer")).toBe(false);
  });
  it("los resultados con todas las frases buscadas van primero", () => {
    const hits = [
      { url: "https://abogados.example/francisco-gonzalez", title: "Francisco González, abogado", snippet: "Bufete", engine: "bing" },
      { url: "https://rock.example/niuno-niotro", title: "Niuno Niotro", snippet: "Francisco González, guitarra de Niuno Niotro", engine: "bing" },
    ];
    const ordered = relevantFirst('"Francisco González" "Niuno Niotro"', hits);
    expect(ordered.relevant).toBe(1);
    expect(ordered.hits[0]!.url).toBe("https://rock.example/niuno-niotro");
  });
  it("un disco acreditado a otro («Rudy» en un disco de Rudy Márquez) se separa como ajeno", () => {
    const rudy: PersonContext = { id: -3, name: 'Rodolfo "Rudy" Pagliuca', birthDate: null, deathDate: null, sourceUrls: [], projects: [
      { name: "Rudy Márquez", album: "Los Dangers", year: 1965, role: "Vocals", credited: ["Rudy"] },
      { name: "Malanga", album: "Malanga", year: 2005, role: "Keyboards", credited: ["Rudy Pagliuca"] },
      { name: "Viniloversus", album: "Si no sabes", year: 2007, role: "Producer", credited: ["Rudy Pagliuca"] }] };
    const split = foreignCredits(rudy);
    expect(split?.name).toBe("Rudy Márquez");
    expect(split?.foreign.map((item) => item.name)).toEqual(["Rudy Márquez"]);
    expect(foreignCredits({ ...rudy, projects: rudy.projects.slice(1) })).toBeNull();
  });
  it("Discogs no prueba que dos homónimos sean la misma persona", () => {
    const context = { names: ["Francisco González", "Francisco González"] as [string, string], sharedProjects: [],
      projectsA: ["Fidelis"], projectsB: ["Recoveco"], eraConflict: null };
    const proposal: WebVerdict = { verdict: "same", rationale: "Discogs lista los dos", uncertainties: [], evidence: [] };
    const pages = (url: string) => [
      webPage(url, "Francisco González", "Francisco González. Credits: Engineer – Fidelis; Guitar – Recoveco."),
      webPage("https://fidelis.example/banda", "Fidelis", "Francisco González grabó el disco de Fidelis."),
      webPage("https://recoveco.example/banda", "Recoveco", "Francisco González, guitarra de Recoveco."),
    ];
    expect(validateWebVerdict(proposal, pages("https://www.discogs.com/artist/1080766"), context).verdict).toBe("unknown");
    // La misma página en un sitio que no junta homónimos sí liga los dos proyectos.
    expect(validateWebVerdict(proposal, pages("https://bio.example/francisco-gonzalez"), context).verdict).toBe("same");
  });
  it("un seudónimo citado une nombre artístico y nombre real aunque los apellidos no casen", () => {
    const context = { names: ["Dj Baffa", "Emidio Falconi"] as [string, string], sharedProjects: ["Chucknorris"],
      projectsA: ["Chucknorris"], projectsB: ["Sur Carabela"], eraConflict: null };
    const pages = [webPage("https://bio.example/baffa", "Baffa", "Emidio Falconi, aka DJ Baffa, grabó con Sur Carabela y con Chucknorris.")];
    const cited: WebVerdict = { verdict: "same", rationale: "Alias", uncertainties: [], evidence: [
      { source: 0, quote: "Emidio Falconi, aka DJ Baffa, grabó con Sur Carabela", supports: "same" }] };
    expect(validateWebVerdict(cited, pages, context).verdict).toBe("same");
    // Sin la marca de alias, dos nombres distintos en la misma frase son dos personas de la banda: no se fusiona.
    const together = [webPage("https://bio.example/banda", "Banda", "Emidio Falconi y DJ Baffa grabaron con Sur Carabela y con Chucknorris.")];
    const plain: WebVerdict = { ...cited, evidence: [{ source: 0, quote: "Emidio Falconi y DJ Baffa grabaron con Sur Carabela", supports: "same" }] };
    expect(validateWebVerdict(plain, together, context).verdict).not.toBe("same");
  });
  it("«Hijo» o «Jr.» en un solo nombre impide fusionar, aunque la cita contenga los dos nombres", () => {
    const context = { names: ["Juan Vicente Torrealba", "Juan Vicente Torrealba Hijo"] as [string, string], sharedProjects: ["Juan Vicente Torrealba"],
      projectsA: ["Juan Vicente Torrealba"], projectsB: ["Juan Vicente Torrealba"], eraConflict: null };
    const pages = [webPage("https://sincopa.example/concierto", "Concierto Romántico", "Juan Vicente Torrealba: arpa. Baby Bass: Juan Vicente Torrealba hijo.")];
    const proposal: WebVerdict = { verdict: "same", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Baby Bass: Juan Vicente Torrealba hijo.", supports: "same" }] };
    expect(validateWebVerdict(proposal, pages, context).verdict).toBe("unknown");
  });
  it("una duración no es una edad («a working relationship that lasted 21 years»)", () => {
    const context = { names: ["Iván Velázquez", "Iván Velásquez"] as [string, string], sharedProjects: [],
      projectsA: ["Vytas Brenner"], projectsB: ["Franco De Vita"], yearsA: [1971], yearsB: [1988], eraConflict: null };
    const pages = [
      webPage("https://bio.example/ivan", "Iván Velásquez", "Iván Velásquez tocó la batería con Vytas Brenner. In 1987 he started a working relationship with Franco De Vita that lasted 21 years."),
      webPage("https://otra.example/ivan", "Iván Velázquez", "Iván Velázquez, baterista de Franco De Vita y de Vytas Brenner."),
    ];
    const proposal: WebVerdict = { verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "In 1987 he started a working relationship with Franco De Vita that lasted 21 years.", supports: "different" }] };
    expect(validateWebVerdict(proposal, pages, context).verdict).not.toBe("different");
  });
  it("los 40 discos que ve el modelo cubren toda la carrera y traen las firmas raras", () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({ name: "Hernán Gamboa", album: `Disco ${index}`, year: 1971 + Math.floor(index / 3),
      role: "Cuatro", credited: ["Hernán Gamboa"] }));
    rows.push({ name: "Hernán Gamboa", album: "Mis Aguinaldos", year: 2007, role: "Vocals", credited: ["Hernán Gamboa Jr."] });
    rows.sort((x, y) => x.year - y.year);
    const picked = pickProjects(rows, "Hernán Gamboa");
    expect(picked).toHaveLength(40);
    expect(picked.some((row) => row.album === "Mis Aguinaldos")).toBe(true);
    expect(picked[0]!.year).toBe(1971);
    expect(picked.at(-1)!.year).toBe(2010);
    expect(pickProjects(rows.slice(0, 10), "Hernán Gamboa")).toHaveLength(10);
  });
  it("la ficha junta al de la página con su pariente cuando los créditos firman con el nombre del pariente", () => {
    const romero: PersonContext = { id: -4, name: "José Romero", birthDate: null, deathDate: null, sourceUrls: [], projects: [
      { name: "Adilia Castillo", album: "Rosalinda", year: 1972, role: "composer", credited: ["José Romero"] },
      { name: "Rudy Márquez", album: "Háblame Suavemente", year: 1972, role: "Guitar", credited: ["Joseito Romero"] }] };
    const pages = [
      webPage("https://historia.example/jose-romero-bello", "JOSÉ ROMERO BELLO - Historia", "José Romero Bello compuso para Adilia Castillo. Tuvo un hijo, José (Joseíto Romero), arpista."),
      webPage("https://rock.example/rudy-marquez", "Rudy Márquez", "En Háblame Suavemente toca la guitarra José Romero con Rudy Márquez."),
    ];
    const proposal = webVerdictSchema.parse({ verdict: "mixed", rationale: "Padre e hijo", groups: [
      { label: "José Romero Bello", projects: ["Adilia Castillo"], source: 0, quote: "José Romero Bello compuso para Adilia Castillo." },
      { label: "Guitarrista de Rudy Márquez", projects: ["Rudy Márquez"], source: 1, quote: "toca la guitarra José Romero con Rudy Márquez" }],
      evidence: [{ source: 0, quote: "Tuvo un hijo, José (Joseíto Romero), arpista.", supports: "mixed" }] });
    const result = validateMixedGroups(proposal, pages, romero, { eraSplit: false });
    expect(result.verdict).toBe("mixed");
    expect(result.rationale).toContain("joseito");
    // Si los créditos no firman «Joseito», el parentesco solo no dice qué discos son del hijo.
    const unsigned = { ...romero, projects: romero.projects.map((item) => ({ ...item, credited: ["José Romero"] })) };
    expect(validateMixedGroups(proposal, pages, unsigned, { eraSplit: false }).verdict).toBe("unknown");
  });
});
