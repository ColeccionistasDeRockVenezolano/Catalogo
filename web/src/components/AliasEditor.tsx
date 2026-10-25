import { useId, useState } from "react";
import { PencilSimple, Star, Trash } from "@phosphor-icons/react";
import { aliasWrites, ApiError, type EntityPath } from "../lib/api";
import { aliasTypeLabel, ALIAS_TYPES } from "../lib/labels";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import type { Alias } from "../lib/types";
import { NoteField } from "./NoteField";
import { ConfirmDialog } from "./ConfirmDialog";

interface AliasEditorProps {
  path: EntityPath;
  entityId: number;
  aliases: Alias[];
  onChanged: () => void;
  compactTypeLabels?: boolean;
}

export function AliasEditor({ path, entityId, aliases, onChanged, compactTypeLabels = false }: AliasEditorProps) {
  const { isAdmin } = useOperator();
  const { notify } = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Alias | null>(null);
  const [removing, setRemoving] = useState<Alias | null>(null);
  const [promoting, setPromoting] = useState<Alias | null>(null);
  // El público no ve los alias iguales al nombre ni las variantes de fuente
  // (plan del primo, punto 10); siguen guardados para la búsqueda y el ER.
  const shown = isAdmin ? aliases : aliases.filter((item) => !item.publicHidden);

  // Los errores suben al diálogo de confirmación, que los muestra sin cerrarse.
  async function handleMakePrimary(aliasId: number, note: string) {
    await aliasWrites[path].update(entityId, aliasId, { isPrimary: true, note });
    onChanged();
    notify("success", "Alias principal actualizado.");
  }

  async function handleRemove(aliasId: number, note: string) {
    await aliasWrites[path].remove(entityId, aliasId, note);
    onChanged();
    notify("success", "Alias retirado.");
  }

  return (
    <div>
      <ul style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {shown.map((item) => (
          <li key={item.id} className={`chip alias-chip ${item.isPrimary ? "is-primary" : ""}${item.publicHidden ? " is-hidden" : ""}`}
            title={item.publicHidden ? "Oculto al público: igual al nombre, repetido o variante de fuente" : undefined}>
            {item.isPrimary ? <Star className="chip-icon chip-icon--primary" aria-label="Alias principal" weight="fill" /> : null}
            <span className="alias-chip__name">{item.alias}</span>
            <span className="alias-chip__type" title={aliasTypeLabel(item.aliasType)}>{compactTypeLabels && item.aliasType === "name_variant" ? "Variante" : aliasTypeLabel(item.aliasType)}</span>
            {isAdmin ? (
              <>
                {!item.isPrimary ? (
                  <button type="button" title="Marcar como principal" aria-label={`Marcar ${item.alias} como principal`} onClick={() => setPromoting(item)}><Star aria-hidden="true" /></button>
                ) : null}
                <button type="button" title="Editar" aria-label={`Editar ${item.alias}`} onClick={() => { setAdding(false); setEditing(item); }}><PencilSimple aria-hidden="true" /></button>
                <button type="button" title="Retirar" aria-label={`Retirar ${item.alias}`} onClick={() => setRemoving(item)}><Trash aria-hidden="true" /></button>
              </>
            ) : null}
          </li>
        ))}
        {shown.length === 0 ? <span style={{ color: "var(--text-faint)", fontSize: 13 }}>Sin alias registrados.</span> : null}
      </ul>
      {isAdmin ? (
        adding ? (
          <AliasInlineForm submitLabel="Añadir alias" onCancel={() => setAdding(false)}
            onSubmit={async (value) => {
              await aliasWrites[path].create(entityId, { ...value, isPrimary: false });
              setAdding(false);
              onChanged();
              notify("success", "Alias añadido.");
            }} />
        ) : editing ? null : (
          <button type="button" className="btn btn--sm btn--ghost" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>+ Añadir alias</button>
        )
      ) : null}
      {editing ? (
        <AliasInlineForm key={editing.id} initial={editing} submitLabel="Guardar alias" onCancel={() => setEditing(null)}
          onSubmit={async (value) => {
            await aliasWrites[path].update(entityId, editing.id, value);
            setEditing(null);
            onChanged();
            notify("success", "Alias actualizado.");
          }} />
      ) : null}
      {removing ? (
        <ConfirmDialog title={`Retirar «${removing.alias}»`} description="El alias deja de estar disponible para búsqueda y conciliación."
          confirmLabel="Retirar" danger onClose={() => setRemoving(null)} onConfirm={async (note) => {
            await handleRemove(removing.id, note);
            setRemoving(null);
          }} />
      ) : null}
      {promoting ? (
        <ConfirmDialog
          title={`Marcar «${promoting.alias}» como alias principal`}
          description="El alias principal es el que la búsqueda y la conciliación usan para reconocer el nombre canónico."
          confirmLabel="Marcar"
          onClose={() => setPromoting(null)}
          onConfirm={async (note) => {
            await handleMakePrimary(promoting.id, note);
            setPromoting(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Formulario de alias en la misma línea: añadir o corregir uno no abre una
 * ventana para dos campos. Los errores quedan junto al formulario.
 */
function AliasInlineForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: Alias;
  submitLabel: string;
  onSubmit: (value: { alias: string; aliasType: string; note: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial?.alias ?? "");
  const [type, setType] = useState(initial?.aliasType ?? "name_variant");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const id = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value.trim()) { setError("Escribe el alias."); return; }
    if (!note.trim()) { setError("Elige o escribe un motivo: queda en la auditoría."); return; }
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit({ alias: value.trim(), aliasType: type, note: note.trim() });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el alias.");
      setBusy(false);
    }
  }

  return (
    <form className="alias-inline" onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
      <div className="alias-inline__row">
        <div className="field">
          <label htmlFor={`${id}-alias`}>Alias *</label>
          <input id={`${id}-alias`} value={value} autoFocus onChange={(event) => setValue(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-type`}>Tipo</label>
          <select id={`${id}-type`} value={type} onChange={(event) => setType(event.target.value)}>
            {ALIAS_TYPES.map((item) => <option key={item} value={item}>{aliasTypeLabel(item)}</option>)}
          </select>
        </div>
      </div>
      <NoteField value={note} onChange={setNote} rows={1} presets={["Variante de la fuente", "Error de escritura", "Nombre anterior", "Corrección de dato"]} />
      {error ? <p className="form-error-banner" role="alert">{error}</p> : null}
      <div className="alias-inline__actions">
        <button type="button" className="btn btn--sm" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="btn btn--sm btn--primary" disabled={busy}>{busy ? "Guardando…" : submitLabel}</button>
      </div>
    </form>
  );
}
