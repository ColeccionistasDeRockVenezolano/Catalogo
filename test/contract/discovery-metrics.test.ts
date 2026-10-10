import { randomUUID, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { getPool, closeDb } from "../../src/db/client.js";
import { migrateUp } from "../../src/db/migrate.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildApp } from "../../src/api/app.js";
import { aggregateMetrics } from "../../src/discovery/aggregate.js";
import { trendPrototype } from "../../src/discovery/trends.js";
import { withOperatorRun } from "../../src/merge/operator.js";
import { undoRunWithJournal } from "../../src/merge/journal-undo.js";
import { mergeInto } from "../../src/review/duplicates.js";
import type { MetricEvent } from "../../src/discovery/metrics.js";
import type { FastifyInstance } from "fastify";

describe("métricas propias: eventos, privacidad, lotes y prototipo interno", () => {
  let pg: PgContainer, app: FastifyInstance, artist: number, other: number;
  let ticket: string, receipt: string;
  const client=randomUUID(), impressionId=randomUUID();
  const originalEnv = { ...process.env };
  const origin="http://127.0.0.1:5173";
  const post = (kind: MetricEvent["kind"], token=receipt, overrides: Partial<MetricEvent>={}, headers: Record<string,string>={}) =>
    app.inject({ method:"POST",url:"/discovery/metrics/events",headers:{origin,"user-agent":"CRV QA human-browser",...headers},
      payload:{id:randomUUID(),client,kind,token,...overrides} });
  beforeAll(async () => {
    pg=await startPgContainer(); process.env["DATABASE_URL"]=pg.databaseUrl;
    process.env["CRV_DISCOVERY_ENABLED"]="true"; process.env["CRV_DISCOVERY_METRICS_ENABLED"]="true";
    process.env["CRV_DISCOVERY_METRICS_SECRET"]="qa-independent-metrics-secret-32-chars";
    process.env["CRV_OPERATOR_TOKEN"]="qa-metrics-operator-token-32-chars";
    const salt=Buffer.alloc(16,7);
    const hash=scryptSync("QA password",salt,32,{N:16384,r:8,p:1}).toString("base64url");
    const passwordHash=`scrypt$16384$8$1$${salt.toString("base64url")}$${hash}`;
    process.env["CRV_COLLABORATORS_JSON"]=JSON.stringify([{username:"qaadmin",name:"QA Admin",passwordHash,role:"admin"},{username:"qareader",name:"QA Reader",passwordHash,role:"reader"}]);
    process.env["CRV_CURATION_AUTOSCAN"]="false"; delete process.env["CRV_HERRA_DB_PATH"]; resetEnvCache();
    await applyCore(pg.name); await migrateUp();
    artist=Number((await getPool().query("INSERT INTO artists(name) VALUES('Artista métricas') RETURNING id")).rows[0].id);
    other=Number((await getPool().query("INSERT INTO artists(name) VALUES('Otro métricas') RETURNING id")).rows[0].id);
    const source=Number((await getPool().query("INSERT INTO ingest.sources(slug,name,site_type,trust_level) VALUES('qa-metrics','QA','database','high') RETURNING id")).rows[0].id);
    const claim=Number((await getPool().query(`INSERT INTO ingest.claims(source_id,entity_kind,identity_key,field,raw_value,normalized_value,raw_hash,extractor,extractor_version,artist_id)
      VALUES($1,'artist','qa','biography','"Proyecto venezolano"','"Proyecto venezolano"',repeat('a',64),'qa','1',$2) RETURNING id`,[source,artist])).rows[0].id);
    const evidence=Number((await getPool().query("INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,evidence_hash) VALUES($1,'https://example.org/metrics','Banda venezolana',repeat('b',64)) RETURNING id",[claim])).rows[0].id);
    await getPool().query("INSERT INTO ingest.artist_search_suggestions(import_key,artist_id,evidence_id,state,exposure_group,reviewer,reason) VALUES('qa-metrics',$1,$2,'approved','historicos','QA','Documento revisado')",[artist,evidence]);
    app=await buildApp();
  });
  afterAll(async () => {
    await app?.close(); await closeDb(); await pg?.stop();
    for (const key of ["DATABASE_URL","CRV_DISCOVERY_ENABLED","CRV_DISCOVERY_METRICS_ENABLED","CRV_DISCOVERY_METRICS_SECRET","CRV_OPERATOR_TOKEN","CRV_COLLABORATORS_JSON","CRV_CURATION_AUTOSCAN","CRV_HERRA_DB_PATH"]) {
      if (originalEnv[key]===undefined) delete process.env[key]; else process.env[key]=originalEnv[key];
    }
    resetEnvCache();
  });
  it("separa administradores autenticados y permite lectura pública sin abrir otras escrituras", async () => {
    for (const username of ["qaadmin","qareader"]) {
      const login=await app.inject({method:"POST",url:"/auth/login",headers:{origin},payload:{username,password:"QA password"}});
      expect(login.statusCode).toBe(200);
      const cookie=String(login.headers["set-cookie"]).split(";",1)[0]!;
      const suggestions=(await app.inject({url:"/discovery/search-suggestions",headers:{cookie}})).json();
      expect(suggestions.metrics.enabled).toBe(username==="qareader");
      expect((await app.inject({url:"/discovery/metrics/prototype",headers:{cookie}})).statusCode).toBe(username==="qareader"?403:200);
      if(username==="qaadmin") expect((await post("impression","none",{visibleMs:1000},{cookie})).json().status).toBe("excluded");
    }
    expect((await app.inject({method:"POST",url:"/artists",headers:{origin},payload:{name:"No autorizado"}})).statusCode).toBe(401);
    expect((await app.inject({url:"/discovery/search-suggestions",headers:{cookie:"crv_session=expired"}})).json().metrics.enabled).toBe(false);
    expect((await post("impression","none",{visibleMs:1000},{cookie:"crv_session=expired"})).json().status).toBe("excluded");
  });
  it("migración repetible y rollback específico conservan public y fase 1; backend antes de migrar", async () => {
    const snapshot=()=>execFileSync("docker",["exec",pg.name,"pg_dump","-U","postgres","-d","postgres","--schema=public","--schema-only"],{encoding:"utf8"}).split("\n").filter(l=>!/^\\(un)?restrict/.test(l)).join("\n");
    const before=snapshot();
    await getPool().query(await readFile("migrations/0053_discovery_metrics.up.sql","utf8"));
    expect((await migrateUp()).applied).toEqual([]);
    await getPool().query(await readFile("migrations/0053_discovery_metrics.down.sql","utf8"));
    expect(snapshot()).toBe(before);
    expect((await app.inject("/discovery/search-suggestions")).json().metrics.enabled).toBe(false);
    expect((await app.inject("/discovery/search-suggestions")).json().suggestions).toHaveLength(1);
    expect((await post("impression","none",{visibleMs:1000})).json().status).toBe("disabled");
    expect((await migrateUp()).applied).toEqual(["0053_discovery_metrics"]);
  });
  it("descargar no es exposición; credenciales firmadas, origen, bots y campos estrictos", async () => {
    const result=(await app.inject("/discovery/search-suggestions")).json();
    expect(result.metrics.enabled).toBe(true); ticket=result.suggestions[0].metricTicket;
    expect((await getPool().query("SELECT * FROM ingest.discovery_metric_events")).rowCount).toBe(0);
    expect((await post("impression",ticket+"x",{visibleMs:1000})).json().status).toBe("ignored");
    expect((await post("impression",ticket,{visibleMs:999})).statusCode).toBe(400);
    expect((await post("impression",ticket,{visibleMs:1000},{origin:"https://evil.example"})).statusCode).toBe(403);
    expect((await post("impression",ticket,{visibleMs:1000},{"user-agent":"Googlebot"})).json().status).toBe("excluded");
    expect((await post("impression",ticket,{visibleMs:1000},{authorization:"Bearer qa-metrics-operator-token-32-chars"})).json().status).toBe("excluded");
    expect((await app.inject({method:"POST",url:"/discovery/metrics/events",headers:{origin},payload:{id:randomUUID(),client,kind:"impression",token:ticket,query:"personal"}})).statusCode).toBe(400);
    expect((await post("impression",ticket,{visibleMs:1000})).json().status).toBe("ignored"); // aún no 1 s
    await new Promise(resolve=>setTimeout(resolve,1050));
    const recorded=(await post("impression",ticket,{id:impressionId,visibleMs:1000})).json();
    expect(recorded.status).toBe("recorded"); receipt=recorded.receipt;
    expect(receipt).toBeTruthy();
  });
  it("embudo ordenado, recibo ligado a sesión, idempotencia y dedupe concurrente", async () => {
    expect((await post("search")).json().status).toBe("ignored");
    expect((await post("acceptance",receipt,{client:randomUUID()})).json().status).toBe("ignored");
    const acceptances=await Promise.all([post("acceptance"),post("acceptance")]);
    expect(acceptances.map(r=>r.json().status).sort()).toEqual(["deduplicated","recorded"]);
    expect((await post("visit")).json().status).toBe("ignored");
    expect((await post("search")).json().status).toBe("recorded");
    expect((await post("search")).json().status).toBe("deduplicated");
    expect((await post("visit")).json().status).toBe("recorded");
    expect((await post("impression",ticket,{visibleMs:1000})).json().status).toBe("deduplicated");
    const rows=(await getPool().query("SELECT * FROM ingest.discovery_metric_events ORDER BY received_at")).rows;
    expect(rows).toHaveLength(4); expect(rows.every(r=>r.impression_id===impressionId)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(client);
    expect(Object.keys(rows[0]).sort()).toEqual(["client_key","exposure_config","id","impression_id","kind","received_at","subject_id"]);
    await expect(getPool().query(`INSERT INTO ingest.discovery_metric_events(id,impression_id,subject_id,kind,client_key,exposure_config)
      VALUES($1,$2,$3,'acceptance','bad-chain','cfg')`,[randomUUID(),randomUUID(),artist])).rejects.toMatchObject({code:"23503"});
  });
  it("retiro y expiración de ticket o atribución no generan nuevos eventos", async () => {
    await getPool().query("UPDATE ingest.artist_search_suggestions SET state='withdrawn'");
    expect((await post("impression",ticket,{visibleMs:1000,client:randomUUID()})).json().status).toBe("ignored");
    await getPool().query("UPDATE ingest.artist_search_suggestions SET state='approved'");
    await getPool().query("UPDATE ingest.discovery_metric_events SET received_at=clock_timestamp()-interval '16 minutes' WHERE kind='impression'");
    expect((await post("acceptance")).json().status).toBe("ignored");
    // Se vuelve a fechar la cohorte para los siguientes casos de agregación.
    await getPool().query("UPDATE ingest.discovery_metric_events SET received_at='2026-10-09T23:59:30Z' WHERE kind='impression'");
    await getPool().query("UPDATE ingest.discovery_metric_events SET received_at='2026-10-10T00:00:30Z' WHERE kind<>'impression'");
  });
  it("agregado por cohorte UTC, idempotencia, cierre, purga y trazabilidad", async () => {
    const now=new Date("2026-10-10T12:00:00Z");
    const result=await aggregateMetrics(now); expect(result.status).toBe("completed");
    const snapshot=(await getPool().query("SELECT day,subject_id,kind,count,exposure_configs FROM ingest.discovery_metric_daily ORDER BY kind")).rows;
    expect(snapshot).toHaveLength(4); expect(snapshot.every(r=>r.day==="2026-10-09" && r.count===1)).toBe(true);
    await aggregateMetrics(now);
    expect((await getPool().query("SELECT day,subject_id,kind,count,exposure_configs FROM ingest.discovery_metric_daily ORDER BY kind")).rows).toEqual(snapshot);
    const lock=await getPool().connect(); await lock.query("SELECT pg_advisory_lock(7530053)");
    try { expect((await aggregateMetrics(now)).status).toBe("busy"); } finally { await lock.query("SELECT pg_advisory_unlock(7530053)"); lock.release(); }
    expect((await trendPrototype(now)).results[0]?.reasons).toContain("insufficient_volume");
    expect((await trendPrototype(new Date("2026-10-11T12:00:00Z"))).status).toBe("stale");
    const old=randomUUID();
    await getPool().query("INSERT INTO ingest.discovery_metric_events(id,impression_id,subject_id,kind,received_at,client_key,exposure_config) VALUES($1,$1,$2,'impression','2026-08-01','old-key','cfg')",[old,artist]);
    await getPool().query("INSERT INTO ingest.discovery_metric_daily(day,subject_id,kind,count,exposure_configs,updated_at) VALUES('2025-01-01',$1,'impression',1,'{cfg}',now())",[artist]);
    await aggregateMetrics(now);
    expect((await getPool().query("SELECT id FROM ingest.discovery_metric_events WHERE id=$1",[old])).rowCount).toBe(0);
    expect((await getPool().query("SELECT day FROM ingest.discovery_metric_daily WHERE day='2025-01-01'")).rowCount).toBe(0);
    expect((await getPool().query("SELECT status FROM ingest.discovery_metric_jobs")).rows.every(r=>r.status==="completed")).toBe(true);
  });
  it("ventanas equivalentes con muestra suficiente producen prototipo interno sin ranking", async () => {
    await getPool().query("DELETE FROM ingest.discovery_metric_daily");
    await getPool().query(`INSERT INTO ingest.discovery_metric_daily(day,subject_id,kind,count,exposure_configs,updated_at)
      SELECT day::date,$1,kind,CASE WHEN kind='impression' THEN 1000 WHEN kind='acceptance' THEN CASE WHEN day<'2026-10-03' THEN 200 ELSE 500 END WHEN kind='search' THEN 100 ELSE 50 END,'{cfg}',now()
      FROM generate_series('2026-09-26'::date,'2026-10-09'::date,'1 day') day CROSS JOIN unnest(ARRAY['impression','acceptance','search','visit']) kind`,[artist]);
    const report=await trendPrototype(new Date("2026-10-10T12:00:00Z"));
    expect(report.internal).toBe(true); expect(report.published).toBe(false);
    expect(report.results[0]?.direction).toBe("rising");
    expect(report.results[0]?.current.impressions).toBe(7000);
    expect(report.period?.current).toEqual({from:"2026-10-03",until:"2026-10-10"});
    expect((await app.inject("/discovery/metrics/prototype")).statusCode).toBe(401);
    expect((await app.inject({url:"/discovery/metrics/prototype",headers:{authorization:"Bearer qa-metrics-operator-token-32-chars"}})).statusCode).toBe(200);
  });
  it("fallos de lote no borran cuentas: backoff acotado, rollback y rastro del fallo", async () => {
    const locker=await getPool().connect();
    await locker.query("BEGIN"); await locker.query("LOCK TABLE ingest.discovery_metric_daily IN ACCESS EXCLUSIVE MODE");
    try {
      await expect(aggregateMetrics(new Date("2026-10-10T12:00:00Z"))).rejects.toMatchObject({code:"55P03"});
    } finally { await locker.query("ROLLBACK"); locker.release(); }
    const job=(await getPool().query("SELECT * FROM ingest.discovery_metric_jobs ORDER BY id DESC LIMIT 1")).rows[0];
    expect(job.status).toBe("failed"); expect(job.attempts).toBe(3); expect(job.summary.code).toBe("55P03");
    expect((await getPool().query("SELECT count(*)::int AS n FROM ingest.discovery_metric_daily")).rows[0].n).toBe(56);
  });
  it("controles de ráfaga y ticket caducado limitan automatización sin guardar eventos", async () => {
    const staleBody=JSON.parse(Buffer.from(ticket.split(".")[0]!,"base64url").toString());
    // Un ticket vencido correctamente firmado sigue siendo inadmisible.
    const { createHmac }=await import("node:crypto");
    staleBody.expires=Date.now()-1; staleBody.issued=Date.now()-31000;
    const body=Buffer.from(JSON.stringify(staleBody)).toString("base64url");
    const signature=createHmac("sha256","qa-independent-metrics-secret-32-chars").update(body).digest("base64url");
    expect((await post("impression",`${body}.${signature}`,{visibleMs:1000,client:randomUUID()})).json().status).toBe("ignored");
    const responses=await Promise.all(Array.from({length:130},()=>app.inject({method:"POST",url:"/discovery/metrics/events",remoteAddress:"203.0.113.7",headers:{origin},
      payload:{id:randomUUID(),client:randomUUID(),kind:"acceptance",token:"invalid"}})));
    expect(responses.some(r=>r.statusCode===429)).toBe(true);
  });
  it("fusión conserva cohortes, no suma identidades; diario restaura vínculo al deshacer/rehacer", async () => {
    await getPool().query("INSERT INTO ingest.discovery_metric_subjects(id,artist_id,name_at_collection) VALUES($1,$1,'Otro métricas')",[other]);
    const before=(await getPool().query("SELECT * FROM ingest.discovery_metric_subjects ORDER BY id")).rows;
    const merge=await withOperatorRun({name:"qa:metric-merge",operator:"QA",note:"Misma identidad"},ctx=>mergeInto(ctx.client,"artist",artist,other,"Misma identidad",ctx.runId));
    expect((await getPool().query("SELECT artist_id FROM ingest.discovery_metric_subjects")).rows.every(r=>Number(r.artist_id)===artist)).toBe(true);
    expect((await trendPrototype(new Date("2026-10-10T12:00:00Z"))).results[0]?.reasons).toContain("identity_changed");
    const undo=await withOperatorRun({name:"qa:undo",operator:"QA",note:"Deshacer"},ctx=>undoRunWithJournal(ctx,merge.runId));
    expect((await getPool().query("SELECT * FROM ingest.discovery_metric_subjects ORDER BY id")).rows).toEqual(before);
    await withOperatorRun({name:"qa:redo",operator:"QA",note:"Rehacer"},ctx=>undoRunWithJournal(ctx,undo.runId));
    expect((await trendPrototype(new Date("2026-10-10T12:00:00Z"))).results[0]?.direction).toBeNull();
  });
  it("bandera apagada deja el catálogo funcional y rechaza analítica sin tocar datos", async () => {
    process.env["CRV_DISCOVERY_METRICS_ENABLED"]="false"; resetEnvCache();
    expect((await app.inject("/discovery/search-suggestions")).json().metrics.enabled).toBe(false);
    expect((await post("search")).json().status).toBe("disabled");
    expect((await app.inject("/search?q=Artista")).statusCode).toBe(200);
  });
});
