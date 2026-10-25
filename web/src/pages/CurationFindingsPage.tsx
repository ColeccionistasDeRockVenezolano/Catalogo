// CRV · Curaduría › una categoría del detector de conflictos.
//
// Los detectores y subgrupos de la categoría salen del resumen de la API: si
// el detector aprende un subgrupo nuevo, aparece aquí como un filtro más sin
// tocar la web. Sin `:key` la página lista hallazgos de todas las categorías
// (la usan los enlaces «nuevos en este análisis» y «surgidos tras corregir»).
//
// Cada tarjeta ofrece la corrección RECOMENDADA como botón principal, con su
// nivel y su consecuencia escritos al lado, y el resto bajo «Otras
// correcciones» (PLAN_CURADURIA E8.1): antes aparecía un «Corregir» genérico
// en hallazgos que no se corrigen así (A2). Todo pasa por la vista previa del
// lote, también cuando es un solo hallazgo.
//
// Ignorar no cambia el catálogo: solo le dice al detector que ese caso no es un
// problema, con un motivo (falso positivo, correcto a propósito, fuera de
// alcance). Dura mientras el detector lo siga viendo; si el problema desaparece,
// el hallazgo pasa a resuelto. «Son distintas» hace lo mismo para un par de
// fichas repetidas, y sobrevive aunque cambie el grupo. «Marcar como revisado»
// (E8.7) tampoco cierra nada: quita la marca «apareció al corregir» para que
// esa lista deje de crecer sin fin (M2).
//
// Triaje con teclado (E8.6): j/k mueven, x selecciona, c corrige con la
// recomendada, i ignora, o abre la ficha y ? explica los atajos.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BackLink } from "../components/BackLink";
import {
  ArrowBendDownRight, ArrowCounterClockwise, ArrowSquareOut, CaretDown, CaretUp, CheckCircle, ClockCounterClockwise, DotsThree,
  EyeSlash, Gavel, GitMerge, Keyboard, Lightbulb, NotEquals, Scales, Sparkle, Trash, Wrench,
} from "@phosphor-icons/react";
import {
  albumWrites, artistWrites, ApiError, curationApi, organizationWrites, personWrites, reviewApi, trackWrites,
  type CurationFindingGroupFilter, type CurationFindingQuery, CATALOG_CHANGE_EVENT, type CatalogChangeEvent } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { useMediaQuery } from "../lib/useMediaQuery";
import {
  ENTITY_KIND_LABEL, IGNORE_REASONS, SEVERITY_BADGE, SEVERITY_LABEL, actionConsequence, categoryIcon, fieldLabel, findingPair,
  formatCount, ignoreReasonLabel, lastChangeText, refHref, relativeTime, resolutionText,
} from "../lib/curation";
import { ErrorState, EmptyState } from "../components/StateViews";
import { HeaderSkeleton, RowsSkeleton } from "../components/Skeletons";
import { Pagination } from "../components/Pagination";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CurationValue } from "../components/CurationValue";
import { FindingEvidence, HIDDEN_EVIDENCE } from "../components/FindingEvidence";
import { FixBatchDialog } from "../components/FixBatchDialog";
import { Modal } from "../components/Modal";
import { MergeEntityModal } from "../components/MergeEntityModal";
import { PersonPairWebResearch } from "../components/PersonPairWebResearch";
import { AlbumMergeModal } from "../components/AlbumMergeModal";
import { CurationWorkbench } from "../components/CurationWorkbench";
import { FindingResearch } from "../components/FindingResearch";
import { researchInstruction, researchOf } from "../lib/curationResearch";
import { useOperator } from "../lib/OperatorContext";
import { saveCurationResume } from "../lib/curationResume";
import "../styles/curation-workbench.css";
import { IDENTITY_RECOMMENDATION, personIdentityAssessment } from "../lib/personIdentityAssessment";
import { ReviewDecisionDialog } from "../components/ReviewDecisionDialog";
import { ConflictResolveDialog } from "../components/ConflictResolveDialog";
import { useCurationSummary } from "./CurationLayout";
import type {
  CurationActionSummary, CurationCategorySummary, CurationFinding, CurationFindingStatus, CurationIgnoreReason, CurationPairKind,
  CurationSeverity, CurationSignatureSummary, FixBatch, MergeableKind, PersonWebVerification,
} from "../lib/types";

/** Detectores de «valores en disputa» que E7 cablea en la tarjeta (PLAN_CURADURIA). */
const REVIEW_DETECTOR = "cola_de_revision";
const CONFLICT_DETECTOR = "conflictos_abiertos";

const DEFAULT_LIMIT = 50;
const MOBILE_QUERY = "(max-width: 760px)";
const MERGEABLE_KINDS = new Set<string>(["person", "organization", "artist"]);
const PAIR_KINDS = new Set<string>(["artist", "person", "organization", "album", "track"]);
const ENTITY_WRITE_API: Readonly<Record<string, { remove: (id: number, note?: string) => Promise<unknown> }>> = {
  artist: artistWrites, person: personWrites, organization: organizationWrites, album: albumWrites, track: trackWrites,
};
const STATUSES: Array<{ value: CurationFindingStatus | "all"; label: string }> = [
  { value: "open", label: "Abiertos" },
  { value: "ignored", label: "Ignorados" },
  { value: "resolved", label: "Resueltos" },
  { value: "all", label: "Todos" },
];
const SEVERITIES: CurationSeverity[] = ["high", "medium", "low"];

/** Lo que se corrige a mano escribiendo el valor: solo donde el detector calcula uno. */
const MANUAL_VALUE_ACTION = "limpiar_texto";

/** Atajos del triaje con teclado (E8.6), también la chuleta de «?». */
const SHORTCUTS: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: "j / k", description: "Bajar y subir por los hallazgos" },
  { keys: "x", description: "Seleccionar o quitar el hallazgo enfocado" },
  { keys: "c", description: "Corregir con la acción recomendada" },
  { keys: "i", description: "No es un problema (pide el motivo)" },
  { keys: "o", description: "Abrir la ficha en otra pestaña" },
  { keys: "?", description: "Mostrar esta ayuda" },
];

/** Un hallazgo se puede corregir de un clic si el motor le ofrece alguna acción (A2). */
const isFixable = (finding: CurationFinding) => finding.status === "open" && finding.actions.length > 0;

/** Acción abierta en el diálogo de corrección: la recomendada, otra del menú, o el valor a mano. */
interface FixTarget {
  finding: CurationFinding;
  action: CurationActionSummary | null;
  manual: boolean;
}

