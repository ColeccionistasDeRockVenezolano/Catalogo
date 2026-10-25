import { useId, useState } from "react";
import { youtubeApi } from "../lib/api";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { youtubeVideoId } from "../lib/youtube";
import type { YoutubeLink } from "../lib/types";

const KINDS: Record<string, string> = { full_album: "Disco completo", music_video: "Videoclip", live_concert: "Concierto", documentary: "Documental", other: "Otro" };
export function AlbumVideoEditor({ albumId, links, onChanged }: { albumId: number; links: YoutubeLink[]; onChanged: () => void }) {
  const { isAdmin } = useOperator();
  const { notify } = useToast();
  const [draft, setDraft] = useState<{ url: string; kind: string; primary: boolean; previousVideoId?: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const uid = useId();
  if (!isAdmin) return null;
  function open(link: YoutubeLink, remove = false) { setDraft({ url: `https://youtu.be/${link.videoId}`, kind: link.kind, primary: link.isPrimaryLink, previousVideoId: link.videoId }); setRemoving(remove); setNote(""); setError(undefined); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const videoId = youtubeVideoId(draft?.url ?? null);
    if (!draft || !videoId || !note.trim()) { setError("Escribe una URL de video de YouTube válida y el motivo."); return; }
    setBusy(true); setError(undefined);
    try {
      if (removing) await youtubeApi.removeAlbumVideo(albumId, videoId, note.trim());
      else await youtubeApi.saveAlbumVideo(albumId, videoId, draft.kind, draft.primary, note.trim(), draft.previousVideoId);
      setDraft(null); onChanged(); notify("success", removing ? "Video desvinculado." : "Video vinculado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el video."); }
    finally { setBusy(false); }
  }
  return <section className="relation-editor" aria-label="Videos del disco">
    <h3>Videos de YouTube</h3>
    <p className="hint">El video principal es el que reproduce la ficha.</p>
    {!links.length ? <p>Sin videos vinculados.</p> : <ul className="relation-editor__list">{links.map((link) => <li key={link.videoId}>
      <div><a href={`https://youtu.be/${link.videoId}`} target="_blank" rel="noreferrer noopener">{link.title ?? link.videoId}</a><span>{KINDS[link.kind] ?? link.kind}{link.isPrimaryLink ? " · Principal" : ""}</span></div>
      <div className="relation-editor__actions"><button type="button" className="btn btn--sm" onClick={() => open(link)}>Editar video {link.title ?? link.videoId}</button><button type="button" className="btn btn--sm btn--danger" onClick={() => open(link, true)}>Quitar video {link.title ?? link.videoId}</button></div>
    </li>)}</ul>}
    <button type="button" className="btn" onClick={() => { setDraft({ url: "", kind: "full_album", primary: !links.length }); setRemoving(false); setNote(""); setError(undefined); }}>Añadir video</button>
    {draft ? <form className="relation-editor__form" onSubmit={submit}>
      {error ? <p className="form-error-banner" role="alert">{error}</p> : null}
      {!removing ? <div className="form-grid">
        <div className="field span-2"><label htmlFor={`${uid}-url`}>URL del video *</label><input id={`${uid}-url`} type="url" required value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></div>
        <div className="field"><label htmlFor={`${uid}-kind`}>Tipo de video</label><select id={`${uid}-kind`} value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>{Object.entries(KINDS).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}</select></div>
        <div className="field checkbox-field"><input id={`${uid}-primary`} type="checkbox" checked={draft.primary} onChange={(event) => setDraft({ ...draft, primary: event.target.checked })} /><label htmlFor={`${uid}-primary`}>Video principal</label></div>
      </div> : <p>Se retira la asociación de este video con el disco.</p>}
      <div className="field"><label htmlFor={`${uid}-note`}>Motivo *</label><textarea id={`${uid}-note`} required maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></div>
      <div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button><button type="submit" className={`btn ${removing ? "btn--danger" : "btn--primary"}`} disabled={busy}>{busy ? "Guardando…" : removing ? "Quitar video" : "Guardar video"}</button></div>
    </form> : null}
  </section>;
}
