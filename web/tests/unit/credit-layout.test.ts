import { describe, expect, it } from "vitest";
import { creditLines, isLeadVocals, joinList, orderMusicianBlocks, otherCreditsWithChannel } from "../../src/lib/creditLayout";
import type { Credit, CreditStatement } from "../../src/lib/types";

let nextId = 1;
const person = (personId: number, name: string, creditType: string, role: string): Credit => ({
  id: nextId++, creditType, role, personId, personName: name, artistId: null, artistName: null, organizationId: null, organizationName: null,
});
const org = (organizationId: number, name: string, creditType: string, role: string): Credit => ({
  id: nextId++, creditType, role, personId: null, personName: null, artistId: null, artistName: null, organizationId, organizationName: name,
});
const names = (line: { targets: Array<{ target: { name: string } | null; fallback: string }> }) => joinList(line.targets.map(({ target, fallback }) => target?.name ?? fallback));
const statement = (id: number, text: string, roleKey: string | null, entities: Array<{ name: string; personId?: number; organizationId?: number }>): CreditStatement => ({
  id, lineNumber: id, sectionKind: "other_credits", text, trackNumbers: [],
  parts: [
    ...(roleKey ? [{ start: 0, end: 1, type: "role", roleKey, personId: null, artistId: null, organizationId: null, placeId: null, year: null }] : []),
    ...entities.map((entity) => {
      const start = text.indexOf(entity.name);
      return { start, end: start + entity.name.length, type: entity.personId ? "person" : "organization", roleKey: null,
        personId: entity.personId ?? null, artistId: null, organizationId: entity.organizationId ?? null, placeId: null, year: null };
    }),
  ],
});

