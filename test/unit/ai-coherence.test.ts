import { describe, expect, it } from "vitest";
import { planOutcome } from "../../src/curation/ai/coherence.js";
import type { CatalogDraft, CatalogOperation, CatalogPreviewItem } from "../../src/curation/ai/types.js";

const base = { label: "Cambio", reason: "Fuente", evidenceIds: ["E1"], enabled: true };
const album: CatalogOperation = {
  ...base, key: "disco", op: "create_album", artist: { kind: "artist", id: 1 },
  values: { title: "Cuentos", releaseYear: 1993 },
  tracks: [{ title: "A", discNumber: 1, trackNumber: 1 }, { title: "B", discNumber: 1, trackNumber: 2 }],
  credits: [], genres: [], aliases: [], formats: [],
};
const alias: CatalogOperation = { ...base, key: "alias", op: "add_alias", target: { kind: "artist", id: 1 }, alias: "Los Pixel", aliasType: "name_variant", isPrimary: false };
const ok = (key: string): CatalogPreviewItem => ({ key, op: "add_alias", label: key, before: null, after: { ok: true }, error: null, warnings: [] });
const draft = (summary: string, operations: CatalogOperation[], unresolved: string[] = []): CatalogDraft => ({ summary, operations, unresolved });

describe("coherencia entre resumen, operaciones y dudas", () => {
  it("describe lo que el plan contiene sin depender del texto del modelo", () => {
    const outcome = planOutcome(draft("Se añade el disco «Cuentos» con 2 pistas y el alias «Los Pixel».", [album, alias], ["Falta la portada"]), [ok("disco"), ok("alias")]);
    expect(outcome.text).toBe("2 cambios listos para decidir (1 disco completo, 1 alias) · 1 duda pendiente con lo que falta para resolverla.");
    expect(outcome.issues).toEqual([]);
  });
  it("señala un resumen que promete operaciones ausentes, cantidades mayores o nombres sin operación", () => {
    const outcome = planOutcome(draft("Se añaden 12 pistas al disco. Se corrige la portada. Se agrega el integrante «Juan Pérez».", [album]), [ok("disco")]);
    expect(outcome.issues).toEqual([
      "El resumen anuncia 12 pistas, pero las operaciones solo proponen 2.",
      "El resumen anuncia imágenes («Se corrige la portada.»), pero ninguna operación lo propone.",
      "El resumen anuncia créditos o integrantes («Se agrega el integrante «Juan Pérez».»), pero ninguna operación lo propone.",
      "El resumen menciona «Juan Pérez», que no figura en ninguna operación ni duda.",
    ]);
  });
  it("no confunde con promesas lo que el resumen deja pendiente", () => {
    const outcome = planOutcome(draft("No se añade la portada porque falta respaldo. Quedan pendientes los créditos de «Juan Pérez».", [], ["Juan Pérez: falta fuente del crédito"]), []);
    expect(outcome.issues).toEqual([]);
    expect(outcome.text).toBe("Sin cambios propuestos: 1 duda pendiente con lo que falta para resolverla.");
  });
  it("un alta con nombres parecidos espera criterio y su vínculo espera esa decisión; ninguno cuenta como bloqueado", () => {
    const org: CatalogOperation = { ...base, key: "sello", op: "create_entity", kind: "organization", values: { name: "Avila Records" } };
    const link: CatalogOperation = { ...base, key: "fundador", op: "create_relation", kind: "person_organization", endpoints: { personId: { kind: "person", id: 1 }, organizationId: { kind: "organization", key: "sello" } }, values: { role: "fundador" } };
    const items: CatalogPreviewItem[] = [
      { ...ok("sello"), after: null, error: "Criterio editorial: ya hay fichas de nombre parecido («Alfi Records»). Si es otra, al aceptarla se crea como ficha distinta." },
      { ...ok("fundador"), after: null, error: "referencia sello no disponible para organization" },
    ];
    expect(planOutcome(draft("", [org, link]), items).text).toBe("1 requiere tu criterio: ya hay fichas de nombre parecido · 1 espera a que decidas la propuesta de la que depende.");
    expect(planOutcome(draft("", [link]), [items[1]!]).text).toBe("1 bloqueado: referencia sello no disponible para organization.");
  });
  it("explica planes vacíos, bloqueos, datos existentes y decisiones", () => {
    expect(planOutcome(draft("", []), []).text).toContain("Sin cambios propuestos ni dudas");
    const same: CatalogPreviewItem = { ...ok("alias"), before: { alias: "Los Pixel" }, after: { alias: "Los Pixel" } };
    const blocked: CatalogPreviewItem = { ...ok("disco"), after: null, error: "Respaldo insuficiente: pista 2 «B». Revisa las fuentes" };
    expect(planOutcome(draft("", [album, alias]), [blocked, same]).text).toBe("1 bloqueado: Respaldo insuficiente · 1 sin efecto: el catálogo ya contiene ese dato.");
    const decided = planOutcome(draft("", [album, alias]), [ok("disco"), ok("alias")], {
      disco: { decision: "accepted", decidedBy: "QA", decidedAt: "", runId: 1 },
      alias: { decision: "rejected", decidedBy: "QA", decidedAt: "", runId: null },
    });
    expect(decided.text).toBe("1 aceptado · 1 rechazado.");
    expect(planOutcome(draft("", [album]), [{ ...ok("plan"), after: null, error: "La ficha cambió" }]).text).toBe("No se pudo validar la propuesta: La ficha cambió");
  });
});
