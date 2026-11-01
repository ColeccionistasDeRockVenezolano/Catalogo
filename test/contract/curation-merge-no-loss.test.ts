import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { mergeAction, type MergeParams } from "../../src/curation/actions/merge.js";
import type { ActionContext, ActionFinding, ActionPreview } from "../../src/curation/actions/types.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRun } from "../../src/merge/run-undo.js";

// Etapa 2: una fusión desde Curaduría conserva integrantes, discos,
// audiovisuales, alias y fechas; los textos se combinan, el año incompatible se
// anota y el undo restaura las dos fichas.
describe("fusión de artistas sin pérdida (contrato)", () => {
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

  async function album(artistId: number, title: string, year: number, tracks: string[]): Promise<number> {
    const id = await one("INSERT INTO public.albums(artist_id,title,release_year,album_type) VALUES($1,$2,$3,'studio_album') RETURNING id", [artistId, title, year]);
    for (const [index, track] of tracks.entries()) {
      await one("INSERT INTO public.tracks(album_id,disc_number,track_number,title) VALUES($1,1,$2,$3) RETURNING id", [id, index + 1, track]);
    }
    return id;
  }

  async function member(artistId: number, name: string, role = "Guitarra"): Promise<number> {
    const person = await one("INSERT INTO public.persons(name) VALUES($1) RETURNING id", [name]);
    return one("INSERT INTO public.artist_members(artist_id,person_id,role) VALUES($1,$2,$3) RETURNING id", [artistId, person, role]);
  }

  async function audiovisual(artistId: number, sourceKey: string, title: string): Promise<number> {
    return one(`INSERT INTO media.artist_audiovisuals(artist_id,source_key,title,title_key,kind)
                VALUES($1,$2,$3,$4,'music_video') RETURNING id`, [artistId, sourceKey, title, sourceKey]);
  }

  it("conserva todo, anota el año incompatible y el undo restaura", async () => {
    const keep = await one(`INSERT INTO public.artists(name,origin_city,formed_year,disbanded_year,biography)
                            VALUES('Banda Conservada','Maracay',1978,1983,'Biografía de la ficha conservada.') RETURNING id`);
    const drop = await one(`INSERT INTO public.artists(name,origin_city,formed_year,biography,notes)
      VALUES('Banda Duplicada','Maracay',2002,'Biografía de la ficha duplicada.','nota previa') RETURNING id`);
    const reviewId = await one(`
      INSERT INTO ingest.review_queue(kind,artist_a_id,artist_b_id,priority,status,payload,notes)
      VALUES ('possible_duplicate',$1,$2,8,'open','{}'::jsonb,'bandeja vieja') RETURNING id`,
    [Math.min(keep, drop), Math.max(keep, drop)]);
    await member(keep, "Ana Keep");
    await member(keep, "Luis Keep", "Batería");
    await member(drop, "Pedro Drop", "Bajo");
    await member(drop, "Ana Keep");
    await album(keep, "Vampiro Keep", 2003, ["Uno", "Dos", "Tres"]);
    await album(keep, "Segundo Keep", 2005, ["Siete", "Ocho"]);
    await album(drop, "Vampiro Keep", 2003, ["Uno", "Dos", "Tres"]);
    await album(drop, "Otro Drop", 2004, ["Cuatro", "Cinco", "Seis"]);
    await audiovisual(keep, "test:av-keep", "Video Keep");
    await audiovisual(drop, "test:av-drop", "Video Drop");
    await one("INSERT INTO ingest.artist_aliases(artist_id,alias,alias_type,normalized_alias) VALUES($1,'Alias Keep','name_variant','alias keep') RETURNING id", [keep]);
    await one("INSERT INTO ingest.artist_aliases(artist_id,alias,alias_type,normalized_alias) VALUES($1,'Alias Drop','name_variant','alias drop') RETURNING id", [drop]);

    const finding: ActionFinding = {
      id: 1, detector: "artistas_duplicados_evidencia", signature: "evidencia_determinista", status: "open",
      entity: { kind: "artist", id: keep, label: "Banda Conservada" },
      field: "name", value: "Banda Conservada", suggestedValue: null,
      related: [{ kind: "artist", id: drop, label: "Banda Duplicada" }],
      title: "Banda Conservada y Banda Duplicada: misma página de evidencia",
      evidence: { pair: [Math.min(keep, drop), Math.max(keep, drop)] },
    };
    const client = await getPool().connect();
    let params: MergeParams | null = null;
    let preview: ActionPreview | null = null;
    try {
      const actionContext = {
        client, mode: "preview" as const, batchMode: "individual" as const, pending: new Map(),
        names: { similar: async () => [], rename: () => undefined },
      } satisfies ActionContext;
      params = await mergeAction.defaultParams(finding, actionContext);
      expect(params).toMatchObject({ kind: "artist", keepId: keep, dropId: drop });
      preview = await mergeAction.preview(finding, params!, actionContext);
      expect(preview.blocked).toBeNull();
      expect(preview.warnings.join(" ")).toMatch(/se revierte/u);
    } finally {
      client.release();
    }

    const { runId, result: outcome } = await withOperatorRun({
      name: "test:merge:no-loss", operator: "prueba", note: "contrato de fusión sin pérdida",
      params: { keepId: keep, dropId: drop },
    }, async (context) => mergeAction.apply(context, finding, params!, preview!));
    expect(outcome.after).toMatchObject({ verified: true, keep: { id: keep }, removed: { id: drop } });

    const members = (await getPool().query<{ name: string }>(`
      SELECT p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1 ORDER BY p.name`, [keep])).rows.map((row) => row.name);
    expect(members).toEqual(["Ana Keep", "Luis Keep", "Pedro Drop"]);

    const albums = (await getPool().query<{ title: string }>("SELECT title FROM public.albums WHERE artist_id=$1 ORDER BY title", [keep])).rows.map((row) => row.title);
    expect(albums).toEqual(["Otro Drop", "Segundo Keep", "Vampiro Keep"]);

    const audiovisuals = (await getPool().query<{ source_key: string }>("SELECT source_key FROM media.artist_audiovisuals WHERE artist_id=$1 ORDER BY source_key", [keep])).rows.map((row) => row.source_key);
    expect(audiovisuals).toEqual(["test:av-drop", "test:av-keep"]);

    const aliases = (await getPool().query<{ alias: string }>("SELECT alias FROM ingest.artist_aliases WHERE artist_id=$1", [keep])).rows.map((row) => row.alias);
    expect(aliases).toContain("Alias Keep");
    expect(aliases).toContain("Alias Drop");
    expect(aliases).toContain("Banda Duplicada");

    const row = (await getPool().query<{ biography: string; formed_year: number | null; notes: string | null; disbanded_year: number | null }>(
      "SELECT biography,formed_year,disbanded_year,notes FROM public.artists WHERE id=$1", [keep])).rows[0]!;
    expect(row.biography).toContain("Biografía de la ficha conservada");
    expect(row.biography).toContain("Biografía de la ficha duplicada");
    expect(row.formed_year).toBe(1978);
    expect(row.disbanded_year).toBe(1983);
    expect(row.notes).toContain("2002");
    // La cascada unió la persona duplicada que dejó la fusión.
    expect((await getPool().query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1 AND p.name='Ana Keep'",
      [keep])).rows[0]!.n).toBe("1");
    expect((await getPool().query<{ n: string }>("SELECT count(*)::text AS n FROM ingest.text_rewrites WHERE entity_kind='artist' AND entity_id=$1 AND status='pending'", [keep])).rows[0]!.n).not.toBe("0");
    // La bandeja histórica se cierra con la fusión: una sola decisión.
    expect((await getPool().query<{ status: string }>("SELECT status FROM ingest.review_queue WHERE id=$1", [reviewId])).rows[0]!.status).toBe("approved");
    // La fusión deja un precedente positivo para el clasificador.
    expect((await getPool().query<{ n: string }>(
      "SELECT count(*)::text AS n FROM ingest.curation_merge_feedback WHERE kind='artist' AND outcome='same_identity' AND a_id=LEAST($1::bigint,$2::bigint) AND b_id=GREATEST($1::bigint,$2::bigint)",
      [keep, drop])).rows[0]!.n).toBe("1");
    expect((await getPool().query("SELECT 1 FROM public.artists WHERE id=$1", [drop])).rowCount).toBe(0);

    await withOperatorRun({
      name: "test:merge:no-loss:undo", operator: "prueba", note: "undo del contrato",
      params: { mergeRunId: runId },
    }, async (context) => undoRun(context, runId));

    expect((await getPool().query("SELECT 1 FROM public.artists WHERE id=$1", [drop])).rowCount).toBe(1);
    const restored = (await getPool().query<{ title: string }>("SELECT title FROM public.albums WHERE artist_id=$1 ORDER BY title", [keep])).rows.map((item) => item.title);
    expect(restored).toEqual(["Segundo Keep", "Vampiro Keep"]);
    const restoredMembers = (await getPool().query<{ name: string }>(`
      SELECT p.name FROM public.artist_members m JOIN public.persons p ON p.id=m.person_id WHERE m.artist_id=$1 ORDER BY p.name`, [keep])).rows.map((item) => item.name);
    expect(restoredMembers).toEqual(["Ana Keep", "Luis Keep"]);
    expect((await getPool().query<{ n: string }>("SELECT count(*)::text AS n FROM public.persons WHERE name='Ana Keep'")).rows[0]!.n).toBe("2");
    // El undo deja el par como precedente negativo.
    expect((await getPool().query<{ n: string }>(
      "SELECT count(*)::text AS n FROM ingest.curation_merge_feedback WHERE kind='artist' AND outcome='related' AND source='undo' AND a_id=LEAST($1::bigint,$2::bigint) AND b_id=GREATEST($1::bigint,$2::bigint)",
      [keep, drop])).rows[0]!.n).toBe("1");
  }, 60_000);
});