describe("créditos del disco, plan v2 etapa 4", () => {
  it("líneas «Rol by Nombre» agrupan los roles de cada persona (sin canal)", () => {
    const lines = creditLines([
      person(1, "Boris Milan", "mixing", "mixed"),
      org(9, "Estudios Mad Box", "recording", "recorded at"),
      person(1, "Boris Milan", "recording", "recorded"),
      person(2, "Caramelos De Cianuro", "producer", "produced"),
      org(9, "Estudios Mad Box", "mixing", "mixed at"),
      person(3, "Ana Pérez", "producer", "Executive Producer"),
    ]);
    const text = lines.map((line) => `${line.roles}${line.joiner === ":" ? ":" : ` ${line.joiner}`} ${names(line)}`);
    expect(text).toEqual([
      "Produced by Caramelos De Cianuro",
      "Executive Producer: Ana Pérez",
      "Recorded & Mixed by Boris Milan",
      "Recorded & Mixed at Estudios Mad Box",
    ]);
  });

  it("el prefijo «Track 8» pasa a alcance y no se mezcla con lo de todo el disco", () => {
    const lines = creditLines([person(1, "Boris Milan", "mixing", "Track 8 Recorded & Mixed by"), person(1, "Boris Milan", "mastering", "mastered")]);
    expect(lines.map((line) => [line.roles, line.scope])).toEqual([["Mastered", null], ["Recorded & Mixed", "pista 8"]]);
  });

  it("con canal: sin columna Producción; Composición y Arte no se repiten; lo no nombrado se queda", () => {
    const byType = {
      producer: [person(2, "Diego Márquez", "producer", "produced")],
      recording: [org(7, "Estudio Fantasma", "recording", "recorded at")],
      composer: [person(5, "Asier Cazalis", "composer", "composed")],
      artwork: [person(6, "Pablo Martínez", "artwork", "graphic design")],
      other: [person(8, "El Beibi", "other", "Kid Cry")],
    };
    const plan = otherCreditsWithChannel([
      statement(1, "Produced by Diego Márquez", "producer", [{ name: "Diego Márquez", personId: 2 }]),
      statement(2, "Composed by Asier Cazalis", "composer", [{ name: "Asier Cazalis", personId: 5 }]),
      statement(3, "Graphic Design: Pablo Martinez", "artwork", [{ name: "Pablo Martinez" }]),
      statement(4, "Photos: Nadie Conocido", "photography", [{ name: "Nadie Conocido", personId: 99 }]),
      statement(5, "Produced by Diego Márquez", "producer", [{ name: "Diego Márquez", personId: 2 }]),
    ], byType, {});
    expect(plan.statements.map((item) => item.text)).toEqual(["Produced by Diego Márquez", "Photos: Nadie Conocido"]);
    expect(plan.lines.map((line) => `${line.roles} ${line.joiner} ${names(line)}`)).toEqual(["Recorded at Estudio Fantasma", "Kid Cry : El Beibi"]);
  });

  it("músicos: Lead Vocals primero, luego el bloque más grande; dentro, el nombre más largo", () => {
    const blocks = orderMusicianBlocks([
      { role: "Drums & Backing Vocals", items: ["Pablo Martínez"] },
      { role: "Guitars & Backing Vocals", items: ['Luis "Golding" Barrios', 'Miguel "El Enano" Gonzáles'] },
      { role: "Lead Vocals & Bass", items: ["Asier Cazalis"] },
    ], (name) => name);
    expect(blocks.map((block) => block.role)).toEqual(["Lead Vocals & Bass", "Guitars & Backing Vocals", "Drums & Backing Vocals"]);
    expect(blocks[1]!.items).toEqual(['Miguel "El Enano" Gonzáles', 'Luis "Golding" Barrios']);
  });

  it("quienes comparten roles van en una línea; tres roles con coma; estudios «at»; «Except Track 08»", () => {
    const lines = creditLines([
      person(1, "Armando Benavides", "recording", "Recorded by"),
      person(2, "A. Abril", "recording", "Recorded by"),
      org(3, "Estudios La Discoteca", "recording", "Recorded by"),
      person(4, "Víctor Hugo Mendoza", "producer", "produced"),
      person(4, "Víctor Hugo Mendoza", "recording", "recorded"),
      person(4, "Víctor Hugo Mendoza", "mixing", "mixed"),
      org(5, "Tarareo Studios", "producer", "Except Track 08 Produced by"),
      person(6, "Rafael Estrella", "recording", "Recorded by"),
    ]);
    expect(lines.map((line) => `${line.roles} ${line.joiner} ${names(line)}${line.scope ? ` (${line.scope})` : ""}`)).toEqual([
      "Produced, Recorded & Mixed by Víctor Hugo Mendoza",
      "Recorded by Armando Benavides, A. Abril & Rafael Estrella",
      "Recorded at Estudios La Discoteca",
      "Produced by Tarareo Studios (pista 8)",
    ]);
  });

  it("una línea sin rol conocido que repite Arte no se duplica", () => {
    const plan = otherCreditsWithChannel([statement(1, "Painting: Gianni Fedele", null, [{ name: "Gianni Fedele", personId: 4 }])],
      { artwork: [person(4, "Gianni Fedele", "artwork", "Painting")] }, {});
    expect(plan.statements).toEqual([]);
  });

  it("el instrumento solo desempata entre bloques del mismo tamaño", () => {
    const blocks = orderMusicianBlocks([
      { role: "Drums", items: ["Ana Ruiz"] },
      { role: "Bass", items: ["Ana Ruiz"] },
      { role: "Keyboards", items: ["José Ignacio Pérez"] },
    ], (name) => name);
    expect(blocks.map((block) => block.role)).toEqual(["Keyboards", "Bass", "Drums"]);
  });

  it("qué cuenta como voz principal", () => {
    expect(isLeadVocals("Lead Vocals & Bass")).toBe(true);
    expect(isLeadVocals("Voz y Guitarra")).toBe(true);
    expect(isLeadVocals("Vocals")).toBe(true);
    expect(isLeadVocals("Backing Vocals")).toBe(false);
    expect(isLeadVocals("Coros")).toBe(false);
  });
});
