import { useState } from "react";
import { Modal } from "./Modal";
import { NOTE_PRESETS, NoteField } from "./NoteField";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  requireNote?: boolean;
  /** Motivos de un clic; por omisión, los de retirar si es destructiva y los de editar si no. */
  presets?: readonly string[];
  onConfirm: (note: string) => Promise<void> | void;
  onClose: () => void;
}

/** Confirmación con motivo obligatorio: toda escritura del operador exige nota (src/api/auth.ts). */
export function ConfirmDialog({ title, description, confirmLabel = "Confirmar", danger, requireNote = true, presets, onConfirm, onClose }: ConfirmDialogProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [noteError, setNoteError] = useState<string>();

  async function handleConfirm() {
    if (requireNote && !note.trim()) { setNoteError("Elige o escribe un motivo: queda en la auditoría."); return; }
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la acción.");
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={() => { if (!busy) onClose(); }} sheet alert={danger ?? false} closeOnOverlay={!note.trim() && !busy}>
      <p className="confirm-dialog__description">{description}</p>
      {requireNote ? (
        <NoteField value={note} onChange={(value) => { setNote(value); setNoteError(undefined); }} autoFocus
          presets={presets ?? (danger ? NOTE_PRESETS.remove : NOTE_PRESETS.edit)}
          placeholder="Por qué se hace este cambio (queda en la auditoría)" error={noteError} />
      ) : null}
      {error ? <p className="form-error-banner" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className={danger ? "btn btn--danger" : "btn btn--primary"} onClick={() => void handleConfirm()} disabled={busy}>
          {busy ? "Guardando…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
