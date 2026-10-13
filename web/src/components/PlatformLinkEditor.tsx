import { useId, useState } from "react";
import { catalogLinksApi, type EditablePlatformLink } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { platformLabel } from "./PlatformLinks";

const SOCIAL = ["instagram", "facebook", "x", "tiktok", "threads", "bluesky"];
const STREAMING = ["spotify", "apple_music", "deezer", "youtube", "youtube_music", "tidal", "bandcamp", "soundcloud", "amazon_music"];
export function PlatformLinkEditor({ kind, id, category, onChanged }: {
  kind: "artist" | "album"; id: number; category: "social" | "streaming"; onChanged: () => void;
}) {
  const { isAdmin } = useOperator();
  const { notify } = useToast();
  const { data, loading, error, reload } = useAsync(() => isAdmin ? catalogLinksApi.list(kind, id, category) : Promise.resolve([]), [kind, id, category, isAdmin]);
  const [draft, setDraft] = useState<EditablePlatformLink | null>(null);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const uid = useId();
  const platforms = category === "social" ? SOCIAL : STREAMING;
  if (!isAdmin) return null;

  function open(link: EditablePlatformLink, remove = false) {
    setDraft(link); setRemoving(remove); setNote(""); setFailure(undefined);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !note.trim()) { setFailure("El motivo es obligatorio."); return; }
    setBusy(true); setFailure(undefined);
    try {
      if (removing) await catalogLinksApi.remove(kind, id, category, draft.platform, note.trim());
      else await catalogLinksApi.save(kind, id, category, draft, note.trim());
      setDraft(null); reload(); onChanged(); notify("success", removing ? "Enlace retirado." : "Enlace guardado.");
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "No se pudo guardar el enlace."); }
    finally { setBusy(false); }
  }
  return <section className="relation-editor" aria-label={category === "social" ? "Redes sociales" : "Plataformas de escucha"}>
    <h3>{category === "social" ? "Redes sociales" : "Plataformas de escucha"}</h3>
    <p className="hint">Los perfiles con identidad confirmada se muestran en la ficha pública.</p>
    {loading ? <p role="status">Cargando enlaces…</p> : error ? <p role="alert">{error} <button type="button" className="btn" onClick={reload}>Reintentar</button></p> : <>
      {!data?.length ? <p>Sin enlaces registrados.</p> : <ul className="relation-editor__list">{data.map((link) => <li key={link.platform}>
        <div><strong>{platformLabel(link.platform)}</strong><a href={link.url} target="_blank" rel="noreferrer noopener">{link.url}</a><span className="hint">{link.verified ? "Identidad confirmada" : "Pendiente de confirmar"}</span></div>
        <div className="relation-editor__actions"><button type="button" className="btn btn--sm" disabled={busy} onClick={() => open(link)}>Editar {platformLabel(link.platform)}</button><button type="button" className="btn btn--sm btn--danger" disabled={busy} onClick={() => open(link, true)}>Quitar {platformLabel(link.platform)}</button></div>
      </li>)}</ul>}
      {!draft ? <button type="button" className="btn" onClick={() => open({ platform: platforms.find((p) => !data?.some((link) => link.platform === p)) ?? platforms[0]!, url: "", handle: null, verified: false })}>Añadir {category === "social" ? "red social" : "plataforma de escucha"}</button> : null}
    </>}
    {draft ? <form className="relation-editor__form" onSubmit={submit}>
      <h4>{removing ? `Quitar ${platformLabel(draft.platform)}` : "Editar enlace"}</h4>
      {failure ? <p className="form-error-banner" role="alert">{failure}</p> : null}
      {!removing ? <div className="form-grid">
        <div className="field"><label htmlFor={`${uid}-platform`}>Plataforma</label><select id={`${uid}-platform`} value={draft.platform} onChange={(event) => {
          const existing = data?.find((link) => link.platform === event.target.value);
          setDraft(existing ?? { platform: event.target.value, url: "", handle: null, verified: false });
        }}>{platforms.map((p) => <option value={p} key={p}>{platformLabel(p)}</option>)}</select></div>
        <div className="field span-2"><label htmlFor={`${uid}-url`}>URL *</label><input id={`${uid}-url`} type="url" required value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></div>
        {category === "social" ? <div className="field"><label htmlFor={`${uid}-handle`}>Usuario</label><input id={`${uid}-handle`} maxLength={120} value={draft.handle ?? ""} onChange={(event) => setDraft({ ...draft, handle: event.target.value || null })} /></div> : null}
        <div className="checkbox-field field"><input id={`${uid}-verified`} type="checkbox" checked={draft.verified} onChange={(event) => setDraft({ ...draft, verified: event.target.checked })} /><label htmlFor={`${uid}-verified`}>Identidad confirmada</label></div>
      </div> : <p>Se retira el enlace de esta ficha.</p>}
      <div className="field"><label htmlFor={`${uid}-note`}>Motivo *</label><textarea id={`${uid}-note`} required maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></div>
      <div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button><button className={`btn ${removing ? "btn--danger" : "btn--primary"}`} disabled={busy}>{busy ? "Guardando…" : removing ? "Quitar enlace" : "Guardar enlace"}</button></div>
    </form> : null}
  </section>;
}
