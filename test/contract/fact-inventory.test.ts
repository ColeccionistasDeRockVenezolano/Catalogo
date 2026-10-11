import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp, DEFAULT_MIGRATIONS_DIR } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import { createEntity, updateEntity, withOperatorRun } from "../../src/merge/operator.js";
import { undoRun } from "../../src/merge/run-undo.js";
import { mergeInto } from "../../src/review/duplicates.js";
import { parseDateValue } from "../../src/catalog/date-value.js";
import { applyFact, factRecord, recordFact, rememberEvidenceDocument, rememberEvidenceFragment, type FactInput } from "../../src/evidence/inventory.js";

const TOKEN = "qa-fact-inventory-01234567890123456789";
const content = "🎸 Archivo original. La persona nació en mayo de 1973. El sello publicó la edición CD en 2001. La edición DVD es distinta.";
const quote = "La persona nació en mayo de 1973.";
const hash = createHash("sha256").update(content).digest("hex");
const capturedAt = "2001-05-06T00:00:00.123Z", readAt = "2026-10-10T00:00:00.123Z";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe.each(["UTF8", "SQL_ASCII"] as const)("inventario persistente de hechos y evidencias (%s)", (encoding) => {
  let database: PgContainer, app: FastifyInstance, person: number, document: number, fragment: number;
  const previousToken = process.env["CRV_OPERATOR_TOKEN"];
  const operation = <T>(work: Parameters<typeof withOperatorRun<T>>[1]) => withOperatorRun({ name: "qa:fact-inventory", operator: "QA Inventario", note: "Afirmación editorial de prueba" }, work);
  const input = (extra: Partial<FactInput> = {}): FactInput => ({ kind: "person", entityId: person, field: "birth_date", value: "1973-05", valueType: "date", state: "verified", evidence: [{ fragmentId: fragment, role: "supports" }], ...extra });
  const request = (method: "GET" | "POST", url: string, payload?: Record<string, unknown>) => app.inject({ method, url, headers: { authorization: `Bearer ${TOKEN}`, "x-crv-operator": "QA Inventario" }, ...(payload === undefined ? {} : { payload }) });

  beforeAll(async () => {
    database = await startPgContainer({ encoding }); process.env["DATABASE_URL"] = database.databaseUrl; process.env["CRV_OPERATOR_TOKEN"] = TOKEN; resetEnvCache();
    expect((await getPool().query("SHOW server_encoding")).rows[0].server_encoding).toBe(encoding);
    await applyCore(database.name); await migrateUp();
    person = (await operation(ctx => createEntity(ctx, "person", { name: "Persona del inventario" }, { allowSimilar: true }))).result.id;
    document = await rememberEvidenceDocument(getPool(), { url: "https://example.org/original", title: "Archivo original", content, contentHash: hash, fetchedAt: capturedAt, capturedAt, readAt, acquisitionMethod: "raw_archive" });
    fragment = await rememberEvidenceFragment(getPool(), document, quote);
    app = await buildApp();
  }, 120_000);
  afterAll(async () => { await app?.close(); await closeDb(); await database?.stop(); if (previousToken === undefined) delete process.env["CRV_OPERATOR_TOKEN"]; else process.env["CRV_OPERATOR_TOKEN"] = previousToken; resetEnvCache(); }, 60_000);

  it("conserva texto, hash, captura y lecturas distintas; sus offsets soportan caracteres astrales", async () => {
    const reread = await rememberEvidenceDocument(getPool(), { url: "https://example.org/original", title: "Archivo original", content, contentHash: hash, fetchedAt: capturedAt, capturedAt, readAt: "2026-10-11T00:00:00.123Z", acquisitionMethod: "raw_archive" });
    expect(reread).toBe(document);
    expect((await getPool().query("SELECT captured_at,content_hash,content_text FROM ingest.evidence_documents WHERE id=$1", [document])).rows[0]).toMatchObject({ captured_at: new Date(capturedAt), content_hash: hash, content_text: content });
    expect((await getPool().query("SELECT read_at FROM ingest.evidence_reads WHERE document_id=$1 ORDER BY read_at", [document])).rows.map(row => row.read_at.toISOString())).toEqual([readAt, "2026-10-11T00:00:00.123Z"]);
    expect((await getPool().query("SELECT convert_from(substring(convert_to(d.content_text,'UTF8') FROM f.start_offset+1 FOR f.end_offset-f.start_offset),'UTF8') AS quote FROM ingest.evidence_fragments f JOIN ingest.evidence_documents d ON d.id=f.document_id WHERE f.id=$1", [fragment])).rows[0].quote).toBe(quote);
    const coordinates=(await getPool().query("SELECT start_offset,end_offset,offset_unit FROM ingest.evidence_fragments WHERE id=$1",[fragment])).rows[0];
    expect(coordinates.offset_unit).toBe("utf8_byte");
    expect(Buffer.from(content,"utf8").subarray(coordinates.start_offset,coordinates.end_offset).toString("utf8")).toBe(quote);
    await expect(rememberEvidenceDocument(getPool(), { url: "https://example.org/tampered", title: "Alterado", content: content.replace("1973", "1980"), contentHash: hash, fetchedAt: capturedAt, capturedAt, readAt, acquisitionMethod: "http" })).rejects.toThrow(/hash/);
    await expect(rememberEvidenceFragment(getPool(), document, "La persona nació en 1980.")).rejects.toThrow(/literalmente/);
    await expect(getPool().query("UPDATE ingest.evidence_documents SET captured_at=now() WHERE id=$1", [document])).rejects.toThrow(/immutable/);
    await expect(getPool().query("INSERT INTO ingest.evidence_fragments(document_id,quote,start_offset,end_offset) VALUES($1,'cita inventada',0,13)", [document])).rejects.toThrow(/does not match/);
  });

  it("conserva y reutiliza las coordenadas nativas del inventario anterior sin reinterpretarlas", async () => {
    const legacy=(await getPool().query(`INSERT INTO ingest.evidence_fragments(document_id,quote,start_offset,end_offset,offset_unit)
      SELECT id,$2,position($2 IN content_text)-1,position($2 IN content_text)-1+length($2),'database_character'
      FROM ingest.evidence_documents WHERE id=$1 RETURNING id::text`,[document,quote])).rows[0];
    expect(await rememberEvidenceFragment(getPool(),document,quote)).toBe(Number(legacy.id));
  });

  it("guarda fecha con su precisión y contexto sin escribir un día ficticio en el catálogo", async () => {
    const result = await operation(ctx => recordFact(ctx, input({ period: "1970/1980" })));
    const fact = await factRecord(getPool(), result.result.factId);
    expect(fact).toMatchObject({ kind: "person", field: "birth_date", valueType: "date", value: { kind: "point", year: 1973, month: 5, day: null, precision: "month" }, period: { kind: "interval" }, state: "verified", disposition: "pending", originalEntityId: person, entityId: person });
    expect(fact!.evidence[0]).toMatchObject({ quote, acquisitionMethod: "raw_archive", role: "supports", offsetUnit: "utf8_byte" });
    expect(Date.parse(String(fact!.evidence[0]!["capturedAt"]))).toBe(Date.parse(capturedAt));
    expect((await getPool().query("SELECT birth_date FROM public.persons WHERE id=$1", [person])).rows[0].birth_date).toBeNull();
    await expect(operation(ctx => applyFact(ctx, result.result.factId, { editorial: true }))).rejects.toThrow(/período/);
  });

  it("conserva los microsegundos de captura y reconoce el mismo instante con otro huso", async () => {
    const source = { url: "https://example.org/precise", title: "Captura precisa", content, contentHash: hash, fetchedAt: capturedAt, readAt, acquisitionMethod: "http" as const };
    const first = await rememberEvidenceDocument(getPool(), { ...source, capturedAt: "2001-05-06T00:00:00.123456Z" });
    const second = await rememberEvidenceDocument(getPool(), { ...source, capturedAt: "2001-05-05T21:00:00.123456-03:00", readAt: "2026-10-11T00:00:00.123456Z" });
    expect(second).toBe(first);
    const stored = (await getPool().query(`SELECT to_char(captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS captured FROM ingest.evidence_documents WHERE id=$1`, [first])).rows[0];
    expect(stored.captured).toBe("2001-05-06T00:00:00.123456Z");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.evidence_reads WHERE document_id=$1", [first])).rows[0].n).toBe(2);
  });

  it("las negativas no adquieren estado verificado por confianza, IA, ausencia de evidencia ni mera relectura", async () => {
    await expect(operation(ctx => recordFact(ctx, input(), "ai"))).rejects.toThrow(/automática/);
    await expect(operation(ctx => recordFact(ctx, input({ evidence: [] })))).rejects.toThrow(/captura conocida/);
    await expect(operation(ctx => recordFact(ctx, input({ evidence: [{ fragmentId: fragment, role: "contradicts" }] })))).rejects.toThrow(/captura conocida/);
    const unknown = await rememberEvidenceDocument(getPool(), { url: "https://example.org/local", title: "Captura desconocida", content, contentHash: hash, fetchedAt: "2026-10-10", capturedAt: null, readAt, acquisitionMethod: "local_archive" });
    const unknownFragment = await rememberEvidenceFragment(getPool(), unknown, quote);
    await expect(operation(ctx => recordFact(ctx, input({ evidence: [{ fragmentId: unknownFragment, role: "supports" }] })))).rejects.toThrow(/captura conocida/);
    await expect(operation(async ctx => {
      await ctx.client.query(`INSERT INTO ingest.catalog_facts(fact_key,subject_kind,original_subject_id,field,value,value_type,documentary_state,created_by,operator,reason)
        VALUES($1,'person',$2,'birth_date','"1973"','scalar','verified','human','QA','sin evidencia')`, ["a".repeat(64), person]);
    })).rejects.toThrow(/requires a preserved supporting fragment/);
    await expect(operation(async ctx => {
      await ctx.client.query(`INSERT INTO ingest.catalog_facts(fact_key,subject_kind,original_subject_id,field,value,value_type,documentary_state,created_by,operator,reason)
        VALUES($1,'person',$2,'notes','{"texto":"objeto escalar inválido"}','scalar','pending','human','QA','forma inválida')`, ["b".repeat(64), person]);
    })).rejects.toThrow(/check constraint/);
  });

  it("la base rechaza fechas imposibles y períodos sin precisión coherente incluso por SQL directo", async () => {
    const invalid = [
      { ...parseDateValue("1973-02-28"), day: 30 },
      { ...parseDateValue("1973"), month: 5 },
      { ...parseDateValue("1973"), year: 1973.5 },
      { kind: "interval", from: null, to: null },
      { kind: "interval", from: parseDateValue("1980"), to: parseDateValue("1970") },
      { kind: "point" },
    ];
    for (const value of invalid) {
      await expect(operation(ctx => ctx.client.query(`INSERT INTO ingest.catalog_facts(fact_key,subject_kind,original_subject_id,field,value,value_type,documentary_state,created_by,operator,reason)
        VALUES($1,'person',$2,'birth_date',$3::jsonb,'date','pending','human','QA','rechazo de fecha incoherente')`, [createHash("sha256").update(JSON.stringify(value)).digest("hex"), person, JSON.stringify(value)]))).rejects.toThrow(/valid calendar precision/);
    }
    await expect(operation(ctx => ctx.client.query(`INSERT INTO ingest.catalog_facts(fact_key,subject_kind,original_subject_id,field,value,value_type,period,documentary_state,created_by,operator,reason)
      VALUES($1,'person',$2,'notes','"nota"','scalar','{"kind":"interval","from":null,"to":null}','pending','human','QA','período incoherente')`, ["c".repeat(64), person]))).rejects.toThrow(/valid calendar precision/);
    for (const text of ["1973", "1973-05", "2000-02-29", "~1973", "1973/1980", "/1980", "1973/", "~1980/1973"]) {
      expect((await getPool().query("SELECT ingest.crv_date_value_valid($1::jsonb) AS valid", [JSON.stringify(parseDateValue(text))])).rows[0].valid).toBe(true);
    }
  });

  it("la API requiere permisos, serializa los metadatos y rechaza una cita ajena", async () => {
    expect((await app.inject({ method: "GET", url: "/evidence-inventory/facts?kind=person&entityId=1" })).statusCode).toBe(401);
    const bad = await request("POST", "/evidence-inventory/fragments", { documentId: document, quote: "Documento distinto", note: "No atribuir" });
    expect(bad.statusCode).toBe(422);
    const created = await request("POST", "/evidence-inventory/facts", { ...input(), note: "Cita comprobada manualmente" });
    expect(created.statusCode, created.body).toBe(201);
    const reread = await request("GET", `/evidence-inventory/facts/${created.json().factId}`);
    expect(reread.statusCode).toBe(200);
    expect(reread.json()).toMatchObject({ state: "verified", disposition: "pending", value: { precision: "month", day: null } });
    expect(reread.json().evidence[0]).toMatchObject({ quote, acquisitionMethod: "raw_archive" });
    expect(Date.parse(reread.json().evidence[0].capturedAt)).toBe(Date.parse(capturedAt));
    const list = await request("GET", `/evidence-inventory/facts?kind=person&entityId=${person}&limit=1`);
    expect(list.json().items).toHaveLength(1); expect(list.json().next).not.toBeNull();
    const source = await request("GET", `/evidence-inventory/documents/${document}`);
    expect(source.statusCode, source.body).toBe(200);
    expect(source.json()).toMatchObject({ id: document, url: "https://example.org/original", contentText: content, contentHash: hash, acquisitionMethod: "raw_archive", readCount: 2 });
    const reads = await request("GET", `/evidence-inventory/documents/${document}/reads?limit=1`);
    expect(reads.statusCode).toBe(200);
    expect(reads.json()).toEqual({ reads: ["2026-10-10T00:00:00.123000Z"], next: "2026-10-10T00:00:00.123000Z" });
    const nextRead = await request("GET", `/evidence-inventory/documents/${document}/reads?limit=1&after=${encodeURIComponent(reads.json().next)}`);
    expect(nextRead.json()).toEqual({ reads: ["2026-10-11T00:00:00.123000Z"], next: null });
    expect((await request("GET", "/evidence-inventory/documents/9007199254740991")).statusCode).toBe(404);
  });

  it("aplicar una decisión editorial y deshacer/rehacer conserva la evidencia y su incertidumbre", async () => {
    const recorded = await operation(ctx => recordFact(ctx, input({ field: "nationality", valueType: "scalar", value: "Venezuela", state: "unverifiable", evidence: [] })));
    await expect(operation(ctx => applyFact(ctx, recorded.result.factId, { editorial: false }))).rejects.toThrow(/decisión editorial/);
    const applied = await operation(ctx => applyFact(ctx, recorded.result.factId, { editorial: true }));
    expect((await factRecord(getPool(), recorded.result.factId))!).toMatchObject({ state: "unverifiable", disposition: "applied" });
    expect((await getPool().query("SELECT nationality FROM public.persons WHERE id=$1", [person])).rows[0].nationality).toBe("Venezuela");
    const undone = await operation(ctx => undoRun(ctx, applied.runId));
    expect((await factRecord(getPool(), recorded.result.factId))!).toMatchObject({ state: "unverifiable", disposition: "pending" });
    expect((await getPool().query("SELECT nationality FROM public.persons WHERE id=$1", [person])).rows[0].nationality).toBeNull();
    await operation(ctx => undoRun(ctx, undone.runId));
    expect((await factRecord(getPool(), recorded.result.factId))!.disposition).toBe("applied");
    const pending = await operation(ctx => recordFact(ctx, input({ field: "notes", valueType: "scalar", value: "Nota pendiente", state: "pending" })));
    await operation(ctx => undoRun(ctx, pending.runId));
    expect((await factRecord(getPool(), pending.result.factId))!).toMatchObject({ entityId: null, bindingId: null, disposition: null, state: "pending" });
    expect((await factRecord(getPool(), pending.result.factId))!.evidence).toHaveLength(1);
  });

  it("la API exige decisión explícita, permite repetir sin escribir y protege una edición posterior", async () => {
    const target = (await operation(ctx => createEntity(ctx, "person", { name: "Decisión repetida" }, { allowSimilar: true }))).result.id;
    const created = await request("POST", "/evidence-inventory/facts", { ...input({ entityId: target, field: "notes", valueType: "scalar", value: " Nota  editorial ", state: "unverifiable" }), note: "La fuente no basta para comprobarlo" });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().factId;
    expect((await request("POST", `/evidence-inventory/facts/${id}/apply`, { note: "Revisar incertidumbre" })).statusCode).toBe(409);
    const applied = await request("POST", `/evidence-inventory/facts/${id}/apply`, { editorial: true, note: "Adoptar como decisión editorial" });
    expect(applied.statusCode, applied.body).toBe(200);
    const before = await factRecord(getPool(), id);
    expect(before).toMatchObject({ state: "unverifiable", disposition: "applied" });
    const repeated = await request("POST", `/evidence-inventory/facts/${id}/apply`, { editorial: true, note: "Repetir la misma petición" });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(await factRecord(getPool(), id)).toEqual(before);
    expect((await getPool().query("SELECT id FROM ingest.claims WHERE run_id=$1", [repeated.json().runId])).rows).toEqual([]);
    expect((await getPool().query("SELECT id FROM ingest.change_journal WHERE run_id=$1", [repeated.json().runId])).rows).toEqual([]);
    await operation(ctx => updateEntity(ctx, "person", target, { notes: "Edición posterior que debe conservarse" }));
    const stale = await request("POST", `/evidence-inventory/facts/${id}/apply`, { editorial: true, note: "Reintentar después de otra edición" });
    expect(stale.statusCode, stale.body).toBe(409);
    expect((await getPool().query("SELECT notes FROM public.persons WHERE id=$1", [target])).rows[0].notes).toBe("Edición posterior que debe conservarse");
    expect(await factRecord(getPool(), id)).toEqual(before);
    await expect(getPool().query("DELETE FROM ingest.catalog_facts WHERE id=$1", [id])).rejects.toThrow(/immutable/);
  });

  it("conserva relaciones y ámbitos de ediciones distintas sin convertirlos en campos globales", async () => {
    const artist = (await operation(ctx => createEntity(ctx, "artist", { name: "Artista del inventario" }, { allowSimilar: true }))).result.id;
    const cd = (await operation(ctx => createEntity(ctx, "album", { title: "Edición CD", media_format: "CD" }, { artistId: artist, allowSimilar: true }))).result.id;
    const dvd = (await operation(ctx => createEntity(ctx, "album", { title: "Edición DVD", media_format: "DVD" }, { artistId: artist, allowSimilar: true }))).result.id;
    const facts = await operation(async ctx => {
      const edition = await recordFact(ctx, input({ kind: "album", entityId: cd, field: "media_format", valueType: "scalar", value: "CD", scope: { editionAlbumId: cd }, period: "2001" }));
      const relation = await recordFact(ctx, input({ entityId: person, field: undefined, relation: "album_credit", valueType: "relation", value: { personId: person, albumId: dvd, role: "guitarra" }, scope: { editionAlbumId: dvd }, state: "pending" }));
      return { edition, relation };
    });
    expect(await factRecord(getPool(), facts.result.edition.factId)).toMatchObject({ kind: "album", entityId: cd, scope: { editionAlbumId: cd }, period: { kind: "point", year: 2001 } });
    expect(await factRecord(getPool(), facts.result.relation.factId)).toMatchObject({ kind: "person", relation: "album_credit", value: { albumId: dvd, personId: person, role: "guitarra" }, scope: { editionAlbumId: dvd }, state: "pending" });
    await expect(operation(ctx => applyFact(ctx, facts.result.edition.factId, { editorial: true }))).rejects.toThrow(/campo global/);
    await expect(operation(ctx => applyFact(ctx, facts.result.relation.factId, { editorial: true }))).rejects.toThrow(/escritor específico/);
    expect((await getPool().query("SELECT id::int,media_format FROM public.albums WHERE id=ANY($1::bigint[]) ORDER BY id", [[cd,dvd]])).rows).toEqual([{ id: cd, media_format: "CD" }, { id: dvd, media_format: "DVD" }]);
    expect((await getPool().query("SELECT id FROM public.album_credits WHERE album_id=$1", [dvd])).rows).toEqual([]);
  });

  it("una fusión mueve el destino vigente y deshacer lo restaura sin reescribir la identidad original", async () => {
    const drop = (await operation(ctx => createEntity(ctx, "person", { name: "Destino original del hecho" }, { allowSimilar: true }))).result.id;
    const recorded = await operation(ctx => recordFact(ctx, input({ entityId: drop })));
    const before = await factRecord(getPool(), recorded.result.factId);
    const merged = await operation(ctx => mergeInto(ctx.client, "person", person, drop, ctx.note, ctx.runId));
    expect(await factRecord(getPool(), recorded.result.factId)).toMatchObject({ entityId: person, originalEntityId: drop });
    await operation(ctx => undoRun(ctx, merged.runId));
    expect(await factRecord(getPool(), recorded.result.factId)).toEqual(before);
  });

  it.each(["fusionar", "deshacer"] as const)("rechaza una aplicación cuyo destino cambia al %s entre lectura y bloqueo", async action => {
    const target = (await operation(ctx => createEntity(ctx, "person", { name: `Destino concurrente ${action}` }, { allowSimilar: true }))).result.id;
    const recorded = await operation(ctx => recordFact(ctx, input({ entityId: target, field: "notes", valueType: "scalar", value: "No sobrescribir un destino cambiado" })));
    const read = gate(), resume = gate();
    const applying = operation(async ctx => {
      const original = ctx.client.query.bind(ctx.client);
      let paused = false;
      ctx.client.query = (async (sql: string, values?: unknown[]) => {
        if (!paused && sql === "SELECT id FROM public.persons WHERE id=$1 FOR UPDATE" && values?.[0] === target) {
          paused = true; read.release(); await resume.promise;
        }
        return original(sql, values);
      }) as PoolClient["query"];
      try { await applyFact(ctx, recorded.result.factId, { editorial: false }); }
      finally { ctx.client.query = original; }
    });
    const settled = Promise.allSettled([applying]);
    await read.promise;
    try {
      if (action === "fusionar") await operation(ctx => mergeInto(ctx.client, "person", person, target, ctx.note, ctx.runId));
      else await operation(ctx => undoRun(ctx, recorded.runId));
    } finally { resume.release(); }
    const [result] = await settled;
    expect(result!.status).toBe("rejected");
    if (result!.status === "rejected") expect(String(result.reason)).toMatch(/destino del hecho cambió/);
    expect(await factRecord(getPool(), recorded.result.factId)).toMatchObject({ originalEntityId: target, entityId: action === "fusionar" ? person : null, disposition: action === "fusionar" ? "pending" : null });
    expect((await getPool().query("SELECT notes FROM public.persons WHERE id=$1", [action === "fusionar" ? person : target])).rows[0].notes).not.toBe("No sobrescribir un destino cambiado");
  });

  it("revertir y reaplicar conserva cada fila de evidencia y del core y continúa las secuencias", async () => {
    const tables = ["evidence_documents", "evidence_reads", "evidence_fragments", "catalog_facts", "catalog_fact_evidence", "catalog_fact_bindings"];
    const snapshot = async (schema: string) => Promise.all(tables.map(async table => (await getPool().query(`SELECT to_jsonb(t) AS row FROM ${schema}.${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const before = await snapshot("ingest");
    const core = (await getPool().query("SELECT to_jsonb(t) AS row FROM public.persons t ORDER BY id")).rows;
    await getPool().query(await readFile(path.join(DEFAULT_MIGRATIONS_DIR, "0062_catalog_model.down.sql"), "utf8"));
    await getPool().query(await readFile(path.join(DEFAULT_MIGRATIONS_DIR, "0060_fact_inventory.down.sql"), "utf8"));
    expect(await snapshot("crv_evidence_archive")).toEqual(before);
    const up = await readFile(path.join(DEFAULT_MIGRATIONS_DIR, "0060_fact_inventory.up.sql"), "utf8");
    await getPool().query(up); await getPool().query(up);
    await getPool().query(await readFile(path.join(DEFAULT_MIGRATIONS_DIR, "0062_catalog_model.up.sql"), "utf8"));
    expect(await snapshot("ingest")).toEqual(before);
    expect((await getPool().query("SELECT to_jsonb(t) AS row FROM public.persons t ORDER BY id")).rows).toEqual(core);
    const next = await rememberEvidenceDocument(getPool(), { url: "https://example.org/next", title: "Después de reaplicar", content, contentHash: hash, fetchedAt: capturedAt, capturedAt, readAt, acquisitionMethod: "http" });
    expect(next).toBeGreaterThan(document);
    await expect(getPool().query("DELETE FROM ingest.evidence_documents WHERE id=$1", [document])).rejects.toThrow(/immutable/);
  });
});
