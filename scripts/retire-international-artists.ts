/** Aplicación revisable del inventario 2026-10-21. No elimina el core.
 * Uso: tsx scripts/retire-international-artists.ts <directorio SSD> [--write]
 */
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { closeDb,getPool } from "../src/db/client.js";
import { createEntity,updateEntity,withOperatorRun } from "../src/merge/operator.js";

const directory=process.argv[2];
if(!directory||!path.resolve(directory).startsWith(path.join(process.env["HOME"]!,"crv-staging","reports")+path.sep)) throw new Error("Indica un directorio de informe en crv-staging/reports");
const write=process.argv.includes("--write");
const inventoryPath="reports/artistas-internacionales-docx-2026-10-21/inventario-detallado.json";
const text=await readFile(inventoryPath,"utf8");
type Inventory={id:string;nombre:string;recomendacion:string;relacion_con_catalogo:string};
const inventory=JSON.parse(text) as Inventory[];
// Se preservan diáspora, arraigo y la contradicción de Marco Ciargo.
// Brian confirmó expresamente en esta sesión: «Analog Circl8 artist Daniel
// Maal is venezuelan». Se conserva el proyecto y se documenta la persona.
const retain=new Set([399,2891,3555,3581,3954,3998,6877,6878,6907,2338,2340,2342,2347,2356,2359,2360,2616,2942]);
const plan=inventory.filter(row=>!retain.has(Number(row.id)));
if(inventory.length!==255||plan.length!==237)throw new Error("El inventario cambió; revisar clasificación");
const provenance="Inventario exhaustivo de artistas internacionales, 2026-10-21; autorización de Brian en esta sesión.";
const events=[{
  key:"metallica-caracas-1999-05-04",title:"Metallica se presenta en el Poliedro de Caracas",date:"1999-05-04",year:1999,
  subject:"Metallica",artist:350,place:"Poliedro de Caracas, Caracas, Venezuela",status:"verified",
  description:"Metallica ofreció un concierto en el Poliedro de Caracas el 4 de mayo de 1999. La fecha y el recinto figuran en el archivo oficial de la banda.",note:null,
  sources:[{title:"Metallica · archivo oficial del concierto de Caracas, 4 de mayo de 1999",url:"https://www.metallica.com/tour/1999-05-04-caracas-venezuela.html"}],
},{
  key:"metallica-caracas-2010-03-12",title:"Metallica toca en La Rinconada durante World Magnetic",date:"2010-03-12",year:2010,
  subject:"Metallica",artist:350,place:"Campos de béisbol de La Rinconada, Caracas, Venezuela",status:"verified",
  description:"Metallica se presentó en Caracas el 12 de marzo de 2010, durante la gira World Magnetic. El archivo oficial identifica los campos de béisbol de La Rinconada como recinto. El catálogo conservaba una grabación titulada «Caracas Magnetic»; la clasificación de esa copia no determina la fecha del concierto.",note:null,
  sources:[{title:"Metallica · archivo oficial del concierto de Caracas, 12 de marzo de 2010",url:"https://www.metallica.com/tour/2010-03-12-caracas-venezuela.html"}],
},{
  key:"sepultura-venezuela-1994-date-review",title:"Sepultura se presenta en Venezuela",date:"1994-05-08",year:1994,
  subject:"Sepultura",artist:737,place:"Venezuela",status:"verified",
  description:"Sepultura se presentó en Venezuela el 8 de mayo de 1994. El testimonio de Johnny Castro en Educación Anterior (Provea, página impresa 145) sitúa el concierto ese día y su detención al día siguiente.",
  note:"Fecha fijada por indicación expresa de Brian el 21 de octubre de 2026: «coloca que fue el 8». Se adopta el 8 de mayo de 1994, coincidente con el testimonio de Johnny Castro. Se conserva como discrepancia documental el 09-05-1994 del título del bootleg y la inconsistencia de la narración editorial del libro.",
  sources:[{title:"Catálogo de origen del bootleg · Descargas Metal Venezolano",url:"https://descargasmetalvenezolano.blogspot.com/2019/05/sepultura-en-vivo-desde-venezuela-09-05.html"},
    {title:"Provea · Educación Anterior, testimonio de Johnny Castro, p. 145",url:"https://provea.org/wp-content/uploads/2019/12/Educacio%CC%81n-Anterior_compressed.pdf"}],
}];

