import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { declarePersonsDistinct, getPersonPairResearch, getResearchJob, listPersonPairResearch, recoverResearchJobs, startPersonPairResearch } from "../../src/ambiguity/person-pair-research.js";
import { buildPersonComparison, personContext } from "../../src/ambiguity/person-web-verification.js";
import { loadPersonFacts } from "../../src/review/person-candidates.js";
import { personComparisonSchema } from "../../src/api/person-comparison-schema.js";
import { listPersonDuplicateCandidates } from "../../src/api/repositories/persons.js";

describe("investigación persistente de un par de personas", () => {
  let container: PgContainer;
  let a: number;
  let b: number;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    a = Number((await getPool().query("INSERT INTO public.persons(name) VALUES('Persona A') RETURNING id")).rows[0]!.id);
    b = Number((await getPool().query("INSERT INTO public.persons(name) VALUES('Persona B') RETURNING id")).rows[0]!.id);
  }, 120_000);
  afterAll(async () => { await closeDb(); await container?.stop(); }, 60_000);

  it("muestra el mismo expediente desde ambas fichas y conserva la versión más reciente", async () => {
    const hash = "a".repeat(64);
    await getPool().query(`INSERT INTO ingest.person_web_verifications
      (person_a_id,person_b_id,dossier_hash,status,verdict,rationale,evidence,sources)
      VALUES($1,$2,$3,'proposed','unknown','Sin pruebas','[]','[]')`, [a, b, hash]);
    expect((await getPersonPairResearch(a, b))?.rationale).toBe("Sin pruebas");
    expect((await getPersonPairResearch(b, a))?.rationale).toBe("Sin pruebas");
    expect((await listPersonPairResearch(a))[0]?.otherId).toBe(b);
    expect((await listPersonPairResearch(b))[0]?.otherId).toBe(a);

    await getPool().query("UPDATE ingest.person_web_verifications SET status='superseded' WHERE person_a_id=$1 AND person_b_id=$2", [a, b]);
    await getPool().query(`INSERT INTO ingest.person_web_verifications
      (person_a_id,person_b_id,dossier_hash,status,verdict,rationale,evidence,sources)
      VALUES($1,$2,$3,'proposed','different','Dos trayectorias citadas','[{"supports":"different","url":"https://example.com","title":"Fuente","quote":"Dos músicos"}]','[]')`,
    [a, b, "b".repeat(64)]);
    expect((await getPersonPairResearch(a, b))?.rationale).toBe("Dos trayectorias citadas");
    expect(await listPersonPairResearch(a)).toHaveLength(1);
  });

  it("un trabajo interrumpido queda recuperable tras reiniciar la API", async () => {
    const id = Number((await getPool().query(`INSERT INTO ingest.person_identity_research_jobs
      (person_a_id,person_b_id,status) VALUES($1,$2,'running') RETURNING id`, [a, b])).rows[0]!.id);
    await recoverResearchJobs();
    expect(await getResearchJob(id)).toMatchObject({ status: "failed", aId: a, bId: b });
  });

  it("responde enseguida, evita trabajo duplicado y publica el resultado al terminar", async () => {
    let finish: ((result: { id: number }) => void) | undefined;
    const work = () => new Promise<{ id: number }>((resolve) => { finish = resolve; });
    const first = await startPersonPairResearch(a, b, work);
    const second = await startPersonPairResearch(b, a, work);
    expect(second.id).toBe(first.id);
    expect(["queued", "running"]).toContain(second.status);
    for (let attempt = 0; attempt < 30 && !finish; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finish).toBeDefined();
    finish!({ id: (await getPersonPairResearch(a, b))!.id });
    let done = await getResearchJob(first.id);
    for (let attempt = 0; attempt < 30 && done?.status !== "done"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      done = await getResearchJob(first.id);
    }
    expect(done).toMatchObject({ status: "done", verificationId: (await getPersonPairResearch(a, b))!.id });
  });

  it("el filtro usa el puntaje ajustado por evidencia y recalcula las señales actuales", async () => {
    await getPool().query("UPDATE public.persons SET name='Francisco González' WHERE id IN ($1,$2)", [a,b]);
    const bands = (await getPool().query("INSERT INTO public.artists(name) VALUES('Banda Norte QA'),('Banda Sur QA') RETURNING id")).rows;
    await getPool().query("INSERT INTO public.artist_members(artist_id,person_id,role,from_year) VALUES($1,$2,'Bass',2013),($3,$4,'Bass',2013)", [bands[0]!.id,a,bands[1]!.id,b]);
    const [left,right,allFacts] = await Promise.all([personContext(a),personContext(b),loadPersonFacts(getPool())]);
    const proof = [{ supports: "same" as const, url: "https://norte.example/perfil", title: "Perfil", quote: "Francisco González Bass" }];
    const comparison = buildPersonComparison(left,right,[
      { url: proof[0]!.url, title: "Perfil", content: "Francisco González Bass en Banda Norte QA 2013. Francisco González Bass en Banda Sur QA 2013.", contentHash:"n", fetchedAt:"2026-10-07" },
      { url: "https://sur.example/perfil", title: "Perfil", content: "Francisco González Bass en Banda Sur QA 2013.", contentHash:"s", fetchedAt:"2026-10-07" },
    ], { verdict: "same", rationale: "Conexión entre proyectos", evidence: proof }, [allFacts.find((p)=>p.id===a)!,allFacts.find((p)=>p.id===b)!]);
    await getPool().query(`INSERT INTO ingest.review_queue(kind,person_a_id,person_b_id,priority,status,payload,notes)
      VALUES('person_duplicate',$1,$2,5,'open','{"score":0.01}','Prueba')`, [a, b]);
    await getPool().query("UPDATE ingest.person_web_verifications SET status='superseded' WHERE person_a_id=$1 AND person_b_id=$2 AND status='proposed'", [a, b]);
    await getPool().query(`INSERT INTO ingest.person_web_verifications
      (person_a_id,person_b_id,dossier_hash,status,verdict,rationale,evidence,sources,comparison)
      VALUES($1,$2,$3,'proposed','same','Proyecto comprobado',$4::jsonb,'[]',$5::jsonb)`,
    [a, b, "c".repeat(64), JSON.stringify(proof), JSON.stringify(comparison)]);
    const all = await listPersonDuplicateCandidates({ limit: 10, offset: 0 });
    const row = all.rows.find((item) => item.a.id === a && item.b.id === b)!;
    expect(row.score).not.toBe(0.01);
    expect(row.effectiveScore).toBeCloseTo(0.8);
    expect(row.score).toBeCloseTo(0.2);
    expect(personComparisonSchema.parse(row.comparison).a.id).toBe(a);
    expect((await getPersonPairResearch(b,a))?.comparison?.b.id).toBe(b);
    const filtered = await listPersonDuplicateCandidates({ limit: 10, offset: 0, minScore: 0.7 });
    expect(filtered.rows.some((item) => item.reviewId === row.reviewId)).toBe(true);
  });

  it("registrar una decisión humana conserva motivo y run de auditoría", async () => {
    const result = await declarePersonsDistinct(a, b, "operador-prueba", "Son dos trayectorias documentadas por separado");
    expect(result.runId).toBeGreaterThan(0);
    expect(result.closedReviews).toBe(1);
    const row = (await getPool().query(`SELECT decided_by,note FROM ingest.curation_distinct_pairs
      WHERE kind='person' AND a_id=$1 AND b_id=$2`, [a, b])).rows[0];
    expect(row).toMatchObject({ decided_by: "operador-prueba", note: "Son dos trayectorias documentadas por separado" });
    expect((await listPersonPairResearch(b))[0]?.declaredDistinct).toBe(true);
  });
});
