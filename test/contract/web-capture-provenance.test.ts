import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { migrateUp, DEFAULT_MIGRATIONS_DIR } from "../../src/db/migrate.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { WebSearchBroker } from "../../src/ambiguity/web-search.js";
import { evaluateVerification } from "../../src/verification/evaluate.js";
import { saveIndividualVerification } from "../../src/verification/store.js";
import {preserveCapture,recoverSourceCapture,readCaptureOriginal} from "../../src/verification/documents/capture.js";
import {buildApp} from "../../src/api/app.js";
import {rememberEvidenceFragment} from "../../src/evidence/inventory.js";
import { verificationReportSchema } from "../../src/api/routes/entity-verification.js";

const html = "<html><title>Banda Archivo</title><body>Banda Archivo publicó Disco Archivo en 2001. La biografía original conserva el contexto de su discografía y los detalles documentados. El álbum pertenece a la banda venezolana y contiene su repertorio original.</body></html>";
const original = "2001-05-06T00:00:00.123Z";

describe("captura original separada de relectura", () => {
  let database: PgContainer;
  let directory: string;
  const previousDataDir = process.env["DATA_DIR"];
  beforeAll(async () => {
    database = await startPgContainer(); directory = await mkdtemp(path.join(tmpdir(), "crv-provenance-"));
    process.env["DATABASE_URL"] = database.databaseUrl; process.env["DATA_DIR"] = directory; resetEnvCache();
    await applyCore(database.name); await migrateUp();
    await mkdir(path.join(directory, "raw")); await writeFile(path.join(directory, "raw", "source.html"), html);
    const source = (await getPool().query("INSERT INTO ingest.sources(slug,name,site_type,trust_level) VALUES('capture-test','Fuente Archivo','website','high') RETURNING id")).rows[0].id;
    await getPool().query(`INSERT INTO ingest.raw_pages(source_id,url,http_status,content_type,sha256,stored_path,fetched_at)
      VALUES($1,'https://93.184.216.34/archive',200,'text/html',$2,'raw/source.html',$3::timestamptz)`, [source,createHash("sha256").update(html).digest("hex"),original]);
  }, 120_000);
  afterAll(async () => {
    await closeDb(); await database?.stop(); await rm(directory, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env["DATA_DIR"]; else process.env["DATA_DIR"] = previousDataDir;
    resetEnvCache();
  }, 60_000);

  it("conserva la captura del archivo, la persiste en caché y la mantiene en nuevas lecturas e informes", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 403 }));
    const first = await new WebSearchBroker(getPool(), "", fetcher).page("https://93.184.216.34/archive");
    expect(Date.parse(first!.capturedAt!)).toBe(Date.parse(original));
    expect(first).toMatchObject({ acquisitionMethod: "raw_archive", fetchedAt: first!.capturedAt });
    expect(Date.parse(first!.readAt!)).toBeGreaterThan(Date.parse(original));
    const cache = (await getPool().query("SELECT captured_at, read_at, acquisition_method FROM ingest.person_web_page_cache WHERE url=$1", [first!.url])).rows[0];
    expect(cache.captured_at.toISOString()).toBe(original); expect(cache.acquisition_method).toBe("raw_archive");
    const forbidden = vi.fn(async () => { throw new Error("El caché no debe volver a obtener la fuente"); });
    const second = await new WebSearchBroker(getPool(), "", forbidden).page(first!.url);
    expect(forbidden).not.toHaveBeenCalled(); expect(second!.capturedAt).toBe(first!.capturedAt);
    const artist = Number((await getPool().query("INSERT INTO public.artists(name) VALUES('Banda Archivo') RETURNING id")).rows[0].id);
    const report = evaluateVerification({ kind: "artist", id: artist, name: "Banda Archivo", identity: ["Banda Archivo"], units: [], sourceUrls: [], albums: [], catalogAlbums: [] }, [second!], undefined, true);
    await saveIndividualVerification(report, "QA");
    const stored = (await getPool().query("SELECT report FROM ingest.entity_verification_reports WHERE entity_kind='artist' AND entity_id=$1 ORDER BY id DESC LIMIT 1", [artist])).rows[0].report;
    expect(verificationReportSchema.parse(stored).sources[0]).toMatchObject({ capturedAt: first!.capturedAt, acquisitionMethod: "raw_archive", readAt: second!.readAt });
  });

  it("una descarga nueva registra captura y lectura; releer el caché conserva la captura", async () => {
    const fresh = await new WebSearchBroker(getPool(), "", async () => new Response(html, { headers: { "content-type": "text/html" } })).page("https://93.184.216.34/fresh");
    expect(fresh!.acquisitionMethod).toBe("http"); expect(Date.parse(fresh!.capturedAt!)).toBeLessThanOrEqual(Date.parse(fresh!.readAt!));
    const reread = await new WebSearchBroker(getPool(), "", async () => { throw new Error("No descargar"); }).page(fresh!.url);
    expect(Date.parse(reread!.capturedAt!)).toBe(Date.parse(fresh!.capturedAt!)); expect(reread!.acquisitionMethod).toBe("http");
  });

  it("conserva el HTML original y la posición de una cita final y permite descargarlo solo a un administrador",async()=>{
    const long=`<html><title>Banda Archivo</title><body><header><h1>Banda Archivo</h1></header><p>${"Historia documentada. ".repeat(4000)}</p><p>Banda Archivo nació como proyecto en 1989 y publicó Disco Final en 2001.</p></body></html>`;
    const page=await new WebSearchBroker(getPool(),"",async()=>new Response(long,{headers:{"content-type":"text/html"}})).page("https://93.184.216.34/full");
    expect(page!.content).toContain("Disco Final en 2001");expect(page!.document?.complete).toBe(true);
    const id=(await getPool().query("SELECT id::text,raw_capture_id FROM ingest.evidence_documents WHERE content_hash=$1",[page!.contentHash])).rows[0].id;
    const quote="Banda Archivo nació como proyecto en 1989 y publicó Disco Final en 2001.";
    const fragment=await rememberEvidenceFragment(getPool(),Number(id),quote);
    const row=(await getPool().query("SELECT selector FROM ingest.evidence_fragments WHERE id=$1",[fragment])).rows[0];
    expect(JSON.parse(row.selector)).toMatchObject({captureId:page!.document!.captureId,locations:[expect.objectContaining({selector:expect.stringContaining("p:nth-of-type")})]});
    const before=process.env["CRV_OPERATOR_TOKEN"];process.env["CRV_OPERATOR_TOKEN"]="document-download-operator-token-long";resetEnvCache();
    const app=await buildApp();
    try{
      const url=`/entity-verification/captures/${page!.document!.captureId}/original`;
      expect((await app.inject({method:"GET",url})).statusCode).toBe(401);
      const allowed=await app.inject({method:"GET",url,headers:{authorization:"Bearer document-download-operator-token-long"}});
      expect(allowed.statusCode).toBe(200);expect(allowed.body).toBe(long);expect(allowed.headers["content-disposition"]).toContain("attachment");expect(allowed.headers["content-security-policy"]).toContain("sandbox");expect(allowed.headers["cache-control"]).toBe("no-store");
    }finally{await app.close();if(before===undefined)delete process.env["CRV_OPERATOR_TOKEN"];else process.env["CRV_OPERATOR_TOKEN"]=before;resetEnvCache();}
  });

  it("marca como parcial una descarga limitada y preserva los bytes obtenidos",async()=>{
    const before=process.env["CRV_RESEARCH_DOCUMENT_MAX_BYTES"];process.env["CRV_RESEARCH_DOCUMENT_MAX_BYTES"]="200";resetEnvCache();
    try{
      const page=await new WebSearchBroker(getPool(),"",async()=>new Response(html,{headers:{"content-type":"text/html"}})).page("https://93.184.216.34/limited");
      expect(page!.document?.complete).toBe(false);expect(page!.document?.unreadParts.join(" ")).toContain("200 bytes");
      const capture=(await getPool().query("SELECT byte_size,acquisition_complete,stored_path FROM ingest.research_source_captures WHERE id=$1",[page!.document!.captureId])).rows[0];
      expect(capture.acquisition_complete).toBe(false);expect((await readFile(path.join(directory,capture.stored_path))).length).toBe(200);
    }finally{if(before===undefined)delete process.env["CRV_RESEARCH_DOCUMENT_MAX_BYTES"];else process.env["CRV_RESEARCH_DOCUMENT_MAX_BYTES"]=before;resetEnvCache();}
  });

  it("recupera el original y su fecha cuando la base falla después de escribir los bytes",async()=>{
    const url="https://93.184.216.34/interrupted";
    const unavailable={query:async()=>{throw new Error("base interrumpida");}};
    await expect(preserveCapture(unavailable,{url,finalUrl:url,contentType:"text/html",capturedAt:original,method:"http",status:200,complete:true,reason:null,parentId:null},Buffer.from(html))).rejects.toThrow("base interrumpida");
    const recovered=await recoverSourceCapture(getPool(),url);
    expect(Date.parse(recovered!.capturedAt!)).toBe(Date.parse(original));expect(recovered?.complete).toBe(true);
    expect(Buffer.from(await readCaptureOriginal(recovered!)).toString()).toBe(html);
    expect(await recoverSourceCapture(getPool(),url)).toBeNull();
    const secondUrl="https://93.184.216.34/interrupted-broker";
    await expect(preserveCapture(unavailable,{url:secondUrl,finalUrl:secondUrl,contentType:"text/html",capturedAt:original,method:"http",status:200,complete:true,reason:null,parentId:null},Buffer.from(html))).rejects.toThrow();
    const fetcher=vi.fn(async()=>{throw new Error("La reanudación debe usar el original recuperado");});
    const page=await new WebSearchBroker(getPool(),"",fetcher).page(secondUrl);
    expect(page!.content).toContain("Disco Archivo en 2001");expect(fetcher).not.toHaveBeenCalled();expect(Date.parse(page!.capturedAt!)).toBe(Date.parse(original));
  });

  it("la migración no interpreta la fecha histórica del caché como una captura verificada", async () => {
    const inventory = async () => (await getPool().query("SELECT to_jsonb(d) AS document FROM ingest.evidence_documents d ORDER BY id")).rows;
    const before = await inventory();
    expect(before.length).toBeGreaterThan(0);
    await getPool().query(await readFile(path.join(DEFAULT_MIGRATIONS_DIR, "0059_web_capture_provenance.down.sql"), "utf8"));
    await getPool().query(`INSERT INTO ingest.person_web_page_cache(url,title,content,content_hash,fetched_at)
      VALUES('https://93.184.216.34/old','Fuente histórica','Contenido histórico','old','2015-01-01')`);
    const up = await readFile(path.join(DEFAULT_MIGRATIONS_DIR, "0059_web_capture_provenance.up.sql"), "utf8");
    await getPool().query(up); await getPool().query(up);
    expect((await getPool().query("SELECT captured_at,read_at,acquisition_method FROM ingest.person_web_page_cache WHERE content_hash='old'")).rows[0]).toEqual({ captured_at: null, read_at: null, acquisition_method: "unknown" });
    expect(await inventory()).toEqual(before);
  });

  it("rechaza un archivo alterado que ya no coincide con la captura guardada", async () => {
    await getPool().query("DELETE FROM ingest.person_web_page_cache WHERE url='https://93.184.216.34/archive'");
    await writeFile(path.join(directory,"raw","source.html"),html.replace("2001","2015"));
    try {
      await expect(new WebSearchBroker(getPool(),"",async()=>new Response("",{status:403})).page("https://93.184.216.34/archive")).rejects.toThrow("HTTP 403");
      expect((await getPool().query("SELECT url FROM ingest.person_web_page_cache WHERE url='https://93.184.216.34/archive'")).rows).toEqual([]);
    } finally { await writeFile(path.join(directory,"raw","source.html"),html); }
  });
});
