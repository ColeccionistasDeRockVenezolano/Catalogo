import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { getPool,closeDb } from "../src/db/client.js";
import { resetEnvCache } from "../src/config/env.js";
import { migrateUp,DEFAULT_MIGRATIONS_DIR } from "../src/db/migrate.js";
import { runDoctor } from "../src/doctor/index.js";
import { inventoryHistoricalClaims } from "../src/evidence/history.js";
import { withOperatorRun } from "../src/merge/operator.js";

const run=promisify(execFile);
const backup=path.resolve(process.argv[2]!);
const reportDir=path.resolve(process.argv[3]??"reports/plan-20-de-20/etapa-1/implementation-current/completion/staging");
const workspace=path.resolve(`/mnt/datos/crv-stage1-migration-check-${Date.now()}-${process.pid}`);
const name=`crv-stage1-migration-check-${process.pid}`;
const manifest=Object.fromEntries((await readFile(path.join(backup,"manifest.txt"),"utf8")).trim().split("\n").map(line=>[line.slice(0,line.indexOf("=")),line.slice(line.indexOf("=")+1)]));
const owner=manifest["db_owner"]!,database=manifest["db_name"]!;
assert.match(owner,/^[a-z_][a-z0-9_]*$/u);assert.match(database,/^[a-z_][a-z0-9_]*$/u);
await mkdir(path.join(workspace,"postgres"),{recursive:true});await mkdir(reportDir,{recursive:true});
async function snapshot() {
 const tables=(await getPool().query<{name:string}>("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
 const out=[];
 for(const {name:table} of tables) {
  assert.match(table,/^[a-z_]+$/u);
  const value=table==="persons"?"to_jsonb(t)-'birth_date_value'-'death_date_value'":"to_jsonb(t)";
  const row=(await getPool().query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5((${value})::text),'' ORDER BY md5((${value})::text)),'')) AS hash FROM public.${table} t`)).rows[0];
  out.push({table,...row});
 }
 return out;
}
try {
 await run("docker",["run","-d","--name",name,"-e",`POSTGRES_USER=${owner}`,"-e","POSTGRES_DB=postgres","-e","POSTGRES_HOST_AUTH_METHOD=trust","-p","127.0.0.1::5432","--mount",`type=bind,source=${workspace}/postgres,target=/var/lib/postgresql/data`,"postgres:16-alpine"]);
 let ready=false;
 for(let i=0;i<100;i++) {
  try {await run("docker",["exec",name,"pg_isready","-h","127.0.0.1","-U",owner,"-q"]);ready=true;break;} catch {await new Promise(resolve=>setTimeout(resolve,1000));}
 }
 assert.ok(ready,"staging no acepta conexiones");
 const port=Number((await run("docker",["inspect","-f",'{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',name])).stdout.trim());
 console.log("Restaurando respaldo en staging aislado");
 const restored=await run("./scripts/db-restore.sh",[backup,"--container",name,"--data-dir",path.join(workspace,"sources")],{maxBuffer:2_000_000});
 await writeFile(path.join(reportDir,"restore.log"),restored.stdout+restored.stderr);
 process.env["DATABASE_URL"]=`postgresql://${owner}@127.0.0.1:${port}/${database}`;
 process.env["DATA_DIR"]=path.join(workspace,"sources");resetEnvCache();
 const restoredCounts=(await getPool().query(await readFile("scripts/sql/table-counts.sql","utf8"))).rows.map(row=>`${row.table_name}\t${row.n}`).join("\n")+"\n";
 assert.equal(restoredCounts,await readFile(path.join(backup,"counts.tsv"),"utf8"),"conteos restaurados difieren del snapshot del respaldo");
 const raw=(await getPool().query<{stored_path:string;sha256:string}>("SELECT stored_path,sha256 FROM ingest.raw_pages ORDER BY id")).rows;
 for(const capture of raw)assert.equal(createHash("sha256").update(await readFile(path.join(workspace,"sources",capture.stored_path))).digest("hex"),capture.sha256);
 console.log(`Restauradas filas idénticas y ${raw.length} capturas con hash correcto; probando migraciones`);
 const before=await snapshot();const migration=await migrateUp();assert.deepEqual(await snapshot(),before,"la migración alteró datos canónicos previos");
 const historical=await withOperatorRun({name:"maintenance:qa:historical-inventory",operator:"QA Etapa 1",note:"Ensayo de conciliación de historial sin inventar procedencia"},ctx=>inventoryHistoricalClaims(ctx,0,1000));
 const repeated=await withOperatorRun({name:"maintenance:qa:historical-inventory",operator:"QA Etapa 1",note:"Repetir conciliación idempotente"},ctx=>inventoryHistoricalClaims(ctx,0,1000));
 assert.equal(repeated.result.inserted,0);assert.deepEqual(await snapshot(),before);
 const tables=["catalog_works","catalog_edition_details","musical_identities","edition_support_details","support_tracks","scoped_genres","evidence_documents","evidence_reads","evidence_fragments","catalog_facts","catalog_fact_evidence","catalog_fact_bindings"];
 const inventorySnapshot=async(schema:string)=>Promise.all(tables.map(async table=>({table,rows:(await getPool().query(`SELECT to_jsonb(t) AS row FROM ${schema}.${table} t ORDER BY to_jsonb(t)::text`)).rows})));
 const inventoryBefore=await inventorySnapshot("ingest");
 for(const version of ["0062_catalog_model","0061_person_date_precision","0060_fact_inventory","0059_web_capture_provenance","0058_external_identity_journal"])await getPool().query(await readFile(path.join(DEFAULT_MIGRATIONS_DIR,`${version}.down.sql`),"utf8"));
 assert.deepEqual(await snapshot(),before);
 for(const version of ["0058_external_identity_journal","0059_web_capture_provenance","0060_fact_inventory","0061_person_date_precision","0062_catalog_model"])await getPool().query(await readFile(path.join(DEFAULT_MIGRATIONS_DIR,`${version}.up.sql`),"utf8"));
 assert.deepEqual(await snapshot(),before);assert.deepEqual(await inventorySnapshot("ingest"),inventoryBefore);
 const doctor=await runDoctor();assert.ok(doctor.ok,JSON.stringify(doctor.checks.filter(check=>!check.ok)));
 const report={createdAt:new Date().toISOString(),backup,workspace,container:name,published:false,countsExact:true,rawChecked:raw.length,migrations:migration.applied,canonicalRowsPreserved:true,rollbackReapplyPreserved:true,historical:historical.result,historicalRepeat:repeated.result,doctor,before};
 await writeFile(path.join(reportDir,"migration-check.json"),JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({passed:true,rawChecked:raw.length,canonicalRowsPreserved:true,rollbackReapplyPreserved:true,doctor:doctor.ok}));
} finally {
 await closeDb();
 // Data remains on the data disk as a reviewable staging artifact; the test
 // service stops so it cannot consume production resources after the check.
 await run("docker",["stop",name]).catch(()=>undefined);
}
