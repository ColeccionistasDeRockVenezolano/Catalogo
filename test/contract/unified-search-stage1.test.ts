import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as resourceFields from "../../src/search/resource-field-review.js";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { getPool, closeDb } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { registerSearchRoutes } from "../../src/api/routes/search.js";
import { ApiError } from "../../src/api/http-errors.js";
import { refreshSearchIndex } from "../../src/api/search-index.js";
import { retainSearchAnalytics, searchCollector } from "../../src/search/observability.js";

const visitor = { "x-forwarded-for": "198.51.100.20", "user-agent": "Mozilla/5.0", origin: "http://localhost:5173" };
describe("buscador unificado: etapa 1", () => {
  let pg: PgContainer, app: FastifyInstance;
  const env = { ...process.env };
  beforeAll(async () => {
    pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl;
    process.env["CRV_OPERATOR_TOKEN"] = "search-stage1-internal-test-token"; delete process.env["CRV_COLLABORATORS_JSON"]; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    await getPool().query("INSERT INTO public.artists(name) VALUES('Desorden Público')");
    await getPool().query("INSERT INTO ingest.search_misses(normalized_query,sample_query,misses) VALUES('historica','Histórica',7)");
    await refreshSearchIndex();
    app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    await registerOperatorAuth(app);
    app.addHook("preHandler", async request => {
      if ((request.query as {q?:string}).q === "early-limit") throw new ApiError(429, "rate_limited", "Límite anterior al handler");
    });
    await registerSearchRoutes(app);
  }, 120_000);
  afterAll(async () => { await app?.close(); await closeDb(); await pg?.stop(); resetAuthStateForTests();
    process.env = env; resetEnvCache(); });
  const search = (q: string, headers = visitor) => app.inject({ method: "GET", url: `/search?q=${encodeURIComponent(q)}`, headers });
  const confirm = (receipt: string, searchId = randomUUID(), extra = {}) => app.inject({ method: "POST", url: "/search/confirmations", headers: visitor,
    payload: { searchId, receipt, confirmation: "enter", ...extra } });
  it("protege lecturas privadas y exige origen para confirmaciones", async () => {
    expect((await app.inject("/search/administration")).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/search/confirmations", headers: { "x-forwarded-for": "198.51.100.2" }, payload: { searchId: randomUUID(), receipt: randomUUID(), confirmation: "enter" } })).statusCode).toBe(403);
  });
  it("separa tecleo y cuenta Enter/selección en caché con deduplicación persistente", async () => {
    const preview = await search("Desorden"); expect(preview.statusCode).toBe(200);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_operations")).rows[0].n).toBe(0);
    const first = await search("Desorden"), searchId = randomUUID();
    const receipt = String(first.headers["x-crv-search-receipt"]);
    expect((await confirm(receipt, searchId)).json().status).toBe("queued");
    expect((await confirm(receipt, searchId)).json().status).toBe("duplicate");
    const retry = await search("Desorden"); await confirm(String(retry.headers["x-crv-search-receipt"]), searchId);
    const selected = await search("Desorden");
    const hit = selected.json().artist[0];
    await confirm(String(selected.headers["x-crv-search-receipt"]), randomUUID(), { confirmation: "entity", selected: { type: "artist", id: hit.id } });
    await searchCollector.flush();
    const rows = (await getPool().query("SELECT * FROM ingest.search_operations ORDER BY confirmed_at")).rows;
    expect(rows).toHaveLength(2); expect(rows[0].snapshot.cache).toBe("hit");
    expect(rows[1].snapshot.intention.capabilities).toEqual(["direct"]);
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_attempts")).rows[0].n).toBe(3);
  });
  it("retiene desconocidas/vacías sanitizadas sin modificar el legado y excluye bots/admin/pruebas", async () => {
    for (const headers of [{ ...visitor, "user-agent": "Googlebot" }, { ...visitor, authorization: "Bearer search-stage1-internal-test-token" }, { ...visitor, "x-crv-test": "1" }]) {
      const excluded = await search("qa-excluded", headers); expect(excluded.headers["x-crv-search-receipt"]).toBeUndefined();
    }
    const empty = await search("sin gritos ana@example.org");
    await confirm(String(empty.headers["x-crv-search-receipt"])); await searchCollector.flush();
    const row = (await getPool().query("SELECT * FROM ingest.search_operations WHERE snapshot->>'outcome'='empty'")).rows[0];
    expect(row.sample).toContain("sin gritos"); expect(JSON.stringify(row)).not.toContain("ana@example.org");
    expect(row.snapshot.intention.interpretation).toBe("unrecognized");
    expect((await getPool().query("SELECT misses FROM ingest.search_misses WHERE normalized_query='historica'")).rows[0].misses).toBe(7);
    const admin = await app.inject({ url: "/search/administration", headers: { authorization: "Bearer search-stage1-internal-test-token" } });
    expect(admin.statusCode).toBe(200); expect(admin.json().summary.total).toBe(3);
    expect(admin.json().resources.rows).toHaveLength(46);
    expect(JSON.stringify(admin.json().resources)).not.toContain("/mnt/");
    const resources=admin.json().resources;
    expect(resources.fieldReviewStatus).toBe("verified");
    expect(resources.fieldReview).toMatchObject({revision:(await resourceFields.readResourceFieldReview(process.cwd())).revision,publicationAuthorized:false,coverage:{resources:46,fields:107,measures:"field_dispositions_not_musical_coverage"}});
    expect(resources.rows.reduce((n:number,row:{fields:unknown[]})=>n+row.fields.length,0)).toBe(107);
    const r03=resources.rows.find((row:{id:string})=>row.id==="R03");
    expect(r03.status).toBe("partially_extracted");
    expect(r03.fields.some((field:{key:string;disposition:string})=>field.key==="discography_reviews"&&field.disposition==="deferred")).toBe(true);
    expect(resources.rows.find((row:{id:string})=>row.id==="R16").fields.every((field:{disposition:string})=>field.disposition==="excluded")).toBe(true);
    for(const privateField of ["sourceFieldText","sourceTerms","sha256","data/raw","/mnt/","captureHash"])
      expect(JSON.stringify(resources)).not.toContain(privateField);
  });
  it("correlaciona también los fallos anteriores al handler de búsqueda", async () => {
    const failed = await search("early-limit"); expect(failed.statusCode).toBe(429);
    expect(failed.headers["x-crv-search-receipt"]).toBeTruthy();
    await confirm(String(failed.headers["x-crv-search-receipt"])); await searchCollector.flush();
    const row = (await getPool().query("SELECT snapshot FROM ingest.search_operations WHERE sample='early-limit'")).rows[0];
    expect(row.snapshot).toMatchObject({ outcome: "technical_failure", incident: "rate_limit" });
  });
  it("separa una respuesta inválida vista por el cliente de los resultados vacíos del servidor", async () => {
    const response = await search("cliente-invalido");
    const logicalId = randomUUID();
    await confirm(String(response.headers["x-crv-search-receipt"]), logicalId, { clientIncident: "invalid_response" });
    await searchCollector.flush();
    const row = (await getPool().query("SELECT snapshot,had_incident FROM ingest.search_operations WHERE search_id=$1", [logicalId])).rows[0];
    expect(row).toMatchObject({ had_incident: true, snapshot: { backendOutcome: "empty", clientReportedIncident: "invalid_response", outcome: "technical_failure", incident: "invalid_response", resultReason: "client_reported_incident" } });
  });
  it("registra un fallo técnico sin contarlo como consulta vacía", async () => {
    let failed;
    for (let i = 0; i < 185; i++) {
      const result = await search("Desorden");
      if (result.statusCode === 429) { failed = result; break; }
    }
    expect(failed?.statusCode).toBe(429);
    const logicalId = randomUUID();
    await confirm(String(failed!.headers["x-crv-search-receipt"]), logicalId);
    await searchCollector.flush();
    const row = (await getPool().query("SELECT snapshot FROM ingest.search_operations WHERE had_incident AND sample='Desorden'")).rows[0];
    expect(row.snapshot).toMatchObject({ outcome: "technical_failure", incident: "rate_limit" });
    const retry = await search("Desorden", { ...visitor, "x-forwarded-for": "198.51.100.21" });
    await confirm(String(retry.headers["x-crv-search-receipt"]), logicalId); await searchCollector.flush();
    const recovered = (await getPool().query("SELECT * FROM ingest.search_operations WHERE search_id=$1", [logicalId])).rows[0];
    expect(recovered.had_incident).toBe(true); expect(recovered.snapshot.outcome).toBe("results");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_attempts WHERE search_id=$1", [logicalId])).rows[0].n).toBe(2);
  });
  it("un modelo o fuente contradictoria conserva la decisión de Brian y abre un solo caso existente", async () => {
    const pool = getPool();
    await pool.query("INSERT INTO ingest.emotion_tag_decisions(tag_key,category,note,decided_by) VALUES('hot','no_expresa_emocion','No acredita emoción','Brian')");
    await pool.query(`INSERT INTO public.entity_user_tags(artist_id,source,tag,weight,emotions)
      SELECT id,'lastfm','hot',10,'{"categoria":"cachonda","p":0.999,"modelo":"future-v2"}' FROM public.artists WHERE name='Desorden Público'`);
    await pool.query(`UPDATE public.entity_user_tags SET emotions='{"categoria":"cachonda","p":0.999}' WHERE tag='hot'`);
    expect((await pool.query("SELECT emotions FROM public.entity_user_tags WHERE tag='hot'")).rows[0].emotions).toMatchObject({ categoria: "no_expresa_emocion", decision: "editorial" });
    expect((await pool.query("SELECT count(*)::int AS n FROM ingest.review_queue WHERE payload->>'type'='search_editorial_contradiction'")).rows[0].n).toBe(1);
    await refreshSearchIndex();
    expect((await pool.query("SELECT category,decided_by FROM ingest.emotion_tag_decisions WHERE tag_key='hot'")).rows[0]).toEqual({ category: "no_expresa_emocion", decided_by: "Brian" });
  });
  it("acota ejemplos por día sin perder contadores ni conservar otra copia en snapshots", async () => {
    await getPool().query(`INSERT INTO ingest.search_operations(search_id,confirmed_at,editorial_date,entry_point,confirmation,origin,snapshot,attempt_at,had_incident,sample,normalized,fingerprint,query_length,version)
      SELECT gen_random_uuid(),now(),editorial_date,entry_point,confirmation,origin,snapshot,attempt_at,had_incident,'fixture cap','fixture cap','fixture',11,version
      FROM (SELECT * FROM ingest.search_operations LIMIT 1) o CROSS JOIN generate_series(1,500)`);
    const response = await search("privacy-sample-limit", { ...visitor, "x-forwarded-for": "198.51.100.22" });
    const logicalId = randomUUID(); await confirm(String(response.headers["x-crv-search-receipt"]), logicalId); await searchCollector.flush();
    const row = (await getPool().query("SELECT * FROM ingest.search_operations WHERE search_id=$1", [logicalId])).rows[0];
    expect(row).toBeTruthy(); expect(row.sample).toBeNull(); expect(row.normalized).toBeNull();
    expect(row.snapshot.intention.interpretation).toBe("unrecognized");
    expect(JSON.stringify(row.snapshot)).not.toContain("privacy-sample-limit");
    const attempts = (await getPool().query("SELECT snapshot FROM ingest.search_attempts WHERE search_id=$1", [logicalId])).rows;
    expect(attempts).toHaveLength(1); expect(JSON.stringify(attempts)).not.toContain("privacy-sample-limit");
  });
  it("agrega y retiene sin borrar históricos del embudo ni muestras legacy", async () => {
    await getPool().query(`INSERT INTO ingest.search_operations(search_id,confirmed_at,editorial_date,entry_point,confirmation,origin,snapshot,attempt_at,had_incident,query_length,version)
      SELECT $1,now()-interval '40 days',current_date-40,entry_point,confirmation,origin,snapshot,attempt_at,had_incident,query_length,version
      FROM ingest.search_operations LIMIT 1`, [randomUUID()]);
    await retainSearchAnalytics();
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_operations WHERE confirmed_at<now()-interval '35 days'")).rows[0].n).toBe(0);
    expect((await getPool().query("SELECT totals->>'total' AS n FROM ingest.search_daily WHERE editorial_date=current_date-40")).rows[0].n).toBe("1");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.search_daily")).rows[0].n).toBeGreaterThan(0);
    const source = await readFile(new URL("../../migrations/0085_search_observability.down.sql", import.meta.url), "utf8");
    await getPool().query(source); await getPool().query(await readFile(new URL("../../migrations/0085_search_observability.up.sql", import.meta.url), "utf8"));
    expect((await getPool().query("SELECT misses FROM ingest.search_misses WHERE normalized_query='historica'")).rows[0].misses).toBe(7);
    expect((await getPool().query("SELECT to_regclass('ingest.discovery_metric_events') AS t")).rows[0].t).not.toBeNull();
  });
  it("una prueba de campos obsoleta oculta su detalle sin bloquear el resto del tablero ni exponer el error",async()=>{
    const failure=vi.spyOn(resourceFields,"resourceFieldAdministration").mockRejectedValueOnce(new Error("private/path/capture-missing"));
    try{
      const result=await app.inject({url:"/search/administration",headers:{authorization:"Bearer search-stage1-internal-test-token"}});
      expect(result.statusCode).toBe(200);
      expect(result.json().resources).toMatchObject({fieldReviewStatus:"needs_review",fieldReview:null});
      expect(result.json().resources.rows.every((row:{fields:unknown})=>row.fields===null)).toBe(true);
      expect(result.json().resources.rows.find((row:{id:string})=>row.id==="R16").status).toBe("withdrawn");
      expect(result.json().summary).toBeTruthy();expect(result.body).not.toContain("private/path");
    }finally{failure.mockRestore();}
  });
});
