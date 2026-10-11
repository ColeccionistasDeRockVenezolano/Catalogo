import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { migrateUp } from "../../src/db/migrate.js";
import { deleteEntity, withOperatorRun } from "../../src/merge/operator.js";
import { mergeInto } from "../../src/review/duplicates.js";
import { undoMergeRun } from "../../src/merge/unmerge.js";
import { undoRun, previewRunUndo } from "../../src/merge/run-undo.js";
import { loadSheetsFile } from "../../src/genres/external/sheets.js";
import { upsertExternalSource } from "../../src/genres/external/store.js";
import { reconcileIntegrity } from "../../src/doctor/reconcile.js";
import { runDoctor } from "../../src/doctor/index.js";

describe("conservación de identidades externas y redirecciones", () => {
  let container: PgContainer;
  let source: number;
  const one = async (sql: string, params: unknown[] = []) => Number((await getPool().query<{ id: string }>(sql, params)).rows[0]!.id);
  const artist = (name: string) => one("INSERT INTO public.artists(name) VALUES($1) RETURNING id", [name]);
  const operation = <T>(work: Parameters<typeof withOperatorRun<T>>[1]) => withOperatorRun({ name: "test:lifecycle", operator: "prueba", note: "prueba de conservación" }, work);
  const merge = (keep: number, drop: number) => operation((ctx) => mergeInto(ctx.client, "artist", keep, drop, ctx.note, ctx.runId));
  const identities = async (ids: number[]) => (await getPool().query("SELECT to_jsonb(i) AS row FROM ingest.genre_external_identities i WHERE entity_id=ANY($1::bigint[]) ORDER BY id", [ids])).rows;
  const identity = (id: number, external: string, status = "matched") => one(`
    INSERT INTO ingest.genre_external_identities(entity_kind,entity_id,source_id,external_id,external_name,score,status,decided_by,decision_kind,reason,signals)
    VALUES('artist',$1,$2,$3::text,'Identidad documental',1,$4,'prueba','human','identidad revisada',jsonb_build_array($3::text)) RETURNING id`, [id, source, external, status]);

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    const client = await getPool().connect();
    try { source = (await upsertExternalSource(client, (await loadSheetsFile())[0]!, { actor: "prueba", reason: "fixture" })).id; }
    finally { client.release(); }
  }, 120_000);
  afterAll(async () => { await closeDb(); await container?.stop(); }, 60_000);

  it("fusionar y deshacer conserva todas las identidades, señales y decisiones originales", async () => {
    const keep = await artist("Identidad A"), drop = await artist("Identidad B");
    await identity(keep, "same");
    await identity(drop, "same");
    await identity(drop, "alternative", "ambiguous");
    const before = await identities([keep, drop]);
    const merged = await merge(keep, drop);
    const after = await identities([keep, drop]);
    expect(after).toHaveLength(2);
    expect(after.every(({ row }) => Number((row as Record<string, unknown>)["entity_id"]) === keep)).toBe(true);
    const undone = await operation((ctx) => undoRun(ctx, merged.runId));
    expect(undone.result.method).toBe("journal");
    expect(await identities([keep, drop])).toEqual(before);
    await operation((ctx) => undoRun(ctx, undone.runId));
    expect(await identities([keep, drop])).toEqual(after);
  });

  it("identidades aceptadas incompatibles quedan ambiguas, con las dos decisiones en auditoría", async () => {
    const keep = await artist("Conflicto A"), drop = await artist("Conflicto B");
    await identity(keep, "external-a"); await identity(drop, "external-b");
    const merged = await merge(keep, drop);
    expect((await identities([keep])).map(({ row }) => (row as Record<string, unknown>)["status"])).toEqual(["ambiguous", "ambiguous"]);
    const audit = (await getPool().query<{ original: unknown[] }>("SELECT new_value->'externalIdentities'->'before' AS original FROM ingest.merge_audit WHERE id=$1", [merged.result.auditId])).rows[0]!;
    expect(audit.original).toHaveLength(2);
  });

  it("deshacer rechaza una decisión externa posterior y revierte la transacción completa", async () => {
    const keep = await artist("Posterior A"), drop = await artist("Posterior B");
    await identity(drop, "changed");
    const merged = await merge(keep, drop);
    await getPool().query("UPDATE ingest.genre_external_identities SET reason='revisión posterior' WHERE entity_id=$1", [keep]);
    const before = await identities([keep]);
    const client = await getPool().connect();
    try { expect((await previewRunUndo(client, merged.runId)).undoable).toBe(false); }
    finally { client.release(); }
    await expect(operation((ctx) => undoRun(ctx, merged.runId))).rejects.toThrow(/cambió después/);
    expect(await identities([keep])).toEqual(before);
    expect((await getPool().query("SELECT id FROM public.artists WHERE id=$1", [drop])).rows).toHaveLength(0);
  });

  it("restaura los destinos previos de redirecciones comprimidas al deshacer la segunda fusión", async () => {
    const a = await artist("Cadena A"), b = await artist("Cadena B"), c = await artist("Cadena C");
    const first = await merge(b, a), second = await merge(c, b);
    await operation((ctx) => undoMergeRun(ctx, second.runId));
    const redirect = (await getPool().query<{ to_id: string }>("SELECT to_id::text FROM ingest.entity_redirects WHERE entity_kind='artist' AND from_id=$1", [a])).rows[0]!;
    expect(Number(redirect.to_id)).toBe(b);
    await operation((ctx) => undoMergeRun(ctx, first.runId));
    expect((await getPool().query("SELECT id FROM public.artists WHERE id=ANY($1::bigint[])", [[a, b, c]])).rows).toHaveLength(3);
  });

  it("retirar y deshacer conserva identidad externa, auditoría y estado previo de los claims", async () => {
    const id = await artist("Retiro documental");
    await identity(id, "retired");
    const src = await one("INSERT INTO ingest.sources(slug,name,site_type,trust_level) VALUES('retirement','Fixture','website','high') RETURNING id");
    const claim = await one("INSERT INTO ingest.claims(source_id,entity_kind,artist_id,field,raw_value,raw_hash,status,identity_key) VALUES($1,'artist',$2,'name','\"Retiro documental\"',repeat('a',64),'accepted','retirement') RETURNING id", [src,id]);
    const audit = await one("INSERT INTO ingest.merge_audit(entity_kind,artist_id,field,new_value,reason,confidence,performed_by) VALUES('artist',$1,'name','\"Retiro documental\"','documentado','high','human') RETURNING id", [id]);
    await getPool().query("INSERT INTO ingest.merge_audit_claims(merge_audit_id,claim_id) VALUES($1,$2)", [audit,claim]);
    const before = await identities([id]);
    const removed = await operation((ctx) => deleteEntity(ctx,"artist",id));
    expect(await identities([id])).toEqual([]);
    await operation((ctx) => undoRun(ctx,removed.runId));
    expect(await identities([id])).toEqual(before);
    expect((await getPool().query("SELECT status FROM ingest.claims WHERE id=$1", [claim])).rows[0]?.status).toBe("accepted");
    expect((await getPool().query("SELECT * FROM ingest.merge_audit_claims WHERE merge_audit_id=$1 AND claim_id=$2", [audit,claim])).rows).toHaveLength(1);
  });

  it("deshace una fusión anterior al registro de identidades usando su instantánea real", async () => {
    const keep = await artist("Histórica A"), drop = await artist("Histórica B");
    await identity(keep, "historical-same"); await identity(drop, "historical-same");
    const before = await identities([keep, drop]);
    let merged: Awaited<ReturnType<typeof merge>>;
    await getPool().query("ALTER TABLE ingest.genre_external_identities DISABLE TRIGGER crv_journal");
    try { merged = await merge(keep, drop); }
    finally { await getPool().query("ALTER TABLE ingest.genre_external_identities ENABLE TRIGGER crv_journal"); }
    expect((await getPool().query("SELECT id FROM ingest.change_journal WHERE run_id=$1 AND table_name='ingest.genre_external_identities'", [merged.runId])).rows).toEqual([]);
    const client = await getPool().connect();
    try { expect((await previewRunUndo(client, merged.runId)).plan?.byTable["ingest.genre_external_identities"]).toBeDefined(); }
    finally { client.release(); }
    const after = await identities([keep, drop]);
    const undone = await operation(ctx => undoRun(ctx, merged.runId));
    expect(await identities([keep, drop])).toEqual(before);
    await operation(ctx => undoRun(ctx, undone.runId));
    expect(await identities([keep, drop])).toEqual(after);
  });

  it("deshace un retiro anterior al registro y conserva todas las identidades originales", async () => {
    const id = await artist("Retiro histórico");
    await identity(id, "historical-retire");
    const before = await identities([id]);
    let removed: { runId: number };
    await getPool().query("ALTER TABLE ingest.genre_external_identities DISABLE TRIGGER crv_journal");
    try { removed = await operation(ctx => deleteEntity(ctx,"artist",id)); }
    finally { await getPool().query("ALTER TABLE ingest.genre_external_identities ENABLE TRIGGER crv_journal"); }
    await operation(ctx => undoRun(ctx, removed.runId));
    expect(await identities([id])).toEqual(before);
  });

  it("reconcilia sin inventar fuentes, conserva el core y detecta nuevas lagunas", async () => {
    const keep = await artist("Reconciliación destino"), drop = await artist("Reconciliación origen");
    await merge(keep,drop);
    await identity(drop,"historical-reference");
    const core = async () => (await getPool().query("SELECT to_jsonb(a) AS row FROM public.artists a ORDER BY id")).rows;
    const before = await core();
    const first = await operation(reconcileIntegrity);
    expect(first.result["snapshots"]).toBeGreaterThan(0);
    expect(first.result["identityTransfers"]).toBe(1);
    expect(await core()).toEqual(before);
    expect((await identities([drop]))).toEqual([]);
    const doctor = await runDoctor();
    expect(doctor.ok, JSON.stringify(doctor.checks)).toBe(true);
    expect(doctor.checks.find((item) => item.name === "merge_audit.coverage")?.detail).toContain("límites históricos");
    const second = await operation(reconcileIntegrity);
    expect(Object.values(second.result)).toEqual([0,0,0,0,0,0]);
    const id = await artist("Laguna posterior");
    expect((await runDoctor()).ok).toBe(false);
    await getPool().query("DELETE FROM public.artists WHERE id=$1", [id]);
  });
});
