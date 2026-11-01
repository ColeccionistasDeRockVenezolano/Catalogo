import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache, getEnv } from "../../src/config/env.js";
import { AI_VERDICT_PROMPT_VERSION, latestVerdict, recordVerdict } from "../../src/curation/ai-verdicts.js";
import { autoDistinctAction } from "../../src/curation/actions/auto-distinct.js";
import type { ActionContext, ActionFinding, ActionPreview } from "../../src/curation/actions/types.js";
import { withOperatorRun } from "../../src/merge/operator.js";

// Etapa 3: el veredicto queda auditado y se lee el último por par.
describe("memoria de veredictos IA (contrato)", () => {
  let container: PgContainer;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
  }, 120_000);

  afterAll(async () => { await closeDb(); await container?.stop(); }, 60_000);

  async function one(sql: string, params: unknown[] = []): Promise<number> {
    return Number((await getPool().query<{ id: string }>(sql, params)).rows[0]!.id);
  }

  it("guarda modelo, prompt y política, y devuelve el último", async () => {
    const a = await one("INSERT INTO public.artists(name) VALUES('IA A') RETURNING id");
    const b = await one("INSERT INTO public.artists(name) VALUES('IA B') RETURNING id");
    expect(await latestVerdict(getPool(), "artist", a, b)).toBeNull();

    await withOperatorRun({ name: "test:verdict", operator: "prueba", note: "contrato" }, async (context) => {
      await recordVerdict(context, "artist", a, b, {
        decision: "needs_human", confidence: 0.5, evidence: [], reasoning: "faltan datos",
        data_gaps: ["ciudad"], identity_doubts: [],
      }, "deepseek-test");
      await recordVerdict(context, "artist", b, a, {
        decision: "same_identity", confidence: 0.91,
        evidence: [{ fact_id: "a.nombre", supports: "match" }], reasoning: "misma lista",
        data_gaps: [], identity_doubts: [],
      }, "deepseek-test");
    });

    const latest = await latestVerdict(getPool(), "artist", a, b);
    expect(latest).toMatchObject({
      decision: "same_identity", confidence: 0.91, model: "deepseek-test",
      promptVersion: AI_VERDICT_PROMPT_VERSION, policyVersion: "2",
    });
    expect(latest!.evidence).toHaveLength(1);
    expect((await getPool().query("SELECT 1 FROM ingest.curation_ai_verdicts WHERE kind='artist' AND a_id=$1 AND b_id=$2", [a, b])).rowCount).toBe(2);
  }, 60_000);

  it("un veredicto distinct 0,96 habilita el descarte automático", async () => {
    const a = await one("INSERT INTO public.artists(name) VALUES('Auto A') RETURNING id");
    const b = await one("INSERT INTO public.artists(name) VALUES('Auto B') RETURNING id");
    await withOperatorRun({ name: "test:auto-verdict", operator: "prueba", note: "contrato" }, async (context) => {
      await recordVerdict(context, "artist", a, b, {
        decision: "distinct", confidence: 0.96, evidence: [], reasoning: "son distintos",
        data_gaps: [], identity_doubts: [],
      }, getEnv().DEEPSEEK_MODEL_FAST);
    });
    const finding: ActionFinding = {
      id: 1, detector: "artistas_duplicados_evidencia", signature: "evidencia_determinista", status: "open",
      entity: { kind: "artist", id: a, label: "Auto A" }, field: "name", value: "Auto A", suggestedValue: null,
      related: [{ kind: "artist", id: b, label: "Auto B" }], title: "Auto A y Auto B",
      evidence: { pair: [Math.min(a, b), Math.max(a, b)] },
    };
    const params = { kind: "artist" as const, aId: a, bId: b };
    const client = await getPool().connect();
    const ctx = { client, mode: "auto", batchMode: "individual", pending: new Map(), names: {} } as unknown as ActionContext;
    const checks = await autoDistinctAction.preconditions(finding, params, ctx);
    client.release();
    expect(checks.find((check) => check.key === "ia_segura")).toMatchObject({ ok: true });
    const preview: ActionPreview = { touched: [], before: {}, after: {}, blocked: null, collisions: [], warnings: [], proposal: null };
    await withOperatorRun({ name: "test:auto-distinct", operator: "prueba", note: "contrato auto" }, async (context) =>
      autoDistinctAction.apply(context, finding, params, preview));
    expect((await getPool().query("SELECT 1 FROM ingest.curation_distinct_pairs WHERE kind='artist' AND a_id=$1 AND b_id=$2", [a, b])).rowCount).toBe(1);
  }, 60_000);
});
