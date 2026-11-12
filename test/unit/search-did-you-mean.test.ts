import { describe, expect, it } from "vitest";
import { allowedDistance, MIN_LENGTH, plausibleShape, buildFuzzyIndex, comparableKeys, didYouMeanEnabled, osaDistance, stripStopwords, suggest, type FuzzyEntry } from "../../src/search/did-you-mean.js";

const entry = (id: number, name: string, keys: string[], weight = 1): FuzzyEntry => ({ id, name, keys, weight });
const artists = buildFuzzyIndex("artist", [
  entry(1, "Caramelos De Cianuro", ["caramelos de cianuro"], 40),
  entry(2, "Desorden Público", ["desorden publico", "dp"], 90),
  entry(3, "Zapato 3", ["zapato 3"], 30),
  entry(4, "Los Amigos Invisibles", ["los amigos invisibles"], 60),
]);

describe("distancia de edición acotada", () => {
  it("cuenta borrar, insertar, sustituir e intercambiar letras contiguas como una edición", () => {
    expect(osaDistance("carameo", "caramelo", 2)).toBe(1);
    expect(osaDistance("caramelo", "carmaelo", 2)).toBe(1);
    expect(osaDistance("caramelo", "carametlo", 2)).toBe(1);
    expect(osaDistance("caramelo", "caramalo", 2)).toBe(1);
    expect(osaDistance("abc", "abc", 2)).toBe(0);
  });
  it("devuelve max+1 cuando se pasa, sin terminar la tabla", () => {
    expect(osaDistance("rock", "salsa", 1)).toBe(2);
    expect(osaDistance("a", "abcdef", 2)).toBe(3);
  });
});

describe("umbrales", () => {
  it("no hay tolerancia por debajo de 5 letras y crece con el largo", () => {
    expect(allowedDistance(4)).toBe(-1);
    expect([5, 8, 9, 13, 14, 30].map(allowedDistance)).toEqual([1, 1, 2, 2, 3, 3]);
  });
  it("quita artículos y conectores, pero no deja la clave vacía", () => {
    expect(stripStopwords("caramelos de cianuro")).toBe("caramelos cianuro");
    expect(stripStopwords("el de la")).toBe("el de la");
  });
});

describe("sugerencias", () => {
  it("encuentra el artista con una errata («carameo de cianuro») y con el «de» omitido", () => {
    expect(suggest("carameo de cianuro", [artists])[0]).toMatchObject({ id: 1, name: "Caramelos De Cianuro" });
    expect(suggest("caramelo de cianuro", [artists])[0]?.id).toBe(1);
    expect(suggest("caramelos cianuro", [artists])[0]).toMatchObject({ id: 1, distance: 0 });
  });
  it("no sugiere nada con consultas de 4 letras o menos ni cuando nada está cerca", () => {
    expect(suggest("zapa", [artists])).toEqual([]);
    expect(suggest("musica triste para estudiar", [artists])).toEqual([]);
  });
  it("ordena por distancia, luego por tipo y por peso, sin repetir nombres", () => {
    const albums = buildFuzzyIndex("album", [entry(10, "Desorden Publico", ["desorden publico", "desorden", "desorden publico desorden"], 5)]);
    const found = suggest("desorden publiko", [albums, artists]);
    expect(found.map(item => `${item.kind}:${item.id}`)).toEqual(["artist:2"]); // el disco homónimo no repite el nombre
  });
  it("en los discos no compara la clave del artista: un artista mal escrito no sugiere sus discos", () => {
    const keys = ["abismo", "caramelos de cianuro", "abismo caramelos de cianuro", "abismo alias"];
    expect(comparableKeys("album", keys)).toEqual(["abismo", "abismo alias"]);
    const albums = buildFuzzyIndex("album", [entry(20, "Abismo", keys)]);
    expect(suggest("carameo de cianuro", [albums])).toEqual([]);
  });
  it("no toca una consulta que ya tiene coincidencia exacta (distancia 0 solo por artículos)", () => {
    const found = suggest("caramelos de cianuro", [artists]);
    expect(found[0]?.distance).toBe(0);
  });
});

