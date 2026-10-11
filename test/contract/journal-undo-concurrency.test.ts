import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { createEntity, updateEntity, withOperatorRun, type OperatorContext } from "../../src/merge/operator.js";
import { undoRun, previewRunUndo } from "../../src/merge/run-undo.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe("deshacer conserva escrituras concurrentes", () => {
  let container: PgContainer;
  const operation = <T>(work: (context: OperatorContext) => Promise<T>) => withOperatorRun({
    name: "test:undo-concurrency", operator: "QA", note: "Conservación de dos escritores reales",
  }, work);
  const row = async (id: number) => (await getPool().query("SELECT nationality FROM public.persons WHERE id=$1", [id])).rows[0];
  async function fixture(name: string) {
    const created = await operation(ctx => createEntity(ctx, "person", { name }, { allowSimilar: true }));
    const edited = await operation(ctx => updateEntity(ctx, "person", created.result.id, { nationality: "Venezuela" }));
    return { id: created.result.id, runId: edited.runId };
  }
  async function backendPid(client: PoolClient) {
    return Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  }
  async function waitForDatabaseLock(pid: number) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const state = (await getPool().query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0];
      if (state?.wait_event_type === "Lock") return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`El escritor ${pid} no esperó el bloqueo de la otra transacción`);
  }

  beforeAll(async () => {
    container = await startPgContainer(); process.env["DATABASE_URL"] = container.databaseUrl; resetEnvCache();
    await applyCore(container.name); await migrateUp();
  }, 120_000);
  afterAll(async () => { await closeDb(); await container?.stop(); }, 60_000);

  it("una edición que confirma mientras deshacer espera se conserva y deshacer rechaza todo el run", async () => {
    const person = await fixture("Edición que confirma primero");
    const edited = gate(), commitEditor = gate(), undoStarted = gate();
    let undoPid = 0;
    const editor = operation(async ctx => {
      await updateEntity(ctx, "person", person.id, { nationality: "Colombia" });
      edited.release(); await commitEditor.promise;
    });
    await edited.promise;
    const undo = operation(async ctx => { undoPid = await backendPid(ctx.client); undoStarted.release(); return undoRun(ctx, person.runId); });
    // Attach a handler before the transaction can reject.
    const settled = Promise.allSettled([editor, undo]);
    try { await undoStarted.promise; await waitForDatabaseLock(undoPid); }
    finally { commitEditor.release(); }
    const results = await settled;
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    if (results[1].status === "rejected") expect(String(results[1].reason)).toMatch(/cambió después/);
    expect(await row(person.id)).toEqual({ nationality: "Colombia" });
    expect((await getPool().query("SELECT id FROM ingest.run_undos WHERE run_id=$1", [person.runId])).rows).toEqual([]);
    const client = await getPool().connect();
    try { expect((await previewRunUndo(client, person.runId)).undoable).toBe(false); }
    finally { client.release(); }
  });

  it("una edición iniciada después de la comprobación espera deshacer y conserva su valor al confirmar", async () => {
    const person = await fixture("Edición que confirma al final");
    const checked = gate(), continueUndo = gate(), editorStarted = gate();
    let editorPid = 0;
    const undo = operation(async ctx => {
      const original = ctx.client.query.bind(ctx.client);
      let paused = false;
      ctx.client.query = (async (sql: string, values?: unknown[]) => {
        const result = await original(sql, values);
        if (!paused && sql.includes('SELECT to_jsonb(t) AS row FROM "public"."persons"')) {
          paused = true; checked.release(); await continueUndo.promise;
        }
        return result;
      }) as PoolClient["query"];
      try { return await undoRun(ctx, person.runId); }
      finally { ctx.client.query = original; }
    });
    await checked.promise;
    const editor = operation(async ctx => {
      editorPid = await backendPid(ctx.client); editorStarted.release();
      return updateEntity(ctx, "person", person.id, { nationality: "Colombia" });
    });
    const settled = Promise.allSettled([undo, editor]);
    try { await editorStarted.promise; await waitForDatabaseLock(editorPid); }
    finally { continueUndo.release(); }
    const results = await settled;
    expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await row(person.id)).toEqual({ nationality: "Colombia" });
  });

  it("consultar la vista previa sigue disponible mientras una edición mantiene bloqueada la ficha", async () => {
    const person = await fixture("Vista previa concurrente");
    const edited = gate(), commit = gate();
    const editor = operation(async ctx => {
      await updateEntity(ctx, "person", person.id, { nationality: "Colombia" }); edited.release(); await commit.promise;
    });
    await edited.promise;
    const client = await getPool().connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL lock_timeout='1s'");
      expect((await previewRunUndo(client, person.runId)).undoable).toBe(true);
    } finally { await client.query("ROLLBACK"); client.release(); commit.release(); await editor; }
    expect(await row(person.id)).toEqual({ nationality: "Colombia" });
  });
});
