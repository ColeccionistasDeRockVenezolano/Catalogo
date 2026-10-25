/** Cierre de la decisión editorial y evidencia reproducible del catálogo. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getPool,closeDb } from "../src/db/client.js";
import { createRelation,withOperatorRun } from "../src/merge/operator.js";

const directory=process.argv[2];
if(!directory||!path.resolve(directory).startsWith(path.join(process.env["HOME"]!,"crv-staging","reports")+path.sep))throw new Error("Usar staging SSD de informes");
try {
  const pool=getPool();
  const restored=(await pool.query(`SELECT previous_exclusion->'persons' AS persons FROM ingest.artist_editorial_admissions WHERE artist_id=2942`)).rows[0];
  const persons=restored?.persons as Array<{person_id:number|string}>|null;
  if(persons?.length===1){
    const personId=Number(persons[0]!.person_id);
    const exists=(await pool.query("SELECT 1 FROM public.artist_members WHERE artist_id=2942 AND person_id=$1",[personId])).rowCount;
    if(!exists)await withOperatorRun({name:"editorial:restore-solo-membership",operator:"Brian (ejecución Codex)",note:"Conservar la persona titular de 2irie junto a su ficha reincorporada por arraigo venezolano."},ctx=>createRelation(ctx,"artist_membership",{artistId:2942,personId},{role:"Titular del proyecto"}));
  }
  const counts=(await pool.query(`SELECT
    (SELECT count(*) FROM public.artists)::int core_artists,
    (SELECT count(*) FROM public.albums)::int core_albums,
    (SELECT count(*) FROM public.tracks)::int core_tracks,
    (SELECT count(*) FROM public.album_credits)::int core_album_credits,
    (SELECT count(*) FROM public.track_credits)::int core_track_credits,
    (SELECT count(*) FROM ingest.catalog_artists)::int public_artists,
    (SELECT count(*) FROM ingest.catalog_albums)::int public_albums,
    (SELECT count(*) FROM ingest.catalog_tracks)::int public_tracks,
    (SELECT count(*) FROM ingest.artist_editorial_policy)::int retired,
    (SELECT count(*) FROM ingest.artist_editorial_admissions)::int admitted,
    (SELECT count(DISTINCT person_id) FROM ingest.artist_editorial_persons)::int protected_persons,
    (SELECT count(*) FROM public.albums a JOIN ingest.artist_editorial_policy p ON p.artist_id=a.artist_id)::int archived_albums`)).rows[0];
  const artists=(await pool.query(`SELECT a.id,a.name,a.origin_country,a.artist_type,a.biography,
    CASE WHEN p.artist_id IS NULL THEN 'conservado' ELSE 'retirado' END AS decision,
    p.disposition,p.reference_kind,COALESCE(d.reason,p.reason) AS reason,d.evidence,
    (SELECT count(*)::int FROM public.albums b WHERE b.artist_id=a.id) AS albums,
    (SELECT jsonb_agg(jsonb_build_object('id',r.person_id,'name',s.name)) FROM ingest.artist_editorial_persons r JOIN public.persons s ON s.id=r.person_id WHERE r.artist_id=a.id) AS persons
    FROM public.artists a LEFT JOIN ingest.artist_editorial_policy p ON p.artist_id=a.id
    LEFT JOIN ingest.artist_editorial_admissions d ON d.artist_id=a.id
    WHERE p.artist_id IS NOT NULL OR d.artist_id IS NOT NULL ORDER BY a.name`)).rows;
  const events=(await pool.query("SELECT * FROM ingest.ephemerides ORDER BY id")).rows;
  const guards=[];
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    for(const [name,sql] of [
      ["reimportar Metallica", "INSERT INTO public.artists(name,artist_type) VALUES('Metallica','band')"],
      ["renombrar Sepultura", "UPDATE public.artists SET name='Sepultura reimportada' WHERE id=737"],
      ["borrar evidencia Metallica", "DELETE FROM public.artists WHERE id=350"],
    ]){
      await client.query("SAVEPOINT guard_check");
      let code:string|undefined;
      try{await client.query(sql!);}catch(error){code=(error as {code?:string}).code;}
      await client.query("ROLLBACK TO SAVEPOINT guard_check");
      if(code!=="PCE01")throw new Error(`Protección falló: ${name} (${code})`);
      guards.push({action:name,code,blocked:true});
    }
  } finally {await client.query("ROLLBACK");client.release();}
  await writeFile(path.join(directory,"estado-final.json"),JSON.stringify({verifiedAt:new Date().toISOString(),counts,artists,events,guards},null,2));
  console.log(JSON.stringify({counts,guards}));
}finally{await closeDb();}