describe("una errata no es una frase distinta (0.2.0)", () => {
  const many = buildFuzzyIndex("track", [
    entry(1, "Canciones De Amor", ["canciones de amor"], 9), entry(2, "Un Buen Venezolano", ["un buen venezolano"], 9),
    entry(3, "Música En Ti", ["musica en ti"], 9), entry(4, "Venezuela", ["venezuela"], 9), entry(5, "Lo Blanco Del Ojo", ["lo blanco del ojo"], 9),
    entry(6, "Pocz & Pacheko", ["pocz pacheko"], 9),
  ]);
  it("rechaza palabras cambiadas por otras distintas", () => {
    expect(suggest("canciones de zoo", [many])).toEqual([]);
    expect(suggest("blues venezolano", [many])).toEqual([]);
    expect(suggest("musica de los 60", [many])).toEqual([]);
  });
  it("rechaza letras añadidas al final («venezueladw» no es «venezuela»), pero acepta una sola", () => {
    expect(plausibleShape("venezueladw", "venezuela")).toBe(false);
    expect(plausibleShape("venezuelas", "venezuela")).toBe(true);
  });
  it("tolera espacios mal puestos y errata en una palabra larga", () => {
    expect(suggest("loblancodelojo", [many])[0]?.id).toBe(5);
    expect(suggest("ppocz pacheko", [many])[0]?.id).toBe(6);
    expect(suggest("canciones de amr", [many])[0]?.id).toBe(1);
  });
  it("a igual distancia prefiere el nombre propio al alias", () => {
    const idx = buildFuzzyIndex("artist", [entry(1, "Natastor", ["natastor", "abdon"], 99), entry(2, "Abaddon", ["abaddon"], 1)]);
    expect(suggest("abddon", [idx]).map(item => item.id)).toEqual([2, 1]);
  });
});

describe("bandera", () => {
  it("está apagada salvo CRV_DID_YOU_MEAN=on", () => {
    expect(didYouMeanEnabled({})).toBe(false);
    expect(didYouMeanEnabled({ CRV_DID_YOU_MEAN: "1" })).toBe(false);
    expect(didYouMeanEnabled({ CRV_DID_YOU_MEAN: "on" })).toBe(true);
  });
});

describe("el filtro de firmas no pierde coincidencias", () => {
  it("da lo mismo que comparar todo con la distancia exacta (semilla fija)", () => {
    let seed = 7;
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const word = () => Array.from({ length: 2 + Math.floor(next() * 3) }, () => Array.from({ length: 3 + Math.floor(next() * 6) }, () => "abcdeilmnoprstu"[Math.floor(next() * 15)]).join("")).join(" ");
    const names = Array.from({ length: 400 }, word);
    const index = buildFuzzyIndex("artist", names.map((name, i) => entry(i + 1, name, [name], 1)));
    for (let n = 0; n < 150; n++) {
      const base = names[Math.floor(next() * names.length)]!;
      const i = Math.floor(next() * base.length);
      const needle = (n % 3 === 0 ? base.slice(0, i) + base.slice(i + 1) : n % 3 === 1 ? base.slice(0, i) + "x" + base.slice(i + 1) : base.slice(0, i) + base[i + 1] + base[i] + base.slice(i + 2)).replace(/\s+/g, " ").trim();
      if (needle.length < MIN_LENGTH) continue;
      const max = allowedDistance(needle.length);
      const raw = new Set(names.map((name, k) => [k, name] as const).filter(([, name]) => osaDistance(needle, name, max) <= max && plausibleShape(needle, name)).map(([k]) => k + 1));
      const viaIndex = new Set(suggest(needle, [index], 1000).filter(item => item.distance <= max).map(item => item.id));
      for (const id of raw) expect(viaIndex.has(id), `${needle} → ${names[id - 1]}`).toBe(true);
    }
  });
});
