import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ArrowSquareOut, Check, CheckSquare, Clock, Disc, ImageSquare, List, MagnifyingGlass, SkipForward, Users, Warning, X } from "@phosphor-icons/react";
import type { ClaimReviewChange, ClaimReviewDetail, ClaimReviewEntity, ClaimReviewResult } from "../../../src/shared/claim-review";
import { ApiError, claimReviewApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useOperator } from "../lib/OperatorContext";
import { useCurationSummary } from "./CurationLayout";
import { useToast } from "../lib/ToastContext";
import { saveCurationResume } from "../lib/curationResume";
import { fieldLabel, formatCount } from "../lib/curation";
import { albumTypeLabel, artistTypeLabel, confidenceLabel, entityKindLabel, organizationTypeLabel } from "../lib/labels";
import { entityHref } from "../lib/routes";
import { mediaImage } from "../lib/media";
import { ErrorState } from "../components/StateViews";
import { RowsSkeleton } from "../components/Skeletons";
import { ReviewDecisionDialog } from "../components/ReviewDecisionDialog";
import { UndoDialog } from "../components/UndoDialog";
import "../styles/claim-review.css";

const PAGE_SIZE = 20;
const CHANGE_SIZE = 50;
const BUCKETS = [{ key: "all",label: "Todos" },{ key: "candidate",label: "Aportes nuevos" },{ key: "conflict",label: "Contradicciones" }] as const;
function imageUrl(value: unknown): string | null {
  return typeof value === "string" && /^(https?:\/\/|\/(?!\/))/u.test(value) ? value : null;
}
function EntityPicture({ entity, large = false }: { entity: ClaimReviewEntity; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = imageUrl(entity.imageUrl);
  const Icon = entity.kind === "album" || entity.kind === "track" ? Disc : Users;
  return <span className={`claim-picture${large ? " claim-picture--large" : ""}`}>
    {url && !failed ? <img {...mediaImage(url,large ? 160 : 56)} src={mediaImage(url,large ? 160 : 56).src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <Icon size={large ? 44 : 24} aria-hidden="true" />}
  </span>;
}
function textValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Sin dato";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (field === "album_type" && typeof value === "string") return albumTypeLabel(value);
  if (field === "artist_type" && typeof value === "string") return artistTypeLabel(value);
  if (field === "organization_type" && typeof value === "string") return organizationTypeLabel(value);
  if ((field === "duration_seconds" || field === "youtube_start_seconds") && typeof value === "number") return `${Math.floor(value / 60)}:${String(value % 60).padStart(2,"0")}`;
  if (Array.isArray(value)) return value.map(item => textValue(field,item)).join(" · ");
  if (typeof value === "object") return Object.entries(value).map(([key,item]) => `${fieldLabel(key)}: ${textValue(key,item)}`).join(" · ");
  return String(value);
}
function ReviewValue({ field, value }: { field: string; value: unknown }) {
  const [failed, setFailed] = useState(false);
  const url = /(?:picture|cover|logo)_url/u.test(field) ? imageUrl(value) : null;
  if (url) return <div className="claim-value-image">{failed ? <ImageSquare size={32} aria-label="Imagen no disponible" /> : <img {...mediaImage(url,160)} src={mediaImage(url,160).src} alt="Imagen para comparar" loading="lazy" onError={() => setFailed(true)} />}
    <a href={url} target="_blank" rel="noopener noreferrer">Ampliar <ArrowSquareOut size={14} aria-hidden="true" /></a></div>;
  const text = textValue(field,value);
  return text.length > 220 ? <details className="claim-long-value"><summary>{text.slice(0,160)}… <span>Leer completo</span></summary><p>{text}</p></details>
    : <span className={value === null || value === undefined || value === "" ? "claim-value-empty" : ""}>{text}</span>;
}
function webUrl(url: string | null): string | null { return url && /^https?:\/\//u.test(url) ? url : null; }
function ChangeEvidence({ change }: { change: ClaimReviewChange }) {
  const evidence = change.evidence;
  const urls = [...new Set(evidence.map(item => webUrl(item.url)).filter((url): url is string => Boolean(url)))];
  const source = urls[0] ?? webUrl(change.sourceUrl);
  return <details className="claim-evidence" open={change.status === "conflict" ? true : undefined}>
    <summary><span>{change.sourceName}</span><span>Ver evidencia</span></summary>
    <div>
      {evidence.filter(item => item.excerpt).map((item,index) => <blockquote key={index}>{item.excerpt}</blockquote>)}
      {source ? <a href={source} target="_blank" rel="noopener noreferrer">Abrir fuente <ArrowSquareOut size={13} aria-hidden="true" /></a> : <p>Sin enlace web registrado.</p>}
      {urls.slice(1).map(url => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">Otra evidencia</a></p>)}
      <p className="form-note">Confianza del aporte: {confidenceLabel(change.confidence)} · Aporte #{change.id}</p>
    </div>
  </details>;
}

export function ClaimReviewPage() {
  const [params,setParams] = useSearchParams();
  const location = useLocation();
  const { user } = useOperator();
  const { refreshSummary } = useCurationSummary();
  const bucket = BUCKETS.find(item => item.key === params.get("bucket"))?.key ?? "all";
  const offset = Math.max(0,Number(params.get("offset")) || 0);
  const q = params.get("q") ?? "";
  const kind = params.get("kind") ?? "";
  const [search,setSearch] = useState(q);
  const [mobileDetail,setMobileDetail] = useState(Boolean(params.get("case")));
  const queue = useAsync(signal => claimReviewApi.groups({ limit: PAGE_SIZE,offset,bucket,q,kind },signal),[offset,bucket,q,kind]);
  const requestedId = Number(params.get("case")) || 0;
  const activeId = queue.data?.data.some(item => item.id === requestedId) ? requestedId : queue.data?.data[0]?.id ?? 0;
  const [changeOffset,setChangeOffset] = useState(0);
  const detail = useAsync(signal => activeId ? claimReviewApi.group(activeId,{ limit: CHANGE_SIZE,offset: changeOffset,bucket },signal) : Promise.resolve(null),[activeId,changeOffset,bucket]);
  const [reviewId,setReviewId] = useState<number | null>(null);
  const [undoRun,setUndoRun] = useState<number | null>(null);
  const [lastRun,setLastRun] = useState<number | null>(null);
  const [sessionResolved,setSessionResolved] = useState(0);
  const [problem,setProblem] = useState<string | null>(null);
  const [notice,setNotice] = useState<string | null>(null);
  const activeIndex = queue.data?.data.findIndex(item => item.id === activeId) ?? -1;
  const [deciding,setDeciding] = useState(false);
  const busyNavigation = queue.loading || detail.loading || deciding;
  useEffect(() => { setSearch(q); },[q]);
  useEffect(() => {
    if (!queue.loading && queue.data && !queue.data.data.length && queue.data.pagination.total > 0 && offset > 0) {
      setParams(current => { const next = new URLSearchParams(current);next.set("offset",String(Math.floor((queue.data!.pagination.total-1)/PAGE_SIZE)*PAGE_SIZE));next.delete("case");return next; },{ replace: true });
    }
  },[queue.loading,queue.data,offset,setParams]);
  useEffect(() => { setChangeOffset(0); },[activeId,bucket]);
  useEffect(() => { if (user) saveCurationResume(user.username,`${location.pathname}${location.search}`); },[user,location.pathname,location.search]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search.trim() === q) return;
      setParams(current => { const next = new URLSearchParams(current); if (search.trim()) next.set("q",search.trim()); else next.delete("q"); next.delete("offset");next.delete("case");return next; },{ replace: true });
    },300);
    return () => window.clearTimeout(timer);
  },[search,q,setParams]);
  function update(values: Record<string,string>) {
    setParams(current => { const next = new URLSearchParams(current);for (const [key,value] of Object.entries(values)) { if (value) next.set(key,value);else next.delete(key); } next.delete("offset");next.delete("case");return next; });
    setMobileDetail(false);
  }
  const activate = useCallback((id: number) => {
    setChangeOffset(0);setMobileDetail(true);
    setParams(current => { const next = new URLSearchParams(current);next.set("case",String(id));return next; },{ replace: true });
  },[setParams]);
  const move = useCallback((delta: number) => {
    const data = queue.data;
    if (!data) return;
    const nextIndex = activeIndex + delta;
    const item = data.data[nextIndex];
    if (item) { activate(item.id);return; }
    const nextOffset = offset + (delta > 0 ? PAGE_SIZE : -PAGE_SIZE);
    if (nextOffset < 0 || nextOffset >= data.pagination.total) return;
    setChangeOffset(0);
    setParams(current => { const next = new URLSearchParams(current);next.set("offset",String(nextOffset));next.delete("case");return next; },{ replace: true });
  },[queue.data,activeIndex,offset,activate,setParams]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busyNavigation || reviewId || undoRun || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if ((event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable='true']")) return;
      if (event.key === "j" || event.key === "k") { event.preventDefault();move(event.key === "j" ? 1 : -1); }
    };
    document.addEventListener("keydown",onKey);return () => document.removeEventListener("keydown",onKey);
  },[busyNavigation,reviewId,undoRun,move]);
  function refresh() { detail.reload();queue.reload();void refreshSummary(); }
  function decided(result: ClaimReviewResult) {
    setProblem(null);
    setLastRun(result.runId);
    setSessionResolved(current => current + result.accepted + result.rejected);
    setNotice(`${result.accepted ? `${result.accepted} aceptados. ` : ""}${result.rejected ? `${result.rejected} descartados. ` : ""}${result.pending ? `${result.pending} necesitan más revisión.` : ""}`);
    // Solo avanzar cuando no quedan aportes sin seleccionar en esta ficha.
    const remaining = (detail.data?.pagination.total ?? 0) - result.accepted - result.rejected;
    if (remaining > 0 || result.pending) {
      const resolvedIds = new Set(result.results.filter(item => item.action !== "pending").map(item => item.id));
      const pending = detail.data?.changes.find(item => !resolvedIds.has(item.id));
      if (pending) activate(pending.id);
    }
    if (remaining === 0 && !result.pending) {
      const next = queue.data?.data[activeIndex + 1] ?? queue.data?.data[activeIndex - 1];
      if (next) activate(next.id);
      else if (offset > 0) setParams(current => { const nextParams = new URLSearchParams(current);nextParams.set("offset",String(Math.max(0,offset-PAGE_SIZE)));nextParams.delete("case");return nextParams; },{ replace: true });
    }
    setChangeOffset(0);refresh();
  }
  const shown = !detail.loading && !detail.error && detail.data?.group.id === activeId ? detail.data : null;
  return <div className="claim-review">
    <header className="claim-review__header"><div><h2>Revisar aportes</h2><p>Reconoce la ficha, compara el dato y decide.</p></div>
      <div className="claim-review__session"><CheckSquare size={18} aria-hidden="true" /><span>{formatCount(sessionResolved)} resueltos en esta sesión</span>{lastRun ? <button type="button" className="text-link" onClick={() => setUndoRun(lastRun)}>Deshacer</button> : null}</div>
    </header>
    <div className="claim-review__tools">
      <div className="segmented" role="group" aria-label="Aportes por revisar">{BUCKETS.map(item => <button key={item.key} type="button" className="segmented__option" aria-pressed={bucket === item.key} disabled={deciding} onClick={() => update({ bucket: item.key })}>{item.label}</button>)}</div>
      <label className="claim-review__search"><MagnifyingGlass size={18} aria-hidden="true" /><span className="visually-hidden">Buscar aportes por nombre o ID</span><input type="search" maxLength={200} disabled={deciding} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar una ficha…" /></label>
      <label><span className="visually-hidden">Tipo de ficha</span><select value={kind} disabled={deciding} onChange={event => update({ kind: event.target.value })}><option value="">Todas las fichas</option>{["artist","person","album","track","organization","artist_membership","album_credit","track_credit","album_format","person_organization","media_link"].map(value => <option key={value} value={value}>{kindLabel(value)}</option>)}</select></label>
    </div>
    {problem ? <div className="claim-review__notice" role="alert"><Warning size={18} aria-hidden="true" /><span>{problem}</span><button type="button" className="text-link" onClick={() => setProblem(null)}>Cerrar</button></div> : null}
    {notice ? <div className="claim-review__notice" role="status"><Check size={18} aria-hidden="true" /><span>{notice}</span><button type="button" className="text-link" onClick={() => setNotice(null)}>Cerrar</button></div> : null}
    {queue.error ? <ErrorState message={queue.error} onRetry={queue.reload} /> : queue.loading ? <RowsSkeleton rows={4} height={90} label="Cargando fichas pendientes…" /> : !queue.data?.data.length ? <div className="claim-review__empty"><CheckSquare size={42} aria-hidden="true" /><h3>{q || kind ? "No hay aportes con estos filtros" : "Esta bandeja está al día"}</h3><p>{q || kind ? "Prueba otro nombre o tipo de ficha." : "Los nuevos aportes aparecerán aquí para revisarlos."}</p>{q || kind ? <button className="btn" onClick={() => { setSearch("");update({ q: "",kind: "" }); }}>Limpiar filtros</button> : null}</div> : <>
      <div className="claim-review__count">{formatCount(queue.data.claims)} aportes en {formatCount(queue.data.pagination.total)} fichas <span>· J / K para cambiar de ficha</span></div>
      <div className={`claim-desk${mobileDetail ? " claim-desk--detail" : ""}`}>
        <aside className="claim-desk__queue" aria-label="Fichas pendientes"><ol>{queue.data.data.map(group => <li key={group.id}>
          <button type="button" aria-current={activeId === group.id ? "true" : undefined} disabled={deciding} onClick={() => activate(group.id)}><EntityPicture key={group.entity.imageUrl} entity={group.entity} /><span className="claim-desk__item-text"><strong>{group.entity.name.split("::").at(-1)}</strong><span>{group.entity.context || kindLabel(group.entity.kind)}</span><span className="claim-desk__item-meta">{group.pending} {group.pending === 1 ? "aporte" : "aportes"}{group.conflicts > 0 ? <><Warning size={13} aria-hidden="true" /> {group.conflicts} en conflicto</> : null}</span></span></button>
        </li>)}</ol><div className="claim-desk__paging"><button className="btn btn--sm" disabled={offset === 0 || busyNavigation} onClick={() => { setParams(current => { const next = new URLSearchParams(current);next.set("offset",String(Math.max(0,offset-PAGE_SIZE)));next.delete("case");return next; }); }}><ArrowLeft size={16} aria-hidden="true" /> Anteriores</button><span>{Math.floor(offset/PAGE_SIZE)+1} / {Math.ceil(queue.data.pagination.total/PAGE_SIZE)}</span><button className="btn btn--sm" disabled={offset+PAGE_SIZE>=queue.data.pagination.total || busyNavigation} onClick={() => { setParams(current => { const next = new URLSearchParams(current);next.set("offset",String(offset+PAGE_SIZE));next.delete("case");return next; }); }}>Más <ArrowRight size={16} aria-hidden="true" /></button></div></aside>
        <section className="claim-desk__detail" aria-label="Aportes de la ficha">
          <div className="claim-desk__navigation"><button type="button" className="btn btn--sm claim-desk__back" onClick={() => setMobileDetail(false)}><List size={16} aria-hidden="true" /> Fichas</button><span>Ficha {formatCount(offset+activeIndex+1)} de {formatCount(queue.data.pagination.total)}</span><button type="button" className="btn btn--sm" disabled={busyNavigation || offset+activeIndex+1>=queue.data.pagination.total} onClick={() => move(1)} title="Mantiene los aportes pendientes"><SkipForward size={16} aria-hidden="true" /> Dejar pendiente</button></div>
          {detail.error ? <ErrorState message={detail.error} onRetry={detail.reload} /> : !shown ? <RowsSkeleton rows={3} height={100} label="Cargando los datos de esta ficha…" /> : <ClaimGroup key={`${shown.group.id}:${changeOffset}:${bucket}`} detail={shown} onDecided={decided} onReview={setReviewId} onStale={message => { setProblem(message);refresh(); }} onBusy={setDeciding} />}
          {shown && shown.pagination.total > CHANGE_SIZE ? <div className="claim-desk__paging"><button className="btn" disabled={deciding || changeOffset === 0} onClick={() => setChangeOffset(current => Math.max(0,current-CHANGE_SIZE))}>Datos anteriores</button><span>{changeOffset+1}–{Math.min(changeOffset+CHANGE_SIZE,shown.pagination.total)} de {shown.pagination.total}</span><button className="btn" disabled={deciding || changeOffset+CHANGE_SIZE>=shown.pagination.total} onClick={() => setChangeOffset(current => current+CHANGE_SIZE)}>Más datos</button></div> : null}
        </section>
      </div>
    </>}
    {reviewId ? <ReviewDecisionDialog reviewId={reviewId} onClose={() => setReviewId(null)} onDone={result => { setLastRun(result.runId);refresh(); }} /> : null}
    {undoRun ? <UndoDialog runId={undoRun} onClose={() => setUndoRun(null)} onDone={() => { setSessionResolved(0);setNotice("Decisión deshecha. Los aportes se han vuelto a consultar.");refresh(); }} /> : null}
  </div>;
}
function kindLabel(kind: string): string {
  return ({ artist_membership: "Membresías",album_credit: "Créditos de disco",track_credit: "Créditos de pista",album_format: "Formatos",person_organization: "Personas y organizaciones",media_link: "Enlaces" } as Record<string,string>)[kind] ?? entityKindLabel(kind);
}

