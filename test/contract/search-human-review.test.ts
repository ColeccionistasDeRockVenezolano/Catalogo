import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { getPool, closeDb } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { adjudicateMapping, humanEvaluationState, mappingAdjudicationState, saveBlindReading, saveVerdict } from "../../src/search/human-review.js";

const root = process.cwd();
const blind = { object: "track", type: "sound", state: "affirmed", appreciation: "liked", coverage: "partial" } as const;

describe("etapa 2: evaluación humana y adjudicación de correspondencias", () => {
  let pg: PgContainer;
  const env = { ...process.env };
  beforeAll(async () => {
    pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
  });
  afterAll(async () => { await closeDb(); await pg?.stop(); process.env = env; resetEnvCache(); });

  it("oculta la anotación hasta registrar la lectura ciega y no permite reescribirla", async () => {
    const before = await humanEvaluationState(root, getPool(), "Brian");
    expect(before.items).toHaveLength(90);
    expect(before.items.every(i => i.annotation === null)).toBe(true);
    expect(JSON.stringify(before.items[0])).not.toContain("interpretation");
    await expect(saveVerdict(root, getPool(), "Brian", "E2-K01", "supported", "")).rejects.toThrow(/lectura ciega/);
    const revealed = await saveBlindReading(root, getPool(), "Brian", "E2-K01", blind);
    expect(revealed.aspect).toBe("structure.development");
    await expect(saveBlindReading(root, getPool(), "Brian", "E2-K01", blind)).rejects.toThrow(/no se reescribe/);
    await saveVerdict(root, getPool(), "Brian", "E2-K01", "supported", "Intención imaginada bien acotada");
    const after = await humanEvaluationState(root, getPool(), "Brian");
    expect(after.metrics).toMatchObject({ blind: 1, judged: 1, scopeErrors: 0, supportPrecision: 1 });
    expect(after.complete).toBe(false); expect(after.meetsThresholds).toBe(false);
    expect((await humanEvaluationState(root, getPool(), "Otra persona")).metrics.blind).toBe(0);
  });

  it("adjudica correspondencias sin aprobar pendientes ni destinos inexistentes", async () => {
    const state = await mappingAdjudicationState(root, getPool());
    expect(state.total).toBe(44); expect(state.decided).toBe(0);
    const equivalence = state.terms.find(t => t.proposal.relation === "equivalence")!;
    const pending = state.terms.find(t => t.proposal.relation === "pending")!;
    await adjudicateMapping(root, getPool(), "Brian", equivalence.originalTerm, { decision: "approved" });
    await expect(adjudicateMapping(root, getPool(), "Brian", pending.originalTerm, { decision: "approved" })).rejects.toThrow(/pendiente/);
    await expect(adjudicateMapping(root, getPool(), "Brian", pending.originalTerm, { decision: "corrected", relation: "equivalence", targetSlug: "no-existe" })).rejects.toThrow(/no existe/);
    await adjudicateMapping(root, getPool(), "Brian", pending.originalTerm, { decision: "rejected", note: "Sin destino CRV" });
    const after = await mappingAdjudicationState(root, getPool());
    expect(after.decided).toBe(2);
    expect(after.terms.find(t => t.originalTerm === equivalence.originalTerm)!.decision).toMatchObject({ decision: "approved", decidedBy: "Brian" });
  });
});
