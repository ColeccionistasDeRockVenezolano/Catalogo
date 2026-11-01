import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb } from '../src/db/client.js';
import { withOperatorRun } from '../src/merge/operator.js';
import { confirmGenre } from '../src/genres/human.js';

const root=process.argv[2];
if(!root||!path.resolve(root).startsWith(`${process.env['HOME']}/crv-staging/`))throw new Error('Informe en staging SSD');
const confirm=process.argv.includes('--confirm');
const html=readFileSync(path.join(root,'top-hits-1972-source.html'),'utf8');
if(!html.includes('ranking del pop nacional'))throw new Error('Falta la cita sobre el disco');
const reason='La fuente describe este disco como parte del «pop nacional»: https://barraezo.blogspot.com/2015/10/v-top-hits-de-venezuela-top-hits-th.html';
try{
 const outcome=await withOperatorRun({name:'rhv:top-hits-1972-source-genre',operator:'codex',note:reason,params:{albumId:39975,genre:'pop',basis:'source'}},async ctx=>{
  const album=(await ctx.client.query<{artistId:number;title:string}>(`SELECT artist_id::int "artistId",title FROM ingest.catalog_albums WHERE id=39975 FOR SHARE`)).rows[0];
  if(!album||album.artistId!==257||album.title!=='Top Hits de Venezuela')throw new Error('Cambió el disco');
  const prior=await ctx.client.query(`SELECT 1 FROM ingest.album_genres WHERE album_id=39975 AND (status='confirmed' OR (status='rejected' AND decision_kind='human'))`);
  if(prior.rowCount)throw new Error('El disco ya tiene decisión de género');
  await confirmGenre(ctx.client,{kind:'album',entityId:39975,genreSlug:'pop',role:'primary',actor:'codex',reason,runId:ctx.runId});
  return {albumId:39975,genre:'pop',basis:'source'};
 },{rollbackOnly:!confirm});
 writeFileSync(path.join(root,`top-hits-genre-${confirm?'applied':'rehearsal'}.json`),JSON.stringify(outcome,null,2));console.log(JSON.stringify({confirmed:confirm,...outcome}));
}finally{await closeDb();}
