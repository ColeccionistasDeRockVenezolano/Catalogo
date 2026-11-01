import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { updateEntity, withOperatorRun } from '../src/merge/operator.js';
import { persistClaim } from '../src/claims/persistence.js';

const root = process.argv[2];
if (!root || !path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`)) throw new Error('Informe en staging SSD');
type Capture = { artistId:number; source:string; header:string; sourceTitle:string; year:number; cover:string; sha256:string; localUrl:string; matched:Array<{id:number}>; error?:string };
const captures = (JSON.parse(readFileSync(path.join(root, 'cover-captures.json'), 'utf8')) as Capture[]).filter(c => !c.error);
const confirm = process.argv.includes('--confirm');
try {
  const outcome = await withOperatorRun({name:'rhv:missing-covers-2026-11-01',operator:'codex',note:'Portadas RHV para ediciones sin imagen; artista, título y año exactos y bytes publicados verificados',params:{candidates:captures.length}}, async ctx => {
    const sourceId = Number((await ctx.client.query("SELECT id FROM ingest.sources WHERE slug='rock-hecho-en-venezuela'")).rows[0].id);
    const changed = [];
    for (const c of captures) {
      const file = path.join('web/public/media', c.localUrl.slice('/crv/media/'.length));
      if (createHash('sha256').update(readFileSync(file)).digest('hex') !== c.sha256) throw new Error('Captura no verificada');
      const id = c.matched[0]!.id;
      const current = (await ctx.client.query<{artistId:number; title:string; year:number|null; cover:string|null}>(`SELECT artist_id::int "artistId",title,release_year AS "year",cover_url cover FROM ingest.catalog_albums WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if (!current || current.artistId !== c.artistId || current.title !== c.sourceTitle || current.year !== c.year || current.cover) continue;
      await updateEntity(ctx,'album',id,{cover_url:c.localUrl});
      const identity = `rhv-cover-2026-11-01:${id}`;
      const claim = await persistClaim({entityKind:'album',albumId:id,field:'cover_url',rawValue:c.cover,normalizedValue:c.localUrl,identity,identitySecondary:identity,originalIdentity:c.header,rawHash:createHash('sha256').update(JSON.stringify([id,c.cover])).digest('hex'),sourceId,runId:ctx.runId,confidence:'medium',createdBy:'human',extractor:'rhv-missing-cover',extractorVersion:'1',evidence:{url:c.source,excerpt:c.header}},ctx.client);
      await ctx.client.query("UPDATE ingest.claims SET status='accepted' WHERE id=$1 AND status='candidate'",[claim.id]);
      changed.push({albumId:id,source:c.source,cover:c.cover,localUrl:c.localUrl});
    }
    return changed;
  },{rollbackOnly:!confirm});
  writeFileSync(path.join(root,confirm?'covers-applied.json':'covers-rehearsal.json'),JSON.stringify(outcome,null,2));
  console.log(JSON.stringify({confirmed:confirm,runId:outcome.runId,changed:outcome.result.length}));
} finally { await closeDb(); }
