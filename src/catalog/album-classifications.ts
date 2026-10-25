import { OperatorError, type OperatorContext } from "../merge/operator.js";
import { ALBUM_EDITABLE_CLASSIFICATIONS } from "../shared/album-categories.js";

export const isMusicalClassification = (value: string) => !/documental|documentary|videoclip|music.video|entrevista|interview|audiovisual|short|video|concierto/i.test(value);

/** Las decisiones humanas prevalecen sin borrar la evidencia de las fuentes. */
export async function writeAlbumClassifications(context: OperatorContext, albumId: number, selected: string[], options:{addOnly?:boolean}={}): Promise<void> {
  if (selected.some(value => !value.trim() || value.length > 60 || !isMusicalClassification(value))) throw new OperatorError("invalid", "Clasificación musical no admitida.");
  const { client } = context;
  if (!(await client.query("SELECT id FROM public.albums WHERE id=$1 FOR UPDATE", [albumId])).rowCount) throw new OperatorError("not_found", "Disco inexistente.");
  const existing = (await client.query<{classification:string}>("SELECT classification FROM ingest.album_classifications WHERE album_id=$1",[albumId])).rows;
  const managed = new Set([...ALBUM_EDITABLE_CLASSIFICATIONS.map(item=>item.classification),...existing.map(item=>item.classification).filter(isMusicalClassification),...selected]);
  for (const classification of managed) {
    const accepted = selected.includes(classification);
    // Source enrichment asserts what was documented. Absence from this source
    // must never become an editorial rejection of another characteristic.
    if(options.addOnly&&!accepted)continue;
    await client.query(`INSERT INTO ingest.album_classification_decisions(album_id,classification,selected,reason,run_id) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(album_id,classification) DO UPDATE SET selected=EXCLUDED.selected,reason=EXCLUDED.reason,run_id=EXCLUDED.run_id`,[albumId,classification,accepted,context.note,context.runId]);
    if (accepted) await client.query(`INSERT INTO ingest.album_classifications(album_id,classification,position,inferred)
      VALUES($1,$2,coalesce((SELECT max(position) FROM ingest.album_classifications WHERE album_id=$1),0)+1,false)
      ON CONFLICT(album_id,classification) DO NOTHING`,[albumId,classification]);
  }
  await client.query("UPDATE public.albums SET updated_at=now() WHERE id=$1",[albumId]);
}
