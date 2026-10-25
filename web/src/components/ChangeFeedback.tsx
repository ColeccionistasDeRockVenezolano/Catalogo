// CRV · Deshacer, de una sola manera.
//
// Toda escritura con run (edición, alta, retiro, fusión, división,
// corrección) la anuncia `request()` con el evento `crv-change`. Aquí:
//
// 1. Cada cambio abre un aviso con «Deshacer» (o «Rehacer», si el cambio fue
//    un deshacer). Un clic lo deshace en el acto, sin motivo que escribir: el
//    run queda con la nota «Deshecho al momento…». Si algo cambió después
//    (409), se abre la vista previa con el conflicto.
// 2. Los cambios de la sesión quedan en «Cambios de esta sesión», dentro del
//    menú de la cuenta (OperatorPill), cada uno con su deshacer con vista
//    previa, y el Historial completo a un clic.
// 3. Ctrl/⌘+Z deshace el último cambio; Ctrl/⌘+Shift+Z lo rehace. Fuera de
//    los campos de texto y con ningún diálogo abierto.
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ArrowArcLeft, ArrowArcRight } from "@phosphor-icons/react";
import { ApiError, CATALOG_CHANGE_EVENT, CATALOG_DATA_CHANGED_EVENT, changesApi, type CatalogChangeEvent } from "../lib/api";
import { changeTitle, entityHref, ENTITY_OP_LABEL, kindLabel } from "../lib/changes";
import { relativeTime } from "../lib/curation";
import { registerChangeToast, toastManager, UNDO_TOAST_MS, useToast } from "../lib/ToastContext";
import type { ChangeSummary } from "../lib/types";
import { UndoDialog } from "./UndoDialog";

export interface Entry {
  runId: number;
  /** «undo» si este run deshizo otro; «change» para el resto (un rehacer también es un cambio). */
  kind: "change" | "undo";
  target: number | null;
  at: number;
  undone: boolean;
  title: string | null;
  entity: { kind: string; id: number; label: string | null; op: keyof typeof ENTITY_OP_LABEL } | null;
  more: number;
}

const STORAGE_KEY = "crv:recent-changes";
const MAX_ENTRIES = 20;
const UNDO_PATH = /^\/changes\/(\d+)\/undo$/u;

function loadEntries(): Entry[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Entry[]).slice(-MAX_ENTRIES) : [];
  } catch { return []; }
}

function saveEntries(entries: Entry[]): void {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* sin almacenamiento: la lista vive en memoria */ }
}

const toastId = (runId: number) => `change-${runId}`;

function EntityLine({ entry, onNavigate }: { entry: Entry; onNavigate?: () => void }) {
  const entity = entry.entity;
  if (!entity) return null;
  const href = entity.op === "removed" ? null : entityHref(entity.kind, entity.id);
  const name = entity.label ?? String(entity.id);
  // ENTITY_OP_LABEL concuerda con «ficha»: «Ficha modificada: Soda · disco».
  return (
    <>
      Ficha {ENTITY_OP_LABEL[entity.op]}:{" "}
      {href ? <Link to={href} onClick={onNavigate}>{name}</Link> : <span>{name}</span>}
      {" · "}{kindLabel(entity.kind)}
      {entry.more > 0 ? ` y ${entry.more} más` : ""}
    </>
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName);
}

export interface SessionChanges {
  entries: Entry[];
  /** Cambios aún vigentes (sin deshacer), para el contador de la cuenta. */
  pending: number;
  clear: () => void;
  /** Abre la vista previa del deshacer de un run. */
  openUndo: (runId: number) => void;
  /** El diálogo de deshacer abierto, si lo hay: quien usa el hook lo monta. */
  dialog: ReactElement | null;
}

