import { describe, expect, it } from "vitest";
import { aliveOnly, combinedName, findLinks, foreignCreditForms, foreignCredits, givenCompatible, incompatibleNames, namesakeFamily, namesakeRelative, pickProjects, nameForms, searchQueries, validateMixedGroups, validateWebVerdict, webVerdictSchema, type PersonContext, type WebVerdict } from "../../src/ambiguity/person-web-verification.js";
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
    // Apellido compuesto: «di marzo» solo no es un tocayo (fresca-5, Yordano separado por su hermano Evio).
    expect(namesakeFamily("Giordano Di Marzo. Profile: Venezuelan singer. Brother of Evio Di Marzo. Credits: Written-By – Yordano",
      ["Yordano", "Giordano Di Marzo"])).toBe(false);
    expect(namesakeFamily("Oscar De León, father of Oscar De León Jr.", ["Oscar De León"])).toBe(true);
    // Seudónimo junto al parentesco: es una sola persona (fresca-5, Boston Rex, hijo de Ramón Goitia).
    expect(namesakeFamily("Para Ramón Goitia y Argelia Lugo, su hijo menor Reynaldo Goitia, mejor conocido como Boston Rex, vocalista",
      ["Boston Rex", "Reynaldo Goitía"])).toBe(false);
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
  it("cada forma ajena se investiga por turno: «El Enano» y «Rubén «El Enano» Castro» (fresca-9, 2704)", () => {
    const enano: PersonContext = { id: -4, name: "Miguel Gonzáles", birthDate: null, deathDate: null, sourceUrls: [], projects: [
      { name: "Naxxo", album: "Piloto", year: 2006, role: "Guitar Loop", credited: ["El Enano"] },
      { name: "Naxxo", album: "Otro", year: 2007, role: "Guitar", credited: ["El Enano"] },
      { name: "Almas", album: "Permiso Para Despegar", year: 2011, role: "Vocals & Guitar", credited: ['Rubén "El Enano" Castro'] },
      { name: "Caramelos De Cianuro", album: "Frisbee", year: 2002, role: "Guitars", credited: ["Miguel González"] }] };
    const forms = foreignCreditForms(enano);
    expect(forms.map((form) => form.name)).toContain('Rubén "El Enano" Castro');
    expect(forms.find((form) => form.name === 'Rubén "El Enano" Castro')?.foreign.map((item) => item.name)).toEqual(["Almas"]);
  });
  it("otro nombre de pila con el mismo apellido, o un apodo que no sale en el nombre, son formas ajenas (fresca-8/9)", () => {
    const ezlen: PersonContext = { id: -5, name: "Ezlen Ramos", birthDate: "1987-05-19", deathDate: null, sourceUrls: [], projects: [
      { name: "Larry Jean Louis", album: "Reaching The Promise", year: 2003, role: "Timple", credited: ["José Antonio Ramos"] },
      { name: "Hiena", album: "Involución", year: 2013, role: "Drums", credited: ["Ezlen Ramos"] }] };
    expect(foreignCredits(ezlen)?.name).toBe("José Antonio Ramos");
    const pipo: PersonContext = { id: -6, name: "Francisco Gonzalez", birthDate: null, deathDate: null, sourceUrls: [], projects: [
      { name: "Huáscar Barradas", album: "Encuentros", year: 2004, role: "Raps", credited: ["Pipo"] },
      { name: "Nauta", album: "Al Natural", year: 2011, role: "composer", credited: ["Francisco Gonzalez"] }] };
    expect(foreignCredits(pipo)?.name).toBe("Pipo");
    // El apodo que ya está en el nombre, o el nombre de pila suelto, no es ajeno.
    const chino: PersonContext = { id: -7, name: 'Pablo "Chino" Agreda', birthDate: null, deathDate: null, sourceUrls: [], projects: [
      { name: "Grupo X", album: "Uno", year: 1990, role: "Bass", credited: ["Chino"] },
      { name: "Grupo Y", album: "Dos", year: 1995, role: "Bass", credited: ["Pablo"] },
      { name: "Grupo Z", album: "Tres", year: 2000, role: "Bass", credited: ["Pablo Agreda"] }] };
    expect(foreignCredits(chino)).toBeNull();
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
  it("hermanos con el apellido y la banda: la lista de integrantes no los fusiona (fresca-6, Lamberti)", () => {
    const context = { names: ["Edgar Lamberti", 'Gabriel "Pepo" Lamberti'] as [string, string], sharedProjects: ["Andreazulado"],
      projectsA: ["Andreazulado"], projectsB: ["Andreazulado", "Alfred Gómez Jr."], eraConflict: null };
    const pages = [webPage("https://lobotoradio.example/andreazulado", "Andreazulado", "Los miembros originales fueron Édgar Lamberti (voz, guitarra) y Gabriel Lamberti (Pepo) (voz líder, bajo), de Andreazulado."),
      webPage("https://sincopa.example/despegue", "Andreazulado - Despegue Eterno", "Vocals, Bass & Guitar: Gabriel Lamberti. Guitar & Backing Vocals: Edgar Lamberti. Andreazulado.")];
    const proposal: WebVerdict = { verdict: "same", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Los miembros originales fueron Édgar Lamberti (voz, guitarra) y Gabriel Lamberti (Pepo) (voz líder, bajo), de Andreazulado.", supports: "same" }] };
    expect(validateWebVerdict(proposal, pages, context).verdict).not.toBe("same");
  });
  it("las variantes de nombre de Discogs no separan al Jr. de la otra ficha (fresca-6, Pedro Junco)", () => {
    const context = { names: ["Pedro Junco", "Pedro Junco Jr."] as [string, string], sharedProjects: [],
      projectsA: ["Los Melódicos"], projectsB: ["Los Blanco"], eraConflict: null };
    const variations = "Variations: Junco Jr., P. Junco, Pedro Junco, Pedro Junco Jnr, Pedro Junco, Jr.";
    const pages = [webPage("https://www.discogs.com/artist/1186133", "Pedro Junco Jr. | Discogs", `Pedro Junco Jr. ${variations}`),
      webPage("https://sincopa.example/melodicos", "Los Melódicos", "Nosotros (Pedro Junco), Los Melódicos."),
      webPage("https://sincopa.example/blanco", "Los Blanco", "Nosotros (Pedro Junco Jr.), Los Blanco.")];
    const proposal: WebVerdict = { verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: variations, supports: "different" }] };
    expect(validateWebVerdict(proposal, pages, context).verdict).not.toBe("different");
  });
  it("seudónimo con «nacido» o entre paréntesis une las fichas (fresca-7, Ilan Chester y Negrito Man)", () => {
    const ilan = { names: ["Ilan Chéster", "Ilan Czenstochouski Schechter"] as [string, string], sharedProjects: [],
      projectsA: ["Huáscar Barradas & Maracaibo"], projectsB: ["Melao", "Ananta"], eraConflict: null };
    const ilanPages = [webPage("https://lobotoradio.example/ilan", "Ilan Chester", "Ilan Chéster (nacido Ilan Czenstochouski Schechter) es un músico venezolano. Fundó Melao y grabó con Huáscar Barradas & Maracaibo."),
      webPage("https://otra.example/ilan", "Ilan Czenstochouski Schechter", "Ilan Czenstochouski Schechter grabó Ananta.")];
    expect(validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Ilan Chéster (nacido Ilan Czenstochouski Schechter) es un músico venezolano.", supports: "same" }] }, ilanPages, ilan).verdict).toBe("same");
    const negrito = { names: ["Negrito Man", "Luis Eduardo Blanco"] as [string, string], sharedProjects: [],
      projectsA: ["Electrotribal"], projectsB: ["King Changó", "Mata Rica"], eraConflict: null };
    const negritoPages = [webPage("https://en.wikipedia.example/king", "King Changó", "Luis Eduardo Blanco, (Negrito Man) – keyboard, cuatro and percussion in King Changó."),
      webPage("https://sincopa.example/electrotribal", "Electrotribal", "track 3 by Luis Eduardo Blanco \"Negrito Man\". Negrito Man canta en Electrotribal.")];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Luis Eduardo Blanco, (Negrito Man) – keyboard, cuatro and percussion", supports: "same" }] }, negritoPages, negrito).verdict).toBe("same");
  });
  it("un nombre artístico de una palabra no se fusiona por una lista de integrantes (fresca-7, Jarz y Nilz)", () => {
    const context = { names: ["Jarzen Arcia", "Nilz"] as [string, string], sharedProjects: ["Billy Se Fue"],
      projectsA: ["Billy Se Fue"], projectsB: ["Billy Se Fue"], eraConflict: null };
    const pages = [webPage("https://venciclopedia.example/billy", "Billy Se Fue", "Billy Se Fue fue formada por Alejandro Estrada \"Alz\" (voz), Neil Enet \"Nilz\" (bajo) y Liz (guitarra). Jarzen Arcia \"Jarz\" (guitarra) se unió en el 2001.")];
    expect(validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Neil Enet \"Nilz\" (bajo) y Liz (guitarra). Jarzen Arcia \"Jarz\" (guitarra) se unió en el 2001.", supports: "same" }] }, pages, context).verdict).not.toBe("same");
  });
  it("otro segundo nombre no es un tocayo: el padre Pedro Francisco no mezcla a «Pedro V. Lizardo» (fresca-7)", () => {
    expect(givenCompatible("Pedro Francisco Lizardo", "Pedro V. Lizardo")).toBe(false);
    expect(givenCompatible("Pedro Vicente Lizardo", "Pedro V. Lizardo")).toBe(true);
    expect(givenCompatible("Mauricio Castro", "Mauricio Castro Rodríguez")).toBe(true);
    expect(namesakeFamily("PTT (Pedro Vicente Lizardo) Cantautor. Hijo del poeta Pedro Francisco Lizardo y de doña Gisela Fernández.", ["Pedro V. Lizardo"])).toBe(false);
    // Con el título que repite el seudónimo (fresca-5, Boston Rex).
    expect(namesakeFamily("La eterna vigencia de Boston Rex. Para Ramón Goitia, su hijo menor Reynaldo Goitia, mejor conocido como Boston Rex",
      ["Boston Rex", "Reynaldo Goitía"])).toBe(false);
  });
  it("«Jr.» separa solo si la frase enumera a los dos, no si nombra dos veces al mismo autor (fresca-6, Pedro Junco)", () => {
    const gamboa = { names: ["Hernán Gamboa", "Hernán Gamboa Jr."] as [string, string], sharedProjects: [],
      projectsA: ["Serenata Guayanesa"], projectsB: ["Mis Aguinaldos"], eraConflict: null };
    const gamboaPages = [webPage("https://sincopa.example/aguinaldos", "Mis Aguinaldos", "Vocals: Hernán Gamboa y Hernán Gamboa Jr. Mis Aguinaldos (2007)."),
      webPage("https://otra.example/serenata", "Serenata Guayanesa", "Hernán Gamboa fundó Serenata Guayanesa.")];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Vocals: Hernán Gamboa y Hernán Gamboa Jr.", supports: "different" }] }, gamboaPages, gamboa).verdict).toBe("different");
    const junco = { names: ["Pedro Junco", "Pedro Junco Jr."] as [string, string], sharedProjects: [],
      projectsA: ["Los Melódicos"], projectsB: ["Los Blanco"], eraConflict: null };
    const juncoPages = [webPage("https://youtube.example/nosotros", "Nosotros", "“NOSOTROS“ “Pedro Junco“ Nosotros-Bolero tocado al piano por su autor, Pedro Junco Jr. Los Melódicos y Los Blanco la grabaron.")];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "“NOSOTROS“ “Pedro Junco“ Nosotros-Bolero tocado al piano por su autor, Pedro Junco Jr.", supports: "different" }] }, juncoPages, junco).verdict).not.toBe("different");
  });
  it("el parentesco o la etiqueta de crédito entre las dos menciones también separa al Jr. (fresca-5, Montaner y Adelso Paz)", () => {
    const montaner = { names: ["Ricardo Montaner", "Ricardo Montaner Jr."] as [string, string], sharedProjects: [],
      projectsA: ["Cada Día"], projectsB: ["Mau y Ricky"], eraConflict: null };
    const montanerPages = [webPage("https://def.example/hermano", "Hermano", "Otro ejemplo de hermanos son Evaluna Montaner, Ricardo Montaner Jr., Héctor Montaner, Alejandro Montaner y Mauricio Montaner, los hijos del cantante Ricardo Montaner y Marlene Rodríguez."),
      webPage("https://bio.example/montaner", "Ricardo Montaner", "Ricardo Montaner publicó Cada Día en 1983."),
      webPage("https://bio.example/mauyricky", "Mau y Ricky", "Mau y Ricky: Ricardo Montaner Jr. y su hermano Mauricio.")];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Otro ejemplo de hermanos son Evaluna Montaner, Ricardo Montaner Jr., Héctor Montaner, Alejandro Montaner y Mauricio Montaner, los hijos del cantante Ricardo Montaner y Marlene Rodríguez.", supports: "different" }] },
      montanerPages, montaner).verdict).toBe("different");
    const paz = { names: ["Adelso Paz", "Adelso Paz Jr."] as [string, string], sharedProjects: [],
      projectsA: ["Rondalla Venezolana"], projectsB: ["Rondalla Venezolana"], eraConflict: null };
    const pazPages = [webPage("https://sincopa.example/rondalla", "Rondalla Venezolana", "Cuatro: Adelso Paz Maracas: Adelso Paz Jr. Rondalla Venezolana.")];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Cuatro: Adelso Paz Maracas: Adelso Paz Jr.", supports: "different" }] }, pazPages, paz).verdict).toBe("different");
    // «Jr.» y «hijo» son la misma marca: no es padre frente a hijo.
    const same = { names: ["Adelso Paz Jr.", "Adelso Paz hijo"] as [string, string], sharedProjects: ["Rondalla Venezolana"],
      projectsA: ["Rondalla Venezolana"], projectsB: ["Rondalla Venezolana"], eraConflict: null };
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Cuatro: Adelso Paz Maracas: Adelso Paz Jr.", supports: "different" }] }, pazPages, same).verdict).not.toBe("different");
  });
  it("la página titulada con un nombre y «nombre completo: …» con el otro es un puente (fresca-7, Ilan Chester)", () => {
    const context = { names: ["Ilan Chester", "Ilan Czenstochouski Schechter"] as [string, string], sharedProjects: [],
      projectsA: ["Franco De Vita"], projectsB: ["Azúcar, Cacao & Leche"], eraConflict: null };
    const quote = "nombre completo: Ilan Czenstochouski Schechter alias: El Músico de Venezuela nacimiento: 1952-07-30";
    const sides = [webPage("https://a.example/1", "Franco De Vita", "Ilan Chester tocó los teclados con Franco De Vita."),
      webPage("https://b.example/2", "Azúcar, Cacao & Leche", "Ilan Czenstochouski Schechter tocó en Azúcar, Cacao & Leche.")];
    const titled = [webPage("https://lobotoradio.example/ilan", "Ilan Chéster – Lobotoradio", `${quote}.`), ...sides];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote, supports: "different" }] },
      titled, context).verdict).not.toBe("different");
    // Sin la ficha en el título no hay puente: la página de un grupo no dice de quién es el nombre completo.
    const band = [webPage("https://lobotoradio.example/azucar", "Azúcar, Cacao & Leche – Lobotoradio", `${quote}.`), ...sides];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote, supports: "different" }] },
      band, context).verdict).toBe("different");
  });
  it("el apodo entre nombre y apellido une «Nene Quintero» con «Carlos Quintero» aunque los nombres de pila difieran (difícil)", () => {
    const context = { names: ["Nene Quintero", "Carlos Quintero"] as [string, string], sharedProjects: [],
      projectsA: ["Onechot"], projectsB: ["Los Dementes"], eraConflict: null };
    const quote = "Carlos \"Nené\" Quintero, percusionista, grabó con Los Dementes en 1966 y con Onechot en 2009.";
    const pages = [webPage("https://sincopa.example/nene", "Carlos \"Nene\" Quintero - Bio", quote),
      webPage("https://genius.example/left-right", "Onechot – Left Right", "Onechot – Left Right. Featuring Patafunk & Nene Quintero."),
      webPage("https://archivo.example/dementes", "Los Dementes", "Los Dementes (1966): Carlos Quintero, congas.")];
    expect(validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote, supports: "same" }] },
      pages, context).verdict).toBe("same");
  });
  it("el apodo entre comillas no tapa el nombre al buscar la liga con el proyecto (fresca-8, Willy Noya)", () => {
    const page = webPage("https://big.example/landin", "La Big Landin Orquesta", "Guillermo \"Willy\" Noya toca el trombón en La Big Landin Orquesta.");
    expect(findLinks([page], nameForms("Guillermo Noya"), ["big landin orquesta"])).toHaveLength(1);
    expect(findLinks([page], nameForms("Willy Noya"), ["big landin orquesta"])).toHaveLength(1);
    // Sin comillas es otro nombre de pila en medio y no se toma («Carlos Alberto Quintero» no es «Carlos Quintero»).
    const other = webPage("https://beat.example/3", "Los Beat3", "Carlos Alberto Quintero toca el bajo en Los Beat3.");
    expect(findLinks([other], nameForms("Carlos Quintero"), ["los beat3"])).toHaveLength(0);
  });
  it("el encabezado «Nombre real: Nombre artístico» une las dos formas (fresca-1, Mayra Martí)", () => {
    const context = { names: ["Mayra Martí", "Moira Elisa Martínez Álvarez"] as [string, string], sharedProjects: [],
      projectsA: ["Gogoteca"], projectsB: ["Venezuela y sus Intérpretes"], eraConflict: null };
    const quote = "La abogada, locutora, juez penal, docente y cantante Moira Elisa Martínez Álvarez: Mayra Martí, nació en Puerto La Cruz, Edo. Anzoátegui, el 2 de junio de 1954.";
    const pages = [webPage("https://historia.example/mayra", "Moira Elisa Martínez Álvarez: Mayra Martí", `${quote} Grabó en Gogoteca (1968).`),
      webPage("https://disco.example/interpretes", "Venezuela y sus Intérpretes", "Moira Elisa Martínez Álvarez cantó en Venezuela y sus Intérpretes (1969).")];
    expect(validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote, supports: "same" }] },
      pages, context).verdict).toBe("same");
    // Sin puente, los hermanos de una lista siguen sin fusionarse (Lamberti, más arriba).
  });
  it("dos nombres de pila del mismo apellido enumerados por separado son dos personas (fresca-6, Lamberti)", () => {
    const context = { names: ["Edgar Lamberti", "Gabriel «Pepo» Lamberti"] as [string, string], sharedProjects: ["Los Hermanos Lamberti"],
      projectsA: ["Los Hermanos Lamberti"], projectsB: ["Los Hermanos Lamberti"], eraConflict: null };
    const quote = "Los Hermanos Lamberti: Édgar Lamberti (voz) y Gabriel Lamberti (bajo), hermanos de Caracas.";
    const pages = [webPage("https://rock.example/lamberti", "Los Hermanos Lamberti", quote)];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote, supports: "different" }] },
      pages, context).verdict).toBe("different");
    // Sin esa frase, otro nombre de pila no separa («Nene Quintero» / «Carlos Quintero»).
    const nene = { names: ["Nene Quintero", "Carlos Quintero"] as [string, string], sharedProjects: [],
      projectsA: ["Onechot"], projectsB: ["Los Dementes"], eraConflict: null };
    const nenePages = [webPage("https://genius.example/lr", "Onechot – Left Right", "Onechot – Left Right. Featuring Patafunk & Nene Quintero."),
      webPage("https://archivo.example/dementes", "Los Dementes", "Los Dementes (1966): Carlos Quintero, congas.")];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Onechot – Left Right. Featuring Patafunk & Nene Quintero.", supports: "different" }] }, nenePages, nene).verdict).not.toBe("different");
  });
  it("una lista con otros nombres en medio enumera al padre y al hijo (fresca-6, Juan V. Torrealba)", () => {
    const context = { names: ["Juan V. Torrealba", "Juan V. Torrealba Jr."] as [string, string], sharedProjects: [],
      projectsA: ["Juan Vicente Torrealba y Su Conjunto"], projectsB: ["Los Torrealberos"], eraConflict: null };
    const list = "Group: Los Torrealberos Juan Vicente Torrealba, Douglas T. Mardonio Tortolero, Henry Rubio & Juan Vicente Torrealba Jr.";
    const pages = [webPage("https://sincopa.example/18exitos", "Los Torrealberos - 18 Éxitos", list),
      webPage("https://sincopa.example/alma", "Los Torrealberos - Alma Llanera", "Maracas: Juan V. Torrealba Jr."),
      webPage("https://sincopa.example/conjunto", "Juan Vicente Torrealba y Su Conjunto - Clásicos", "Arpa y dirección: Juan V. Torrealba.")];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote: list, supports: "different" }] },
      pages, context).verdict).toBe("different");
    // El mismo nombre en frases distintas no es una lista: «Produced by Pedro Junco Jr. Written by Pedro Junco.»
    const junco = { names: ["Pedro Junco", "Pedro Junco Jr."] as [string, string], sharedProjects: [],
      projectsA: ["Los Melódicos"], projectsB: ["Los Blanco"], eraConflict: null };
    const juncoPages = [webPage("https://sincopa.example/melodicos", "Los Melódicos", "Nosotros. Produced by Pedro Junco Jr. Written by Pedro Junco, Los Melódicos."),
      webPage("https://sincopa.example/blanco", "Los Blanco", "Nosotros (Pedro Junco Jr.), Los Blanco. Pedro Junco Jr. compuso Nosotros, que grabó Pedro Junco.")];
    expect(validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 1, quote: "Nosotros (Pedro Junco Jr.), Los Blanco.", supports: "different" }] }, juncoPages, junco).verdict).not.toBe("different");
  });
  it("el apodo con letras sueltas entre nombre y apellido une las fichas (fresca-7, G-Zaz)", () => {
    const context = { names: ["G-Zaz", "Jesús Romero"] as [string, string], sharedProjects: [],
      projectsA: ["Kontrol Remoto"], projectsB: ["God's New Version"], eraConflict: null };
    const quote = "God´s New Version es un proyecto musical que forman Andrés Morillo (guitarra, voz) y Jesús «G-zaz» Romero (teclados, programación).";
    const pages = [webPage("https://rockhecho.example/gnv", "God's New Version", `${quote} Formación: Andrés Morillo, Jesús Romero.`)];
    expect(validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote, supports: "same" }] },
      pages, context).verdict).toBe("same");
    // Sin el apodo entre nombre y apellido, una lista con los dos nombres no los une.
    const list = "Formación: Andrés Morillo, Jesús Romero, G-Zaz.";
    expect(validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote: list, supports: "same" }] },
      [webPage("https://rockhecho.example/gnv", "God's New Version", list)], context).verdict).not.toBe("same");
  });
  it("con el nombre más un apodo, una página con los proyectos de las dos fichas y otro sitio las une (fresca-6, Diquez)", () => {
    const context = { names: ["Manuel Diquez", "Manuel «Manny» Diquez"] as [string, string], sharedProjects: [],
      projectsA: ["Franco De Vita", "Roque Valero"], projectsB: ["Ultrachic", "Caramelos De Cianuro"], eraConflict: null };
    const bio = "Tras su tránsito por la agrupación UltraChic, el músico venezolano Manuel Diquez, que ha acompañado como vocalista a Franco De Vita, retoma su carrera.";
    const pages = [webPage("https://rumberos.example/diquez", "Manuel Diquez", bio),
      webPage("https://sincopa.example/insomnio", "Roque Valero - Insomnio", "Co-Producers: Manuel Diquez, Salomón Lerner & Jorge Luis Chasín")];
    const proposal = (quote: string): WebVerdict => ({ verdict: "same", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote, supports: "same" }] });
    expect(validateWebVerdict(proposal(bio), pages, context).verdict).toBe("same");
    // Discogs junta homónimos: su página con los dos proyectos no basta.
    const discogs = "Manuel Diquez. Credits: Guitar – Franco De Vita – En Primera Fila; Keyboards – Caramelos De Cianuro – Miss Mujerzuela.";
    expect(validateWebVerdict(proposal(discogs), [webPage("https://www.discogs.com/artist/1", "Manuel Diquez | Discogs", discogs), pages[1]!], context).verdict).not.toBe("same");
  });
  it("busca las dos formas juntas como las escriben las páginas (fresca-8 Noya, fresca-10 Machado)", () => {
    expect(combinedName("Guillermo Noya", "Willy Noya")).toBe("Guillermo Willy Noya");
    expect(combinedName("Angie Machado", "Angel Machado")).toBe("Angel Angie Machado");
    expect(combinedName("Francisco Tedesco", "Francisco «Chicho» Tedesco")).toBe("Francisco Chicho Tedesco");
    // Hermanos, generaciones y nombres que ya se buscan tal cual: no.
    expect(combinedName("Edgar Lamberti", 'Gabriel "Pepo" Lamberti')).toBeNull();
    expect(combinedName("Juan V. Torrealba", "Juan V. Torrealba Jr.")).toBeNull();
    expect(combinedName("René Toledo", "René L. Toledo")).toBeNull();
    expect(combinedName("G-Zaz", "Jesús Romero")).toBeNull();
  });
  it("«credited as» es una marca de alias: une nombres de pila distintos (fresca-10, Angie Machado)", () => {
    const context = { names: ["Angie Machado", "Angel Machado"] as [string, string], sharedProjects: [],
      projectsA: ["Trina Medina"], projectsB: ["Servando y Florentino"], eraConflict: null };
    const profile = 'Profile: Jazz latin salsa musician, great trumpeter and songwriter from Puerto Rico. Sometimes only credited as "Angel Machado", or Angie Marchado.';
    const pages = [webPage("https://sincopa.example/entrega", "Trina Medina - Entrega", "Trumpet: Luis Aquino, Angie Machado, Cusi Castillo & Elias Lopés"),
      webPage("https://sincopa.example/primera", "Servando y Florentino - Los Primera", "Trombone: Angel Machado"),
      webPage("https://www.discogs.com/artist/1280145-Angie-Machado", "Angie Machado Discography | Discogs", `Angie Machado. ${profile}`)];
    expect(validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [{ source: 2, quote: profile, supports: "same" }] },
      pages, context).verdict).toBe("same");
    // Sin esa frase, «Angie» y «Angel» con proyectos distintos no se unen.
    expect(validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [{ source: 1, quote: "Trombone: Angel Machado", supports: "same" }] },
      pages.slice(0, 2), context).verdict).not.toBe("same");
  });
  it("el teatro de un colegio es un lugar, no una edad (fresca-5, Gavidia)", () => {
    const context = { names: ["Yonathan Gavidia", "Yonathan «Morocho» Gavidia"] as [string, string], sharedProjects: [],
      projectsA: ["Eduardo Betancourt"], projectsB: ["Movida Acústica Urbana"], yearsA: [2001], yearsB: [2014, 2024], eraConflict: null };
    const setlist = "Movida Acústica Urbana Setlist at Teatro del Colegio Santa Rosa de Lima, Caracas, Venezuela";
    const pages = [webPage("https://www.setlist.fm/setlist/movida-acustica-urbana/2024/teatro", setlist, `${setlist}. Yonathan "Morocho" Gavidia, percusión.`),
      webPage("https://sincopa.example/adlibitum", "Eduardo Betancourt - Ad Libitum (2001)", "Percussion: Yonathan Gavidia. Eduardo Betancourt.")];
    const result = validateWebVerdict({ verdict: "different", rationale: "x", uncertainties: [], evidence: [{ source: 0, quote: setlist, supports: "different" }] }, pages, context);
    expect(result.verdict).not.toBe("different");
    expect(result.rationale).not.toMatch(/no pudo nacer/u);
  });
  it("nombre artístico y «nombre de pila»: no se separa, y con la nota de la persona se une (fresca-8, Al Zeppy)", () => {
    const context = { names: ["Al Zeppy", "Alberto Lewis"] as [string, string], sharedProjects: [],
      projectsA: ["Al Zeppy y Su Orquesta"], projectsB: ["Los Zeppy"], eraConflict: null };
    const blog = webPage("https://barraezo.example/al-zeppy", "Barraezo: Al Zeppy",
      "Al Zeppy y Su Orquesta grabó en Puerto Rico. Su nombre de pila es Alberto Lewis y formó parte del quinteto Los Zeppy, disuelto en 1962.");
    const zeppy = webPage("https://sincopa.example/zeppy", "Los Zeppy - Los Zeppy", "Vocals: Alberto Lewis, Estelita del Llano, José Luis Rodríguez & Nicolás Alvarado. Los Zeppy.");
    const proposal = (source: number, quote: string): WebVerdict => ({ verdict: "different", rationale: "x", uncertainties: [], evidence: [{ source, quote, supports: "different" }] });
    // El modelo no cita el puente, pero la página lo tiene: «apellidos distintos» no basta para separar.
    expect(validateWebVerdict(proposal(1, "Vocals: Alberto Lewis, Estelita del Llano, José Luis Rodríguez & Nicolás Alvarado."), [blog, zeppy], context).verdict).not.toBe("different");
    // La nota de su muerte lo nombra y dice «Alberto Lewis, su nombre de pila»: es la misma persona.
    const obituary = webPage("https://elnacional.example/al-zeppy", "Murió el cantante Al Zeppy a los 80 años",
      "Alberto Lewis, su nombre de pila, era hijo de padre norteamericano y madre venezolana. Formó Los Zeppy; luego Al Zeppy y Su Orquesta.");
    expect(validateWebVerdict({ verdict: "same", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Alberto Lewis, su nombre de pila, era hijo de padre norteamericano y madre venezolana.", supports: "same" }] },
      [obituary, zeppy], context).verdict).toBe("same");
  });
  it("el nombre real con el artístico entre comillas en una página impide separar (fresca-12, Nano Grand)", () => {
    const context = { names: ["Nano Grand", "Octavio Palacios"] as [string, string], sharedProjects: [],
      projectsA: ["Olegario Díaz"], projectsB: ["Frank Hernández"], eraConflict: null };
    const pages = [
      webPage("https://sincopa.example/oldi", "Olegario Díaz - Casi en El Guaire", "Vocals: María Fernanda Márquez, Nano Grand. Olegario Díaz."),
      webPage("https://palmera.example/pavo", "El Pavo en salsa", "Frank Hernández y su orquesta. Voz: Octavio Palacios \"Nano Grand\"."),
    ];
    const proposal: WebVerdict = { verdict: "different", rationale: "x", uncertainties: [], evidence: [
      { source: 0, quote: "Vocals: María Fernanda Márquez, Nano Grand.", supports: "different" }] };
    expect(validateWebVerdict(proposal, pages, context).verdict).not.toBe("different");
    // Sin ese puente, los apellidos distintos siguen separando.
    const plainPage = webPage("https://palmera.example/pavo", "El Pavo en salsa", "Frank Hernández y su orquesta. Voz: Octavio Palacios.");
    expect(validateWebVerdict(proposal, [pages[0]!, plainPage], context).verdict).toBe("different");
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
