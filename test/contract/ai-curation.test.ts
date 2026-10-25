import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import {
  startPlan,
  waitForPlans,
  getPlan,
  savePlan,
  applyPlan,
  decidePlan,
  refreshPlan,
  recoverPlans,
  resumePlan,
} from "../../src/curation/ai/store.js";
import { planningContext } from "../../src/curation/ai/context.js";
import { executePlan } from "../../src/curation/ai/executor.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRun } from "../../src/merge/run-undo.js";
import { waitForCurationScans } from "../../src/curation/scan.js";
import { draftSchema } from "../../src/curation/ai/schema.js";
import { planWithDeepSeek } from "../../src/curation/ai/planner.js";
import { DeepSeekBudgetExceeded } from "../../src/ai/budget.js";
import {
  DeepSeekGateway,
  PostgresDeepSeekRunStore,
  MockDeepSeekTransport,
} from "../../src/ai/gateway.js";
import type {
  CatalogDraft,
  CatalogEvidence,
  CatalogPlan,
} from "../../src/curation/ai/types.js";

const TOKEN = "curation-plan-test-token-0123456789";
const evidence: CatalogEvidence[] = [
  {
    id: "E1",
    url: "https://catalogo.example/fuente",
    quote:
      "Banda QA: Caracas y Valencia. Publicó Disco Completo en 2001. Rock QA. Banda Alternativa. Músico QA: Bass, 1999 a 2004, hasta 2006. Pistas A y B.",
    origin: "page",
    fetchedAt: "2026-10-08T00:00:00Z",
    contentHash: "fixture",
    label: "Fuente QA",
  },
];
const base = {
  label: "Cambio QA",
  reason: "Fuente QA documenta el cambio",
  evidenceIds: ["E1"],
  enabled: true,
};
function draft(operations: unknown[]): CatalogDraft {
  return draftSchema.parse({
    summary: "Propuesta QA",
    unresolved: [],
    operations,
  });
}
describe("curaduría IA: catálogo aislado, autorización y reversión", () => {
  let container: PgContainer,
    app: FastifyInstance,
    artist: number,
    person: number,
    album: number,
    first: number,
    second: number;
  let genre: string;
  const headers = { authorization: `Bearer ${TOKEN}` };
  let preparationSequence=0;
  async function prepared(input: CatalogDraft): Promise<CatalogPlan> {
    const p = await startPlan(
      "artist",
      artist,
      `Revisar ficha con fuentes documentadas, caso de contrato ${++preparationSequence}`,
      "QA",
      async () => ({
        draft: input,
        evidence,
        usage: {
          calls: 1,
          cachedCalls: 0,
          tokensIn: 300,
          tokensOut: 100,
          model: "deepseek-flash",
        },
      }),
    );
    await waitForPlans();
    return getPlan(p.id);
  }
  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    process.env["CRV_OPERATOR_TOKEN"] = TOKEN;
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    const db = getPool();
    artist = Number(
      (
        await db.query(
          "INSERT INTO public.artists(name) VALUES('Banda QA') RETURNING id",
        )
      ).rows[0].id,
    );
    person = Number(
      (
        await db.query(
          "INSERT INTO public.persons(name) VALUES('Músico QA') RETURNING id",
        )
      ).rows[0].id,
    );
    album = Number(
      (
        await db.query(
          "INSERT INTO public.albums(title,artist_id) VALUES('Disco Existente',$1) RETURNING id",
          [artist],
        )
      ).rows[0].id,
    );
    const tracks = (
      await db.query(
        "INSERT INTO public.tracks(album_id,title,disc_number,track_number) VALUES($1,'Primera',1,1),($1,'Segunda',1,2) RETURNING id",
        [album],
      )
    ).rows;
    first = Number(tracks[0].id);
    second = Number(tracks[1].id);
    const family = (
      await db.query(
        "INSERT INTO ingest.genres(name,slug,level) VALUES('Familia QA','familia-qa','family') RETURNING id",
      )
    ).rows[0].id;
    genre = (
      await db.query(
        "INSERT INTO ingest.genres(name,slug,level,parent_genre_id) VALUES('Rock QA','rock-qa','genre',$1) RETURNING slug",
        [family],
      )
    ).rows[0].slug;
    app = await buildApp();
  }, 180000);
  afterAll(async () => {
    await waitForPlans();
    await waitForCurationScans();
    await app?.close();
    await closeDb();
    delete process.env["CRV_OPERATOR_TOKEN"];
    resetEnvCache();
    await container?.stop();
  }, 60000);
  it("protege todos los recursos y entrega campos y taxonomía válidos", async () => {
    for (const url of [
      "/curation/ai/vocabulary",
      "/curation/ai/plans",
      "/curation/ai/plans/1",
    ])
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const vocabulary = await app.inject({
      method: "GET",
      url: "/curation/ai/vocabulary",
      headers,
    });
    expect(vocabulary.statusCode).toBe(200);
    expect(
      vocabulary.json().entities.album.map((f: { key: string }) => f.key),
    ).toContain("releaseDateText");
    expect(vocabulary.json().genres.length).toBeGreaterThan(0);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/curation/ai/plans",
          payload: {
            kind: "artist",
            entityId: artist,
            instruction: "Revisar datos documentados",
          },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("recorta las notas largas armadas por el código en vez de perder la preparación", async () => {
    const long = `Límite de investigación en ${Array.from({ length: 80 }, (_, i) => `finding.${i}`).join(", ")}: las citas se conservan para reintentar.`;
    expect(long.length).toBeGreaterThan(700);
    const plan = await prepared({ ...draft([]), unresolved: [long, long, "Duda corta"] });
    expect(plan.status, plan.error ?? "").toBe("ready");
    expect(plan.draft!.unresolved).toHaveLength(2);
    expect(plan.draft!.unresolved[0]).toHaveLength(700);
    expect(plan.draft!.unresolved[0]!.endsWith("…")).toBe(true);
  });
  it("recupera contexto acotado del sistema, hallazgos, fuentes y relaciones", async () => {
    const result = await planningContext(
      getPool(),
      "artist",
      artist,
      "Revisar ficha documentada",
    );
    expect(JSON.stringify(result.context).length).toBeLessThan(40000);
    expect(result.context["root"]).toMatchObject({
      id: artist,
      label: "Banda QA",
    });
    expect(result.context["taxonomy"]).toMatchObject({
      columns: ["slug", "name", "level", "parentSlug"],
    });
  });
  it("vincula el género descubierto a sus citas y conserva la biografía completa para combinar textos", async () => {
    const biography = "Detalle histórico que se conserva. ".repeat(90) + "HECHO ÚNICO AL FINAL";
    await getPool().query("UPDATE public.artists SET biography=$2 WHERE id=$1", [artist, biography]);
    await getPool().query("INSERT INTO ingest.entity_verification_reports(entity_kind,entity_id,snapshot_hash,report,requested_by) VALUES('artist',$1,'fixture',$2::jsonb,'QA')", [artist, JSON.stringify({ createdAt: "2026-10-10", findings: [], suggestions: [{ key: "genres.rap", label: "Género faltante", area: "genres", value: null, observed: "Rap", status: "missing", context: ["Banda QA"], explanation: "La fuente documenta Rap", evidence: [{ url: "https://catalogo.example/generos", quote: "Banda QA interpreta Rap.", origin: "page", fetchedAt: "2026-10-10" }] }] })]);
    const { context, evidence: citations } = await planningContext(getPool(), "artist", artist, "Corregir el género faltante");
    const unit = (context["report"] as { pending: Array<{ observed: string; evidenceIds: string[] }> }).pending[0]!;
    expect(unit.observed).toBe("Rap");
    expect(citations.find((item) => item.id === unit.evidenceIds[0])?.quote).toBe("Banda QA interpreta Rap.");
    expect((context["narrativeOriginals"] as { current: { biography: string } }).current.biography).toBe(biography);
    await getPool().query("DELETE FROM ingest.entity_verification_reports WHERE entity_kind='artist' AND entity_id=$1", [artist]);
  });
  it("mantiene las asignaciones de género aunque el vecindario del catálogo se reduzca", async () => {
    await getPool().query("INSERT INTO ingest.artist_genres(artist_id,genre_id,role,status,source_kind,decision_rule,decision_kind) SELECT $1,id,'secondary','confirmed','ai','qa','rule' FROM ingest.genres WHERE slug=$2", [artist, genre]);
    try {
      const result = await planningContext(getPool(), "artist", artist, "Revisar géneros");
      expect(result.context["currentGenres"]).toContainEqual(expect.objectContaining({ slug: genre, role: "secondary", status: "confirmed" }));
    } finally { await getPool().query("DELETE FROM ingest.artist_genres WHERE artist_id=$1", [artist]); }
  });
  it("conserva todos los pendientes en el inventario general y carga únicamente el hallazgo elegido con sus citas", async () => {
    const findings = Array.from({ length: 75 }, (_, index) => ({
      key: `missing.${index}`, label: `Dato ${index}`, area: "genres", value: null, observed: `Valor ${index}`,
      status: "missing", context: ["Banda QA"], explanation: "La fuente documenta el dato", evidence: [{ url: `https://catalogo.example/dato/${index}`, quote: `Banda QA documenta exactamente Valor ${index}.`, origin: "page", fetchedAt: "2026-10-10" }],
    }));
    await getPool().query("INSERT INTO ingest.entity_verification_reports(entity_kind,entity_id,snapshot_hash,report,requested_by) VALUES('artist',$1,'fixture',$2::jsonb,'QA')", [artist, JSON.stringify({ createdAt: "2026-10-10", findings, suggestions: [] })]);
    try {
      const broad = await planningContext(getPool(), "artist", artist, "Revisar todos los datos pendientes");
      expect((broad.context["report"] as { pending: unknown[] }).pending).toHaveLength(75);
      const result = await planningContext(getPool(), "artist", artist, "Prepara únicamente la corrección del hallazgo missing.74 (Dato 74).");
      const report = result.context["report"] as { selectedKey: string; pending: Array<{ key: string; evidenceIds: string[] }> };
      expect(report.selectedKey).toBe("missing.74");
      expect(report.pending).toHaveLength(1);
      expect(report.pending[0]!.key).toBe("missing.74");
      expect(result.evidence.find(e => e.id === report.pending[0]!.evidenceIds[0])?.quote).toBe("Banda QA documenta exactamente Valor 74.");
    } finally { await getPool().query("DELETE FROM ingest.entity_verification_reports WHERE entity_kind='artist' AND entity_id=$1", [artist]); }
  });
  it("preparar y editar no escriben al catálogo; implementar registra alias, campos y géneros", async () => {
    const before = (
      await getPool().query("SELECT count(*)::int AS n FROM ingest.scrape_runs")
    ).rows[0].n;
    let p = await prepared(
      draft([
        {
          ...base,
          key: "nombre",
          op: "replace_fields",
          target: { kind: "artist", id: artist },
          values: { originCity: "Caracas" },
        },
        {
          ...base,
          key: "alias",
          op: "add_alias",
          target: { kind: "artist", id: artist },
          alias: "Banda Alternativa",
          aliasType: "name_variant",
          isPrimary: false,
        },
        {
          ...base,
          key: "genero",
          op: "assign_genre",
          target: { kind: "artist", id: artist },
          genreSlug: genre,
          role: "primary",
        },
      ]),
    );
    expect(p.error).toBeNull();
    expect(p.preview?.items.map((i) => i.error)).toEqual([null, null, null]);
    expect(p.preview?.ready).toBe(true);
    expect(
      (
        await getPool().query(
          "SELECT origin_city FROM public.artists WHERE id=$1",
          [artist],
        )
      ).rows[0].origin_city,
    ).toBeNull();
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int AS n FROM ingest.scrape_runs",
        )
      ).rows[0].n,
    ).toBe(before);
    const edit = structuredClone(p.draft!);
    (
      edit.operations[0] as Extract<
        CatalogDraft["operations"][number],
        { op: "replace_fields" }
      >
    ).values["originCity"] = "Valencia";
    p = await savePlan(p.id, p.revision, edit, [], "Admin QA");
    expect(p.usage.calls).toBe(1);
    const response = await app.inject({
      method: "POST",
      url: `/curation/ai/plans/${p.id}/implement`,
      headers,
      payload: {
        revision: p.revision,
        previewHash: p.preview!.hash,
        confirmSensitive: false,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json() as CatalogPlan;
    expect(result.status).toBe("applied");
    expect(
      (await applyPlan(p.id, p.revision, p.preview!.hash, false, "QA")).runId,
    ).toBe(result.runId);
    expect(
      (
        await getPool().query(
          "SELECT origin_city FROM public.artists WHERE id=$1",
          [artist],
        )
      ).rows[0].origin_city,
    ).toBe("Valencia");
    expect(
      (
        await getPool().query(
          "SELECT alias FROM ingest.artist_aliases WHERE artist_id=$1",
          [artist],
        )
      ).rows[0].alias,
    ).toBe("Banda Alternativa");
    await waitForCurationScans();
    await withOperatorRun(
      { name: "qa:undo", operator: "QA", note: "Revertir propuesta" },
      (ctx) => undoRun(ctx, result.runId!),
    );
    expect(
      (
        await getPool().query(
          "SELECT origin_city FROM public.artists WHERE id=$1",
          [artist],
        )
      ).rows[0].origin_city,
    ).toBeNull();
  });
  it("ordena intercambios de pistas sin colisiones y deshace exactamente el orden original", async () => {
    let p = await prepared(
      draft([
        {
          ...base,
          key: "orden",
          op: "reorder_tracks",
          album: { kind: "album", id: album },
          positions: [
            {
              track: { kind: "track", id: first },
              discNumber: 1,
              trackNumber: 2,
            },
            {
              track: { kind: "track", id: second },
              discNumber: 1,
              trackNumber: 1,
            },
          ],
        },
      ]),
    );
    p = await savePlan(p.id, p.revision, p.draft!, ["orden"], "Admin QA");
    expect(p.preview?.items[0]?.error).toBeNull();
    const applied = await applyPlan(
      p.id,
      p.revision,
      p.preview!.hash,
      false,
      "QA",
    );
    expect(
      (
        await getPool().query(
          "SELECT id::int FROM public.tracks WHERE album_id=$1 ORDER BY track_number",
          [album],
        )
      ).rows.map((r) => r.id),
    ).toEqual([second, first]);
    await waitForCurationScans();
    await withOperatorRun(
      {
        name: "qa:undo-order",
        operator: "QA",
        note: "Volver al orden inicial",
      },
      (ctx) => undoRun(ctx, applied.runId!),
    );
    expect(
      (
        await getPool().query(
          "SELECT id::int FROM public.tracks WHERE album_id=$1 ORDER BY track_number",
          [album],
        )
      ).rows.map((r) => r.id),
    ).toEqual([first, second]);
  });
  it("crea un disco con metadatos, pistas, créditos, alias, formatos y géneros en un solo cambio", async () => {
    const p = await prepared(
      draft([
        {
          ...base,
          key: "completo",
          op: "create_album",
          artist: { kind: "artist", id: artist },
          values: {
            title: "Disco Completo",
            releaseYear: 2001,
            albumType: "studio_album",
            releaseDateText: "2001-05",
            catalogId: "QA-001",
            mediaFormat: "CD",
            description: "Edición documentada",
            coverUrl: "https://catalogo.example/portada.jpg",
          },
          tracks: [
            {
              title: "Tema A",
              discNumber: 1,
              trackNumber: 1,
              durationSeconds: 180,
            },
            { title: "Tema B", discNumber: 1, trackNumber: 2 },
          ],
          credits: [
            {
              target: { kind: "person", id: person },
              role: "Bass",
              creditType: "musician",
            },
          ],
          genres: [{ slug: genre, role: "primary" }],
          aliases: ["Disco Completo QA"],
          formats: [
            { format: "CD", quality: "HQ", archiveStatus: "published" },
          ],
        },
      ]),
    );
    const reviewed = await savePlan(
      p.id,
      p.revision,
      p.draft!,
      ["completo"],
      "Admin QA",
    );
    expect(reviewed.preview?.items[0]?.error).toBeNull();
    const result = await applyPlan(
      reviewed.id,
      reviewed.revision,
      reviewed.preview!.hash,
      false,
      "QA",
    );
    const id = result.result!.created["completo"]!.id;
    expect(
      (
        await getPool().query(
          "SELECT title,catalog_id,release_date_text FROM public.albums WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toMatchObject({
      title: "Disco Completo",
      catalog_id: "QA-001",
      release_date_text: "2001-05",
    });
    for (const table of [
      "public.tracks",
      "public.album_credits",
      "public.album_formats",
      "ingest.album_aliases",
      "ingest.album_genres",
    ])
      expect(
        (
          await getPool().query(
            `SELECT count(*)::int AS n FROM ${table} WHERE album_id=$1`,
            [id],
          )
        ).rows[0].n,
      ).toBeGreaterThan(0);
    await waitForCurationScans();
    await withOperatorRun(
      { name: "qa:undo-album", operator: "QA", note: "Revertir alta completa" },
      (ctx) => undoRun(ctx, result.runId!),
    );
    expect(
      (await getPool().query("SELECT id FROM public.albums WHERE id=$1", [id]))
        .rowCount,
    ).toBe(0);
  });
  it("detecta cambios posteriores y no aplica una vista previa obsoleta", async () => {
    const p = await prepared(
      draft([
        {
          ...base,
          key: "ciudad",
          op: "replace_fields",
          target: { kind: "artist", id: artist },
          values: { originCity: "Caracas" },
        },
      ]),
    );
    await getPool().query(
      "UPDATE public.artists SET notes='Otra edición' WHERE id=$1",
      [artist],
    );
    await expect(
      applyPlan(p.id, p.revision, p.preview!.hash, false, "QA"),
    ).rejects.toThrow("cambiaron");
    expect(
      (
        await getPool().query(
          "SELECT origin_city FROM public.artists WHERE id=$1",
          [artist],
        )
      ).rows[0].origin_city,
    ).toBeNull();
  });
  it("bloquea colisiones, períodos imposibles, campos ajenos y eliminación con dependencias", async () => {
    const p = await prepared(
      draft([
        {
          ...base,
          key: "ordenmal",
          op: "reorder_tracks",
          album: { kind: "album", id: album },
          positions: [
            {
              track: { kind: "track", id: first },
              discNumber: 1,
              trackNumber: 2,
            },
          ],
        },
        {
          ...base,
          key: "periodomal",
          op: "create_relation",
          kind: "artist_membership",
          endpoints: {
            artistId: { kind: "artist", id: artist },
            personId: { kind: "person", id: person },
          },
          values: { role: "Bass", fromYear: 2005, toYear: 2000 },
        },
        {
          ...base,
          key: "sql",
          op: "replace_fields",
          target: { kind: "artist", id: artist },
          values: { table: "persons" },
        },
        {
          ...base,
          key: "borrarmal",
          op: "remove_entity",
          target: { kind: "artist", id: artist },
        },
      ]),
    );
    expect(p.preview?.ready).toBe(false);
    expect(p.preview?.items.every((i) => i.error)).toBe(true);
    await expect(
      applyPlan(p.id, p.revision, p.preview!.hash, true, "QA"),
    ).rejects.toThrow("Guarda y valida");
  });
  it("un error tardío revierte los cambios anteriores de todo el lote", async () => {
    const input = draft([
      {
        ...base,
        key: "primero",
        op: "replace_fields",
        target: { kind: "artist", id: artist },
        values: { originCity: "No debe persistir" },
      },
      {
        ...base,
        key: "despues",
        op: "replace_fields",
        target: { kind: "artist", id: artist },
        values: { invalidColumn: "No autorizado" },
      },
    ]);
    await expect(
      withOperatorRun(
        { name: "qa:atomic", operator: "QA", note: "Comprobar rollback" },
        (ctx) =>
          executePlan(
            ctx,
            { kind: "artist", id: artist },
            input,
            evidence,
            ["primero", "despues"],
            { preview: false },
          ),
      ),
    ).rejects.toThrow();
    expect(
      (
        await getPool().query(
          "SELECT origin_city FROM public.artists WHERE id=$1",
          [artist],
        )
      ).rows[0].origin_city,
    ).toBeNull();
  });
  it("permite decisiones editoriales explícitas sin atribuir evidencia ficticia a la IA", async () => {
    let p = await prepared(
      draft([
        {
          ...base,
          evidenceIds: [],
          key: "editorial",
          op: "replace_fields",
          target: { kind: "artist", id: artist },
          values: { originCity: "Caracas" },
        },
      ]),
    );
    expect(p.preview?.ready).toBe(false);
    p = await savePlan(p.id, p.revision, p.draft!, ["editorial"], "Admin QA");
    expect(p.preview?.ready).toBe(true);
    expect(p.reviewedKeys).toEqual(["editorial"]);
  });
  it("reanuda una ronda fallida con sus operaciones, consultas ya obtenidas y claves estables",async()=>{
    const entity=Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Rondas QA') RETURNING id")).rows[0].id);
    const planId=Number((await getPool().query("INSERT INTO ingest.ai_curation_plans(entity_kind,entity_id,instruction,requested_by,status) VALUES('artist',$1,'Recuperar rondas y conservar datos','QA','failed') RETURNING id",[entity])).rows[0].id);
    const transport=new MockDeepSeekTransport({summary:"Primer hallazgo",operations:[{...base,key:"primer_alias",op:"add_alias",target:{kind:"artist",id:entity},alias:"Alias durante consulta"}],unresolved:[],lookups:[{type:"catalog",kind:"album",query:String(album)}]},new Error("DeepSeek HTTP 503"),{summary:"Continuación",operations:[],unresolved:[],lookups:[]});
    const gateway=new DeepSeekGateway({baseUrl:"https://mock.invalid",models:{fast:"deepseek-flash",reasoning:"pro",vision:"vision"},maxTokens:6000,timeoutMs:1000},transport,new PostgresDeepSeekRunStore());
    const partial=await planWithDeepSeek("artist",entity,"Recuperar rondas y conservar datos",async()=>{},gateway,{planId});
    expect(partial.complete).toBe(false);expect(partial.draft.operations).toHaveLength(1);
    const saved=(await getPool().query("SELECT result,status FROM ingest.ai_curation_research_tasks WHERE plan_id=$1",[planId])).rows[0];
    expect(saved.status).toBe("failed");expect(saved.result.continuation.lookupIndex).toBe(1);
    const finished=await planWithDeepSeek("artist",entity,"Recuperar rondas y conservar datos",async()=>{},gateway,{planId});
    expect(finished.complete).toBe(true);expect(finished.usage.calls).toBe(1);expect(finished.draft.operations[0]?.key).toBe(partial.draft.operations[0]?.key);
    const input=JSON.parse(transport.requests[2]!.user.replace(/^INPUT JSON:\n/u,""));
    expect(input.previousDraft.operations[0].key).toBe("primer_alias");expect(input.toolResults[0].lookup.query).toBe(String(album));expect(JSON.stringify(input.toolResults[0].result)).toContain("Disco Existente");
    expect(transport.requests).toHaveLength(3);
  });
  it("un presupuesto agotado antes de preguntar no consume la ronda con consultas",async()=>{
    const entity=Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Presupuesto QA') RETURNING id")).rows[0].id);
    const planId=Number((await getPool().query("INSERT INTO ingest.ai_curation_plans(entity_kind,entity_id,instruction,requested_by,status) VALUES('artist',$1,'Ronda sin presupuesto','QA','failed') RETURNING id",[entity])).rows[0].id);
    const transport=new MockDeepSeekTransport({summary:"Con consultas",operations:[],unresolved:[],lookups:[]});
    let refused=false;
    // The budget refuses before the provider is asked, so the mock sees only the resumed round.
    const gateway=new DeepSeekGateway({baseUrl:"https://mock.invalid",models:{fast:"deepseek-flash",reasoning:"pro",vision:"vision"},maxTokens:6000,timeoutMs:1000},{complete:request=>{if(!refused){refused=true;throw new DeepSeekBudgetExceeded("Presupuesto agotado");}return transport.complete(request);}},new PostgresDeepSeekRunStore());
    const partial=await planWithDeepSeek("artist",entity,"Ronda sin presupuesto",async()=>{},gateway,{planId});
    expect(partial.complete).toBe(false);
    const saved=(await getPool().query("SELECT result FROM ingest.ai_curation_research_tasks WHERE plan_id=$1",[planId])).rows[0];
    expect(saved.result.continuation.round).toBe(0);expect(saved.result.usage.calls).toBe(0);
    const finished=await planWithDeepSeek("artist",entity,"Ronda sin presupuesto",async()=>{},gateway,{planId});
    expect(finished.complete).toBe(true);
    expect(JSON.parse(transport.requests[0]!.user.replace(/^INPUT JSON:\n/u,"")).forcePlan).toBe(false);
  });
  it("una caída o cuota del proveedor no consume la ronda, no llega al modelo como error y se reanuda",async()=>{
    const entity=Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Proveedor caído QA') RETURNING id")).rows[0].id);
    const planId=Number((await getPool().query("INSERT INTO ingest.ai_curation_plans(entity_kind,entity_id,instruction,requested_by,status) VALUES('artist',$1,'Proveedor caído','QA','failed') RETURNING id",[entity])).rows[0].id);
    const transport=new MockDeepSeekTransport({summary:"Tras la caída",operations:[],unresolved:[],lookups:[]});
    let failures=0;
    const gateway=new DeepSeekGateway({baseUrl:"https://mock.invalid",models:{fast:"deepseek-flash",reasoning:"pro",vision:"vision"},maxTokens:6000,timeoutMs:1000},{complete:request=>{if(failures<2){failures++;throw new Error("DeepSeek HTTP 429: quota exceeded");}return transport.complete(request);}},new PostgresDeepSeekRunStore());
    const partial=await planWithDeepSeek("artist",entity,"Proveedor caído",async()=>{},gateway,{planId,providerRetryMs:0});
    expect(partial.complete).toBe(false);expect(failures).toBe(2);
    expect(partial.draft.unresolved.join(" ")).toContain("El proveedor de IA no respondió tras reintentar");
    const saved=(await getPool().query("SELECT status,result FROM ingest.ai_curation_research_tasks WHERE plan_id=$1",[planId])).rows[0];
    expect(saved.status).toBe("failed");expect(saved.result.continuation.round).toBe(0);expect(saved.result.continuation.previousError).toBeUndefined();
    const finished=await planWithDeepSeek("artist",entity,"Proveedor caído",async()=>{},gateway,{planId,providerRetryMs:0});
    expect(finished.complete).toBe(true);
    const input=JSON.parse(transport.requests[0]!.user.replace(/^INPUT JSON:\n/u,""));
    expect(input.forcePlan).toBe(false);expect(input.formatError).toBeUndefined();
  });
  it("otro proceso no invalida una preparación vigente y el propietario perdido no puede publicar",async()=>{
    const entity=Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Lease de plan QA') RETURNING id")).rows[0].id);
    let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{enter=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
    const plan=await startPlan("artist",entity,"Ensayar recuperación entre procesos","QA",async(_kind,_id,_instruction,notify)=>{enter();await barrier;await notify("planning",{calls:1,cachedCalls:0,tokensIn:1,tokensOut:1});return {draft:draft([]),evidence:[],usage:{calls:1,cachedCalls:0,tokensIn:1,tokensOut:1}};});
    await entered;await recoverPlans();expect((await getPlan(plan.id)).status).toBe("running");
    await getPool().query("UPDATE ingest.ai_curation_plans SET lease_owner='otro-proceso',lease_expires_at=now()+interval '1 minute' WHERE id=$1",[plan.id]);
    release();await waitForPlans();expect(await getPlan(plan.id)).toMatchObject({status:"running",draft:null});
    await getPool().query("UPDATE ingest.ai_curation_plans SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[plan.id]);await recoverPlans();expect((await getPlan(plan.id)).status).toBe("failed");
    const resumed=await resumePlan(plan.id,"QA",async()=>({draft:draft([]),evidence:[],usage:{calls:0,cachedCalls:0,tokensIn:0,tokensOut:0}}));await waitForPlans();expect(resumed.id).toBe(plan.id);expect((await getPlan(plan.id)).status).toBe("ready");
  });
  it("consulta herramientas de lectura y respeta el presupuesto de dos llamadas al modelo", async () => {
    const validatedBefore=Number((await getPool().query("SELECT count(*)::int AS n FROM ingest.ai_runs WHERE task_kind='curation_plan' AND status='validated'")).rows[0].n);
    const transport = new MockDeepSeekTransport(
      {
        summary: "Consultar disco",
        operations: [{ ...base, key: "alias_de_primera_ronda", op: "add_alias", target: { kind: "artist", id: artist }, alias: "Nombre recuperado durante investigación" }],
        unresolved: [],
        lookups: [{ type: "catalog", kind: "album", query: String(album) }],
      },
      {
        summary: "Conservar información",
        operations: [],
        unresolved: ["No hay evidencia nueva para corregir"],
        lookups: [],
      },
    );
    const gateway = new DeepSeekGateway(
      {
        baseUrl: "https://mock.invalid",
        models: { fast: "deepseek-flash", reasoning: "pro", vision: "vision" },
        maxTokens: 6000,
        timeoutMs: 5000,
      },
      transport,
      new PostgresDeepSeekRunStore(),
    );
    const phases: string[] = [];
    const result = await planWithDeepSeek(
      "artist",
      artist,
      "Consultar el disco existente y conservar las dudas",
      async (phase) => {
        phases.push(phase);
      },
      gateway,
    );
    expect(result.usage.calls).toBe(2);
    expect(result.draft.operations.map(op => op.key)).toContain("alias_de_primera_ronda");
    expect(transport.requests[1]?.user).toContain('"previousDraft"');
    expect(transport.requests[0]?.system).toContain("El pedido marca la prioridad inicial");
    expect(transport.requests[0]?.system).not.toContain("Mantén el alcance solicitado");
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]?.user).toContain("Disco Existente");
    expect(transport.requests[1]?.user).toContain('"forcePlan":true');
    expect(phases).toContain("sources");
    const cached = await planWithDeepSeek(
      "artist",
      artist,
      "Consultar el disco existente y conservar las dudas",
      async () => {},
      gateway,
    );
    expect(cached.usage.cachedCalls).toBe(2);
    expect(transport.requests).toHaveLength(2);
    expect(
      (
        await getPool().query(
          "SELECT count(*)::int AS n FROM ingest.ai_runs WHERE task_kind='curation_plan' AND status='validated'",
        )
      ).rows[0].n,
    ).toBe(validatedBefore+2);
  });
  it("añade períodos y corrige solo la relación elegida", async () => {
    let p = await prepared(
      draft([
        {
          ...base,
          key: "miembro",
          op: "create_relation",
          kind: "artist_membership",
          endpoints: {
            artistId: { kind: "artist", id: artist },
            personId: { kind: "person", id: person },
          },
          values: {
            role: "Bass",
            fromYear: 1999,
            toYear: 2004,
            isCurrent: false,
          },
        },
      ]),
    );
    expect(p.preview?.ready).toBe(true);
    const added = await applyPlan(
      p.id,
      p.revision,
      p.preview!.hash,
      false,
      "QA",
    );
    await waitForCurationScans();
    const row = (
      await getPool().query(
        "SELECT id::int,from_year,to_year FROM public.artist_members WHERE artist_id=$1 AND person_id=$2",
        [artist, person],
      )
    ).rows[0];
    expect(row).toMatchObject({ from_year: 1999, to_year: 2004 });
    p = await prepared(
      draft([
        {
          ...base,
          key: "periodo",
          op: "replace_relation",
          kind: "artist_membership",
          id: row.id,
          values: { toYear: 2006 },
        },
      ]),
    );
    expect(p.preview?.ready).toBe(true);
    const changed = await applyPlan(
      p.id,
      p.revision,
      p.preview!.hash,
      false,
      "QA",
    );
    await waitForCurationScans();
    expect(
      (
        await getPool().query(
          "SELECT from_year,to_year FROM public.artist_members WHERE id=$1",
          [row.id],
        )
      ).rows[0],
    ).toMatchObject({ from_year: 1999, to_year: 2006 });
    await withOperatorRun(
      { name: "qa:undo-period", operator: "QA", note: "Revertir período" },
      (ctx) => undoRun(ctx, changed.runId!),
    );
    await withOperatorRun(
      { name: "qa:undo-member", operator: "QA", note: "Revertir integrante" },
      (ctx) => undoRun(ctx, added.runId!),
    );
  });
  it("fusionar requiere confirmación, conserva alias y puede deshacerse", async () => {
    const rows = (
      await getPool().query(
        "INSERT INTO public.persons(name,biography) VALUES('Identidad QA','Biografía principal'),('Identidad Variante QA','Variante documentada') RETURNING id",
      )
    ).rows;
    const keep = Number(rows[0].id),
      drop = Number(rows[1].id);
    let p = await prepared(
      draft([
        {
          ...base,
          key: "fusion",
          op: "merge_entities",
          keep: { kind: "person", id: keep },
          drop: { kind: "person", id: drop },
          fieldChoices: { biography: "keep" },
        },
      ]),
    );
    p = await savePlan(p.id, p.revision, p.draft!, ["fusion"], "Admin QA");
    expect(p.preview?.items[0]?.error).toBeNull();
    expect(p.preview?.sensitive).toBe(true);
    await expect(
      applyPlan(p.id, p.revision, p.preview!.hash, false, "QA"),
    ).rejects.toThrow("Confirma");
    const result = await applyPlan(
      p.id,
      p.revision,
      p.preview!.hash,
      true,
      "QA",
    );
    await waitForCurationScans();
    expect(
      (
        await getPool().query("SELECT id FROM public.persons WHERE id=$1", [
          drop,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await getPool().query(
          "SELECT alias FROM ingest.person_aliases WHERE person_id=$1",
          [keep],
        )
      ).rows.map((r) => r.alias),
    ).toContain("Identidad Variante QA");
    await withOperatorRun(
      { name: "qa:undo-merge", operator: "QA", note: "Revertir fusión" },
      (ctx) => undoRun(ctx, result.runId!),
    );
    expect(
      (
        await getPool().query("SELECT id FROM public.persons WHERE id=$1", [
          drop,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("acepta un cambio al instante, rechaza otro sin escribir y conserva decisiones al recargar", async () => {
    let p = await prepared(draft([
      { ...base, key: "ciudad_inmediata", op: "replace_fields", target: { kind: "artist", id: artist }, values: { originCity: "Valencia" } },
      { ...base, key: "alias_rechazado", op: "add_alias", target: { kind: "artist", id: artist }, alias: "Alias que no se debe crear", aliasType: "name_variant" },
    ]));
    const originalRevision = p.revision;
    const response = await app.inject({ method: "POST", url: `/curation/ai/plans/${p.id}/decisions`, headers, payload: { revision: p.revision, key: "ciudad_inmediata", decision: "accepted" } });
    expect(response.statusCode).toBe(200);
    p = response.json<CatalogPlan>();
    await waitForCurationScans();
    expect(p.decisions?.["ciudad_inmediata"]?.decision).toBe("accepted");
    expect((await getPool().query("SELECT origin_city FROM public.artists WHERE id=$1", [artist])).rows[0].origin_city).toBe("Valencia");
    expect((await getPool().query("SELECT id FROM ingest.artist_aliases WHERE artist_id=$1 AND alias=$2", [artist, "Alias que no se debe crear"])).rowCount).toBe(0);
    const repeated = await decidePlan(p.id, originalRevision, "ciudad_inmediata", "accepted", "QA");
    expect(repeated.decisions?.["ciudad_inmediata"]?.runId).toBe(p.decisions?.["ciudad_inmediata"]?.runId);
    await expect(applyPlan(p.id, p.revision, p.preview!.hash, true, "QA")).rejects.toThrow("cambio por cambio");
    const runCount = (await getPool().query("SELECT count(*)::int AS n FROM ingest.scrape_runs")).rows[0].n;
    p = await decidePlan(p.id, p.revision, "alias_rechazado", "rejected", "QA");
    expect(p.status).toBe("reviewed");
    expect(p.decisions?.["alias_rechazado"]?.runId).toBeNull();
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.scrape_runs")).rows[0].n).toBe(runCount);
    expect((await getPlan(p.id)).decisions).toEqual(p.decisions);
    await withOperatorRun({ name: "qa:undo-single", operator: "QA", note: "Deshacer únicamente la aceptación" }, (ctx) => undoRun(ctx, p.decisions!["ciudad_inmediata"]!.runId!));
    expect((await getPlan(p.id)).decisions?.["ciudad_inmediata"]?.undone).toBe(true);
    expect((await getPlan(p.id)).decisions?.["alias_rechazado"]?.decision).toBe("rejected");
  });
  it("la misma aceptación enviada dos veces a la vez escribe un solo run y ambas respuestas devuelven la decisión", async () => {
    const p = await prepared(draft([{ ...base, key: "ciudad_doble", op: "replace_fields", target: { kind: "artist", id: artist }, values: { originCity: "Barquisimeto" } }]));
    const both = await Promise.allSettled([decidePlan(p.id, p.revision, "ciudad_doble", "accepted", "QA"), decidePlan(p.id, p.revision, "ciudad_doble", "accepted", "QA")]);
    await waitForCurationScans();
    expect(both.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const runs = both.map((r) => (r as PromiseFulfilledResult<CatalogPlan>).value.decisions?.["ciudad_doble"]?.runId);
    expect(runs[0]).toBeTruthy();
    expect(runs[1]).toBe(runs[0]);
    const accepts = (await getPool().query("SELECT count(*)::int AS n FROM ingest.scrape_runs WHERE params->>'operationKey'='ciudad_doble'")).rows[0].n;
    expect(accepts).toBe(1);
  });
  it("muestra las partes sin respaldo antes de decidir y las registra como decisión editorial al aceptar", async () => {
    let p = await prepared(draft([
      { ...base, key: "anio_sin_cita", op: "replace_fields", target: { kind: "artist", id: artist }, values: { formedYear: 1987, originCity: "Caracas" } },
    ]));
    const pending = p.preview!.items.find((item) => item.key === "anio_sin_cita")!;
    expect(pending.error).toContain("Respaldo insuficiente");
    expect(pending.evidenceGaps).toEqual(["año de formación «1987»"]);
    p = await decidePlan(p.id, p.revision, "anio_sin_cita", "accepted", "QA");
    const accepted = p.decisions?.["anio_sin_cita"]?.preview;
    expect(accepted?.evidenceGaps).toEqual(["año de formación «1987»"]);
    expect(accepted?.warnings.join(" ")).toContain("Decisión editorial: sin respaldo documental para año de formación «1987»");
    expect((await getPool().query("SELECT formed_year FROM public.artists WHERE id=$1", [artist])).rows[0].formed_year).toBe(1987);
    await withOperatorRun({ name: "qa:undo-editorial", operator: "QA", note: "Deshacer la decisión editorial" }, (ctx) => undoRun(ctx, p.decisions!["anio_sin_cita"]!.runId!));
  });
  it("explica qué contiene el plan, señala un resumen sin operaciones y avisa de cambios repetidos en otra propuesta", async () => {
    const repeated = { ...base, key: "alias_repetido", op: "add_alias", target: { kind: "artist", id: artist }, alias: "Banda Alternativa", aliasType: "name_variant" };
    const first = await prepared(draft([repeated]));
    const second = await prepared(draftSchema.parse({ summary: "Se añade el alias. Se agrega el integrante «Músico Fantasma».", unresolved: ["Falta la fecha de formación"], operations: [repeated] }));
    expect(second.preview?.outcome?.text).toBe("1 cambio listo para decidir (1 alias) · 1 duda pendiente con lo que falta para resolverla.");
    expect(second.preview?.outcome?.issues).toEqual([
      "El resumen anuncia créditos o integrantes («Se agrega el integrante «Músico Fantasma».»), pero ninguna operación lo propone.",
      "El resumen menciona «Músico Fantasma», que no figura en ninguna operación ni duda.",
    ]);
    expect(second.preview?.items[0]?.warnings).toContain(`También figura sin decidir en la propuesta #${first.id}; decide este cambio una sola vez.`);
    await decidePlan(first.id, first.revision, "alias_repetido", "rejected", "QA");
    const refreshed = await savePlan(second.id, second.revision, second.draft!, [], "QA");
    expect(refreshed.preview?.items[0]?.warnings.join(" ") ?? "").not.toContain("También figura");
  });
  it("acepta altas y relaciones dependientes por separado sin reaplicar lo ya creado", async () => {
    let p = await prepared(draft([
      { ...base, key: "persona_nueva", op: "create_entity", kind: "person", values: { name: "Persona para decisión individual QA" } },
      { ...base, key: "membresia_nueva", op: "create_relation", kind: "artist_membership", endpoints: { artistId: { kind: "artist", id: artist }, personId: { kind: "person", key: "persona_nueva" } }, values: { role: "Bass" } },
    ]));
    await expect(decidePlan(p.id, p.revision, "membresia_nueva", "accepted", "QA")).rejects.toThrow("Primero acepta");
    p = await decidePlan(p.id, p.revision, "persona_nueva", "accepted", "QA");
    await waitForCurationScans();
    const created = p.result!.created["persona_nueva"]!;
    expect((await getPool().query("SELECT id FROM public.artist_members WHERE person_id=$1", [created.id])).rowCount).toBe(0);
    p = await decidePlan(p.id, p.revision, "membresia_nueva", "accepted", "QA");
    await waitForCurationScans();
    expect(p.status).toBe("reviewed");
    expect((await getPool().query("SELECT id FROM public.artist_members WHERE artist_id=$1 AND person_id=$2", [artist, created.id])).rowCount).toBe(1);
    expect((await getPool().query("SELECT id FROM public.persons WHERE name=$1", ["Persona para decisión individual QA"])).rowCount).toBe(1);
    expect(p.decisions?.["persona_nueva"]?.runId).not.toBe(p.decisions?.["membresia_nueva"]?.runId);
  });
  it("no modifica el catálogo al rechazar, bloquea datos inválidos y exige actualizar una ficha cambiada", async () => {
    let p = await prepared(draft([
      { ...base, key: "invalido", op: "replace_fields", target: { kind: "artist", id: artist }, values: { campoInventado: "Nunca escribir" } },
      { ...base, key: "cambio_actualizado", op: "replace_fields", target: { kind: "artist", id: artist }, values: { originCity: "Caracas" } },
    ]));
    await expect(decidePlan(p.id, p.revision, "invalido", "accepted", "QA")).rejects.toThrow();
    expect((await getPlan(p.id)).decisions).toEqual({});
    p = await decidePlan(p.id, p.revision, "invalido", "rejected", "QA");
    await getPool().query("UPDATE public.artists SET origin_city='Maracay' WHERE id=$1", [artist]);
    await expect(decidePlan(p.id, p.revision, "cambio_actualizado", "accepted", "QA")).rejects.toThrow("La ficha cambió");
    expect((await getPool().query("SELECT origin_city FROM public.artists WHERE id=$1", [artist])).rows[0].origin_city).toBe("Maracay");
    p = await refreshPlan(p.id, p.revision, "QA");
    p = await decidePlan(p.id, p.revision, "cambio_actualizado", "accepted", "QA");
    await waitForCurationScans();
    expect(p.decisions?.["cambio_actualizado"]?.preview?.before).toMatchObject({ originCity: "Maracay" });
    expect((await getPool().query("SELECT origin_city FROM public.artists WHERE id=$1", [artist])).rows[0].origin_city).toBe("Caracas");
  });
  it("acepta una fusión sola, conserva la ficha principal y permite seguir corrigiéndola", async () => {
    const duplicate = Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Variante QA para fusión individual') RETURNING id")).rows[0].id);
    let p = await startPlan("artist", duplicate, "Fusionar duplicado y añadir alias", "QA", async () => ({ draft: draft([
      { ...base, key: "fusion_sola", op: "merge_entities", keep: { kind: "artist", id: artist }, drop: { kind: "artist", id: duplicate }, fieldChoices: {} },
      { ...base, key: "alias_tras_fusion", op: "add_alias", target: { kind: "artist", id: duplicate }, alias: "Alias tras fusion individual", aliasType: "name_variant" },
    ]), evidence, usage: { calls: 1, cachedCalls: 0, tokensIn: 1, tokensOut: 1 } }));
    await waitForPlans(); p = await getPlan(p.id);
    p = await decidePlan(p.id, p.revision, "fusion_sola", "accepted", "QA");
    await waitForCurationScans();
    expect((await getPool().query("SELECT id FROM public.artists WHERE id=$1", [duplicate])).rowCount).toBe(0);
    expect(p.decisions?.["alias_tras_fusion"]).toBeUndefined();
    p = await decidePlan(p.id, p.revision, "alias_tras_fusion", "accepted", "QA");
    await waitForCurationScans();
    expect((await getPool().query("SELECT id FROM ingest.artist_aliases WHERE artist_id=$1 AND alias=$2", [artist, "Alias tras fusion individual"])).rowCount).toBe(1);
    expect(p.status).toBe("reviewed");
  });
  it("un cambio inválido sobre otra ficha no bloquea aceptar un cambio independiente", async () => {
    let p = await prepared(draft([
      { ...base, key: "ficha_inexistente", op: "replace_fields", target: { kind: "person", id: 9999999 }, values: { name: "Inexistente" } },
      { ...base, key: "alias_independiente", op: "add_alias", target: { kind: "artist", id: artist }, alias: "Alias independiente QA", aliasType: "name_variant" },
    ]));
    expect(p.preview?.operationHashes?.["alias_independiente"]).toBeTruthy();
    p = await decidePlan(p.id, p.revision, "alias_independiente", "accepted", "QA");
    await waitForCurationScans();
    expect((await getPool().query("SELECT id FROM ingest.artist_aliases WHERE artist_id=$1 AND alias=$2", [artist, "Alias independiente QA"])).rowCount).toBe(1);
    expect(p.decisions?.["ficha_inexistente"]).toBeUndefined();
  });
  it("rechaza géneros sin borrar taxonomía y retira solo fichas sin dependencias", async () => {
    const id = Number(
      (
        await getPool().query(
          "INSERT INTO public.organizations(name) VALUES('Organización Retirable QA') RETURNING id",
        )
      ).rows[0].id,
    );
    let p = await prepared(
      draft([
        {
          ...base,
          key: "retirar",
          op: "remove_entity",
          target: { kind: "organization", id },
        },
        {
          ...base,
          key: "rechazar",
          op: "remove_genre",
          target: { kind: "artist", id: artist },
          genreSlug: genre,
        },
      ]),
    );
    p = await savePlan(p.id, p.revision, p.draft!, ["retirar"], "Admin QA");
    expect(p.preview?.ready).toBe(true);
    const result = await applyPlan(
      p.id,
      p.revision,
      p.preview!.hash,
      true,
      "QA",
    );
    await waitForCurationScans();
    expect(
      (
        await getPool().query(
          "SELECT id FROM public.organizations WHERE id=$1",
          [id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await getPool().query("SELECT id FROM ingest.genres WHERE slug=$1", [
          genre,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await getPool().query(
          "SELECT status FROM ingest.artist_genres WHERE artist_id=$1",
          [artist],
        )
      ).rows[0].status,
    ).toBe("rejected");
    await withOperatorRun(
      { name: "qa:undo-remove", operator: "QA", note: "Revertir retiros" },
      (ctx) => undoRun(ctx, result.runId!),
    );
    p = await prepared(
      draft([
        {
          ...base,
          key: "norecrear",
          op: "create_entity",
          kind: "artist",
          values: { name: "Banda QA" },
        },
      ]),
    );
    p = await savePlan(p.id, p.revision, p.draft!, ["norecrear"], "QA");
    expect(p.preview?.ready).toBe(false);
  });
});
