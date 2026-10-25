import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { migrateUp } from "../../src/db/migrate.js";
import { loadReviewIdentityContext } from "../../src/review/visual-identity.js";
import { normalizeRecord } from "../../src/normalization/claims.js";
import { persistClaim } from "../../src/claims/persistence.js";
import { decideClaimReview, getClaimReviewGroup, listClaimReviewGroups } from "../../src/review/visual-workbench.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRun } from "../../src/merge/run-undo.js";
import type { ClaimReviewDetail } from "../../src/shared/claim-review.js";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { registerClaimReviewRoutes } from "../../src/api/routes/claim-review.js";

let sourceId: number;
async function one(sql: string, params: unknown[] = []): Promise<number> { return Number((await getPool().query<{ id: string }>(sql,params)).rows[0]!.id); }
async function artist(name: string): Promise<number> { return one("INSERT INTO public.artists(name,picture_url) VALUES($1,'/crv/media/fixture.jpg') RETURNING id",[name]); }
async function claim(artistId: number, name: string, field: string, value: unknown): Promise<number> {
  const normalized = normalizeRecord({ entityKind: "artist",identity: name,extractor: "fixture",extractorVersion: "1",fields: [{ field,value,evidence: { url: "https://fixture.invalid/evidence",excerpt: `${field}: ${String(value)}` } }] })[0]!;
  const persisted = await persistClaim({ ...normalized,sourceId,artistId,confidence: "low" });
  await getPool().query("INSERT INTO ingest.review_queue(kind,claim_a_id) VALUES('low_confidence',$1)",[persisted.id]);
  return persisted.id;
}
async function detail(id: number): Promise<ClaimReviewDetail> { return (await getClaimReviewGroup(id,{ limit: 50,offset: 0 }))!; }
function decision(group: ClaimReviewDetail, ids: number[], action: "accept" | "reject" = "accept") {
  return decideClaimReview({ groupId: group.group.id,claims: group.changes.filter(item => ids.includes(item.id)).map(({ id,version }) => ({ id,version })),action,note: "Decisión de la prueba",operator: "QA" });
}

