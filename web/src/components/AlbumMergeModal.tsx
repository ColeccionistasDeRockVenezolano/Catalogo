// CRV · Fusión de discos con previsualización (E6.5; la API la ofrecía, la web no).
//
// Igual que la fusión de fichas: nada se toca sin ver antes qué pasa — pistas
// emparejadas, cuáles se moverían, conflictos de campos, formatos que se
// añaden y créditos compartidos. La fusión real la ejecuta el servicio
// (merge/album-merge.ts) dentro de una transacción del operador; aquí no hay
// reglas propias. El modal no se cierra al fusionar: muestra el resultado y
// deja deshacer la fusión mientras el run siga siendo reversible.
//
// Dos maneras de juntar (2026-10-13): «el mismo disco» empareja pistas;
// «partes de un mismo disco» (Lado B, CD 2, B-Sides, DVD) suma la otra ficha
// como disco siguiente, con su nombre y su propio video, y la página muestra
// una lista y un reproductor por disco. El motor sugiere cuál y qué ficha queda.
import { useCallback, useEffect, useState } from "react";
import { albumMergeApi, ApiError } from "../lib/api";
import { formatMergeValue } from "../lib/format";
import { useToast } from "../lib/ToastContext";
import { Modal } from "./Modal";
import { EntityPicker } from "./EntityPicker";
import type { AlbumMergeMode, AlbumMergePreview, AlbumMergeResult, AlbumTrackMatch } from "../lib/types";

/** Etiquetas de los campos fusionables de un disco (MERGE_ALBUM_FIELDS). */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  release_year: "Año", album_type: "Tipo", genre: "Género", label_id: "Sello",
  cover_url: "Portada", description: "Descripción",
  youtube_url: "URL de YouTube", youtube_status: "Estado en YouTube",
  instagram_url: "URL de Instagram", instagram_status: "Estado en Instagram",
  wordpress_url: "URL de WordPress", wordpress_status: "Estado en WordPress",
  notes: "Notas",
};

const MATCH_LABEL: Readonly<Record<AlbumTrackMatch["matchType"], string>> = {
  position_and_title: "misma posición y título",
  title: "mismo título",
  position: "misma posición",
};

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Textos que, sin elección, se unen al fusionar (la reseña además queda marcada para la IA). */
const TEXT_FIELDS = new Set(["description", "notes"]);

/** La sugerencia del motor vista desde la orientación de esta previsualización. */
function suggestedNames(preview: AlbumMergePreview): { keep: string; drop: string; title: string } {
  const s = preview.suggestion;
  const straight = s.keepId === preview.keep.id;
  return {
    keep: (straight ? s.keepDiscTitle : s.dropDiscTitle) ?? "",
    drop: (straight ? s.dropDiscTitle : s.keepDiscTitle) ?? "",
    title: straight ? s.title ?? "" : "",
  };
}

interface AlbumMergeModalProps {
  albumId: number;
  albumTitle: string;
  otherAlbum?: { id: number; title: string };
  initialMode?: AlbumMergeMode;
  onApplied?: () => void;
  onMerged: (keepId: number) => void;
  onClose: () => void;
}

