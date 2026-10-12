import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { artistMemberWrites } from "../lib/api";
import { TITULAR_ROLE } from "../lib/types";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { EntityPicker } from "./EntityPicker";

export interface MembershipRow {
  id: number; otherId: number; otherName: string; role: string;
  fromYear: number | null; toYear: number | null; isCurrent: boolean;
}
export function MembershipEditor({ fixedKind, fixedId, rows, onChanged }: {
  fixedKind: "artist" | "person"; fixedId: number; rows: MembershipRow[]; onChanged: () => void;
}) {
  const { isAdmin } = useOperator();
  const [draft, setDraft] = useState<MembershipRow | null>(null);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const uid = useId();
  const { notify } = useToast();
  if (!isAdmin) return null;
  const titular = rows.filter((row) => row.role === TITULAR_ROLE);
  const members = rows.filter((row) => row.role !== TITULAR_ROLE);
  function open(row: MembershipRow, remove = false) { setDraft(row); setRemoving(remove); setNote(""); setError(undefined); }
  function add(role: string) { open({ id: 0, otherId: 0, otherName: "", role, fromYear: null, toYear: null, isCurrent: true }); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !note.trim()) { setError("El motivo es obligatorio."); return; }
    if (!removing && (!draft.otherId || !draft.role.trim())) { setError("Selecciona una ficha y escribe el rol."); return; }
    if (draft.fromYear !== null && draft.toYear !== null && draft.toYear < draft.fromYear) { setError("El año final no puede ser anterior al inicial."); return; }
    setBusy(true); setError(undefined);
    try {
      if (removing) await artistMemberWrites.remove(draft.id, note.trim());
      else {
        const values = { role: draft.role.trim(), fromYear: draft.fromYear, toYear: draft.isCurrent ? null : draft.toYear, isCurrent: draft.isCurrent, note: note.trim() };
        if (draft.id) await artistMemberWrites.update(draft.id, { ...values, ...(fixedKind === "artist" ? { personId: draft.otherId } : {}) });
        else await artistMemberWrites.create({ ...values, artistId: fixedKind === "artist" ? fixedId : draft.otherId, personId: fixedKind === "person" ? fixedId : draft.otherId });
      }
      setDraft(null); onChanged(); notify("success", removing ? "Vínculo retirado." : "Vínculo guardado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el vínculo."); }
    finally { setBusy(false); }
  }
  function list(items: MembershipRow[]) {
    return items.length ? <ul className="relation-editor__list">{items.map((row) => <li key={row.id}>
      <div><Link to={`/${fixedKind === "artist" ? "personas" : "artistas"}/${row.otherId}`}>{row.otherName}</Link><span>{row.role}</span><span className="hint">{row.fromYear ?? "Sin fecha"}{row.isCurrent ? "–presente" : row.toYear ? `–${row.toYear}` : ""}</span></div>
      <div className="relation-editor__actions"><button type="button" className="btn btn--sm" disabled={busy} onClick={() => open(row)}>Editar vínculo con {row.otherName}</button><button type="button" className="btn btn--sm btn--danger" disabled={busy} onClick={() => open(row, true)}>Quitar vínculo con {row.otherName}</button></div>
    </li>)}</ul> : <p>Sin vínculos registrados.</p>;
  }
  return <section className="relation-editor" aria-label="Identidad e integrantes">
    <h3>{fixedKind === "artist" ? "Persona y nombre real del artista" : "Proyectos propios"}</h3>
    <p className="hint">Vincula la ficha de la persona titular. Su nombre y fechas se muestran en el proyecto; sus datos se editan en la ficha de persona.</p>
    {list(titular)}
    <button type="button" className="btn" disabled={busy} onClick={() => add(TITULAR_ROLE)}>{fixedKind === "artist" ? "Asociar persona titular" : "Asociar proyecto propio"}</button>
    <h3>{fixedKind === "artist" ? "Integrantes" : "Bandas y agrupaciones"}</h3>
    {list(members)}
    <button type="button" className="btn" disabled={busy} onClick={() => add("")}>{fixedKind === "artist" ? "Añadir integrante" : "Añadir vínculo con artista"}</button>
    {draft ? <form className="relation-editor__form" onSubmit={submit}>
      <h4>{removing ? `Quitar vínculo con ${draft.otherName}` : draft.role === TITULAR_ROLE ? "Persona titular del proyecto" : "Editar membresía"}</h4>
      {error ? <p className="form-error-banner" role="alert">{error}</p> : null}
      {!removing ? <>
        {fixedKind === "artist" || !draft.id ? <EntityPicker kind={fixedKind === "artist" ? "person" : "artist"} label={fixedKind === "artist" ? "Persona *" : "Artista *"} value={draft.otherId || null} valueLabel={draft.otherName || null} onSelect={(id, name) => setDraft({ ...draft, otherId: id, otherName: name })} /> : <p>{draft.otherName}</p>}
        <div className="form-grid">
          <div className="field"><label htmlFor={`${uid}-role`}>Rol *</label><input id={`${uid}-role`} required maxLength={200} value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></div>
          <div className="field"><label htmlFor={`${uid}-from`}>Desde (año)</label><input id={`${uid}-from`} type="number" min={1000} max={9999} value={draft.fromYear ?? ""} onChange={(event) => setDraft({ ...draft, fromYear: event.target.value ? Number(event.target.value) : null })} /></div>
          <div className="field"><label htmlFor={`${uid}-to`}>Hasta (año)</label><input id={`${uid}-to`} type="number" min={1000} max={9999} disabled={draft.isCurrent} value={draft.isCurrent ? "" : draft.toYear ?? ""} onChange={(event) => setDraft({ ...draft, toYear: event.target.value ? Number(event.target.value) : null })} /></div>
          <div className="checkbox-field field"><input id={`${uid}-current`} type="checkbox" checked={draft.isCurrent} onChange={(event) => setDraft({ ...draft, isCurrent: event.target.checked })} /><label htmlFor={`${uid}-current`}>Vínculo actual</label></div>
        </div>
      </> : <p>La persona y sus créditos se conservan; se retira esta relación.</p>}
      <div className="field"><label htmlFor={`${uid}-note`}>Motivo *</label><textarea id={`${uid}-note`} required maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></div>
      <div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>Cancelar</button><button className={`btn ${removing ? "btn--danger" : "btn--primary"}`} disabled={busy}>{busy ? "Guardando…" : removing ? "Quitar vínculo" : "Guardar vínculo"}</button></div>
    </form> : null}
  </section>;
}
