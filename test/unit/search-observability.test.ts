import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SearchCollector, type SearchSnapshot } from "../../src/search/observability.js";
import { isPublishableEvidence, authorizeEditorialRevision, intentionSchema, INTENTION_VERSION } from "../../src/search/contracts.js";
import { searchSample } from "../../src/search/privacy.js";
const snapshot = (): SearchSnapshot => ({ attemptId: randomUUID(), at: new Date().toISOString(),
  intention: { version: INTENTION_VERSION, capabilities: [], interpretation: "unrecognized", entities: [], conditions: [], pending: [{ text: "sin gritos", reason: "legacy" }], engine: "legacy" },
  entityResolution: "undetermined", resultReason: "legacy_literal_no_matches",
  counts: { artist: 0 }, entities: [], outcome: "empty", incident: null, timings: { server: 1 }, cache: "hit", cold: false, versions: {} });

describe("observabilidad base del buscador", () => {
  it("las previas y cachés no se cuentan como confirmaciones; un recibo no crea dos operaciones", async () => {
    let written = 0;
    const collector = new SearchCollector(async rows => { written += rows.length; return { persisted: rows.length, duplicates: 0 }; });
    const receipt = collector.issue("sin gritos", snapshot())!;
    await collector.flush(); expect(written).toBe(0);
    const event = { receipt, searchId: randomUUID(), confirmation: "enter" as const };
    expect(collector.confirm(event)).toBe("queued");
    expect(collector.confirm(event)).toBe("duplicate");
    expect(collector.confirm({ ...event, searchId: randomUUID() })).toBe("receipt_used");
    await collector.flush(); expect(written).toBe(1);
    expect(collector.status()).toMatchObject({ requests: 1, previews: 0, duplicates: 1, invalid: 1 });
  });
  it("no acepta entidades que el servidor no recuperó", () => {
    const collector = new SearchCollector();
    const receipt = collector.issue("Desorden", snapshot())!;
    expect(collector.confirm({ receipt, searchId: randomUUID(), confirmation: "entity", selected: { type: "artist", id: 7 } })).toBe("invalid_selection");
    expect(collector.status().pending).toBe(0);
  });
  it("una avería de PostgreSQL conserva el lote acotado y publica el fallo fuera de la BD", async () => {
    const collector = new SearchCollector(async () => { throw new Error("private database details"); });
    const receipt = collector.issue("Desorden", snapshot())!;
    collector.confirm({ receipt, searchId: randomUUID(), confirmation: "enter" });
    await collector.flush(); expect(collector.status()).toMatchObject({ failed: 1, pending: 1, persisted: 0 });
  });
  it("sanitiza antes de huella y agrupación sin perder negación, artista ni número musical", () => {
    const safe = searchSample("sin gritos de 30 Seconds to Mars, 1990; correo ana@example.org https://example.org/?token=private +58 414 123 4567");
    expect(searchSample("rock de 1990-2000").sample).toBe("rock de 1990-2000");
    expect(safe.sample).toContain("sin gritos de 30 Seconds to Mars, 1990");
    expect(JSON.stringify(safe)).not.toMatch(/ana@example|token=private|414 123/);
    expect(searchSample("triste").fingerprint).not.toBe(searchSample("sin tristeza").fingerprint);
  });
  it("conserva seis ejes, exclusión, OR y fragmentos pendientes sin declararlos comprendidos", () => {
    const plan = snapshot().intention;
    expect(intentionSchema.safeParse(plan).success).toBe(true);
    expect(intentionSchema.safeParse({ ...plan, interpretation: "identified" }).success).toBe(false);
    expect(intentionSchema.parse({ ...plan, capabilities: ["direct", "emotional", "contextual"], conditions: [
      { id: "1", axis: "activity", facet: null, value: "study", sourceText: "para estudiar", scope: "listener", mode: "required", alternativeGroup: null, status: "recognized" },
      { id: "2", axis: "emotion", facet: null, value: "sad", sourceText: "sin tristeza", scope: "track", mode: "excluded", alternativeGroup: null, status: "recognized" },
    ] }).conditions).toHaveLength(2);
  });
  it("publicar exige decisión humana, identidad exacta y recurso permitido, con observación/análisis separados", () => {
    const evidence = { version: "crv-search-evidence-v1", id: "review-1",
      entity: { role: "target", kind: "album", id: 1, name: "Disco", resolution: "resolved" },
      observation: { resourceId: "R04", source: "https://example.org/review", locator: "página 1, párrafo 2", quote: "La fuente describe una guitarra", capturedAt: new Date().toISOString() },
      analysis: { text: "Interpretación del analista", method: "review", version: "v1" },
      proposal: { axis: "atmosphere", value: "tense", status: "approved" },
      decision: { actor: "Brian", revision: 1, reason: "Evidencia revisada", decidedAt: new Date().toISOString() } };
    expect(isPublishableEvidence(evidence)).toBe(true);
    expect(isPublishableEvidence({ ...evidence, decision: null })).toBe(false);
    expect(isPublishableEvidence({ ...evidence, entity: { ...evidence.entity, resolution: "ambiguous" } })).toBe(false);
    expect(isPublishableEvidence({ ...evidence, observation: { ...evidence.observation, resourceId: "R16" } })).toBe(false);
    expect(isPublishableEvidence({ ...evidence, proposal: { ...evidence.proposal, status: "rejected" } })).toBe(false);
  });
  it.each(["model", "source", "alias", "index"] as const)("%s no puede sustituir decisiones humanas", origin => {
    expect(authorizeEditorialRevision({ revision: 4, status: "withdrawn", actor: "Brian" }, { origin, expectedRevision: 4, actor: "automatic", reason: "p=0.99" })).toBe("review");
  });
});
