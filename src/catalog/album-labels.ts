import { type OperatorContext } from '../merge/operator.js';
/** Compatibilidad del campo histórico: su escritura llega también al vínculo público. */
export async function syncCoreAlbumLabel(ctx:OperatorContext,albumId:number,labelId:number|null) {
 const old=(await ctx.client.query<{label_id:string|null}>('SELECT label_id::text FROM public.albums WHERE id=$1 FOR UPDATE',[albumId])).rows[0];
 if(old?.label_id && Number(old.label_id)!==labelId) await ctx.client.query("DELETE FROM ingest.album_labels WHERE album_id=$1 AND version_id IS NULL AND role='label' AND organization_id=$2",[albumId,old.label_id]);
 if(labelId!==null) await ctx.client.query(`INSERT INTO ingest.album_labels(album_id,organization_id,role,run_id) VALUES($1,$2,'label',$3) ON CONFLICT DO NOTHING`,[albumId,labelId,ctx.runId]);
}
