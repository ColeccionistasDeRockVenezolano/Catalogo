/** Contexto de relaciones ya existentes; no decide identidades ni escribe catálogo. */
import{writeFileSync}from'node:fs';import path from'node:path';
import{getPool,closeDb}from'../src/db/client.js';
const out=process.env['HERMES_DEEP_DATA'];if(!out)throw new Error('Falta directorio de campaña');
try{
 const db=getPool();const result={readAt:new Date().toISOString(),
 memberships:(await db.query('SELECT id::text,artist_id::text,person_id::text,role,notes FROM public.artist_members')).rows,
 credits:(await db.query(`SELECT DISTINCT c.person_id::text,a.artist_id::text FROM public.album_credits c JOIN public.albums a ON a.id=c.album_id WHERE c.person_id IS NOT NULL UNION SELECT DISTINCT c.person_id::text,a.artist_id::text FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id JOIN public.albums a ON a.id=t.album_id WHERE c.person_id IS NOT NULL`)).rows,
 bindings:(await db.query("SELECT artist_id::text,metadata->>'artistKey' source_key FROM media.artist_documents WHERE metadata->>'bindingStatus'='confirmed' AND metadata->>'campaign'='hermes-integral-2026-10-24'")).rows,
 songDuplicates:(await db.query("SELECT identity_key,count(*)::int n FROM ingest.claims WHERE identity_key LIKE 'hermes-integral-2026-10-24:mp3com:song:%' GROUP BY identity_key HAVING count(*)>1")).rows,
 };
 writeFileSync(path.join(out,'relationships.json'),JSON.stringify(result));console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))));
}finally{await closeDb();}