export function CurationFindingsPage() {
  const paginationStartRef = useRef<HTMLDivElement>(null);
  const { key: routeKey } = useParams();
  const { summary, summaryError, refreshSummary } = useCurationSummary();
  const { notify } = useToast();
  const [params, setParams] = useSearchParams();
  const { user } = useOperator();
  const key = routeKey ?? params.get("category") ?? undefined;
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [ignoringGroup, setIgnoringGroup] = useState(false);
  const [fixingGroup, setFixingGroup] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [ignoringFinding, setIgnoringFinding] = useState<CurationFinding | null>(null);
  const [distinctFinding, setDistinctFinding] = useState<{ finding: CurationFinding; pair: [number, number] } | null>(null);
  const [fixTarget, setFixTarget] = useState<FixTarget | null>(null);
  const [mergingFinding, setMergingFinding] = useState<{ finding: CurationFinding; kind: MergeableKind; otherId?: number; otherName?: string } | null>(null);
  const [decidingReviewId, setDecidingReviewId] = useState<number | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState<CurationFinding | null>(null);
  const [applyingTrust, setApplyingTrust] = useState(false);
  const [acknowledgingGroup, setAcknowledgingGroup] = useState(false);
  const [deletingFinding, setDeletingFinding] = useState<CurationFinding | null>(null);
  const [sheetFinding, setSheetFinding] = useState<CurationFinding | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [fixingSelected, setFixingSelected] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const pendingIndex = useRef<number | null>(null);
  const [albumMergeFinding, setAlbumMergeFinding] = useState<CurationFinding | null>(null);

  const detector = params.get("detector") ?? "";
  const signature = params.get("signature") ?? "";
  const severity = (params.get("severity") ?? "") as CurationSeverity | "";
  const entityKind = params.get("entityKind") ?? "";
  const status = (params.get("status") ?? "open") as CurationFindingStatus | "all";
  const q = params.get("q") ?? "";
  const scanId = Number(params.get("scanId") ?? "") || undefined;
  const chained = params.get("chained") === "true";
  const offset = Math.max(0, Math.floor(Number(params.get("offset")) || 0));
  const limit = [25, 50, 100].includes(Number(params.get("limit"))) ? Number(params.get("limit")) : DEFAULT_LIMIT;
  const sort = (["priority", "oldest", "newest", "entity"].includes(params.get("sort") ?? "")
    ? params.get("sort") : "priority") as NonNullable<CurationFindingQuery["sort"]>;
  const view = params.get("view") === "cards" ? "cards" : "review";
  const activeId = Number(params.get("case")) || 0;
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);

  const category = key ? summary?.categories.find((item) => item.key === key) : undefined;
  const lastScanId = summary?.lastScan?.id ?? 0;

  const query: CurationFindingQuery = {
    limit, offset, status, sort,
    ...(key ? { category: key } : {}),
    ...(detector ? { detector } : {}),
    ...(signature ? { signature } : {}),
    ...(severity ? { severity } : {}),
    ...(entityKind ? { entityKind } : {}),
    ...(q ? { q } : {}),
    ...(scanId ? { scanId } : {}),
    ...(chained ? { chained: true } : {}),
  };
  const requestKey = JSON.stringify(query);
  const { data: response, loading, error, reload } = useAsync(
    async () => ({ ...await curationApi.findings(query), requestKey }),
    // El último análisis entra en las dependencias: si una corrección vuelve a
    // analizar el catálogo, la lista se actualiza sola.
    [key, detector, signature, severity, entityKind, status, q, scanId, chained, offset, limit, sort, lastScanId],
  );
  // Cambiar de filtro no deja decisiones activas sobre la respuesta anterior.
  const data = response?.requestKey === requestKey ? response : undefined;

  // La selección se ancla al FILTRO, no a la página: pasar a la página 2 no
  // borra lo elegido en la 1 (M5). Cambiar cualquier filtro sí, porque ya no
  // corresponde a lo que se ve.
  useEffect(() => {
    setSelected(new Set());
    setSelectAll(false);
  }, [key, detector, signature, severity, entityKind, status, q, scanId, chained]);

  const rows = data?.data ?? [];
  const focused = Math.max(0, rows.findIndex((finding) => finding.id === activeId));
  const activeFinding = rows[focused];
  const savedParams = params.toString();
  useEffect(() => {
    if (user) saveCurationResume(user.username, `/curaduria/${routeKey ? `categoria/${routeKey}` : "hallazgos"}${savedParams ? `?${savedParams}` : ""}`);
  }, [user, routeKey, savedParams]);

  function activate(index: number) {
    const finding = rows[index];
    if (!finding || loading) return;
    const next = new URLSearchParams(params);
    next.set("case", String(finding.id));
    setParams(next, { replace: true });
  }

  function move(delta: number) {
    if (loading) return;
    const nextIndex = focused + delta;
    if (nextIndex >= 0 && nextIndex < rows.length) { activate(nextIndex); return; }
    const total = data?.pagination.total ?? 0;
    if (nextIndex < 0 && offset > 0) {
      pendingIndex.current = -1;
      update({ offset: String(Math.max(0, offset - limit)) });
    } else if (nextIndex >= rows.length && offset + rows.length < total) {
      pendingIndex.current = 0;
      update({ offset: String(offset + limit) });
    }
  }

  useEffect(() => {
    if (loading || !data) return;
    // Al resolver el último caso de una página, retroceder a la última viva.
    if (offset > 0 && offset >= data.pagination.total) {
      const next = new URLSearchParams(params);
      const lastOffset = Math.max(0, (Math.ceil(data.pagination.total / limit) - 1) * limit);
      if (lastOffset) next.set("offset", String(lastOffset)); else next.delete("offset");
      next.delete("case");
      setParams(next, { replace: true });
      return;
    }
    if (pendingIndex.current === null || !data.data.length) return;
    const index = pendingIndex.current < 0 ? data.data.length - 1 : Math.min(pendingIndex.current, data.data.length - 1);
    pendingIndex.current = null;
    const next = new URLSearchParams(params);
    next.set("case", String(data.data[index]!.id));
    setParams(next, { replace: true });
  }, [loading, data, offset, limit, params, setParams]);

  function toggleSelected(id: number) {
    if (selectAll) {
      // Con «todo el filtro» elegido, desmarcar uno no puede seguir siendo una
      // selección por filtro: se pasa a una selección por ids con lo que se ve
      // y se corrige, menos el que se acaba de quitar. Lo de otras páginas se
      // pierde, y por eso el aviso lo dice.
      setSelectAll(false);
      setSelected(new Set(rows.filter(isFixable).map((row) => row.id).filter((rowId) => rowId !== id)));
      notify("info", "Ya no está seleccionado todo el filtro: ahora solo lo elegido en esta página.");
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value); else next.delete(name);
    }
    if (!("view" in changes)) next.delete("case");
    if (!("offset" in changes) && !("view" in changes)) next.delete("offset");
    setParams(next);
  }

  const afterWrite = useCallback(() => {
    const remaining = data?.data ?? [];
    const nextFinding = remaining[focused + 1] ?? remaining[focused - 1];
    if (nextFinding) {
      const next = new URLSearchParams(params);
      next.set("case", String(nextFinding.id));
      setParams(next, { replace: true });
    } else pendingIndex.current = focused;
    reload();
    void refreshSummary();
  }, [data, focused, params, setParams, reload, refreshSummary]);

  /**
   * «Deshacer» tras una corrección individual (E8.4). Con una sola corrección
   * aplicada, su run va a la barra «Deshacer» de siempre (deshacerlo también
   * marca la corrección como deshecha en su lote); si el lote tocó varias, el
   * aviso deshace el lote entero.
   */
  const offerUndo = useCallback((batch: FixBatch) => {
    const runs = batch.items.filter((item) => item.status === "applied" && item.runId !== null);
    if (runs.length === 1) {
      // El aviso del cambio (con su «Deshacer») nace con el evento; el texto
      // de aquí solo le pone título.
      window.dispatchEvent(new CustomEvent<CatalogChangeEvent>(CATALOG_CHANGE_EVENT, {
        detail: { runId: runs[0]!.runId!, method: "POST", path: `/curation/fixes/${batch.id}` },
      }));
      notify("success", "Corrección aplicada.");
      return;
    }
    notify("success", runs.length > 1 ? `${formatCount(runs.length)} correcciones aplicadas.` : "Corrección aplicada.", {
      action: {
        label: "Deshacer",
        onAction: async () => {
          try {
            const undone = await curationApi.fixUndo(batch.id, "Deshecho desde el aviso de la corrección");
            const failed = typeof undone.counts["notUndoable"] === "number" ? undone.counts["notUndoable"] : 0;
            notify(failed ? "error" : "success", failed ? "No se pudo restaurar: la ficha cambió después." : "Corrección deshecha.");
            afterWrite();
          } catch (err) {
            notify("error", err instanceof ApiError ? err.message : "No se pudo deshacer la corrección.");
          }
        },
      },
    });
  }, [notify, afterWrite]);

  async function reopen(finding: CurationFinding) {
    setBusyId(finding.id);
    try {
      await curationApi.reopen(finding.id);
      notify("success", "Hallazgo reabierto.");
      afterWrite();
    } catch (err) {
      notify("error", err instanceof ApiError ? err.message : "No se pudo guardar la decisión.");
    } finally {
      setBusyId(null);
    }
  }

  async function acknowledge(finding: CurationFinding) {
    setBusyId(finding.id);
    try {
      await curationApi.acknowledgeChain(finding.id);
      notify("success", "Marcado como revisado. El hallazgo sigue abierto.");
      afterWrite();
    } catch (err) {
      notify("error", err instanceof ApiError ? err.message : "No se pudo marcar como revisado.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteFinding(finding: CurationFinding, note: string) {
    const api = finding.entity.kind ? ENTITY_WRITE_API[finding.entity.kind] : undefined;
    if (!api || finding.entity.id === null) throw new Error("Esta ficha no se puede eliminar desde aquí.");
    await api.remove(finding.entity.id, note);
    notify("success", `«${finding.entity.label}» se eliminó del catálogo.`);
    setDeletingFinding(null);
    afterWrite();
  }

  // ---- Triaje con teclado (E8.6) ----
  const anyDialogOpen = Boolean(
    ignoringFinding || distinctFinding || fixTarget || mergingFinding || deletingFinding || sheetFinding
    || decidingReviewId !== null || resolvingConflict || ignoringGroup || fixingGroup || fixingSelected || applyingTrust
    || acknowledgingGroup || helpOpen || albumMergeFinding,
  );

  // Sin lista de dependencias a propósito: el manejador tiene que leer el foco
  // y los hallazgos de ESTE render. Con dependencias habría que enumerarlas
  // todas y cualquier olvido dejaría el atajo actuando sobre una lista vieja.
  useEffect(() => {
    if (anyDialogOpen || loading) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "?") { event.preventDefault(); setHelpOpen(true); return; }
      if (!rows.length) return;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        move(event.key === "j" ? 1 : -1);
        return;
      }
      const finding = focused >= 0 ? rows[focused] : undefined;
      if (!finding) return;
      if (event.key === "x" && isFixable(finding)) { event.preventDefault(); toggleSelected(finding.id); }
      if (event.key === "c" && isFixable(finding)) { event.preventDefault(); setFixTarget({ finding, action: finding.actions[0] ?? null, manual: false }); }
      if (event.key === "i" && finding.status === "open") { event.preventDefault(); setIgnoringFinding(finding); }
      if (event.key === "o") {
        const href = refHref(finding.entity, finding);
        if (href) { event.preventDefault(); window.open(href, "_blank", "noopener"); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (focused < 0) return;
    const card = listRef.current?.children[focused] as HTMLElement | undefined;
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);

  if (key && !summary) {
    return summaryError ? <ErrorState message={summaryError} onRetry={() => void refreshSummary()} /> : (
      <div role="status" aria-label="Cargando la categoría…">
        <HeaderSkeleton />
        <RowsSkeleton rows={4} />
      </div>
    );
  }
  if (key && summary && !category) {
    return <EmptyState title="Esa categoría no existe" hint="Elige una categoría del menú de Curaduría." />;
  }

  // Con un solo detector con hallazgos (p. ej. «Otros») sus subgrupos se
  // muestran de entrada: son la única forma útil de partir la categoría.
  const openDetectors = category?.detectors.filter((item) => item.open > 0) ?? [];
  const activeDetector = category?.detectors.find((item) => item.key === detector)
    ?? (openDetectors.length === 1 ? openDetectors[0] : undefined);
  const signatures = activeDetector?.signatures ?? [];
  // Lo mismo que `query`, sin paginar ni estado: exactamente lo que ven las
  // acciones de grupo (ignorar/corregir este detector), para que afecten
  // solo lo que la pantalla muestra (C3, PLAN_CURADURIA E3.1).
  const groupFilter: CurationFindingGroupFilter | null = category && activeDetector
    ? {
      category: category.key, detector: activeDetector.key,
      ...(signature ? { signature } : {}),
      ...(severity ? { severity } : {}),
      ...(entityKind ? { entityKind } : {}),
      ...(q ? { q } : {}),
      ...(scanId ? { scanId } : {}),
      ...(chained ? { chained: true } : {}),
    }
    : null;
  const total = data?.pagination.total ?? 0;
  const fixableShown = rows.filter(isFixable).length;
  // «Seleccionar los N que cumplen el filtro» viaja como filtro, no como ids
  // (M5, E8.3): alcanza también las páginas que no se han abierto. Un filtro de
  // grupo siempre está anclado a un detector (E3.1), así que sin detector
  // activo solo queda lo elegido a mano, página a página.
  const canSelectAll = groupFilter !== null && status === "open" && total > 0;

  const cardHandlers = (finding: CurationFinding) => ({
    onAlbumMerge: finding.entity.kind === "album" && findingPair(finding)
      && (!researchOf(finding) || (researchOf(finding)!.verdict === "consolidar" && !researchOf(finding)!.changedAlbumIds.length))
      ? () => setAlbumMergeFinding(finding) : undefined,
    onIgnore: () => setIgnoringFinding(finding),
    onReopen: () => void reopen(finding),
    onAcknowledge: finding.triggeredBy.length ? () => void acknowledge(finding) : undefined,
    onFix: (action: CurationActionSummary | null, manual: boolean) => setFixTarget({ finding, action, manual }),
    onMerge: finding.category === "fichas_repetidas" && MERGEABLE_KINDS.has(finding.entity.kind) && finding.entity.id !== null
      ? () => {
        const other = finding.related.find((ref) => ref.kind === finding.entity.kind && ref.id !== null && ref.id !== finding.entity.id);
        setMergingFinding({
          finding, kind: finding.entity.kind as MergeableKind,
          ...(other?.id ? { otherId: other.id, otherName: other.label } : {}),
        });
      }
      : undefined,
    onDelete: finding.category === "fichas_sin_vinculos" && finding.entity.id !== null && ENTITY_WRITE_API[finding.entity.kind]
      ? () => setDeletingFinding(finding)
      : undefined,
    onDistinct: (() => {
      const pair = findingPair(finding);
      return pair && PAIR_KINDS.has(finding.entity.kind) ? () => setDistinctFinding({ finding, pair }) : undefined;
    })(),
    onDecide: finding.detector === REVIEW_DETECTOR && typeof finding.evidence["reviewId"] === "number"
      ? () => setDecidingReviewId(finding.evidence["reviewId"] as number)
      : undefined,
    onResolveConflict: finding.detector === CONFLICT_DETECTOR ? () => setResolvingConflict(finding) : undefined,
  });

  // Lo que está filtrando la lista, siempre a la vista y quitable de a uno.
  const activeFilters: Array<{ key: string; label: string; clear: Record<string, string | null> }> = [
    ...(detector ? [{ key: "detector", label: category?.detectors.find((item) => item.key === detector)?.label ?? detector, clear: { detector: null, signature: null } }] : []),
    ...(signature ? [{ key: "signature", label: signatures.find((item) => item.key === signature)?.label ?? signature, clear: { signature: null } }] : []),
    ...(severity ? [{ key: "severity", label: `Gravedad ${SEVERITY_LABEL[severity].toLowerCase()}`, clear: { severity: null } }] : []),
    ...(entityKind ? [{ key: "entityKind", label: ENTITY_KIND_LABEL[entityKind] ?? entityKind, clear: { entityKind: null } }] : []),
    ...(status !== "open" ? [{ key: "status", label: STATUSES.find((item) => item.value === status)?.label ?? status, clear: { status: null } }] : []),
    ...(q ? [{ key: "q", label: `«${q}»`, clear: { q: null } }] : []),
    ...(scanId ? [{ key: "scanId", label: `Análisis #${scanId}`, clear: { scanId: null } }] : []),
    ...(chained ? [{ key: "chained", label: "Surgidos tras corregir", clear: { chained: null } }] : []),
  ];

  /** «No es un problema»: tras decidir, el caso siguiente queda delante y el aviso permite reabrirlo. */
  const ignoreProps = (finding: CurationFinding): IgnoreProps => ({
    title: "¿No es un problema?",
    description: `«${finding.title}» dejará de aparecer entre los abiertos mientras el detector lo siga viendo igual. Si el problema desaparece, pasa a resuelto. El catálogo no cambia.`,
    confirmLabel: "No es un problema",
    requireNote: false,
    onConfirm: async (reason, note) => {
      await curationApi.ignore(finding.id, reason, note);
      notify("success", "Marcado como «no es un problema».", { action: { label: "Reabrir", onAction: () => reopen(finding) } });
      setIgnoringFinding(null);
      afterWrite();
    },
    onClose: () => setIgnoringFinding(null),
  });
  const ignoreInline = view === "review" && ignoringFinding !== null && activeFinding?.id === ignoringFinding.id;

  return (
    <>
      <FindingsHeader category={category} scanId={scanId} chained={chained} />

      <div className="cwork-toolbar">
        <form className="cfind-search" role="search" onSubmit={(event) => { event.preventDefault(); update({ q: search.trim() || null }); }}>
          <label className="visually-hidden" htmlFor="cfind-q">Buscar en los hallazgos</label>
          <input id="cfind-q" className="filter-input" type="search" value={search} placeholder="Nombre, valor o ID…"
            onChange={(event) => setSearch(event.target.value)} />
          <button type="submit" className="btn btn--sm">Buscar</button>
        </form>
        <div className="segmented" role="group" aria-label="Vista de los casos">
          <button type="button" className="segmented__option" aria-pressed={view === "review"} onClick={() => update({ view: null })}>Lista y detalle</button>
          <button type="button" className="segmented__option" aria-pressed={view === "cards"} onClick={() => update({ view: "cards" })}>Tarjetas</button>
        </div>
      </div>

      <details className="cwork-filters">
        <summary>Filtros{[detector, signature, severity, entityKind, status !== "open" ? status : "", q, scanId, chained].filter(Boolean).length
          ? ` · ${[detector, signature, severity, entityKind, status !== "open" ? status : "", q, scanId, chained].filter(Boolean).length} activos` : ""}</summary>
      {!routeKey ? <div className="cwork-category-filter">
        <label htmlFor="cfind-category">Categoría</label>
        <select id="cfind-category" className="filter-input" value={key ?? ""}
          onChange={(event) => update({ category: event.target.value || null, detector: null, signature: null })}>
          <option value="">Todas las categorías</option>
          {summary?.categories.map((item) => <option key={item.key} value={item.key}>{item.label} ({formatCount(item.open)})</option>)}
        </select>
      </div> : null}

      {category ? (
        <div className="cfilters" role="group" aria-label="Filtrar por detector">
          <button type="button" className="cchip" aria-pressed={!detector} onClick={() => update({ detector: null, signature: null })}>
            Todos <span className="mono">{formatCount(category.open)}</span>
          </button>
          {category.detectors.filter((item) => item.open > 0 || item.key === detector).map((item) => (
            <button
              key={item.key} type="button" className="cchip" aria-pressed={detector === item.key} title={item.description}
              onClick={() => update({ detector: item.key, signature: null })}
            >
              {item.label} <span className="mono">{formatCount(item.open)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {signatures.length > 1 ? (
        // La clave reinicia cuántos subgrupos se ven al cambiar de detector.
        <SignatureFilter key={`${key ?? ""}:${activeDetector?.key ?? ""}`} signatures={signatures} selected={signature}
          onSelect={(value) => update({ signature: value })} />
      ) : null}

      <div className="list-toolbar">
        <div className="cfind-selects">
          <label className="visually-hidden" htmlFor="cfind-severity">Gravedad</label>
          <select id="cfind-severity" className="filter-input" value={severity} onChange={(event) => update({ severity: event.target.value || null })}>
            <option value="">Toda gravedad</option>
            {SEVERITIES.map((value) => <option key={value} value={value}>Gravedad {SEVERITY_LABEL[value].toLowerCase()}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="cfind-kind">Tipo de ficha</label>
          <select id="cfind-kind" className="filter-input" value={entityKind} onChange={(event) => update({ entityKind: event.target.value || null })}>
            <option value="">Todo tipo de ficha</option>
            {Object.entries(ENTITY_KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <div className="segmented" role="group" aria-label="Estado">
            {STATUSES.map((item) => (
              <button key={item.value} type="button" className="segmented__option" aria-pressed={status === item.value}
                onClick={() => update({ status: item.value === "open" ? null : item.value })}>
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--sm btn--outline" onClick={() => setHelpOpen(true)} title="Atajos de teclado (?)">
            <Keyboard size={14} weight="bold" aria-hidden="true" />
            <span className="visually-hidden">Atajos de teclado</span>
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => update({ detector: null, signature: null, severity: null,
            entityKind: null, status: null, q: null, scanId: null, chained: null, ...(!routeKey ? { category: null } : {}) })}>Limpiar filtros</button>
        </div>
      </div>
      </details>

      {activeFilters.length ? (
        <div className="cfilter-chips" role="group" aria-label="Filtros activos">
          {activeFilters.map((filter) => (
            <span key={filter.key} className="cfilter-chip">
              <span className="cfilter-chip__label">{filter.label}</span>
              <button type="button" aria-label={`Quitar filtro ${filter.label}`} onClick={() => update(filter.clear)}>×</button>
            </span>
          ))}
          {activeFilters.length > 1 ? (
            <button type="button" className="btn-link" onClick={() => update(Object.assign({}, ...activeFilters.map((filter) => filter.clear)))}>Quitar todos</button>
          ) : null}
        </div>
      ) : null}

      <div className="cfind-count">
        {data && !loading ? (
          <p aria-live="polite">{total === 1 ? "1 hallazgo" : `${formatCount(total)} hallazgos`}</p>
        ) : <span />}
        <div className="cwork-order">
          <label className="visually-hidden" htmlFor="cfind-sort">Ordenar casos</label>
          <select id="cfind-sort" className="filter-input" value={sort} onChange={(event) => update({ sort: event.target.value })}>
            <option value="priority">Mayor gravedad primero</option>
            <option value="oldest">Más antiguos primero</option>
            <option value="newest">Más recientes primero</option>
            <option value="entity">Nombre de la ficha</option>
          </select>
          <label className="visually-hidden" htmlFor="cfind-limit">Casos por página</label>
          <select id="cfind-limit" className="filter-input" value={limit} onChange={(event) => update({ limit: event.target.value })}>
            {[25, 50, 100].map((size) => <option key={size} value={size}>{size} por página</option>)}
          </select>
        </div>
        {status === "open" && data && total > 0 && (groupFilter || chained) ? (
          <div className="cfind-count__actions" role="group" aria-label="Acciones sobre todo el grupo">
            {/* Solo si hay algo que corregir de un clic en lo que se ve: «Corregir este detector» no debe
                terminar en «0 corregidos» cuando ningún hallazgo tiene acción (A2). */}
            {groupFilter && fixableShown > 0 ? (
              <button type="button" className="btn btn--sm btn--outline" onClick={() => setFixingGroup(true)}>
                <Wrench size={14} weight="bold" aria-hidden="true" />
                Corregir {signature ? "este subgrupo" : "este detector"}
              </button>
            ) : null}
            {/* «Aplicar la fuente de mayor confianza» (PLAN_CURADURIA E7.2): solo para
                conflictos abiertos, donde cada hallazgo trae la confianza de sus dos fuentes. */}
            {groupFilter && activeDetector?.key === CONFLICT_DETECTOR ? (
              <button type="button" className="btn btn--sm btn--outline" onClick={() => setApplyingTrust(true)}>
                <Scales size={14} weight="bold" aria-hidden="true" />
                Aplicar la fuente de mayor confianza
              </button>
            ) : null}
            {/* «Surgidos tras corregir»: darlos por revisados de una vez (E8.7, M2). */}
            {chained ? (
              <button type="button" className="btn btn--sm btn--outline" onClick={() => setAcknowledgingGroup(true)}>
                <CheckCircle size={14} weight="bold" aria-hidden="true" />
                Marcar todos como revisados
              </button>
            ) : null}
            {groupFilter ? (
              <button type="button" className="btn btn--sm btn--outline" onClick={() => setIgnoringGroup(true)}>
                <EyeSlash size={14} weight="bold" aria-hidden="true" />
                Ignorar {signature ? "este subgrupo" : "este detector"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div ref={paginationStartRef} className="pagination-start" />

      {loading && !data ? <RowsSkeleton rows={6} height={64} label="Cargando hallazgos…" /> : error ? <ErrorState message={error} onRetry={reload} /> : !data || rows.length === 0 ? (
        <EmptyState
          title={status === "open" ? "No hay hallazgos abiertos aquí" : "No hay hallazgos con estos filtros"}
          hint={status === "open" ? "El detector no encontró problemas de este tipo en el último análisis." : "Prueba con otros filtros."}
        />
      ) : (
        <>
          {view === "review" && activeFinding ? <CurationWorkbench
            rows={rows} activeId={activeFinding.id} offset={offset} total={total}
            selected={selected} selectAll={selectAll} loading={loading} initiallyOpen={activeId > 0}
            onActivate={activate} onMove={move} onToggleSelected={toggleSelected}
            onSelectPage={(checked) => {
              if (selectAll) { setSelectAll(false); setSelected(new Set()); return; }
              setSelected((current) => {
                const next = new Set(current);
                for (const row of rows.filter(isFixable)) { if (checked) next.add(row.id); else next.delete(row.id); }
                return next;
              });
            }}
            actions={ignoreInline && ignoringFinding ? <IgnoreForm inline {...ignoreProps(ignoringFinding)} />
              : <FindingActions finding={activeFinding} busy={busyId === activeFinding.id || loading} layout="row" {...cardHandlers(activeFinding)} />}
            detail={<FindingCard finding={activeFinding} busy={busyId === activeFinding.id || loading} compact={false} hideActions
              categoryLabel={key ? undefined : summary?.categories.find((item) => item.key === activeFinding.category)?.label ?? "Otros"}
              selected={selectAll ? isFixable(activeFinding) : selected.has(activeFinding.id)} selectionLocked={selectAll}
              onToggleSelected={() => toggleSelected(activeFinding.id)} focusedByKeyboard={false}
              onOpenSheet={() => setSheetFinding(activeFinding)} {...cardHandlers(activeFinding)} />}
          /> : <ol className={`cfind-list${loading ? " is-refreshing" : ""}`} ref={listRef}>
            {rows.map((finding, index) => (
              <li key={finding.id}>
                <FindingCard
                  finding={finding} busy={busyId === finding.id || loading} compact={isMobile}
                  categoryLabel={key ? undefined : summary?.categories.find((item) => item.key === finding.category)?.label ?? "Otros"}
                  selected={selectAll ? isFixable(finding) : selected.has(finding.id)}
                  selectionLocked={selectAll}
                  onToggleSelected={() => toggleSelected(finding.id)}
                  focusedByKeyboard={focused === index}
                  onOpenSheet={() => setSheetFinding(finding)}
                  {...cardHandlers(finding)}
                />
              </li>
            ))}
          </ol>}
          <Pagination scrollTargetRef={paginationStartRef} limit={limit} offset={offset} total={total} onOffsetChange={(next) => update({ offset: String(next) })} />
        </>
      )}

      {selected.size > 0 || selectAll ? (
        <div className="csel-toolbar" role="toolbar" aria-label="Acciones sobre lo seleccionado">
          <span className="csel-toolbar__count" aria-live="polite">
            {selectAll
              ? `Los ${formatCount(total)} hallazgos que cumplen el filtro`
              : `${formatCount(selected.size)} seleccionado${selected.size === 1 ? "" : "s"}`}
          </span>
          <div className="csel-toolbar__actions">
            {!selectAll && canSelectAll ? (
              <button type="button" className="btn btn--sm btn--outline" onClick={() => { setSelected(new Set()); setSelectAll(true); }}>
                Seleccionar los {formatCount(total)} que cumplen el filtro
              </button>
            ) : null}
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setFixingSelected(true)}>
              <Wrench size={14} weight="bold" aria-hidden="true" /> Corregir {selectAll ? "todo el filtro" : "seleccionados"}
            </button>
            <button type="button" className="btn btn--sm btn--outline" onClick={() => { setSelected(new Set()); setSelectAll(false); }}>
              Vaciar selección
            </button>
          </div>
        </div>
      ) : null}

      {ignoringFinding && !ignoreInline ? <IgnoreDialog {...ignoreProps(ignoringFinding)} /> : null}

      {distinctFinding ? (
        <ConfirmDialog
          title="¿Son fichas distintas?"
          description={`El detector no volverá a proponer este par (#${distinctFinding.pair[0]} y #${distinctFinding.pair[1]}) como repetido, aunque cambien sus nombres o aparezcan otras fichas parecidas. El catálogo no cambia.`}
          confirmLabel="Son distintas"
          onConfirm={async (note) => {
            await curationApi.declareDistinct({
              kind: distinctFinding.finding.entity.kind as CurationPairKind, aId: distinctFinding.pair[0], bId: distinctFinding.pair[1], note,
            });
            notify("success", "Par declarado distinto. Desaparece de los abiertos en cuanto termine la verificación.");
            setDistinctFinding(null);
            afterWrite();
          }}
          onClose={() => setDistinctFinding(null)}
        />
      ) : null}

      {ignoringGroup && groupFilter ? (
        <IgnoreDialog
          title={`¿Ignorar ${signature ? "este subgrupo" : "este detector"}?`}
          description={`Los ${formatCount(total)} hallazgos abiertos de «${activeDetector?.label ?? detector}»${signature ? ` › «${signatures.find((item) => item.key === signature)?.label ?? signature}»` : ""} (con los filtros activos) se marcarán como «no es un problema». El catálogo no cambia y cada caso se puede reabrir.`}
          confirmLabel="Ignorar el grupo"
          requireNote
          onConfirm={async (reason, note) => {
            const result = await curationApi.ignoreGroup({ ...groupFilter, reason, note });
            notify("success", `${formatCount(result.ignored)} hallazgos ignorados.`);
            setIgnoringGroup(false);
            afterWrite();
          }}
          onClose={() => setIgnoringGroup(false)}
        />
      ) : null}

      {acknowledgingGroup ? (
        <ConfirmDialog
          title="¿Marcar todos como revisados?"
          description={`Los ${formatCount(total)} hallazgos de esta lista dejarán de contar como «surgidos tras corregir»: la marca pasa a su historial, con quién y cuándo. Ninguno se cierra ni se corrige, y el catálogo no cambia.`}
          confirmLabel="Marcar como revisados"
          requireNote={false}
          onConfirm={async () => {
            const result = await curationApi.acknowledgeChainGroup({
              status,
              ...(key ? { category: key } : {}),
              ...(detector ? { detector } : {}),
              ...(signature ? { signature } : {}),
              ...(severity ? { severity } : {}),
              ...(entityKind ? { entityKind } : {}),
              ...(q ? { q } : {}),
              ...(scanId ? { scanId } : {}),
            });
            notify("success", `${formatCount(result.acknowledged)} marcados como revisados.`);
            setAcknowledgingGroup(false);
            afterWrite();
          }}
          onClose={() => setAcknowledgingGroup(false)}
        />
      ) : null}

      {fixingGroup && groupFilter ? (
        <FixBatchDialog
          mode="group"
          filter={groupFilter}
          title={`¿Corregir ${signature ? "este subgrupo" : "este detector"}?`}
          description={`Cada hallazgo abierto y corregible de «${activeDetector?.label ?? detector}»${signature ? ` › «${signatures.find((item) => item.key === signature)?.label ?? signature}»` : ""} recibirá su corrección recomendada. Revisa la vista previa —podrás excluir ítems o cambiar la acción de una fila— antes de aplicar, y deshacer el lote después.`}
          onDone={afterWrite}
          onClose={() => setFixingGroup(false)}
        />
      ) : null}

      {applyingTrust && groupFilter ? (
        <ConfirmDialog
          title="¿Aplicar la fuente de mayor confianza?"
          description={`Sobre los ${formatCount(total)} conflictos abiertos con los filtros activos, se elige el lado de mayor confianza declarada de su fuente. Un empate (misma confianza a los dos lados) queda sin tocar: nadie decidió por él.`}
          confirmLabel="Aplicar por confianza"
          onConfirm={async (note) => {
            const result = await curationApi.resolveConflictsGroup({ ...groupFilter, note });
            notify("success", `${formatCount(result.applied)} resueltos, ${formatCount(result.tied)} en empate, ${formatCount(result.failed)} sin aplicar.`);
            setApplyingTrust(false);
            afterWrite();
          }}
          onClose={() => setApplyingTrust(false)}
        />
      ) : null}

      {fixingSelected ? (
        selectAll && groupFilter ? (
          <FixBatchDialog
            mode="group"
            filter={groupFilter}
            title="¿Corregir todo lo que cumple el filtro?"
            description={`Los ${formatCount(total)} hallazgos abiertos que cumplen los filtros de la pantalla —no solo los de esta página— recibirán su corrección recomendada. Revisa la vista previa antes de aplicar; el lote se puede deshacer.`}
            onDone={() => { setSelectAll(false); afterWrite(); }}
            onClose={() => setFixingSelected(false)}
          />
        ) : (
          <FixBatchDialog
            mode="selected"
            findingIds={[...selected]}
            title="¿Corregir los hallazgos seleccionados?"
            description={`Cada uno de los ${formatCount(selected.size)} hallazgos seleccionados recibirá su corrección recomendada. Revisa la vista previa —podrás excluir ítems o cambiar la acción de una fila— antes de aplicar, y deshacer el lote después.`}
            onDone={() => { setSelected(new Set()); afterWrite(); }}
            onClose={() => setFixingSelected(false)}
          />
        )
      ) : null}

      {fixTarget ? (
        <FixBatchDialog
          mode="individual"
          findingIds={[fixTarget.finding.id]}
          {...(fixTarget.action && !fixTarget.manual ? { actionKey: fixTarget.action.key } : {})}
          title={fixTarget.manual ? `Corregir «${fixTarget.finding.title}»` : `${fixTarget.action?.label ?? "Corregir"} · «${fixTarget.finding.title}»`}
          description={fixTarget.manual
            ? `Se aplicará el valor al campo «${fieldLabel(fixTarget.finding.field ?? "")}» de «${fixTarget.finding.entity.label}».`
            : `${fixTarget.action ? actionConsequence(fixTarget.action) : ""} Se aplica sobre «${fixTarget.finding.entity.label}». Revisa el antes → después antes de aplicar.`}
          {...(fixTarget.manual
            ? {
              valueEditor: {
                initial: fixTarget.finding.suggestedValue ?? fixTarget.finding.value ?? "",
                current: fixTarget.finding.value ?? "",
                fieldLabel: fieldLabel(fixTarget.finding.field ?? ""),
              },
            }
            : {})}
          onDone={afterWrite}
          onApplied={offerUndo}
          onClose={() => setFixTarget(null)}
        />
      ) : null}

      {mergingFinding ? (
        <MergeEntityModal
          kind={mergingFinding.kind}
          entityId={mergingFinding.finding.entity.id!}
          entityName={mergingFinding.finding.entity.label}
          {...(mergingFinding.otherId ? { otherId: mergingFinding.otherId, otherName: mergingFinding.otherName ?? "" } : {})}
          onMerged={() => { setMergingFinding(null); notify("success", "Fichas fusionadas."); afterWrite(); }}
          onClose={() => setMergingFinding(null)}
        />
      ) : null}

      {albumMergeFinding ? (() => {
        const pair = findingPair(albumMergeFinding)!;
        const research = researchOf(albumMergeFinding);
        const keep = research?.suggestedKeep ?? albumMergeFinding.entity.id!;
        const drop = pair.find((id) => id !== keep)!;
        const label = (id: number) => research?.albums.find((album) => album.id === id)?.title
          ?? (id === albumMergeFinding.entity.id ? albumMergeFinding.entity.label : albumMergeFinding.related.find((ref) => ref.kind === "album" && ref.id === id)?.label)
          ?? `Disco #${id}`;
        return <AlbumMergeModal albumId={keep} albumTitle={label(keep)} otherAlbum={{ id: drop, title: label(drop) }}
          {...(research ? { initialMode: "match" as const } : {})}
          onApplied={afterWrite}
          onMerged={() => setAlbumMergeFinding(null)}
          onClose={() => setAlbumMergeFinding(null)} />;
      })() : null}

      {deletingFinding ? (
        <ConfirmDialog
          title="¿Eliminar esta ficha?"
          description={`«${deletingFinding.entity.label}» no tiene vínculos con el catálogo. Se retira del catálogo con auditoría.`}
          confirmLabel="Eliminar ficha"
          danger
          onConfirm={(note) => deleteFinding(deletingFinding, note)}
          onClose={() => setDeletingFinding(null)}
        />
      ) : null}

      {decidingReviewId !== null ? (
        <ReviewDecisionDialog
          reviewId={decidingReviewId}
          onDone={afterWrite}
          onClose={() => setDecidingReviewId(null)}
        />
      ) : null}

      {resolvingConflict ? (
        <ConflictResolveDialog
          finding={resolvingConflict}
          onDone={afterWrite}
          onClose={() => setResolvingConflict(null)}
        />
      ) : null}

      {sheetFinding ? (
        <Modal title="Acciones" onClose={() => setSheetFinding(null)} sheet>
          <p className="dialog-lead">{sheetFinding.title}</p>
          <div className="csheet">
            <FindingActions
              finding={sheetFinding} busy={busyId === sheetFinding.id} layout="sheet"
              {...cardHandlers(sheetFinding)}
              onAny={() => setSheetFinding(null)}
            />
          </div>
        </Modal>
      ) : null}

      {helpOpen ? (
        <Modal title="Atajos de teclado" onClose={() => setHelpOpen(false)}>
          <p className="dialog-lead">Funcionan mientras no haya un diálogo abierto ni el foco esté en un campo de texto.</p>
          <dl className="cshortcuts">
            {SHORTCUTS.map((item) => (
              <div key={item.keys} className="cshortcuts__row">
                <dt><kbd>{item.keys}</kbd></dt>
                <dd>{item.description}</dd>
              </div>
            ))}
          </dl>
          <div className="form-actions">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>Entendido</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

interface IgnoreProps {
  title: string; description: string; confirmLabel: string; requireNote: boolean;
  onConfirm: (reason: CurationIgnoreReason, note: string) => Promise<void>; onClose: () => void;
}

/** «No es un problema» con motivo obligatorio: sin él no se puede medir la precisión de cada detector. */
function IgnoreDialog(props: IgnoreProps) {
  return <Modal title={props.title} onClose={props.onClose}><IgnoreForm {...props} /></Modal>;
}

/**
 * La misma decisión dentro del panel del caso (vista «Lista y detalle»): sin
 * ventana encima, el caso sigue a la vista mientras se elige el motivo.
 */
function IgnoreForm({ title, description, confirmLabel, requireNote, onConfirm, onClose, inline = false }: IgnoreProps & { inline?: boolean }) {
  const [reason, setReason] = useState<CurationIgnoreReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const noteId = useId();

  async function submit() {
    if (!reason) { setError("Elige un motivo."); return; }
    if (requireNote && !note.trim()) { setError("La nota es obligatoria."); return; }
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(reason, note.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la decisión.");
      setBusy(false);
    }
  }

  return (
    <div className={inline ? "cignore cignore--inline" : "cignore"} onKeyDown={(event) => { if (inline && event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      {inline ? <h3 className="cignore__title">{title}</h3> : null}
      <p className="dialog-lead">{description}</p>
      <fieldset className="reason-choices">
        <legend>Motivo *</legend>
        {IGNORE_REASONS.map((item) => (
          <label key={item.value} className="reason-choice">
            <input type="radio" name="ignore-reason" value={item.value} checked={reason === item.value} autoFocus={inline && item === IGNORE_REASONS[0]} onChange={() => { setReason(item.value); setError(undefined); }} />
            <span>
              <span className="reason-choice__label">{item.label}</span>
              <span className="reason-choice__hint">{item.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={noteId}>Nota{requireNote ? " *" : " (opcional)"}</label>
        <textarea id={noteId} rows={2} value={note} onChange={(event) => setNote(event.target.value)}
          placeholder="Qué lo justifica (ayuda a quien lo revise después)" />
      </div>
      {error ? <p className="form-error-banner" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="btn btn--primary" onClick={submit} disabled={busy}>{busy ? "Guardando…" : confirmLabel}</button>
      </div>
    </div>
  );
}

/** Subgrupos visibles de entrada y cuántos más muestra cada «Ver más». */
const SIGNATURES_INITIAL = 6;
const SIGNATURES_STEP = 12;

/**
 * Filtro por subgrupo. «Otros» puede tener decenas (un signo raro por campo):
 * se muestran los más frecuentes y el resto se despliega por tandas, sin
 * empujar la lista de hallazgos fuera de la pantalla.
 */
function SignatureFilter({ signatures, selected, onSelect }: {
  signatures: CurationSignatureSummary[]; selected: string; onSelect: (value: string | null) => void;
}) {
  const [visible, setVisible] = useState(SIGNATURES_INITIAL);
  const [revealFrom, setRevealFrom] = useState(signatures.length);
  const listId = useId();

  const shown = signatures.slice(0, visible);
  // El subgrupo elegido siempre queda a la vista, aunque esté más abajo.
  const selectedIndex = signatures.findIndex((item) => item.key === selected);
  const pinned = selectedIndex >= visible;
  if (pinned) shown.push(signatures[selectedIndex]!);
  const hidden = Math.max(signatures.length - visible - (pinned ? 1 : 0), 0);
  const next = Math.min(SIGNATURES_STEP, hidden);

  return (
    <div className="csub">
      <p className="csub__label">
        Subgrupos <span className="mono">{formatCount(signatures.length)}</span>
      </p>
      <div className="cfilters cfilters--sub" role="group" aria-label="Filtrar por subgrupo" id={listId}>
        <button type="button" className="cchip cchip--sub" aria-pressed={!selected} onClick={() => onSelect(null)}>
          Todos los subgrupos
        </button>
        {shown.map((item, index) => (
          <button
            key={item.key} type="button" className={`cchip cchip--sub${index >= revealFrom ? " is-revealed" : ""}`}
            style={index >= revealFrom ? { animationDelay: `${Math.min(index - revealFrom, 11) * 22}ms` } : undefined}
            aria-pressed={selected === item.key} title={item.label}
            onClick={() => onSelect(item.key)}
          >
            <span className="cchip__text">{item.label}</span> <span className="mono">{formatCount(item.open)}</span>
          </button>
        ))}
        {hidden > 0 ? (
          <button type="button" className="cchip cchip--more" aria-controls={listId}
            onClick={() => { setRevealFrom(shown.length); setVisible(visible + next); }}>
            <CaretDown size={12} weight="bold" aria-hidden="true" />
            Ver {formatCount(next)} más
            {hidden > next ? <span className="mono">de {formatCount(hidden)}</span> : null}
          </button>
        ) : visible > SIGNATURES_INITIAL ? (
          <button type="button" className="cchip cchip--more" aria-controls={listId}
            onClick={() => { setRevealFrom(signatures.length); setVisible(SIGNATURES_INITIAL); }}>
            <CaretUp size={12} weight="bold" aria-hidden="true" />
            Ver menos
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FindingsHeader({ category, scanId, chained }: { category: CurationCategorySummary | undefined; scanId: number | undefined; chained: boolean }) {
  if (category) {
    const Icon = categoryIcon(category.key);
    return (
      <div className="cfind-head">
        <h2><Icon size={20} weight="bold" aria-hidden="true" /> {category.label}</h2>
        <p className="curation-lead">{category.description}</p>
      </div>
    );
  }
  const title = chained && scanId ? `Desencadenados por la corrección del análisis #${scanId}`
    : chained ? "Surgidos tras corregir"
      : scanId ? `Aparecidos en el análisis #${scanId}` : "Todos los hallazgos";
  return (
    <div className="cfind-head">
      <BackLink fallback="/curaduria" />
      <h2>{title}</h2>
      <p className="curation-lead">
        {chained
          ? "Hallazgos que aparecieron en las mismas fichas donde una corrección acababa de resolver otro. Revísalos: la corrección pudo dejar el dato a medias. Marcar como revisado no los cierra, solo los saca de esta lista."
          : "Hallazgos de todas las categorías."}
      </p>
    </div>
  );
}

interface FindingActionsProps {
  finding: CurationFinding;
  busy: boolean;
  /** `row` es la fila de la tarjeta en escritorio; `sheet`, la hoja inferior de móvil (E8.9). */
  layout: "row" | "sheet";
  onIgnore: () => void;
  onReopen: () => void;
  onAcknowledge: (() => void) | undefined;
  onFix: (action: CurationActionSummary | null, manual: boolean) => void;
  onMerge: (() => void) | undefined;
  onAlbumMerge: (() => void) | undefined;
  onDelete: (() => void) | undefined;
  onDistinct: (() => void) | undefined;
  onDecide: (() => void) | undefined;
  onResolveConflict: (() => void) | undefined;
  onAny?: (() => void) | undefined;
}

/**
 * Botones de una tarjeta (E8.1). El principal es la acción RECOMENDADA del
 * motor —no un «Corregir» genérico— y las demás viven en «Otras correcciones»,
 * para que la primera lectura de la tarjeta no sea una fila de seis botones.
 */
function FindingActions({
  finding, busy, layout, onIgnore, onReopen, onAcknowledge, onFix, onMerge, onAlbumMerge, onDelete, onDistinct, onDecide, onResolveConflict, onAny,
}: FindingActionsProps) {
  const open = finding.status === "open";
  const [recommended, ...others] = finding.actions;
  // Escribir el valor a mano solo tiene sentido donde el detector calculó uno
  // (los hallazgos de texto): en los demás, el valor lo decide la acción.
  const manual = finding.suggestedValue !== null && finding.actions.some((action) => action.key === MANUAL_VALUE_ACTION);
  const run = (fn: () => void) => () => { fn(); onAny?.(); };
  const sheet = layout === "sheet";
  const size = sheet ? "" : " btn--sm";
  // Una sola acción principal por caso: la primera que aplique, en este orden.
  // Las demás siguen a la vista, pero sin competir por el primer clic.
  const primary = !open ? null : onAlbumMerge ? "albumMerge" : recommended ? "fix" : onDecide ? "decide" : onResolveConflict ? "resolve" : null;
  const tone = (key: string) => primary === key ? " btn--primary" : " btn--outline";

  return (
    <div className={sheet ? "csheet__actions" : "cfind__actions"}>
      {open && onAlbumMerge ? <button type="button" className={`btn${size}${tone("albumMerge")}`} onClick={run(onAlbumMerge)} disabled={busy}>
        <GitMerge size={14} weight="bold" aria-hidden="true" /> Revisar fusión
      </button> : null}
      {open && recommended ? (
        <button type="button" className={`btn${size}${tone("fix")}`} onClick={run(() => onFix(recommended, false))} disabled={busy}
          title={actionConsequence(recommended)}>
          <Wrench size={14} weight="bold" aria-hidden="true" /> {recommended.label}
        </button>
      ) : null}
      {open && onDecide ? (
        <button type="button" className={`btn${size}${tone("decide")}`} onClick={run(onDecide)} disabled={busy}
          title="Aceptar, rechazar o resolver esta revisión sin salir de la lista">
          <Gavel size={14} weight="bold" aria-hidden="true" /> Decidir
        </button>
      ) : null}
      {open && onResolveConflict ? (
        <button type="button" className={`btn${size}${tone("resolve")}`} onClick={run(onResolveConflict)} disabled={busy}
          title="Elegir A, B u otro valor con la evidencia de cada fuente">
          <Scales size={14} weight="bold" aria-hidden="true" /> Resolver
        </button>
      ) : null}
      {/* «Son distintas» no es una corrección: es la decisión contraria a fusionar,
          y queda a la vista junto a «No es un problema» en vez de en el menú. */}
      {open && onDistinct ? (
        <button type="button" className={`btn${size} btn--outline`} onClick={run(onDistinct)} disabled={busy}
          title="Son fichas distintas: el detector no vuelve a proponer este par">
          <NotEquals size={14} weight="bold" aria-hidden="true" /> Son distintas
        </button>
      ) : null}

      {open && (others.length > 0 || manual || onMerge || onDelete) ? (
        sheet ? (
          <>
            {others.map((action) => (
              <button key={action.key} type="button" className="btn btn--outline" onClick={run(() => onFix(action, false))} disabled={busy}
                title={actionConsequence(action)}>
                {action.label} <span className="hint">· nivel {action.level}</span>
              </button>
            ))}
            {manual ? (
              <button type="button" className="btn btn--outline" onClick={run(() => onFix(null, true))} disabled={busy}>
                Escribir el valor a mano
              </button>
            ) : null}
            {onMerge ? (
              <button type="button" className="btn btn--outline" onClick={run(onMerge)} disabled={busy}>
                <GitMerge size={14} weight="bold" aria-hidden="true" /> Fusionar eligiendo la otra ficha
              </button>
            ) : null}
            {onDelete ? (
              <button type="button" className="btn btn--outline" onClick={run(onDelete)} disabled={busy}>
                <Trash size={14} weight="bold" aria-hidden="true" /> Retirar la ficha
              </button>
            ) : null}
          </>
        ) : (
          <Menu.Root>
            <Menu.Trigger className="btn btn--sm btn--outline" disabled={busy}>
              <DotsThree size={16} weight="bold" aria-hidden="true" /> Otras correcciones
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={6} align="end" className="cmenu__positioner">
                <Menu.Popup className="cmenu__panel cmenu__panel--floating">
                  {others.map((action) => (
                    <Menu.Item key={action.key} className="cmenu__item" onClick={run(() => onFix(action, false))}>
                      <span className="cmenu__label">{action.label}</span>
                      <span className="cmenu__hint">{actionConsequence(action)}</span>
                    </Menu.Item>
                  ))}
                  {manual ? (
                    <Menu.Item className="cmenu__item" onClick={run(() => onFix(null, true))}>
                      <span className="cmenu__label">Escribir el valor a mano</span>
                      <span className="cmenu__hint">Se aplica el texto que escribas, con vista previa.</span>
                    </Menu.Item>
                  ) : null}
                  {onMerge ? (
                    <Menu.Item className="cmenu__item" onClick={run(onMerge)}>
                      <span className="cmenu__label">Fusionar eligiendo la otra ficha</span>
                      <span className="cmenu__hint">Cuando la repetida no es la que propone el detector.</span>
                    </Menu.Item>
                  ) : null}
                  {onDelete ? (
                    <Menu.Item className="cmenu__item cmenu__item--danger" onClick={run(onDelete)}>
                      <span className="cmenu__label">Retirar la ficha</span>
                      <span className="cmenu__hint">Se retira con motivo y auditoría; el aviso trae «Deshacer».</span>
                    </Menu.Item>
                  ) : null}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )
      ) : null}

      {onAcknowledge ? (
        <button type="button" className={`btn${size} btn--outline`} onClick={run(onAcknowledge)} disabled={busy}
          title="Ya lo miré: quita la marca «apareció al corregir». No cierra el hallazgo.">
          <CheckCircle size={14} weight="bold" aria-hidden="true" /> Marcar como revisado
        </button>
      ) : null}

      {open ? (
        <button type="button" className={`btn${size} btn--outline`} onClick={run(onIgnore)} disabled={busy}
          title="No es un problema: con motivo; dura mientras el detector lo siga viendo igual">
          <EyeSlash size={14} weight="bold" aria-hidden="true" /> No es un problema
        </button>
      ) : finding.status === "ignored" ? (
        <button type="button" className={`btn${size} btn--outline`} onClick={run(onReopen)} disabled={busy}>
          <ArrowCounterClockwise size={14} weight="bold" aria-hidden="true" /> Reabrir
        </button>
      ) : null}
    </div>
  );
}

interface FindingCardProps extends Omit<FindingActionsProps, "layout" | "onAny"> {
  hideActions?: boolean;
  categoryLabel: string | undefined;
  selected: boolean;
  /** Con «seleccionar todo el filtro» la casilla refleja el filtro, no una elección ficha a ficha. */
  selectionLocked: boolean;
  onToggleSelected: () => void;
  /** El triaje con teclado tiene su propio foco, que no es el del navegador. */
  focusedByKeyboard: boolean;
  /** En móvil las acciones viven en una hoja inferior (E8.9). */
  compact: boolean;
  onOpenSheet: () => void;
}

function MixedPersonWebResearch({ personId }: { personId: number }) {
  const [result, setResult] = useState<PersonWebVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let active = true;
    reviewApi.mixedVerification(personId).then((value) => { if (active) setResult(value); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [personId]);
  const run = async (action: () => Promise<PersonWebVerification>) => {
    setBusy(true); setError(null);
    try { setResult(await action()); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const assessment = result ? personIdentityAssessment(null, result) : null;
  return <div className="cfind__note" style={{ display: "block", marginTop: 12 }}>
    <button type="button" className="btn btn--sm btn--outline" disabled={busy} onClick={() => run(() => reviewApi.investigateMixed(personId))}>
      {busy ? "Investigando…" : result ? "Actualizar investigación web" : "Investigar ficha mezclada en internet"}
    </button>
    {error ? <p role="alert">{error}</p> : null}
    {result ? <div style={{ marginTop: 12 }}>
      <strong>{result.verdict === "mixed" ? "Posible mezcla de personas" : "Sin conclusión comprobada"}</strong>
      {assessment ? <p><strong>Recomendación: {IDENTITY_RECOMMENDATION[assessment.recommendation]}.</strong> {assessment.explanation}</p> : null}
      <p>{result.rationale}</p>
      {result.evidence.length ? <ul>{result.evidence.map((item, index) => <li key={`${item.url}-${index}`}>
        «{item.quote}» <a href={item.url} target="_blank" rel="noopener noreferrer">Fuente</a>
      </li>)}</ul> : null}
      {result.status === "proposed" ? <div style={{ display: "flex", gap: 8 }}>
        <input aria-label={`Nota para investigación de persona ${personId}`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Conclusión de la revisión" />
        <button type="button" className="btn btn--sm btn--outline" disabled={busy || !note.trim()} onClick={() => run(() => reviewApi.markMixedReviewed(personId, note.trim()))}>Marcar como leída</button>
      </div> : <p>Revisada por {result.reviewedBy}: {result.reviewNote}</p>}
    </div> : null}
  </div>;
}

function FindingCard(props: FindingCardProps) {
  const { finding, categoryLabel, selected, selectionLocked, onToggleSelected, focusedByKeyboard, compact, onOpenSheet, busy } = props;
  const change = lastChangeText(finding);
  const entityLink = refHref(finding.entity, finding);
  const related = finding.related.filter((ref) => !(ref.kind === finding.entity.kind && ref.id === finding.entity.id));
  const recommended = finding.actions[0];
  const selectable = isFixable(finding);
  const research = researchOf(finding);
  const hasEvidence = Object.keys(finding.evidence).some((name) => !HIDDEN_EVIDENCE.has(name));

  return (
    <article
      className={`cfind cfind--${finding.severity}${finding.status !== "open" ? " is-closed" : ""}${selected ? " cfind--picked" : ""}${focusedByKeyboard ? " cfind--focused" : ""}`}
      aria-current={focusedByKeyboard ? "true" : undefined}
    >
      <div className="cfind__badges">
        {/* Solo si hay algo que corregir de un clic: seleccionar un hallazgo sin acción
            solo serviría para que «Corregir seleccionados» lo reporte como no corregible (A2). */}
        {selectable ? (
          <>
            <label className="visually-hidden" htmlFor={`cfind-pick-${finding.id}`}>Seleccionar este hallazgo</label>
            <input id={`cfind-pick-${finding.id}`} type="checkbox" checked={selected} onChange={onToggleSelected}
              {...(selectionLocked ? { title: "Está seleccionado porque lo está todo el filtro; quitarlo pasa a elegir uno a uno." } : {})} />
          </>
        ) : null}
        <span className={`badge ${SEVERITY_BADGE[finding.severity]}`}>{SEVERITY_LABEL[finding.severity]}</span>
        <span className="badge badge--outline">{ENTITY_KIND_LABEL[finding.entity.kind] ?? finding.entity.kind}</span>
        {finding.isNew && finding.status === "open" ? <span className="badge badge--violet"><Sparkle size={11} weight="fill" aria-hidden="true" /> Nuevo</span> : null}
        {finding.status === "ignored" ? <span className="badge">Ignorado</span> : null}
        {finding.status === "resolved" ? <span className="badge badge--teal">Resuelto</span> : null}
        <span className="cfind__detector">
          {categoryLabel ? `${categoryLabel} › ` : ""}{finding.detectorLabel}
          {finding.signatureLabel !== finding.detectorLabel ? ` › ${finding.signatureLabel}` : ""}
        </span>
      </div>

      <h3 className="cfind__title">{finding.title}</h3>

      {research ? <FindingResearch research={research} /> : null}

      {finding.value !== null ? (
        <p className="cfind__value">
          {finding.field ? <span className="cfind__field">{fieldLabel(finding.field)}</span> : null}
          <CurationValue value={finding.value} evidence={finding.evidence} />
        </p>
      ) : null}

      {finding.suggestion ? (
        <p className="cfind__suggestion"><Lightbulb size={15} weight="bold" aria-hidden="true" /> {finding.suggestion}</p>
      ) : null}

      {/* Nivel y consecuencia de la acción recomendada, en una línea (E8.1): qué
          pasa si se pulsa el botón principal, sin abrir el diálogo. */}
      {finding.status === "open" && recommended ? (
        <p className="cfind__level"><Wrench size={13} weight="bold" aria-hidden="true" /> {actionConsequence(recommended)}</p>
      ) : null}

      {finding.triggeredBy.length ? (
        <div className="cfind__chain">
          <ArrowBendDownRight size={15} weight="bold" aria-hidden="true" />
          <span>
            Apareció al corregir:{" "}
            {finding.triggeredBy.map((cause, index) => (
              <span key={cause.id}>{index ? " · " : ""}«{cause.title}»</span>
            ))}
          </span>
        </div>
      ) : null}

      <div className="cfind__refs">
        {entityLink ? (
          <Link className="text-link" to={entityLink} target="_blank" rel="noopener">
            {finding.entity.label || `#${finding.entity.id}`}
            <ArrowSquareOut size={13} weight="bold" aria-hidden="true" />
            <span className="visually-hidden"> (abre la ficha en otra pestaña)</span>
          </Link>
        ) : <span>{finding.entity.label}</span>}
        {finding.entity.id !== null ? <span className="mono cfind__id">#{finding.entity.id}</span> : null}
        {related.length ? (
          <span className="cfind__related">
            <span className="cfind__related-label">Relacionadas:</span>
            {related.slice(0, 8).map((ref) => {
              const href = refHref(ref, finding);
              const label = ref.label || `${ENTITY_KIND_LABEL[ref.kind] ?? ref.kind} #${ref.id ?? "?"}`;
              return href
                ? <Link key={`${ref.kind}-${ref.id}`} className="text-link" to={href} target="_blank" rel="noopener">{label}</Link>
                : <span key={`${ref.kind}-${ref.id}-${ref.label}`}>{label}</span>;
            })}
            {related.length > 8 ? <span>y {related.length - 8} más</span> : null}
          </span>
        ) : null}
      </div>

      {change ? (
        <p className="cfind__note"><ClockCounterClockwise size={13} weight="bold" aria-hidden="true" /> {change}</p>
      ) : null}

      {finding.status === "resolved" && resolutionText(finding) ? (
        <p className="cfind__note">
          {resolutionText(finding)}{finding.resolvedAt ? ` ${relativeTime(finding.resolvedAt)}` : ""}
          {finding.ignoredAt ? ` · antes estaba ignorado${ignoreReasonLabel(finding.ignoreReason) ? ` (${ignoreReasonLabel(finding.ignoreReason)!.toLowerCase()})` : ""}` : ""}
        </p>
      ) : null}

      {finding.status === "ignored" && (finding.ignoredBy || finding.ignoreNote || finding.ignoreReason) ? (
        <p className="cfind__note">
          Ignorado{finding.ignoredBy ? ` por ${finding.ignoredBy}` : ""}{finding.ignoredAt ? ` ${relativeTime(finding.ignoredAt)}` : ""}
          {ignoreReasonLabel(finding.ignoreReason) ? ` · ${ignoreReasonLabel(finding.ignoreReason)}` : ""}
          {finding.ignoreNote ? `: ${finding.ignoreNote}` : ""}
        </p>
      ) : null}

      {finding.detector === "trayectoria_imposible" && finding.entity.kind === "person" && finding.entity.id !== null && finding.status === "open"
        ? <MixedPersonWebResearch personId={finding.entity.id} /> : null}

      {finding.status === 'open' && finding.entity.id !== null && ['artist','person','album','organization','track'].includes(finding.entity.kind) ? <div className="cfind__ai"><Link className="btn btn--sm" to={`/curaduria/ia?kind=${finding.entity.kind}&id=${finding.entity.id}&instruction=${encodeURIComponent(researchInstruction(finding))}`}>Preparar corrección con IA</Link><span>Revisa la propuesta antes de aceptar cambios.</span></div> : null}
      {finding.category === "fichas_repetidas" && finding.entity.kind === "person" && finding.status === "open" && findingPair(finding)
        ? <PersonPairWebResearch aId={findingPair(finding)![0]} bId={findingPair(finding)![1]} autoLoad={false} /> : null}

      {hasEvidence || !props.hideActions ? <div className="cfind__foot">
        {hasEvidence ? <details className="cfind__evidence">
          <summary>Evidencia <CaretDown size={12} weight="bold" aria-hidden="true" /></summary>
          <FindingEvidence evidence={finding.evidence} />
        </details> : null}
        {props.hideActions ? null : compact ? (
          <div className="cfind__actions">
            <button type="button" className="btn btn--sm btn--primary" onClick={onOpenSheet} disabled={busy}>
              <DotsThree size={16} weight="bold" aria-hidden="true" /> Acciones
            </button>
          </div>
        ) : (
          <FindingActions {...props} layout="row" />
        )}
      </div> : null}
    </article>
  );
}