describe("bandeja visual de claims: alcance, concurrencia e historial",() => {
  let container: PgContainer;
  beforeAll(async () => {
    container = await startPgContainer();process.env["DATABASE_URL"] = container.databaseUrl;resetEnvCache();
    await applyCore(container.name);await migrateUp();
    sourceId = await one("INSERT INTO ingest.sources(slug,name,site_type,trust_level) VALUES('visual-qa','Fuente de prueba','website','low') RETURNING id");
  },120_000);
  afterAll(async () => { await closeDb();await container?.stop(); },60_000);

  it("muestra imagen y evidencia y acepta solamente los datos seleccionados; se puede deshacer",async () => {
    const target = await artist("Banda Visual QA");
    const city = await claim(target,"Banda Visual QA","origin_city","Caracas");
    const year = await claim(target,"Banda Visual QA","formed_year",1982);
    const view = await detail(city);
    expect(view.group.entity).toMatchObject({ id: target,name: "Banda Visual QA",imageUrl: "/crv/media/fixture.jpg" });
    expect(view.pagination.total).toBe(2);
    expect(view.changes[0]?.evidence[0]).toMatchObject({ url: "https://fixture.invalid/evidence" });
    const result = await decision(view,[city]);
    expect(result).toMatchObject({ accepted: 1,rejected: 0,pending: 0 });
    expect((await getPool().query("SELECT origin_city,formed_year FROM public.artists WHERE id=$1",[target])).rows[0]).toEqual({ origin_city: "Caracas",formed_year: null });
    expect((await getPool().query("SELECT status FROM ingest.claims WHERE id=$1",[year])).rows[0]?.status).toBe("candidate");
    expect((await getPool().query("SELECT status FROM ingest.review_queue WHERE claim_a_id=$1",[year])).rows[0]?.status).toBe("open");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.change_journal WHERE run_id=$1 AND table_name='ingest.claims'",[result.runId])).rows[0]?.n).toBeGreaterThan(0);
    await withOperatorRun({ name: "qa:undo",operator: "QA",note: "Deshacer prueba" },context => undoRun(context,result.runId));
    expect((await getPool().query("SELECT origin_city FROM public.artists WHERE id=$1",[target])).rows[0]?.origin_city).toBeNull();
    expect((await detail(city)).changes.some(item => item.id === city && item.status === "candidate")).toBe(true);
  });

  it("rechaza una previsualización cuando cambia el catálogo y no escribe parcialmente",async () => {
    const target = await artist("Ficha Cambiante QA");
    const city = await claim(target,"Ficha Cambiante QA","origin_city","Mérida");
    const year = await claim(target,"Ficha Cambiante QA","formed_year",1990);
    const view = await detail(city);
    await getPool().query("UPDATE public.artists SET origin_city='Valencia' WHERE id=$1",[target]);
    await expect(decision(view,[city,year])).rejects.toMatchObject({ code: "stale_preview" });
    expect((await getPool().query("SELECT formed_year FROM public.artists WHERE id=$1",[target])).rows[0]?.formed_year).toBeNull();
    expect((await detail(city)).changes).toHaveLength(2);
  });

  it("separa homónimos y no permite colar claims de otra ficha",async () => {
    const a = await artist("Homónimo uno QA");const b = await artist("Homónimo dos QA");
    const ca = await claim(a,"Nombre de fuente compartido QA","origin_city","Caracas");
    const cb = await claim(b,"Nombre de fuente compartido QA","origin_city","Valencia");
    const listing = await listClaimReviewGroups({ limit: 50,offset: 0,q: "Nombre de fuente compartido QA" });
    expect(listing.pagination.total).toBe(2);
    const first = await detail(ca);const second = await detail(cb);
    await expect(decideClaimReview({ groupId: ca,claims: [...first.changes,...second.changes].map(({ id,version }) => ({ id,version })),action: "accept",note: "Prueba",operator: "QA" })).rejects.toMatchObject({ code: "stale_preview" });
  });

  it("exige elegir una alternativa y permite descartar sin borrar evidencia",async () => {
    const target = await artist("Alternativas QA");
    const a = await claim(target,"Alternativas QA","formed_year",1980);const b = await claim(target,"Alternativas QA","formed_year",1981);
    await expect(decision(await detail(a),[a,b])).rejects.toMatchObject({ code: "invalid" });
    const result = await decision(await detail(a),[b],"reject");expect(result.rejected).toBe(1);
    expect((await getPool().query("SELECT status FROM ingest.claims WHERE id=$1",[b])).rows[0]?.status).toBe("rejected");
    expect((await getPool().query("SELECT count(*)::int n FROM ingest.claim_evidence WHERE claim_id=$1",[b])).rows[0]?.n).toBe(1);
    expect((await detail(a)).changes.map(item => item.id)).toEqual([a]);
    await withOperatorRun({ name: "qa:undo",operator: "QA",note: "Deshacer descarte" },context => undoRun(context,result.runId));
    expect((await detail(a)).changes.find(item => item.id === b)?.status).toBe("candidate");
  });

  it("resuelve la contradicción con el valor elegido y conserva ambos claims",async () => {
    const target = await artist("Contradicción QA");
    const a = await claim(target,"Contradicción QA","formed_year",1980);await decision(await detail(a),[a]);
    const b = await claim(target,"Contradicción QA","formed_year",1981);
    const proposed = await decision(await detail(b),[b]);expect(proposed.pending).toBe(1);
    const view = await detail(b);expect(view.group.conflicts).toBe(2);
    expect(view.changes.find(item => item.id === b)).toMatchObject({ canAccept: true,canReject: false,status: "conflict" });
    const chosen = await decision(view,[b]);expect(chosen.accepted).toBe(1);
    expect((await getPool().query("SELECT formed_year FROM public.artists WHERE id=$1",[target])).rows[0]?.formed_year).toBe(1981);
    expect((await getPool().query("SELECT count(*)::int n FROM ingest.claims WHERE id=ANY($1::bigint[])",[[a,b]])).rows[0]?.n).toBe(2);
  });

  it("mantiene las decisiones de identidad en su comparación específica",async () => {
    const target = await artist("Identidad dudosa QA");const id = await claim(target,"Identidad dudosa QA","name","Identidad dudosa QA");
    const review = await one("INSERT INTO ingest.review_queue(kind,claim_a_id) VALUES('ambiguous_alias',$1) RETURNING id",[id]);
    const view = await detail(id);expect(view.changes[0]).toMatchObject({ requiresReview: true,reviewId: review,canAccept: false,canReject: false });
    await expect(decision(view,[id])).rejects.toMatchObject({ code: "needs_review" });
  });



  it("deriva las contradicciones sin claim rival a su resolución específica",async () => {
    const target = await artist("Conflicto sin rival QA");
    const id = await claim(target,"Conflicto sin rival QA","origin_city","Caracas");
    const review = await one("INSERT INTO ingest.review_queue(kind,claim_a_id,payload) VALUES('field_conflict',$1,$2::jsonb) RETURNING id",[id,JSON.stringify({ entityKind: "artist",targetId: target,field: "origin_city",canonicalValue: "Valencia",proposedValue: "Caracas" })]);
    const view = await detail(id);
    expect(view.changes[0]).toMatchObject({ requiresReview: true,reviewId: review,canAccept: false });
    await expect(decision(view,[id])).rejects.toMatchObject({ code: "needs_review" });
  });

  it("ofrece contexto visual de dos identidades sin confundir sus fotos",async () => {
    const a = await one("INSERT INTO public.persons(name,picture_url,nationality) VALUES('Identidad A QA','/crv/media/a.jpg','Venezuela') RETURNING id");
    const b = await one("INSERT INTO public.persons(name,picture_url,nationality) VALUES('Identidad B QA','/crv/media/b.jpg','Colombia') RETURNING id");
    const review = await one("INSERT INTO ingest.review_queue(kind,person_a_id,person_b_id) VALUES('person_duplicate',$1,$2) RETURNING id",[a,b]);
    const context = await loadReviewIdentityContext(review);
    expect(context?.incoming).toMatchObject({ id: a,name: "Identidad A QA",imageUrl: "/crv/media/a.jpg" });
    expect(context?.candidate).toMatchObject({ id: b,name: "Identidad B QA",imageUrl: "/crv/media/b.jpg" });
  });

  it("serializa la API real y pagina las fichas en el servidor",async () => {
    const app = Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);await registerClaimReviewRoutes(app);
    try {
      const listing = await app.inject({ method: "GET",url: "/claims/review/groups?limit=1&offset=0" });
      expect(listing.statusCode).toBe(200);expect(listing.json().data).toHaveLength(1);expect(listing.json().pagination.total).toBeGreaterThan(1);
      const id = listing.json().data[0].id as number;
      const view = await app.inject({ method: "GET",url: `/claims/review/groups/${id}?limit=1` });
      expect(view.statusCode).toBe(200);expect(view.json().changes[0].version).toMatch(/^[a-f0-9]{64}$/);
    } finally { await app.close(); }
  });
});
