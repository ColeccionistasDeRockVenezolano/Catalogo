import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { createEntity, deleteEntity, deleteRelation, updateEntity, withOperatorRun } from "../src/merge/operator.js";
import { tracklistFingerprint } from "../src/verification/tracklist-corrections.js";
import { normalizeRymIdentity } from "../src/verification/rym-identity.js";

const directory = "reports/aprovechamiento-1-5-2026-10-17";
const confirm = process.argv.includes("--confirm");
interface Track { id: number; title: string; disc_number: number; track_number: number }
interface Plan {
  albumId: number; artistId: number; title: string;
  before: { id: number; album: Record<string, unknown>; tracks: Track[] };
  pins: Array<{ path: string; sha256: string }>; findings: string[]; sourceUrls: string[]; positiveSourceUrls: string[];
  fields: Record<string, string | number>; tracks: Array<{ title: string; duration: number | null; notes?: string }>;
  keepTrackIds?: number[]; reviewReason: string | null;
}
async function main() {
  const document = JSON.parse(readFileSync(`${directory}/tracklists-plan.json`, "utf8")) as { version: string; plans: Plan[] };
  if (document.version !== "crv-tracklist-repairs-v1") throw new Error("Plan de reparación inválido");
  const outcomes: unknown[] = [];
  for (const plan of document.plans) {
    for (const pin of plan.pins) if (createHash("sha256").update(readFileSync(pin.path)).digest("hex") !== pin.sha256) throw new Error(`Evidencia cambió: ${pin.path}`);
    const wanted = plan.keepTrackIds ? plan.before.tracks.filter(track => plan.keepTrackIds!.includes(track.id)).map(track => track.title) : plan.tracks.map(track => track.title);
    const existing = (await getPool().query<{ title: string }>("SELECT title FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number,id", [plan.albumId])).rows.map(track => track.title);
    const currentAlbum = (await getPool().query<{ data: Record<string, unknown> }>('SELECT row_to_json(a) data FROM public.albums a WHERE id=$1', [plan.albumId])).rows[0]?.data;
    if (!currentAlbum || Number(currentAlbum['artist_id']) !== plan.artistId) throw new Error('El artista del disco cambió desde el plan');
    const fieldsStillNeeded = Object.entries(plan.fields).some(([field, value]) => currentAlbum[field] !== value);
    if (tracklistFingerprint(existing) === tracklistFingerprint(wanted) && !fieldsStillNeeded) { outcomes.push({ albumId: plan.albumId, status: "already_correct" }); continue; }
    const { runId, result } = await withOperatorRun({
      name: "catalogo:reparar-tracklist", operator: "Codex (encargo de Brian: puntos 1–5)",
      note: `Reparación documentada de ${plan.title} (#${plan.albumId}): retirar pistas de otra publicación; conservar fuentes, ediciones, créditos correctos y evidencia.`,
      params: { albumId: plan.albumId, sourcePins: plan.pins, findings: plan.findings, sourceUrls: plan.sourceUrls },
    }, async context => {
      await context.client.query("SET LOCAL lock_timeout='5s'");
      const snapshot = (await context.client.query<{ snapshot: Plan["before"] }>(`SELECT json_build_object('id',a.id,'album',row_to_json(a),'tracks',
        (SELECT coalesce(json_agg(t ORDER BY t.disc_number,t.track_number,t.id),'[]'::json) FROM public.tracks t WHERE t.album_id=a.id)) snapshot
        FROM public.albums a WHERE a.id=$1 FOR UPDATE`, [plan.albumId])).rows[0]?.snapshot;
      if (!snapshot || JSON.stringify(snapshot) !== JSON.stringify(plan.before)) throw new Error(`Ficha ${plan.albumId} cambió desde el plan; regenerar`);
      const bad = snapshot.tracks.filter(track => !plan.keepTrackIds?.includes(track.id));
      const fingerprint = tracklistFingerprint(snapshot.tracks.map(track => track.title));
      const rejection = { operation: "tracklist_source_rejected", fingerprint, titles: snapshot.tracks.map(track => track.title), findings: plan.findings, sourcePins: plan.pins, sourceUrls: plan.sourceUrls };
      await context.client.query(`INSERT INTO ingest.review_queue(kind,status,priority,album_id,payload,notes,resolved_at,resolved_by,resolution_note)
        SELECT 'manual_review','dismissed',3,$1,$2::jsonb,$3,now(),$4,'Lista ajena rechazada con evidencia documental'
        WHERE NOT EXISTS (SELECT 1 FROM ingest.review_queue WHERE album_id=$1 AND payload->>'operation'='tracklist_source_rejected' AND payload->>'fingerprint'=$5)`,
      [plan.albumId, JSON.stringify(rejection), context.note, 'human', fingerprint]);
      const creditDestinations: Array<{ oldCredit: number; retainedCredit: number }> = [];
      let removed = 0;
      for (const track of bad) {
        const credits = await context.client.query<{ id: string; person_id: string | null; credit_type: string; role: string }>(
          "SELECT id::text,person_id::text,credit_type,role FROM public.track_credits WHERE track_id=$1", [track.id]);
        for (const credit of credits.rows) {
          if (plan.albumId !== 1427) throw new Error(`Crédito inesperado en pista ${track.id}; requiere cotejo`);
          const possible = await context.client.query<{ id: string; title: string }>(`SELECT c.id::text,t.title FROM public.track_credits c JOIN public.tracks t ON t.id=c.track_id
            WHERE t.album_id=1598 AND c.person_id=$1 AND c.credit_type=$2 AND c.role=$3`, [credit.person_id, credit.credit_type, credit.role]);
          const targets = possible.rows.filter(candidate => normalizeRymIdentity(candidate.title) === normalizeRymIdentity(track.title));
          if (targets.length !== 1) throw new Error(`El crédito ${credit.id} no tiene destino documental único en la antología`);
          creditDestinations.push({ oldCredit: Number(credit.id), retainedCredit: Number(targets[0]!.id) });
          await deleteRelation(context, "track_credit", Number(credit.id));
        }
        // These metrics were attached to the wrong recording. The reversible
        // change journal retains every deleted row; do not invent another target.
        await context.client.query("DELETE FROM public.entity_metrics WHERE track_id=$1", [track.id]);
        await deleteEntity(context, "track", track.id);
        removed++;
      }
      let created = 0;
      if (!plan.keepTrackIds) for (const [index, track] of plan.tracks.entries()) {
        await createEntity(context, "track", { title: track.title, disc_number: 1, track_number: index + 1,
          ...(track.duration === null ? {} : { duration_seconds: track.duration }), ...(track.notes ? { notes: track.notes } : {}) },
        { albumId: plan.albumId, allowSimilar: true });
        created++;
      }
      if (Object.keys(plan.fields).length) await updateEntity(context, "album", plan.albumId, plan.fields);
      if (plan.reviewReason) await context.client.query(`INSERT INTO ingest.review_queue(kind,status,priority,album_id,payload,notes)
        SELECT 'manual_review','open',1,$1,$2::jsonb,$3 WHERE NOT EXISTS
        (SELECT 1 FROM ingest.review_queue WHERE album_id=$1 AND payload->>'operation'='tracklist_after_repair')`,
      [plan.albumId, JSON.stringify({ operation: "tracklist_after_repair", reason: plan.reviewReason, sourcePins: plan.pins, sourceUrls: plan.sourceUrls }), plan.reviewReason]);
      const newClaims = await context.client.query<{ id: string }>("SELECT id::text FROM ingest.claims WHERE run_id=$1", [context.runId]);
      for (const claim of newClaims.rows) for (const url of plan.positiveSourceUrls) await context.client.query(`INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,position,evidence_hash)
        VALUES($1,$2,$3,0,$4) ON CONFLICT DO NOTHING`, [claim.id, url, `Corrección documental de ${plan.title}; referencias y capturas en el run ${context.runId}.`, createHash("sha256").update(`${claim.id}:${url}`).digest("hex")]);
      const after = (await context.client.query<{ title: string }>("SELECT title FROM public.tracks WHERE album_id=$1 ORDER BY disc_number,track_number,id", [plan.albumId])).rows.map(track => track.title);
      if (tracklistFingerprint(after) !== tracklistFingerprint(wanted)) throw new Error("El resultado no coincide con la lista documentada");
      const journal = (await context.client.query<{ n: number }>("SELECT count(*)::int n FROM ingest.change_journal WHERE run_id=$1", [context.runId])).rows[0]!.n;
      if (!journal) throw new Error("La reparación no tiene diario reversible");
      return { albumId: plan.albumId, removed, created, retained: plan.keepTrackIds?.length ?? 0, creditDestinations, journalRows: journal, reviewReason: plan.reviewReason, after };
    }, { rollbackOnly: !confirm });
    outcomes.push({ runId: confirm ? runId : null, dryRun: !confirm, ...result });
    writeFileSync(`${directory}/tracklists-${confirm ? "aplicado" : "ensayo"}.json`, JSON.stringify(outcomes, null, 2) + "\n");
    console.log(`#${plan.albumId}: ${result.removed} retiradas, ${result.created} documentadas; ${confirm ? `run ${runId}` : "ensayo revertido"}`);
  }
  if (outcomes.every(item => (item as { status?: string }).status === 'already_correct')) {
    writeFileSync(`${directory}/tracklists-repeticion.json`, JSON.stringify(outcomes, null, 2) + '\n');
    console.log(`${outcomes.length} fichas ya correctas; cero cambios pendientes`);
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
