/** Corrección editorial expresa de Brian: «coloca que fue el 8» (2026-10-21). */
import { getPool,closeDb } from "../src/db/client.js";
import { withOperatorRun } from "../src/merge/operator.js";
import { saveEphemeris } from "../src/catalog/ephemerides.js";

try {
  const result=await withOperatorRun({name:"editorial:sepultura-date-correction",operator:"Brian (ejecución Codex)",
    note:"Brian indica expresamente publicar el concierto de Sepultura el 8 de mayo de 1994.",
    params:{instruction:"coloca que fue el 8",date:"1994-05-08"}},async ctx=>{
    const event=(await ctx.client.query("SELECT * FROM ingest.ephemerides WHERE event_key=$1 FOR UPDATE",["sepultura-venezuela-1994-date-review"])).rows[0];
    if(!event)throw new Error("No se encontró la efeméride original de Sepultura");
    return saveEphemeris(ctx,{
      key:event.event_key,title:"Sepultura se presenta en Venezuela",date:"1994-05-08",year:1994,
      description:"Sepultura se presentó en Venezuela el 8 de mayo de 1994. El testimonio de Johnny Castro en Educación Anterior (Provea, página impresa 145) sitúa el concierto ese día y su detención al día siguiente.",
      dateNote:"Fecha fijada por indicación expresa de Brian el 21 de octubre de 2026: «coloca que fue el 8». Se adopta el 8 de mayo de 1994, coincidente con el testimonio de Johnny Castro. Se conserva como discrepancia documental el 09-05-1994 del título del bootleg y la inconsistencia de la narración editorial del libro.",
      place:event.place,subject:event.subject_name,originalArtistId:Number(event.original_artist_id),status:"verified",sources:event.sources,
    });
  });
  const check=(await getPool().query("SELECT id,title,event_date::text,status FROM ingest.ephemerides WHERE id=$1",[result.result.id])).rows[0];
  console.log(JSON.stringify({runId:result.runId,event:check}));
}finally{await closeDb();}