function ClaimGroup({ detail,onDecided,onReview,onStale,onBusy }: { detail: ClaimReviewDetail;onDecided: (result: ClaimReviewResult) => void;onReview: (id: number) => void;onStale: (message: string) => void;onBusy: (value: boolean) => void }) {
  const { notify } = useToast();
  const [selected,setSelected] = useState<Set<number>>(new Set());
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [reasons,setReasons] = useState("");
  const [customNote,setCustomNote] = useState("");
  const [remaining,setRemaining] = useState<Record<number,string>>({});
  const visible = detail.changes;
  const selectedChanges = visible.filter(change => selected.has(change.id));
  const canAccept = selectedChanges.length > 0 && selectedChanges.every(change => change.canAccept);
  const canReject = selectedChanges.length > 0 && selectedChanges.every(change => change.canReject);
  const selectable = visible.filter(change => change.canAccept || change.canReject);
  const selectionRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (selectionRef.current) selectionRef.current.indeterminate = selected.size > 0 && selected.size < selectable.length; },[selected.size,selectable.length]);
  const actionLock = useRef(false);
  useEffect(() => { setSelected(new Set()); },[detail]);
  function toggle(change: ClaimReviewChange) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(change.id)) next.delete(change.id);
      else {
        // Elegir una alternativa no puede aceptar también su valor rival.
        for (const other of visible) if (other.field === change.field && JSON.stringify(other.value) !== JSON.stringify(change.value)) next.delete(other.id);
        next.add(change.id);
      }
      return next;
    });
  }
  async function decide(action: "accept" | "reject", changes = selectedChanges) {
    if (actionLock.current || !changes.length) return;
    actionLock.current = true;setBusy(true);onBusy(true);setError(null);
    try {
      const note = [action === "accept" ? "Aceptación de los aportes seleccionados en revisión visual" : "Descarte de los aportes seleccionados en revisión visual",reasons,customNote.trim()].filter(Boolean).join(". ");
      const result = await claimReviewApi.decide({ groupId: detail.group.id,claims: changes.map(change => ({ id: change.id,version: change.version })),action,note });
      setRemaining(Object.fromEntries(result.results.filter(item => item.action === "pending").map(item => [item.id,item.detail])));
      setSelected(new Set());onDecided(result);
      notify(result.pending ? "info" : "success",result.pending ? "Algunos aportes necesitan más revisión y siguen pendientes." : "Decisión guardada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar. Vuelve a intentarlo.");
      if (cause instanceof ApiError && cause.code === "stale_preview") onStale(cause.message);
    } finally { actionLock.current = false;setBusy(false);onBusy(false); }
  }
  const entity = detail.group.entity;
  const href = entity.id !== null && ["artist","person","album","track","organization"].includes(entity.kind) ? entityHref(entity.kind as "artist" | "person" | "album" | "track" | "organization",entity.id,entity.albumId ?? undefined) : null;
  const alternativeValues = new Map<string,Set<string>>();
  for (const change of selectable) { const values = alternativeValues.get(change.field) ?? new Set<string>(); values.add(JSON.stringify(change.value)); alternativeValues.set(change.field,values); }
  const hasAlternatives = [...alternativeValues.values()].some(values => values.size > 1);
  return <div className="claim-group" aria-busy={busy}>
    <header className="claim-group__identity"><EntityPicture key={entity.imageUrl} entity={entity} large /><div><span className="claim-group__kind">{kindLabel(entity.kind)}{entity.id === null ? " · Ficha por identificar" : ""}</span><h3>{entity.name.split("::").at(-1)}</h3><p>{entity.context || entity.name.split("::").slice(0,-1).join(" · ") || "Revisa los datos y su procedencia."}</p>{href ? <Link to={href} target="_blank" rel="noopener noreferrer">Abrir ficha <ArrowSquareOut size={14} aria-hidden="true" /></Link> : null}</div></header>
    {visible.length ? <>
      <div className="claim-group__selection"><strong>{formatCount(detail.pagination.total)} {detail.pagination.total === 1 ? "aporte por revisar" : "aportes por revisar"}</strong>{selectable.length > 1 && !hasAlternatives ? <label><input ref={selectionRef} type="checkbox" disabled={busy} checked={selectable.length > 0 && selected.size === selectable.length} onChange={event => setSelected(event.target.checked ? new Set(selectable.map(change => change.id)) : new Set())} /> Seleccionar {selectable.length} visibles</label> : <span>Elige los datos que quieres resolver</span>}</div>
      <div className="claim-changes">{visible.map(change => {
        const same = change.hasCurrentField && JSON.stringify(change.currentValue) === JSON.stringify(change.value);
        const conflict = change.status === "conflict";
        return <article key={change.id} className={`claim-change${selected.has(change.id) ? " is-selected" : ""}${conflict ? " claim-change--conflict" : ""}`}>
          <header><label>{change.canAccept || change.canReject ? <input type="checkbox" checked={selected.has(change.id)} disabled={busy} onChange={() => toggle(change)} aria-label={`Seleccionar ${fieldLabel(change.field)}: ${textValue(change.field,change.value)}`} /> : null}<strong>{fieldLabel(change.field)}</strong></label><span className="claim-change__state">{conflict ? <><Warning size={14} aria-hidden="true" /> En conflicto</> : same ? <><Check size={14} aria-hidden="true" /> Coincide</> : change.hasCurrentField && change.currentValue !== null ? "Cambio propuesto" : change.hasCurrentField || entity.id === null ? "Dato nuevo" : "Contexto"}</span></header>
          <div className="claim-change__comparison"><div><span className="claim-change__label">En el catálogo</span>{change.hasCurrentField ? <ReviewValue key={`current:${change.id}:${change.version}`} field={change.field} value={change.currentValue} /> : <span className="claim-value-empty">{entity.id === null ? "Ficha por identificar" : "Dato de contexto"}</span>}</div><ArrowRight size={19} className="claim-change__arrow" aria-hidden="true" /><div><span className="claim-change__label">{same ? "La fuente confirma" : "La fuente propone"}</span><ReviewValue key={`proposed:${change.id}:${change.version}`} field={change.field} value={change.value} /></div></div>
          <ChangeEvidence change={change} />
          {remaining[change.id] ? <p className="claim-change__pending" role="status"><Clock size={15} aria-hidden="true" /> {remaining[change.id]}</p> : null}
          <footer>{change.requiresReview && change.reviewId ? <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => onReview(change.reviewId!)}>Comparar y decidir</button> : <>
            {change.canAccept ? <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void decide("accept",[change])}><Check size={16} aria-hidden="true" /> {conflict ? "Elegir este valor" : same ? "Confirmar dato" : "Aceptar dato"}</button> : null}
            {change.canReject ? <button type="button" className="btn btn--sm btn--outline" disabled={busy} onClick={() => void decide("reject",[change])}><X size={16} aria-hidden="true" /> Descartar</button> : null}
            {!change.canAccept && !change.canReject ? <Link to="/curaduria/hallazgos">Abrir revisión detallada</Link> : null}
          </>}</footer>
        </article>;
      })}</div>
      <details className="claim-group__reason"><summary>Añadir un motivo (opcional)</summary><div role="group" aria-label="Motivos frecuentes">{["Dato comprobado","Error de extracción","No corresponde a esta ficha"].map(reason => <button key={reason} type="button" className="note-chip" aria-pressed={reasons === reason} disabled={busy} onClick={() => setReasons(current => current === reason ? "" : reason)}>{reason}</button>)}</div><label>Otra explicación<textarea value={customNote} disabled={busy} maxLength={1600} rows={2} onChange={event => setCustomNote(event.target.value)} /></label></details>
      {error ? <p className="form-error-banner" role="alert">{error}</p> : null}
      {selected.size > 0 ? <div className="claim-group__actions"><span>{selected.size ? `${selected.size} seleccionados` : "Selecciona varios datos para decidir juntos"}</span><div><button type="button" className="btn btn--outline" disabled={busy || !canReject} onClick={() => void decide("reject")}><X size={17} aria-hidden="true" /> Descartar{selected.size ? ` ${selected.size}` : ""}</button><button type="button" className="btn btn--primary" disabled={busy || !canAccept} onClick={() => void decide("accept")}><Check size={17} aria-hidden="true" /> {busy ? "Guardando…" : `Aceptar${selected.size ? ` ${selected.size}` : ""}`}</button></div></div> : null}
    </> : <div className="claim-review__empty"><CheckSquare size={36} aria-hidden="true" /><h3>Esta ficha está revisada</h3><p>Puedes continuar con la siguiente.</p></div>}
  </div>;
}
