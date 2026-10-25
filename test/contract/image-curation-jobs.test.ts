import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { toApiError } from "../../src/api/http-errors.js";
import { registerImageCandidateRoutes } from "../../src/api/routes/image-candidates.js";
import { registerChangeRoutes } from "../../src/api/routes/changes.js";
import { ImageCurationWorker, listImageJobs } from "../../src/merge/image-curation-jobs.js";
import type { ImageJob, ImageTask } from "../../src/shared/image-curation-jobs.js";
const token = "persistent-images-queue-contract-0123456789";
const headers = { authorization: `Bearer ${token}`, "x-crv-operator": "Curador de prueba" };
describe("cola persistente de imágenes", () => {
  let app: FastifyInstance, pg: PgContainer, mediaRoot: string, artist: number, bytes: Buffer;
  let blocking = false, unavailable = false, calls = 0;
  const gates: Array<() => void> = [], workers: ImageCurationWorker[] = [];
  const previousEnv = { ...process.env };
  const serve = async (_url: string) => {
    calls++;
    if (blocking) await new Promise<void>(resolve => gates.push(resolve));
    return unavailable ? { error: "HTTP 503", transient: true } : { bytes };
  };
  async function createApp() {
    const http = Fastify(); http.setValidatorCompiler(validatorCompiler); http.setSerializerCompiler(serializerCompiler);
    http.setErrorHandler((error, _request, reply) => {
      const mapped = toApiError(error);
      if (mapped) return reply.status(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message } });
      return reply.send(error);
    });
    await registerOperatorAuth(http);
    await registerImageCandidateRoutes(http, { mediaRoot, download: serve, worker: false });
    await registerChangeRoutes(http);
    return http;
  }
  function worker() { const value = new ImageCurationWorker({ mediaRoot, download: serve, pollMs: 25 }); workers.push(value); value.start(); return value; }
  async function seed(type: "decision" | "inspection" = "decision"): Promise<ImageTask> {
    const album = Number((await getPool().query("INSERT INTO public.albums(artist_id,title,cover_url) VALUES($1,$2,'https://img.example/before.jpg') RETURNING id", [artist, `Disco ${randomUUID()}`])).rows[0].id);
    const candidateId = Number((await getPool().query("INSERT INTO ingest.image_candidates(entity_kind,album_id,current_url,candidate_url,source,origin) VALUES('album',$1,'https://img.example/before.jpg',$2,'qa','contrato') RETURNING id", [album, `https://img.example/${album}.jpg`])).rows[0].id);
    const base = { requestId: randomUUID(), kind: "album" as const, entityId: album };
    return type === "decision" ? { ...base, type, candidateId } : { ...base, type, candidateIds: [candidateId] };
  }
  const submit = (tasks: ImageTask[]) => app.inject({ method: "POST", url: "/curation/images/jobs", headers, payload: { tasks } });
  async function job(id: number) { return (await listImageJobs()).find(row => row.id === id)!; }
  async function done(id: number) { await vi.waitFor(async () => { expect((await job(id)).status).toBe("done"); }, { timeout: 15000, interval: 30 }); return job(id); }
  beforeAll(async () => {
    pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl; process.env["CRV_OPERATOR_TOKEN"] = token;
    mediaRoot = await mkdtemp(path.join(tmpdir(), "crv-persistent-images-"));
    process.env["DATA_DIR"] = mediaRoot;
    resetEnvCache(); await applyCore(pg.name); await migrateUp();
    bytes = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#bb2233" } }).jpeg().toBuffer();
    artist = Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Persistencia de prueba') RETURNING id")).rows[0].id);
    app = await createApp();
  });
  afterAll(async () => {
    blocking = false; for (const release of gates.splice(0)) release();
    await Promise.all(workers.map(value => value.stop())); await app?.close(); await closeDb(); await pg?.stop();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
    for (const key of ["DATABASE_URL", "CRV_OPERATOR_TOKEN", "DATA_DIR"]) { if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key]; }
    resetEnvCache(); resetAuthStateForTests();
  });
  it("protege lecturas/escrituras, confirma antes de descargar y hace idempotente el envío", async () => {
    expect((await app.inject({ url: "/curation/images/jobs" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/curation/images/jobs", payload: { tasks: [] } })).statusCode).toBe(401);
    const task = await seed();
    const responses = await Promise.all([submit([task]), submit([task])]);
    expect(responses.map(response => response.statusCode)).toEqual([202, 202]);
    const id = responses[0]!.json<ImageJob[]>()[0]!.id;
    expect(responses[1]!.json<ImageJob[]>()[0]!.id).toBe(id);
    expect(calls).toBe(0); expect((await job(id)).status).toBe("queued");
    expect((await submit([{ ...task, requestId: randomUUID() }])).statusCode).toBe(409);
    const reused = await app.inject({ method: "POST", url: "/curation/images/jobs", headers: { ...headers, "x-crv-operator": "Otro curador" }, payload: { tasks: [task] } });
    expect(reused.statusCode).toBe(409);
    // Cerrar la API y sus conexiones no borra la solicitud aceptada.
    await app.close(); await closeDb(); app = await createApp();
    const resumed = worker(); const result = await done(id); await resumed.stop();
    expect(result.attempts).toBe(1); expect(result.runId).toBeGreaterThan(0);
    expect((await submit([task])).json<ImageJob[]>()[0]!.runId).toBe(result.runId);
  });
  it("limita a tres trabajos globales incluso con dos trabajadores", async () => {
    blocking = true; const before = calls;
    const tasks = await Promise.all(Array.from({ length: 8 }, () => seed()));
    const response = await submit(tasks); expect(response.statusCode).toBe(202);
    const ids = response.json<ImageJob[]>().map(value => value.id);
    const first = worker(), second = worker();
    await vi.waitFor(() => { expect(calls - before).toBe(3); });
    const state = (await listImageJobs()).filter(value => ids.includes(value.id));
    expect(state.filter(value => value.status === "running")).toHaveLength(3);
    expect(state.filter(value => value.status === "queued")).toHaveLength(5);
    gates.shift()!();
    await vi.waitFor(() => { expect(calls - before).toBe(4); });
    blocking = false; for (const release of gates.splice(0)) release();
    await Promise.all(ids.map(id => done(id))); await first.stop(); await second.stop();
    expect(calls - before).toBe(8);
  });
  it("conserva un fallo, reintenta y permite deshacer el resultado al volver", async () => {
    unavailable = true;
    const task = await seed(); const id = (await submit([task])).json<ImageJob[]>()[0]!.id;
    const runner = worker();
    await vi.waitFor(async () => { expect((await job(id)).status).toBe("error"); });
    expect(await job(id)).toMatchObject({ conflict: false, runId: null, attempts: 1 });
    expect((await getPool().query("SELECT cover_url FROM public.albums WHERE id=$1", [task.entityId])).rows[0].cover_url).toBe("https://img.example/before.jpg");
    unavailable = false;
    expect((await app.inject({ method: "POST", url: `/curation/images/jobs/${id}/retry`, headers, payload: {} })).statusCode).toBe(202);
    const result = await done(id); await runner.stop();
    expect(result.attempts).toBe(2);
    expect((await app.inject({ method: "POST", url: `/curation/images/jobs/${id}/retry`, headers, payload: {} })).statusCode).toBe(409);
    const undo = await app.inject({ method: "POST", url: `/changes/${result.runId}/undo`, headers, payload: { note: "Deshacer al volver a la página" } });
    expect(undo.statusCode, undo.body).toBe(200);
    expect((await getPool().query("SELECT cover_url FROM public.albums WHERE id=$1", [task.entityId])).rows[0].cover_url).toBe("https://img.example/before.jpg");
  });
  it("recupera una tarea vencida y cerca el trabajador anterior sin duplicar el cambio", async () => {
    blocking = true; const before = calls;
    const task = await seed(); const id = (await submit([task])).json<ImageJob[]>()[0]!.id;
    const first = worker(); await vi.waitFor(() => { expect(calls - before).toBe(1); });
    const stopping = first.stop();
    const owner = (await getPool().query("SELECT lease_owner FROM ingest.image_curation_jobs WHERE id=$1", [id])).rows[0].lease_owner;
    await getPool().query("UPDATE ingest.image_curation_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    const second = worker(); await vi.waitFor(() => { expect(calls - before).toBe(2); });
    expect((await job(id)).attempts).toBe(2);
    expect((await getPool().query("SELECT lease_owner FROM ingest.image_curation_jobs WHERE id=$1", [id])).rows[0].lease_owner).not.toBe(owner);
    gates.shift()!(); await stopping;
    expect((await job(id)).status).toBe("running");
    expect((await getPool().query("SELECT cover_url FROM public.albums WHERE id=$1", [task.entityId])).rows[0].cover_url).toBe("https://img.example/before.jpg");
    blocking = false; for (const release of gates.splice(0)) release();
    const result = await done(id); await second.stop();
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.scrape_runs WHERE params->>'candidateId'=$1 AND params->>'id'=$2", [String(task.type === "decision" ? task.candidateId : 0), String(task.entityId)])).rows[0].n).toBe(1);
    expect(result.runId).toBeGreaterThan(0);
  });
  it("confirma tarea e imagen en una transacción y reutiliza el original publicado al reintentar", async () => {
    const before = calls, task = await seed(); const id = (await submit([task])).json<ImageJob[]>()[0]!.id;
    await getPool().query(`CREATE FUNCTION ingest.qa_fail_image_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=${id} AND NEW.status='done' THEN RAISE EXCEPTION 'Fallo simulado antes del commit'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_image_job BEFORE UPDATE ON ingest.image_curation_jobs FOR EACH ROW EXECUTE FUNCTION ingest.qa_fail_image_job()`);
    const runner = worker();
    await vi.waitFor(async () => { expect((await job(id)).status).toBe("error"); });
    expect((await job(id)).runId).toBeNull();
    expect((await getPool().query("SELECT cover_url FROM public.albums WHERE id=$1", [task.entityId])).rows[0].cover_url).toBe("https://img.example/before.jpg");
    expect((await getPool().query("SELECT status FROM ingest.image_candidates WHERE album_id=$1", [task.entityId])).rows[0].status).toBe("open");
    expect(calls - before).toBe(1);
    await getPool().query("DROP TRIGGER qa_fail_image_job ON ingest.image_curation_jobs; DROP FUNCTION ingest.qa_fail_image_job()");
    unavailable = true;
    expect((await app.inject({ method: "POST", url: `/curation/images/jobs/${id}/retry`, headers, payload: {} })).statusCode).toBe(202);
    await done(id); await runner.stop(); unavailable = false;
    expect(calls - before).toBe(1);
  });
  it("serializa medición y decisión de una ficha y rechaza candidatas ajenas", async () => {
    const task = await seed("inspection"); if (task.type !== "inspection") throw new Error("fixture");
    const other = await seed(); if (other.type !== "decision") throw new Error("fixture");
    expect((await submit([{ ...task, candidateIds: [other.candidateId!] }])).statusCode).toBe(409);
    const decision: ImageTask = { requestId: randomUUID(), kind: task.kind, entityId: task.entityId, type: "decision", candidateId: task.candidateIds[0]! };
    const response = await submit([task, decision]); expect(response.statusCode).toBe(202);
    const ids = response.json<ImageJob[]>().map(value => value.id);
    const runner = worker(); await Promise.all(ids.map(id => done(id))); await runner.stop();
    const inspection = await job(ids[0]!); expect(inspection.result).toBe("0 imágenes medidas.");
  });
});
