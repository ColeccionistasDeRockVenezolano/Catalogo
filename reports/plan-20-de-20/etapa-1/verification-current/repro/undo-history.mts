import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const { startPgContainer } = await import(pathToFileURL(resolve(process.cwd(), 'test/support/pg-container.ts')).href);
const { applyCore } = await import(pathToFileURL(resolve(process.cwd(), 'test/support/apply-core.ts')).href);
const { closeDb, getPool } = await import(pathToFileURL(resolve(process.cwd(), 'src/db/client.ts')).href);
const { resetEnvCache } = await import(pathToFileURL(resolve(process.cwd(), 'src/config/env.ts')).href);
const { migrateUp } = await import(pathToFileURL(resolve(process.cwd(), 'src/db/migrate.ts')).href);
const { withOperatorRun } = await import(pathToFileURL(resolve(process.cwd(), 'src/merge/operator.ts')).href);
const { mergeInto } = await import(pathToFileURL(resolve(process.cwd(), 'src/review/duplicates.ts')).href);
const { undoRun } = await import(pathToFileURL(resolve(process.cwd(), 'src/merge/run-undo.ts')).href);
const { loadSheetsFile } = await import(pathToFileURL(resolve(process.cwd(), 'src/genres/external/sheets.ts')).href);
const { upsertExternalSource } = await import(pathToFileURL(resolve(process.cwd(), 'src/genres/external/store.ts')).href);
const database = await startPgContainer();
try {
 process.env.DATABASE_URL=database.databaseUrl;
 resetEnvCache(); await applyCore(database.name); await migrateUp();
 const one = async (sql,params=[]) => Number((await getPool().query(sql,params)).rows[0].id);
 const a=await one("INSERT INTO public.artists(name) VALUES('Undo A') RETURNING id");
 const b=await one("INSERT INTO public.artists(name) VALUES('Undo B') RETURNING id");
 const client=await getPool().connect();
 let source;
 try { source=(await upsertExternalSource(client,(await loadSheetsFile())[0],{actor:'prueba',reason:'fixture'})).id; } finally { client.release(); }
 await getPool().query("INSERT INTO ingest.genre_external_identities(entity_kind,entity_id,source_id,external_id,external_name,score,status,decided_by,reason) VALUES('artist',$1,$2,'fixture','Fixture',1,'matched','prueba','Identity checked')",[b,source]);
 const op=work=>withOperatorRun({name:'audit:stage1',operator:'prueba',note:'Prueba aislada de conservación'},work);
 const merged=await op(ctx=>mergeInto(ctx.client,'artist',a,b,ctx.note,ctx.runId));
 const undone=await op(ctx=>undoRun(ctx,merged.runId));
 const rows=(await getPool().query("SELECT entity_id::text FROM ingest.genre_external_identities WHERE external_id='fixture'")).rows;
 const target=Number(rows[0]?.entity_id);
 console.log(JSON.stringify({undoneWith:undone.result.method,originalOwner:b,ownerAfterUndo:target,conserved:target===b}));
 assert.equal(target,b,'Deshacer desde el historial no restaura el destino de la identidad externa');
} finally { await closeDb(); await database.stop(); }
