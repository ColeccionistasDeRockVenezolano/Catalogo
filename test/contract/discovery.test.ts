import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { getPool, closeDb } from "../../src/db/client.js";
import { migrateUp } from "../../src/db/migrate.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import { importDiscoveryBatch, type DiscoveryBatch } from "../../src/discovery/curation.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRunWithJournal } from "../../src/merge/journal-undo.js";
import { mergeInto } from "../../src/review/duplicates.js";
import type { FastifyInstance } from "fastify";

describe("descubrimiento editorial: contrato, curaduría, migración e integridad", () => {
 let pg: PgContainer, app: FastifyInstance, id: number, other: number, evidence: number, source: number;
 const batch = (): DiscoveryBatch => ({ batch: "qa", reviewer: "QA", note: "Revisión documental del proyecto y origen",
   labels: [{ slug: "historicos", name: "Históricos", definition: "Trayectoria documentada", criterion: "Origen y trayectoria revisados" }],
   artists: [{ key: "artist", artistId: id, expectedName: "Artista QA", state: "approved", evidenceId: evidence,
     reason: "Fuente documenta proyecto musical y origen venezolano", group: "historicos", priority: 1,
     validFrom: "2020-01-01T00:00:00Z", validUntil: null,
     labels: [{ slug: "historicos", state: "approved", evidenceId: evidence, reason: "Trayectoria documentada en la fuente" }] }] });
 const list = async () => (await app.inject("/discovery/search-suggestions")).json();
 beforeAll(async () => {
   pg = await startPgContainer(); process.env["DATABASE_URL"] = pg.databaseUrl;
   process.env["CRV_DISCOVERY_ENABLED"] = "true"; process.env["CRV_CURATION_AUTOSCAN"] = "false"; resetEnvCache();
   await applyCore(pg.name); await migrateUp();
   const p = getPool();
   source = Number((await p.query("INSERT INTO ingest.sources(slug,name,site_type,trust_level) VALUES('qa-discovery','QA','database','high') RETURNING id")).rows[0].id);
   id = Number((await p.query("INSERT INTO artists(name) VALUES('Artista QA') RETURNING id")).rows[0].id);
   other = Number((await p.query("INSERT INTO artists(name) VALUES('Duplicado QA') RETURNING id")).rows[0].id);
   const claim = Number((await p.query(`INSERT INTO ingest.claims(source_id,entity_kind,identity_key,field,raw_value,normalized_value,raw_hash,extractor,extractor_version,artist_id)
     VALUES($1,'artist','qa','biography','"Banda venezolana"','"Banda venezolana"',repeat('a',64),'qa','1',$2) RETURNING id`, [source,id])).rows[0].id);
   evidence = Number((await p.query("INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,evidence_hash) VALUES($1,'https://example.org/qa','Banda venezolana formada en Caracas en 1980',repeat('b',64)) RETURNING id", [claim])).rows[0].id);
   app = await buildApp();
 });
 afterAll(async () => { await app?.close(); await closeDb(); delete process.env["CRV_DISCOVERY_ENABLED"]; delete process.env["CRV_CURATION_AUTOSCAN"]; resetEnvCache(); await pg?.stop(); });
 it("migración SQL repetible; runner idempotente; rollback específico conserva public", async () => {
   const snapshot = () => execFileSync("docker",["exec",pg.name,"pg_dump","-U","postgres","-d","postgres","--schema=public","--schema-only"],{encoding:"utf8"})
     .split("\n").filter(line => !/^\\(un)?restrict/.test(line)).join("\n");
   const before = snapshot();
   expect((await migrateUp()).applied).toEqual([]);
   await getPool().query(await readFile("migrations/0052_discovery.up.sql", "utf8"));
   await getPool().query(await readFile("migrations/0052_discovery.down.sql", "utf8"));
   expect(snapshot()).toBe(before);
   expect((await getPool().query("SELECT id FROM artists")).rows).toHaveLength(2);
   expect((await getPool().query("SELECT to_regclass('ingest.artist_search_suggestions') AS t")).rows[0].t).toBeNull();
   // Backend compatible antes de migrar.
   expect((await list()).suggestions).toEqual([]);
   expect((await migrateUp()).applied).toEqual(["0052_discovery"]);
   expect((await migrateUp()).applied).toEqual([]);
 });
 it("vista previa no escribe; aplicar es idempotente y por ID", async () => {
   expect((await importDiscoveryBatch(batch())).result.conflicts).toEqual([]);
   expect((await list()).suggestions).toEqual([]);
   await importDiscoveryBatch(batch(),true);
   const rows = (await getPool().query("SELECT * FROM ingest.artist_search_suggestions")).rows;
   await importDiscoveryBatch(batch(),true);
   expect((await getPool().query("SELECT * FROM ingest.artist_search_suggestions")).rows).toEqual(rows);
   expect((await list()).suggestions.map((s: {id:number}) => s.id)).toEqual([id]);
   expect((await app.inject("/discovery/search-suggestions")).headers["cache-control"]).toBe("no-store");
 });
 it("rechaza evidencia ajena, IDs ausentes, aliases duplicados y ventanas inválidas", async () => {
   const wrong = batch(); wrong.artists[0]!.artistId=other; wrong.artists[0]!.expectedName="Duplicado QA";
   expect((await importDiscoveryBatch(wrong)).result.conflicts.length).toBeGreaterThan(0);
   const missing=batch(); missing.artists[0]!.artistId=999999;
   expect((await importDiscoveryBatch(missing)).result.conflicts.length).toBeGreaterThan(0);
   const twice=batch(); twice.artists.push({...twice.artists[0]!,key:"alias"});
   expect((await importDiscoveryBatch(twice)).result.conflicts.length).toBeGreaterThan(0);
   const invalid=batch(); invalid.artists[0]!.validUntil="2019-01-01T00:00:00Z";
   await expect(importDiscoveryBatch(invalid,true)).rejects.toThrow();
 });
 it("solo aprobadas vigentes; pendientes, rechazo, retiro, futuro y vencidas no aparecen", async () => {
   for (const state of ["proposed","rejected","withdrawn"]) {
     await getPool().query("UPDATE ingest.artist_search_suggestions SET state=$1",[state]);
     expect((await list()).suggestions).toEqual([]);
   }
   await getPool().query("UPDATE ingest.artist_search_suggestions SET state='approved',valid_until='2021-01-01'");
   expect((await list()).suggestions).toEqual([]);
   await getPool().query("UPDATE ingest.artist_search_suggestions SET valid_until=NULL,valid_from='2099-01-01'");
   expect((await list()).suggestions).toEqual([]);
   await importDiscoveryBatch(batch(),true);
   await getPool().query("INSERT INTO ingest.artist_aliases(artist_id,alias,normalized_alias,alias_type) VALUES($1,'Alias QA','alias qa','stage_name')",[id]);
   expect((await list()).suggestions).toHaveLength(1);
 });
 it("retirar y deshacer/rehacer conserva evidencias; renombrar devuelve nombre actual", async () => {
   const b=batch(); b.artists[0]!.state="withdrawn";
   const removal=await importDiscoveryBatch(b,true);
   expect((await list()).suggestions).toEqual([]);
   const undo=await withOperatorRun({name:"qa:undo",operator:"QA",note:"Deshacer retiro"},ctx=>undoRunWithJournal(ctx,removal.runId));
   expect((await list()).suggestions).toHaveLength(1);
   await withOperatorRun({name:"qa:redo",operator:"QA",note:"Rehacer retiro"},ctx=>undoRunWithJournal(ctx,undo.runId));
   expect((await list()).suggestions).toEqual([]);
   await importDiscoveryBatch(batch(),true);
   await getPool().query("UPDATE artists SET name='Nombre nuevo' WHERE id=$1",[id]);
   expect((await list()).suggestions[0].name).toBe("Nombre nuevo");
   await getPool().query("UPDATE artists SET name='Artista QA' WHERE id=$1",[id]);
 });
 it("fusión contradictoria conserva ambas decisiones y etiquetas; deshacer/rehacer restaura", async () => {
   const otherClaim = Number((await getPool().query(`INSERT INTO ingest.claims(source_id,entity_kind,identity_key,field,raw_value,normalized_value,raw_hash,extractor,extractor_version,artist_id)
     VALUES($1,'artist','qa-other','biography','"Otra interpretación"','"Otra interpretación"',repeat('c',64),'qa','1',$2) RETURNING id`,[source,other])).rows[0].id);
   const otherEvidence = Number((await getPool().query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,evidence_hash)
     VALUES($1,'https://example.org/other','Revisión del duplicado',repeat('d',64)) RETURNING id`,[otherClaim])).rows[0].id);
   await getPool().query(`INSERT INTO ingest.artist_search_suggestions(import_key,artist_id,state,exposure_group,reviewer,reason,evidence_id)
     VALUES('qa:other',$1,'rejected','historicos','QA','Identidad pendiente de revisión',$2)`,[other,otherEvidence]);
   await getPool().query(`INSERT INTO ingest.artist_discovery_labels(import_key,artist_id,label_id,state,reviewer,reason,evidence_id)
     SELECT 'qa:other:historicos',$1,id,'rejected','QA','Criterio editorial contradictorio',$2 FROM ingest.discovery_labels WHERE slug='historicos'`,[other,otherEvidence]);
   const beforeLabels=(await getPool().query("SELECT * FROM ingest.artist_discovery_labels ORDER BY id")).rows;
   const before=(await getPool().query("SELECT * FROM ingest.artist_search_suggestions ORDER BY id")).rows;
   const merge=await withOperatorRun({name:"qa:merge",operator:"QA",note:"Misma identidad"},ctx=>mergeInto(ctx.client,"artist",id,other,"Misma identidad",ctx.runId));
   expect((await list()).suggestions).toEqual([]);
   expect((await getPool().query("SELECT * FROM ingest.artist_search_suggestions WHERE artist_id=$1",[id])).rows).toHaveLength(2);
   expect((await getPool().query("SELECT * FROM ingest.artist_discovery_labels WHERE artist_id=$1",[id])).rows).toHaveLength(2);
   expect(new Set((await getPool().query("SELECT evidence_id FROM ingest.artist_discovery_labels")).rows.map(r=>Number(r.evidence_id)))).toEqual(new Set([evidence,otherEvidence]));
   const undo=await withOperatorRun({name:"qa:undo",operator:"QA",note:"Deshacer fusión"},ctx=>undoRunWithJournal(ctx,merge.runId));
   expect((await getPool().query("SELECT * FROM ingest.artist_search_suggestions ORDER BY id")).rows).toEqual(before);
   expect((await getPool().query("SELECT * FROM ingest.artist_discovery_labels ORDER BY id")).rows).toEqual(beforeLabels);
   expect((await list()).suggestions).toHaveLength(1);
   await withOperatorRun({name:"qa:redo",operator:"QA",note:"Rehacer fusión"},ctx=>undoRunWithJournal(ctx,undo.runId));
   expect((await list()).suggestions).toEqual([]);
   // Revisar el choque deja dos aprobaciones y dos evidencias, una identidad.
   await getPool().query("UPDATE ingest.artist_search_suggestions SET state='approved' WHERE artist_id=$1",[id]);
   expect((await list()).suggestions).toHaveLength(1);
   expect((await getPool().query("SELECT id FROM ingest.claim_evidence WHERE id=ANY($1)",[[evidence,otherEvidence]])).rows).toHaveLength(2);
 });
 it("bandera apagada devuelve fallback y búsqueda existente sigue disponible", async () => {
   process.env["CRV_DISCOVERY_ENABLED"]="false"; resetEnvCache();
   const result=await list(); expect(result.enabled).toBe(false); expect(result.suggestions).toEqual([]);
   expect(result.fallback).toBe("Busca artistas, bandas, álbumes o canciones");
   expect((await app.inject("/search?q=Artista")).statusCode).toBe(200);
 });
});