await mkdir(directory,{recursive:true});
try {
  const snapshot=(await getPool().query(`SELECT a.*,to_jsonb(a) AS original,
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.albums x WHERE x.artist_id=a.id),'[]'::jsonb) AS albums,
    COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.artist_members x WHERE x.artist_id=a.id),'[]'::jsonb) AS members
    FROM public.artists a WHERE a.id=ANY($1::bigint[]) ORDER BY a.id`,[plan.map(row=>Number(row.id))])).rows;
  if(snapshot.length!==237||snapshot.some(row=>!plan.some(item=>Number(item.id)===Number(row.id)&&item.nombre===row.name)))throw new Error("Las identidades ya no coinciden con el inventario");
  const counters=async()=> (await getPool().query(`SELECT (SELECT count(*) FROM public.artists)::int artists,(SELECT count(*) FROM public.albums)::int albums,
    (SELECT count(*) FROM public.tracks)::int tracks,(SELECT count(*) FROM public.track_credits)::int track_credits,(SELECT count(*) FROM public.album_credits)::int album_credits`)).rows[0];
  const before=await counters();
  await writeFile(path.join(directory,"plan.json"),JSON.stringify({provenance,inventoryPath,inventoryHash:createHash("sha256").update(text).digest("hex"),retain:[...retain],plan,events,before},null,2));
  await writeFile(path.join(directory,"snapshot-before.json"),JSON.stringify(snapshot,null,2));
  if(write){
    const result=await withOperatorRun({name:"editorial:retire-international-artists",operator:"Brian (ejecución Codex)",note:"Retirar referencias extranjeras del catálogo, impedir reimportación/conversión y conservar personas, créditos, discografía histórica y efemérides.",params:{inventoryPath,retained:[...retain],confirmation:"Brian: Analog Circl8 artist Daniel Maal is venezuelan"}},async ctx=>{
      await ctx.client.query("SELECT pg_advisory_xact_lock(hashtext('crv:editorial-scope'))");
      // Cierra la carrera con importadores: ninguno puede crear un homónimo
      // entre la comprobación de identidades y la publicación del bloqueo.
      await ctx.client.query("LOCK TABLE public.artists IN SHARE ROW EXCLUSIVE MODE");
      const daniel=(await ctx.client.query("SELECT p.id FROM public.persons p JOIN public.artist_members m ON m.person_id=p.id WHERE m.artist_id=2891 AND p.name='Daniel Maal'")).rows;
      if(daniel.length!==1)throw new Error("Revisar identidad de Daniel Maal antes de aplicar");
      await updateEntity(ctx,"person",Number(daniel[0].id),{nationality:"Venezuela",is_venezuelan:true});
      const policies=[];
      for(const row of snapshot){
        const id=Number(row.id),item=plan.find(item=>Number(item.id)===id)!;
        if((await ctx.client.query("SELECT artist_id FROM ingest.artist_editorial_policy WHERE artist_id=$1",[id])).rowCount)continue;
        const members=row.members as Array<{person_id:number|string;role:string}>;
        let people=(row.artist_type==="solo_artist"||row.artist_type==="project")?members.filter(member=>row.artist_type==="solo_artist"||/titular del proyecto/iu.test(member.role)).map(member=>Number(member.person_id)):[];
        if(people.length>1) people=[]; // un proyecto colectivo no es una persona
        if(row.artist_type==="solo_artist"&&!members.length){
          const exact=(await ctx.client.query("SELECT p.id FROM public.persons p WHERE lower(p.name)=lower($1) OR EXISTS(SELECT 1 FROM ingest.person_aliases a WHERE a.person_id=p.id AND lower(a.alias)=lower($1))",[row.name])).rows;
          if(exact.length)throw new Error(`Revisar identidad existente de ${row.name}`);
          const person=await createEntity(ctx,"person",{name:row.name,notes:`Identidad solista conservada tras el retiro editorial del artista #${id}. El origen de la ficha era ${row.origin_country}; no se infiere nacionalidad. ${provenance}`},{allowSimilar:true});
          people=[person.id];
        }
        const disposition=id===3535?"review":"reference";
        const reason=`${provenance} ${item.recomendacion} ${item.relacion_con_catalogo}`;
        await ctx.client.query("INSERT INTO ingest.artist_editorial_policy(artist_id,disposition,reference_kind,reason,snapshot,decided_by,run_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [id,disposition,people.length?"person":"collective",reason,JSON.stringify({artist:row.original,albums:row.albums,members:row.members,inventory:item}),ctx.operator,ctx.runId]);
        await ctx.client.query(`INSERT INTO ingest.artist_editorial_names(artist_id,name)
          SELECT $1::bigint,$2 UNION SELECT $1::bigint,alias FROM ingest.artist_aliases WHERE artist_id=$1 ON CONFLICT DO NOTHING`,[id,row.name]);
        for(const personId of people){
          await ctx.client.query("INSERT INTO ingest.artist_editorial_persons(artist_id,person_id) VALUES($1,$2)",[id,personId]);
          await ctx.client.query("INSERT INTO ingest.artist_editorial_names(artist_id,name) SELECT $1::bigint,name FROM public.persons WHERE id=$2 UNION SELECT $1::bigint,alias FROM ingest.person_aliases WHERE person_id=$2 ON CONFLICT DO NOTHING",[id,personId]);
        }
        await ctx.client.query(`INSERT INTO ingest.artist_editorial_identifiers(artist_id,namespace,identifier)
          SELECT $1::bigint,'url',url FROM public.streaming_links WHERE artist_id=$1
          UNION SELECT $1::bigint,'platform:'||platform,external_id FROM public.streaming_links WHERE artist_id=$1 AND external_id IS NOT NULL
          UNION SELECT $1::bigint,'url',url FROM public.social_links WHERE artist_id=$1
          UNION SELECT $1::bigint,'genre-source:'||source_id,external_id FROM ingest.genre_external_identities WHERE entity_kind='artist' AND entity_id=$1 ON CONFLICT DO NOTHING`,[id]);
        policies.push({artistId:id,name:row.name,disposition,people,albums:row.albums.length});
      }
      for(const event of events)await ctx.client.query(`INSERT INTO ingest.ephemerides(event_key,title,description,event_date,event_year,date_note,place,subject_name,original_artist_id,status,sources,run_id,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(event_key) DO NOTHING`,
        [event.key,event.title,event.description,event.date,event.year,event.note,event.place,event.subject,event.artist,event.status,JSON.stringify(event.sources),ctx.runId,ctx.operator]);
      return {policies,events:events.map(event=>({key:event.key,status:event.status}))};
    },{serializable:true});
    const after=await counters();
    const publicCounts=(await getPool().query(`SELECT (SELECT count(*) FROM ingest.catalog_artists)::int artists,
      (SELECT count(*) FROM ingest.catalog_albums)::int albums,(SELECT count(*) FROM ingest.catalog_tracks)::int tracks,
      (SELECT count(*) FROM ingest.artist_editorial_persons)::int protectedPersons`)).rows[0];
    await writeFile(path.join(directory,"applied.json"),JSON.stringify({...result,before,after,publicCounts,corePreserved:JSON.stringify(before)===JSON.stringify(after)},null,2));
    console.log(JSON.stringify({runId:result.runId,retired:result.result.policies.length,corePreserved:JSON.stringify(before)===JSON.stringify(after),publicCounts}));
  }else console.log(JSON.stringify({mode:"preview",retire:plan.length,retain:retain.size,archiveAlbums:snapshot.reduce((n,row)=>n+row.albums.length,0),events:events.length}));
}finally{await closeDb();}