export function AlbumMergeModal({ albumId, albumTitle, otherAlbum, initialMode, onApplied, onMerged, onClose }: AlbumMergeModalProps) {
  const { notify } = useToast();
  const [dropId, setDropId] = useState<number | null>(null);
  const [dropLabel, setDropLabel] = useState<string | null>(null);
  const [keepId, setKeepId] = useState<number | null>(null);
  const [preview, setPreview] = useState<AlbumMergePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [stale, setStale] = useState(false);
  const [choices, setChoices] = useState<Record<string, "keep" | "drop">>({});
  const [keepDropNameAsAlias, setKeepDropNameAsAlias] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AlbumMergeResult | null>(null);
  const [mode, setMode] = useState<AlbumMergeMode>("match");
  const [keepDiscTitle, setKeepDiscTitle] = useState("");
  const [dropDiscTitle, setDropDiscTitle] = useState("");
  const [pageTitle, setPageTitle] = useState("");

  const load = useCallback(async (
    firstId: number, secondId: number, orient: "recommended" | "first" = "recommended", wanted?: AlbumMergeMode,
  ) => {
    setLoading(true);
    setError(undefined);
    setStale(false);
    setPreview(null);
    try {
      // «recommended» normaliza al disco recomendado por el motor; «first»
      // respeta la orientación pedida — así el botón Intercambiar cambia de
      // verdad quién queda (el servidor no normaliza, solo informa).
      // Sin modo pedido manda la sugerencia: modo y qué ficha queda.
      let loaded = await albumMergeApi.preview(firstId, secondId, wanted ?? "match");
      const nextMode = wanted ?? loaded.suggestion.mode;
      const keep = orient === "first" ? firstId
        : nextMode === "append" ? loaded.suggestion.keepId : loaded.recommendedKeepId;
      if (keep !== loaded.keep.id || nextMode !== loaded.mode) {
        loaded = await albumMergeApi.preview(keep, keep === firstId ? secondId : firstId, nextMode);
      }
      const names = suggestedNames(loaded);
      setMode(loaded.mode);
      setKeepDiscTitle(names.keep);
      setDropDiscTitle(names.drop);
      setPageTitle(names.title);
      setKeepId(loaded.keep.id);
      setDropId(loaded.drop.id);
      setPreview(loaded);
      setChoices({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo previsualizar la fusión.");
    } finally {
      setLoading(false);
    }
  }, []);

  const initialOtherId = otherAlbum?.id;
  const initialOtherTitle = otherAlbum?.title;
  useEffect(() => {
    if (!initialOtherId || initialOtherId === albumId) return;
    setDropLabel(initialOtherTitle ?? null);
    // Desde un expediente ya se eligieron las dos fichas y, cuando procede,
    // el modo documentado. No repetir el buscador ni adoptar «append».
    void load(albumId, initialOtherId, initialMode ? "first" : "recommended", initialMode);
  }, [albumId, initialOtherId, initialOtherTitle, initialMode, load]);

  function chooseOther(id: number, label: string) {
    if (id === albumId) { setError("Es el mismo disco: elige otro."); return; }
    setDropLabel(label);
    void load(albumId, id);
  }

  function swap() {
    if (preview) void load(preview.drop.id, preview.keep.id, "first", mode);
  }

  function changeMode(next: AlbumMergeMode) {
    if (preview && next !== mode) void load(preview.keep.id, preview.drop.id, "first", next);
  }

  useEffect(() => {
    // Al cerrar con el modal montado no queda nada pendiente; el efecto solo
    // existe para que el hash de la previsualización no sobreviva a un cambio.
  }, [preview?.previewHash]);

  async function submit() {
    if (!preview || !keepId || !dropId) return;
    setBusy(true);
    setError(undefined);
    try {
      const merged = await albumMergeApi.merge(keepId, {
        dropId, previewHash: preview.previewHash,
        ...(Object.keys(choices).length ? { fieldChoices: choices } : {}),
        keepDropNameAsAlias, mode, note: note.trim(),
        ...(mode === "append" ? {
          keepDiscTitle: keepDiscTitle.trim() || null,
          dropDiscTitle: dropDiscTitle.trim() || null,
          ...(pageTitle.trim() && pageTitle.trim() !== preview.keep.title ? { title: pageTitle.trim() } : {}),
        } : {}),
      });
      notify("success", mode === "append"
        ? `«${preview.drop.title}» quedó como ${dropDiscTitle.trim() ? `«${dropDiscTitle.trim()}»` : "disco siguiente"} de «${pageTitle.trim() || preview.keep.title}».`
        : `Discos fusionados: «${preview.drop.title}» → «${preview.keep.title}» (${plural(merged.tracksMerged + merged.tracksMoved, "pista movida o unificada", "pistas movidas o unificadas")}).`);
      setResult(merged);
      onApplied?.();
      setBusy(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "stale_preview") {
        setStale(true);
        setChoices({});
        void load(preview.keep.id, preview.drop.id, "first", mode);
      } else {
        setError(err instanceof Error ? err.message : "No se pudo fusionar.");
      }
      setBusy(false);
    }
  }


  return (
    <Modal title={result ? "Fusión completada" : "Fusionar discos"} onClose={onClose} wide>
      {result ? (
        <>
          {mode === "append" ? (
            <p style={{ fontSize: 14, margin: "0 0 10px" }}>
              «{preview?.drop.title}» es ahora {dropDiscTitle.trim() ? `«${dropDiscTitle.trim()}»` : "el disco siguiente"} de
              {" "}«{pageTitle.trim() || preview?.keep.title}»: {plural(result.tracksMoved, "pista sumada", "pistas sumadas")}, con su propia lista
              {" "}y su video en la misma página.
            </p>
          ) : (
          <p style={{ fontSize: 14, margin: "0 0 10px" }}>
            «{preview?.drop.title}» se fusionó en «{preview?.keep.title}»: {plural(result.tracksMerged, "pista unificada", "pistas unificadas")},
            {" "}{plural(result.tracksMoved, "pista movida", "pistas movidas")}, {plural(result.creditsMerged, "crédito unificado", "créditos unificados")} y
            {" "}{plural(result.formatsMerged, "formato unificado", "formatos unificados")}
            {result.fieldsCorrected.length ? `; campos corregidos: ${result.fieldsCorrected.map((field) => FIELD_LABELS[field] ?? field).join(", ")}` : ""}.
          </p>
          )}
          <p className="hint">El id del disco que desapareció ya lleva al que quedó (redirección). Los enlaces de medios se repuntaron.</p>
          <p className="hint">
            ¿Fue un error? Al cerrar queda a la vista la barra «Deshacer» de este cambio; también está en el Historial.
          </p>
          {error ? <p className="form-error-banner" style={{ marginTop: 12 }} role="alert">{error}</p> : null}
          <div className="form-actions">
            <button type="button" className="btn btn--primary" onClick={() => onMerged(result.keepId)}>Ir al disco</button>
          </div>
        </>
      ) : dropId === null ? (
        <div className="field">
          <EntityPicker
            kind="album"
            label={`¿Con qué disco se fusiona «${albumTitle}»?`}
            value={dropId}
            valueLabel={dropLabel}
            onSelect={chooseOther}
            placeholder="Título del otro disco…"
          />
          <span className="hint">Se compara antes de tocar nada; el disco que desaparece queda redirigido al que se conserve.</span>
          {error ? <p className="form-error-banner" role="alert" style={{ marginTop: 10 }}>{error}</p> : null}
        </div>
      ) : (
        <>
          {loading ? <p className="hint" role="status">Calculando previsualización…</p> : null}
          {stale ? (
            <p className="form-error-banner" role="alert" style={{ marginBottom: 12 }}>
              El disco cambió; revisa de nuevo antes de fusionar.
            </p>
          ) : null}
          {error ? <p className="form-error-banner" role="alert" style={{ marginBottom: 12 }}>{error}</p> : null}

          {preview ? (
            <>
              <div className="compare-grid" style={{ marginBottom: 14 }}>
                {([["keep", preview.keep], ["drop", preview.drop]] as const).map(([role, side]) => (
                  <div className="compare-side" key={role}>
                    <h4>{role === "keep" ? "Disco que queda" : "Disco que desaparece"}{side.id === preview.recommendedKeepId ? " · recomendado" : ""}</h4>
                    <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{side.title}</p>
                    <p className="hint" style={{ margin: 0 }}>{side.artistName}{side.labelName ? ` · ${side.labelName}` : ""}</p>
                    <p className="hint" style={{ margin: "4px 0 0" }}>
                      {side.counts.tracks} pistas · {side.counts.albumCredits} créditos · {side.counts.formats} formatos · {side.counts.mediaLinks} enlaces · {side.counts.claims} claims
                    </p>
                    {side.aliases.length ? <p className="hint" style={{ margin: "6px 0 0" }}>Alias: {side.aliases.join(", ")}</p> : null}
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <button type="button" className="btn btn--sm" onClick={swap} disabled={busy || loading}>
                  Intercambiar (queda «{preview.drop.title}»)
                </button>
              </div>

              <fieldset className="merge-mode">
                <legend>¿Qué son estas dos fichas?</legend>
                {([
                  ["match", "El mismo disco", "Se emparejan las pistas y queda una sola lista."],
                  ["append", "Partes de un mismo disco", `«${preview.drop.title}» se suma como disco siguiente (Lado B, CD 2, B-Sides, DVD…), con su lista y su video.`],
                ] as const).map(([value, label, help]) => (
                  <label key={value} className={`merge-mode__option${mode === value ? " is-active" : ""}`}>
                    <input type="radio" name="album-merge-mode" checked={mode === value} disabled={busy || loading} onChange={() => changeMode(value)} />
                    <span>
                      <strong>{label}</strong>{preview.suggestion.mode === value ? <span className="merge-mode__badge">sugerido</span> : null}
                      <span className="hint">{help}</span>
                    </span>
                  </label>
                ))}
                <p className="hint" style={{ margin: "6px 0 0" }}>{preview.suggestion.reason}</p>
              </fieldset>

              {mode === "append" ? (
                <div className="merge-discs">
                  <h4>Cómo quedará la página</h4>
                  <div className="field">
                    <label htmlFor="album-merge-title">Título de la página</label>
                    <input
                      id="album-merge-title" type="text" value={pageTitle} placeholder={preview.keep.title}
                      onChange={(event) => setPageTitle(event.target.value)}
                    />
                    <span className="hint">Vacío lo deja como está; si cambia, «{preview.keep.title}» queda como alias.</span>
                  </div>
                  <ol>
                    {([["keep", preview.keep, 0], ["drop", preview.drop, preview.discOffset]] as const).flatMap(([role, side, offset]) => {
                      const single = side.discs.length <= 1;
                      const discs = side.discs.length ? side.discs : [{ discNumber: 1, title: null, trackCount: 0, hasVideo: false }];
                      return discs.map((disc, index) => {
                        const number = disc.discNumber + offset;
                        const video = disc.hasVideo ? "video propio"
                          : index === 0 && side.fields["youtube_url"] ? (role === "keep" ? "video de la ficha" : "su video pasa a este disco")
                          : role === "keep" ? null : "sin video propio";
                        return (
                          <li key={`${role}-${disc.discNumber}`} className={role === "drop" ? "is-new" : undefined}>
                            <span className="merge-discs__number">Disco {number}</span>
                            {single ? (
                              <input
                                type="text" aria-label={`Nombre del disco ${number}`}
                                value={role === "keep" ? keepDiscTitle : dropDiscTitle}
                                placeholder={disc.title ?? (role === "keep" ? "Sin nombre" : `Disco ${number}`)}
                                onChange={(event) => (role === "keep" ? setKeepDiscTitle : setDropDiscTitle)(event.target.value)}
                              />
                            ) : <span className="merge-discs__name">{disc.title ?? `Disco ${number}`}</span>}
                            <span className="hint">{plural(disc.trackCount, "pista", "pistas")}{video ? ` · ${video}` : ""}</span>
                          </li>
                        );
                      });
                    })}
                  </ol>
                </div>
              ) : null}

              {preview.warnings.length ? (
                <div className="alert-block" role="alert" style={{ marginBottom: 14 }}>
                  <strong>Avisos</strong>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              ) : null}

              {mode === "match" && preview.matchedTracks.length ? (
                <div className="table-wrap table-wrap--scroll" style={{ marginBottom: 14 }}>
                  <table>
                    <caption className="visually-hidden">Pistas emparejadas entre los dos discos</caption>
                    <thead><tr><th scope="col">Pista que queda</th><th scope="col">Pista que desaparece</th><th scope="col">Empate</th></tr></thead>
                    <tbody>
                      {preview.matchedTracks.map((match) => (
                        <tr key={`${match.keepTrackId}-${match.dropTrackId}`}>
                          <td>{match.discNumber}.{match.keepTrackNumber} {match.keepTitle}</td>
                          <td>{match.discNumber}.{match.dropTrackNumber} {match.dropTitle}</td>
                          <td className="hint">{MATCH_LABEL[match.matchType]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {mode === "match" && preview.unmatchedDropTracks.length ? (
                <p style={{ fontSize: 13.5, margin: "0 0 12px" }}>
                  Se moverán al disco que queda sus {plural(preview.unmatchedDropTracks.length, "pista sin pareja", "pistas sin pareja")}:
                  {" "}{preview.unmatchedDropTracks.map((track) => `«${track.title}»`).join(", ")}.
                </p>
              ) : null}

              {preview.fieldConflicts.length ? (
                <div className="table-wrap table-wrap--scroll" style={{ marginBottom: 14 }}>
                  <table>
                    <caption className="visually-hidden">Campos en conflicto entre los dos discos</caption>
                    <thead><tr><th scope="col">Campo</th><th scope="col">Queda</th><th scope="col">Desaparece</th><th scope="col">Decisión</th></tr></thead>
                    <tbody>
                      {preview.fieldConflicts.map((conflict) => (
                        <tr key={conflict.field}>
                          <td>{FIELD_LABELS[conflict.field] ?? conflict.field}</td>
                          <td>{formatMergeValue(conflict.keepValue)}</td>
                          <td>{formatMergeValue(conflict.dropValue)}</td>
                          <td>
                            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                              <legend className="visually-hidden">Decisión para {FIELD_LABELS[conflict.field] ?? conflict.field}</legend>
                              {TEXT_FIELDS.has(conflict.field) ? (
                                <label style={{ display: "block", fontSize: 12.5 }}>
                                  <input
                                    type="radio" name={`album-merge-${conflict.field}`}
                                    checked={choices[conflict.field] === undefined}
                                    onChange={() => setChoices((current) => {
                                      const { [conflict.field]: _dropped, ...rest } = current;
                                      return rest;
                                    })}
                                  /> Unir las dos{conflict.field === "description" ? " (la IA las reescribe después)" : ""}
                                </label>
                              ) : null}
                              <label style={{ display: "block", fontSize: 12.5 }}>
                                <input
                                  type="radio" name={`album-merge-${conflict.field}`}
                                  checked={TEXT_FIELDS.has(conflict.field) ? choices[conflict.field] === "keep" : (choices[conflict.field] ?? "keep") === "keep"}
                                  onChange={() => setChoices((current) => ({ ...current, [conflict.field]: "keep" }))}
                                /> Conservar: {formatMergeValue(conflict.keepValue)}
                              </label>
                              <label style={{ display: "block", fontSize: 12.5 }}>
                                <input
                                  type="radio" name={`album-merge-${conflict.field}`}
                                  checked={choices[conflict.field] === "drop"}
                                  onChange={() => setChoices((current) => ({ ...current, [conflict.field]: "drop" }))}
                                /> Usar: {formatMergeValue(conflict.dropValue)}
                              </label>
                              {!TEXT_FIELDS.has(conflict.field) ? <span className="hint" style={{ fontSize: 11.5 }}>El otro valor queda anotado en Notas.</span> : null}
                            </fieldset>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {preview.fieldsFilledFromDrop.length ? (
                <p className="hint" style={{ marginBottom: 12 }}>Se completan campos vacíos: {preview.fieldsFilledFromDrop.map((field) => FIELD_LABELS[field] ?? field).join(", ")}.</p>
              ) : null}
              {preview.formatsToAdd.length ? (
                <p className="hint" style={{ marginBottom: 12 }}>Formatos que se añadirán: {preview.formatsToAdd.map((format) => format.format).join(", ")}.</p>
              ) : null}
              {preview.sharedCredits.length ? (
                <p className="hint" style={{ marginBottom: 12 }}>
                  Créditos ya presentes en ambos (no se duplican): {preview.sharedCredits.map((credit) => `${credit.role} — ${credit.targetName}`).join("; ")}.
                </p>
              ) : null}

              <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: "0 0 12px" }}>
                «{preview.drop.title}» dejará de existir y su enlace llevará a «{preview.keep.title}».
              </p>

              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 12 }}>
                <input type="checkbox" checked={keepDropNameAsAlias} onChange={(event) => setKeepDropNameAsAlias(event.target.checked)} />
                Guardar «{preview.drop.title}» como alias de «{preview.keep.title}»
              </label>

              <div className="field">
                <label htmlFor="album-merge-note">Motivo *</label>
                <textarea
                  id="album-merge-note" rows={3} value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={mode === "append" ? "Por qué son partes del mismo disco (queda en la auditoría)" : "Por qué son el mismo disco (queda en la auditoría)"}
                />
              </div>

              <div className="form-actions">
                <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
                <button
                  type="button" className="btn btn--danger"
                  onClick={submit}
                  disabled={busy || loading || !note.trim()}
                >
                  {busy ? "Fusionando…" : mode === "append"
                    ? `Sumar «${preview.drop.title}» como ${dropDiscTitle.trim() ? `«${dropDiscTitle.trim()}»` : `disco ${preview.discOffset + 1}`}`
                    : `Fusionar «${preview.drop.title}» en «${preview.keep.title}»`}
                </button>
              </div>
            </>
          ) : null}
          {!loading && !preview && !error ? <p className="hint">Sin previsualización.</p> : null}
        </>
      )}
    </Modal>
  );
}