/** Avisos, atajos de teclado y lista de la sesión. Montarlo una sola vez, solo para administradores. */
export function useSessionChanges(): SessionChanges {
  const { notify } = useToast();
  const [entries, setEntries] = useState<Entry[]>(loadEntries);
  const [dialogFor, setDialogFor] = useState<number | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const update = useCallback((fn: (prev: Entry[]) => Entry[]) => {
    setEntries((prev) => { const next = fn(prev).slice(-MAX_ENTRIES); saveEntries(next); return next; });
  }, []);

  /** Deshace en el acto; si el servidor encuentra un conflicto, abre la vista previa. */
  const quickUndo = useCallback(async (runId: number, how: string) => {
    const entry = entriesRef.current.find((item) => item.runId === runId);
    const redo = entry?.kind === "undo";
    toastManager.close(toastId(runId));
    try {
      await changesApi.undo(runId, `${redo ? "Rehecho" : "Deshecho"} al momento ${how}`);
      window.dispatchEvent(new Event(CATALOG_DATA_CHANGED_EVENT));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        notify("error", "No se pudo al momento: algo cambió después. Revisa qué hay que deshacer primero.");
        setDialogFor(runId);
        return;
      }
      notify("error", err instanceof ApiError ? err.message : "No se pudo deshacer el cambio.");
    }
  }, [notify]);

  const describe = useCallback((runId: number) => {
    // El detalle solo enriquece el aviso: si falta o llega incompleto, el aviso queda como está.
    changesApi.get(runId).then((detail: ChangeSummary) => {
      if (!Array.isArray(detail?.entities)) return;
      const first = detail.entities[0];
      update((prev) => prev.map((item) => item.runId !== runId ? item : {
        ...item,
        title: changeTitle(detail),
        entity: first ? { kind: first.kind, id: first.id, label: first.label ?? null, op: first.op } : null,
        more: Math.max(0, (detail.entityTotal ?? detail.entities.length) - 1),
      }));
    }).catch(() => undefined);
  }, [update]);

  // Las descripciones de los avisos se pintan desde la lista: así la ficha
  // aparece en cuanto llega el detalle, sin depender del orden de respuesta.
  useEffect(() => {
    for (const entry of entries) {
      if (!entry.entity) continue;
      toastManager.update(toastId(entry.runId), { description: <EntityLine entry={entry} /> });
    }
  }, [entries]);

  useEffect(() => {
    const onChange = (event: Event) => {
      const { runId, path } = (event as CustomEvent<CatalogChangeEvent>).detail;
      const match = UNDO_PATH.exec(path);
      const target = match ? Number(match[1]) : null;
      const targetEntry = target === null ? undefined : entriesRef.current.find((item) => item.runId === target);
      // Deshacer un deshacer es rehacer: vuelve a ser un cambio que se puede deshacer.
      const kind: Entry["kind"] = target === null || targetEntry?.kind === "undo" ? "change" : "undo";
      update((prev) => [
        ...prev.filter((item) => item.runId !== runId).map((item) => item.runId === target ? { ...item, undone: true } : item),
        { runId, kind, target, at: Date.now(), undone: false, title: null, entity: null, more: 0 },
      ]);
      if (target !== null) toastManager.close(toastId(target));
      const id = toastId(runId);
      toastManager.add({
        id,
        title: kind === "undo" ? "Cambio deshecho." : targetEntry ? "Cambio rehecho." : "Cambio guardado.",
        type: "success",
        timeout: UNDO_TOAST_MS,
        actionProps: {
          children: <>{kind === "undo" ? <ArrowArcRight size={14} weight="bold" aria-hidden="true" /> : <ArrowArcLeft size={14} weight="bold" aria-hidden="true" />}{kind === "undo" ? "Rehacer" : "Deshacer"}</>,
          onClick: () => { void quickUndo(runId, "desde el aviso"); },
        },
      });
      registerChangeToast(id);
      describe(runId);
    };
    // Un deshacer hecho desde el Historial o una ficha refresca el estado de la lista.
    const onData = () => {
      const last = entriesRef.current.at(-1);
      if (last && !last.title) describe(last.runId);
    };
    window.addEventListener(CATALOG_CHANGE_EVENT, onChange);
    window.addEventListener(CATALOG_DATA_CHANGED_EVENT, onData);
    return () => {
      window.removeEventListener(CATALOG_CHANGE_EVENT, onChange);
      window.removeEventListener(CATALOG_DATA_CHANGED_EVENT, onData);
    };
  }, [update, describe, quickUndo]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isEditable(event.target) || document.body.classList.contains("has-modal")) return;
      const wanted: Entry["kind"] = event.shiftKey ? "undo" : "change";
      const entry = [...entriesRef.current].reverse().find((item) => !item.undone && item.kind === wanted);
      if (!entry) {
        notify("info", event.shiftKey ? "No hay nada que rehacer en esta sesión." : "No hay cambios de esta sesión por deshacer.");
        return;
      }
      event.preventDefault();
      void quickUndo(entry.runId, "con el teclado");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [notify, quickUndo]);

  const pending = entries.filter((item) => !item.undone && item.kind === "change").length;
  const clear = useCallback(() => update(() => []), [update]);
  const dialog = dialogFor !== null ? <UndoDialog runId={dialogFor} onClose={() => setDialogFor(null)} /> : null;
  return { entries, pending, clear, openUndo: setDialogFor, dialog };
}

/** Lista de los cambios de la sesión, del más reciente al más viejo. */
export function SessionChangesList({ entries, onUndo, onNavigate }: { entries: Entry[]; onUndo: (runId: number) => void; onNavigate: () => void }) {
  if (entries.length === 0) return <p className="recent-changes__empty">Lo que guardes aparece aquí, con su deshacer.</p>;
  return (
    <ol className="recent-changes__list">
      {[...entries].reverse().map((entry) => (
        <li key={entry.runId} className={`recent-changes__item${entry.undone ? " is-undone" : ""}`}>
          <div className="recent-changes__text">
            <strong>{entry.title ?? (entry.kind === "undo" ? "Deshacer" : "Cambio guardado")}{entry.undone ? " · deshecho" : ""}</strong>
            <span><EntityLine entry={entry} onNavigate={onNavigate} /></span>
            <span className="recent-changes__when">{relativeTime(new Date(entry.at).toISOString())} · #{entry.runId}</span>
          </div>
          {entry.undone ? null : (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => onUndo(entry.runId)}>
              {entry.kind === "undo" ? <><ArrowArcRight size={14} weight="bold" aria-hidden="true" /> Rehacer</> : <><ArrowArcLeft size={14} weight="bold" aria-hidden="true" /> Deshacer</>}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
