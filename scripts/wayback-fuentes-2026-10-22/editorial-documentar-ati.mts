/** Conserva los hallazgos adicionales de la web del propio grupo, sin inferir discos ni fechas de aniversario. */
import {writeFileSync} from 'node:fs';
import {closeDb} from '../../src/db/client.js';
import {withOperatorRun} from '../../src/merge/operator.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw new Error('WAYBACK_OUT obligatorio');
const source='https://web.archive.org/web/20041204200517/http://www.angelfire.com/rock3/ati/mypage1.html';
const news='https://web.archive.org/web/20041204200517/http://www.angelfire.com/rock3/ati/mypage5.html';
const announcement='https://www.oidossucios.com/site/todo-listo-para-el-alma-mater/';
const content=`La web oficial archivada de Anger Turned Inward amplía la documentación de sus primeros años. Su sección «Pasado» describe grabaciones caseras realizadas entre mayo y agosto de 2001: Run Away, Drive Me Home y There’s No Me at All, además de los temas de estudio New Day y Wake Up y versiones en vivo. La banda reúne esas grabaciones bajo el título de CD demo It’s Meant to Happen. Esta enumeración no establece el orden completo de un disco.

En sus noticias de agosto de 2002, el grupo menciona siete canciones nuevas y un CD con seis canciones nuevas, sin dar en esa entrada un título ni un repertorio completo. También describe una sesión de grabación de Too Bad. Se conserva esa referencia sin deducir una publicación adicional.

La web relata una actuación en El Claret el 2 de junio de 2002 y otra en el CELARG/Alma Mater, fechada allí el 27 de junio. El anuncio de programación publicado por Oídos Sucios sitúa a la banda en la jornada del 30 de junio: las dos fechas de Alma Mater quedan expresamente en conflicto. No se fijan aniversarios a partir de esa discrepancia.

La última noticia visible, fechada el 17 de abril de 2003, dice que el grupo está en pausa y que el proyecto sigue en pie. No demuestra una fecha de disolución. La historia oficial sigue llamando al bajista Daniel «el nuevo», sin aportar un apellido.

Fuentes:
${source}
${news}
${announcement}`;
const result=await withOperatorRun({name:'wayback-editorial:ati-official-history',operator:'codex (encargo de Brian)',note:'Conservar los hallazgos recuperados de la web oficial durante la investigación del integrante incompleto. Mantener en revisión la identidad del bajista y la discrepancia de fecha del concierto.',params:{campaign:'wayback-cierre-editorial-2026-10-25'}},async ctx=>{
 await ctx.client.query("SELECT set_config('crv.run_id',$1,true)",[String(ctx.runId)]);
 const existing=(await ctx.client.query('SELECT id FROM media.artist_documents WHERE artist_id=7008 AND source_key=$1',['editorial-2026-10-25:ati-official-history'])).rows[0];if(existing)return {alreadyIncluded:true,id:Number(existing.id)};
 const r=await ctx.client.query(`INSERT INTO media.artist_documents(artist_id,source_key,category,title,content,source_url,archive_url,date_text,tags,metadata) VALUES(7008,$1,'biography',$2,$3,$4,$4,'2001–2003',$5,$6::jsonb) RETURNING id`,['editorial-2026-10-25:ati-official-history','Anger Turned Inward — demos y actividad en su web oficial',content,source,['archivo-wayback-2026-10-22','revision-editorial-2026-10-25','sitio-oficial-archivado','demos-documentados','fecha-de-concierto-en-revision'],JSON.stringify({editorialReviewCampaign:'wayback-cierre-editorial-2026-10-25',sources:[source,news,announcement],albumCreationDeferred:true,trackOrderUnconfirmed:true,concertDateConflict:{artistSite:'2002-06-27',announcement:'2002-06-30'}})]);
 return {documentId:Number(r.rows[0].id),artistId:7008,newAlbums:0,newTracks:0,newMilestones:0};
});
writeFileSync(out+'/ati-documento-adicional.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await closeDb();
