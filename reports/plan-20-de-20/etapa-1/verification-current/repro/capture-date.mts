import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { WebSearchBroker } = await import(pathToFileURL(resolve(process.cwd(), 'src/ambiguity/web-search.ts')).href);
const { resetEnvCache } = await import(pathToFileURL(resolve(process.cwd(), 'src/config/env.ts')).href);
const directory=await mkdtemp(join(tmpdir(),'crv-capture-audit-'));
try {
 process.env.DATA_DIR=directory; resetEnvCache();
 await mkdir(join(directory,'raw'));
 await writeFile(join(directory,'raw','sample.html'),'<html><title>Fuente conservada</title><body>La Banda Fixture publicó Disco Fixture en 2001. Este documento original conserva el contexto de la discografía y sus datos publicados. La captura original fue archivada anteriormente para verificación.</body></html>');
 const capturedAt='2001-05-06T00:00:00Z';
 const queryable={query:async(sql)=>({rows:sql.includes('FROM ingest.raw_pages')?[{stored_path:'raw/sample.html',content_type:'text/html',fetched_at:capturedAt}]:[]})};
 const broker=new WebSearchBroker(queryable,'',async()=>new Response('',{status:403}));
 const page=await broker.page('https://93.184.216.34/catalog-fixture');
 console.log(JSON.stringify({originalCapture:capturedAt,reportedCapture:page?.fetchedAt,acquisitionMethod:page?.acquisitionMethod??null,capturePreserved:page?.fetchedAt===capturedAt}));
 assert.equal(page?.fetchedAt,capturedAt,'Releer una fuente archivada debe conservar su fecha de captura original');
} finally { await rm(directory,{recursive:true,force:true}); }
