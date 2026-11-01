// CRV · Curaduría › Roadmap — el /admin de Herra con la piel del catálogo (B6).
//
// Una sola página: cabecera, tarjeta de progreso, barra de herramientas con
// contadores, los dos avisos de orden, y las etapas y actividades editables en
// el sitio (arrastre con ratón, táctil y teclado). Los textos vienen de
// `roadmapAdminCopy` y los componentes son los del catálogo: Modal,
// ConfirmDialog, avisos de ToastContext e iconos Phosphor.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, ArrowSquareOut, CheckCircle, Circle, CircleHalf,
  ChartLine, ClipboardText, DotsSixVertical, Gear, IdentificationCard, LinkSimple,
  ListChecks, NotePencil, Palette, Plus, PushPin, PushPinSlash, Translate, Trash, UsersThree,
  type Icon,
} from "@phosphor-icons/react";
import {
  roadmapApi, type AdminCategory, type AdminRoadmap, type AdminTask, type TaskStatus,
} from "../lib/roadmap";
import { communityApi } from "../lib/community";
import { roadmapAdminCopy } from "../lib/roadmapAdminCopy";
import { useI18n } from "../lib/i18n";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { taskDropPosition } from "../lib/roadmapOrder";
import { Modal } from "../components/Modal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PeopleWindow } from "../components/roadmap/PeopleWindow";
import { ErrorState, LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";
import "../styles/roadmap-admin.css";

type ToolId =
  | "nueva-actividad" | "nueva-etapa" | "personas" | "pendientes" | "candidaturas"
  | "metricas" | "formulario" | "enlaces" | "identidad" | "idiomas" | "ajustes"
  | "clave" | "publica";

interface ToolDef {
  id: ToolId;
  label: string;
  icon: Icon;
  count?: number;
  enabled: boolean;
  href?: string;
}

/** Estado de arrastre por teclado: se previsualiza en local y se guarda con Enter. */
type Grab =
  | { kind: "task"; categoryId: number; id: number; ids: number[] }
  | { kind: "stage"; id: number; ids: number[] }
  | null;

const STATUS_ICON: Record<TaskStatus, Icon> = {
  completed: CheckCircle,
  in_progress: CircleHalf,
  pending: Circle,
};

function enValue(form: FormData): string {
  return String(form.get("titleEn") ?? "").trim();
}

function assignedValues(form: FormData): number[] {
  return form.getAll("assignees").map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

function moveWithin<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

export function CurationRoadmapPage() {
  const { lang } = useI18n();
  const copy = roadmapAdminCopy(lang);
  const { notify } = useToast();
  const roadmap = useAsync<AdminRoadmap>(() => roadmapApi.admin(), []);
  const overview = useAsync(() => communityApi.overview(), []);
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [grab, setGrab] = useState<Grab>(null);
  const [newTask, setNewTask] = useState<{ categoryId?: number; position?: number } | null>(null);
  const [newStage, setNewStage] = useState(false);
  const [editStage, setEditStage] = useState<AdminCategory | null>(null);
  const [editTask, setEditTask] = useState<AdminTask | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "stage"; category: AdminCategory }
    | { kind: "task"; task: AdminTask }
    | null
  >(null);

  const tool = (params.get("herramienta") ?? "") as ToolId | "";

  function openTool(id: ToolId): void {
    if (id === "nueva-actividad") { setNewTask({}); return; }
    if (id === "nueva-etapa") { setNewStage(true); return; }
    const next = new URLSearchParams(params);
    next.set("herramienta", id);
    setParams(next, { replace: true });
  }

  function closeTool(): void {
    const next = new URLSearchParams(params);
    next.delete("herramienta");
    setParams(next, { replace: true });
  }

  // Un enlace con ?herramienta= desconocida o de un bloque que aún no existe
  // no debe dejar la URL mintiendo: se limpia.
  useEffect(() => {
    const known: ToolId[] = ["nueva-actividad", "nueva-etapa", "personas", "pendientes"];
    if (tool && !known.includes(tool)) closeTool();
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: () => Promise<unknown>, success: string, undo?: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      if (undo) {
        notify("success", success, { action: { label: copy.undo, onAction: () => { void undo().then(() => roadmap.reload()).catch((error: unknown) => notify("error", error instanceof Error ? error.message : copy.saveFailed)); } } });
      } else {
        notify("success", success);
      }
      roadmap.reload();
      return true;
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reorderTask(task: AdminTask, categoryId: number, position: number, previousPosition: number): Promise<void> {
    const ok = await run(
      () => roadmapApi.updateTask(task.id, { categoryId, position }),
      copy.toasts.taskSaved,
      () => roadmapApi.updateTask(task.id, { categoryId: task.categoryId, position: previousPosition, pinned: task.orderPinned }),
    );
    if (!ok) return;
    setGrab(null);
  }

  async function reorderStage(category: AdminCategory, position: number, previousPosition: number): Promise<void> {
    const ok = await run(
      () => roadmapApi.updateCategory(category.id, { position }),
      copy.toasts.stageSaved,
      () => roadmapApi.updateCategory(category.id, { position: previousPosition }),
    );
    if (!ok) return;
    setGrab(null);
  }

  async function togglePin(task: AdminTask): Promise<void> {
    await run(
      () => roadmapApi.updateTask(task.id, { pinned: !task.orderPinned }),
      task.orderPinned ? copy.toasts.unpinned : copy.toasts.pinned,
      () => roadmapApi.updateTask(task.id, { position: task.sortOrder, pinned: task.orderPinned }),
    );
  }

  if (roadmap.loading) return <div className="community-page"><LoadingState label="Cargando el roadmap…" /></div>;
  if (roadmap.error) return <div className="community-page"><ErrorState message={roadmap.error} onRetry={() => void roadmap.reload()} /></div>;
  const data = roadmap.data;
  if (!data) return null;

  const counts = overview.data;
  const categories = data.categories;
  const stageOrder = grab?.kind === "stage" ? grab.ids : categories.map((category) => category.id);
  const orderedCategories = stageOrder
    .map((id) => categories.find((category) => category.id === id))
    .filter((category): category is AdminCategory => Boolean(category));

  function dropTask(sourceId: number, targetCategoryId: number, targetId: number | null, after: boolean): void {
    const source = categories.find((item) => item.tasks.some((task) => task.id === sourceId));
    const destination = categories.find((item) => item.id === targetCategoryId);
    const task = source?.tasks.find((item) => item.id === sourceId);
    const target = destination ? (targetId === null ? destination.tasks.length + 1 : destination.tasks.findIndex((item) => item.id === targetId) + 1) : 0;
    if (!source || !destination || !task || !target || sourceId === targetId) return;
    const previousPosition = source.tasks.findIndex((item) => item.id === sourceId) + 1;
    const position = taskDropPosition(target, after, source.id === destination.id ? previousPosition : null);
    void run(
      () => roadmapApi.updateTask(task.id, { categoryId: destination.id, position }),
      copy.toasts.taskSaved,
      () => roadmapApi.updateTask(task.id, { categoryId: source.id, position: previousPosition, pinned: task.orderPinned }),
    );
  }

  function dropStage(sourceId: number, targetId: number, after: boolean): void {
    const sourceIndex = categories.findIndex((item) => item.id === sourceId);
    const targetIndex = categories.findIndex((item) => item.id === targetId);
    const source = categories[sourceIndex];
    if (!source || targetIndex < 0 || sourceId === targetId) return;
    const previousPosition = sourceIndex + 1;
    void reorderStage(source, taskDropPosition(targetIndex + 1, after, previousPosition), previousPosition);
  }

  function touchDrop(kind: "task" | "stage", sourceId: number, x: number, y: number): void {
    const element = document.elementFromPoint(x, y);
    const stage = element?.closest<HTMLElement>("[data-category-id]");
    if (!stage) return;
    const targetCategory = Number(stage.dataset.categoryId);
    if (kind === "stage") {
      const rect = stage.getBoundingClientRect();
      dropStage(sourceId, targetCategory, y > rect.top + rect.height / 2);
      return;
    }
    const row = element?.closest<HTMLElement>("[data-roadmap-task-id]");
    if (!row) { dropTask(sourceId, targetCategory, null, false); return; }
    const rect = row.getBoundingClientRect();
    dropTask(sourceId, targetCategory, Number(row.dataset.roadmapTaskId), y > rect.top + rect.height / 2);
  }

  function crossStage(current: Exclude<Grab, null> & { kind: "task" }, direction: -1 | 1): void {
    const at = categories.findIndex((category) => category.id === current.categoryId);
    const next = categories[at + direction];
    if (!next) return;
    const ids = next.tasks.map((task) => task.id).filter((id) => id !== current.id);
    if (direction < 0) ids.push(current.id); else ids.unshift(current.id);
    setGrab({ ...current, categoryId: next.id, ids });
  }

  const tools: ToolDef[] = [
    { id: "nueva-actividad", label: copy.tools.newTask, icon: Plus, enabled: true },
    { id: "nueva-etapa", label: copy.tools.newStage, icon: ListChecks, enabled: true },
    { id: "personas", label: copy.tools.people, icon: UsersThree, count: counts?.collaborators ?? data.users.length, enabled: true },
    { id: "pendientes", label: copy.tools.pending, icon: IdentificationCard, count: counts?.pending_collaborators ?? 0, enabled: true },
    { id: "candidaturas", label: copy.tools.applications, icon: ClipboardText, count: counts?.pending_applications ?? 0, enabled: false },
    { id: "metricas", label: copy.tools.metrics, icon: ChartLine, enabled: false },
    { id: "formulario", label: copy.tools.form, icon: NotePencil, enabled: false },
    { id: "enlaces", label: copy.tools.invites, icon: LinkSimple, enabled: false },
    { id: "identidad", label: copy.tools.branding, icon: Palette, enabled: false },
    { id: "idiomas", label: copy.tools.languages, icon: Translate, enabled: false },
    { id: "ajustes", label: copy.tools.settings, icon: Gear, enabled: false },
    { id: "clave", label: copy.tools.password, icon: IdentificationCard, enabled: false },
    { id: "publica", label: copy.tools.viewPublic, icon: ArrowSquareOut, enabled: true, href: "/roadmap" },
  ];

  return (
    <div className="community-page roadmap-admin">
      <header className="roadmap-admin__hero">
        <span className="roadmap-admin__chip">{copy.badge}</span>
        <h1 className="roadmap-admin__title">{copy.title1}<br />{copy.title2}<span className="roadmap-admin__dot-end">.</span></h1>
        <p className="roadmap-admin__sub">{copy.heroSub}</p>
      </header>

      <section className="roadmap-admin__progress-card" aria-label={copy.overallWord}>
        <div className="roadmap-admin__pct">
          <strong>{Math.round(data.overall.percentage)}%</strong>
          <span>{copy.overallWord}</span>
        </div>
        <div className="roadmap-admin__progress-meta">
          <p>{copy.completedOf(data.overall.completed, data.overall.total)}</p>
          <div className="roadmap-admin__bar"><i style={{ width: `${Math.min(100, data.overall.percentage)}%` }} /></div>
        </div>
      </section>

      <section className="roadmap-admin__tools-block">
        <div className="roadmap-admin__tools-head">
          <span className="roadmap-admin__kicker">{copy.adminKicker}</span>
          <h2>{copy.toolsTitle}</h2>
          <p>{copy.toolsSub}</p>
        </div>
        <div className="roadmap-admin__tools" role="toolbar" aria-label={copy.toolsTitle}>
          {tools.map((item, index) => {
            const Glyph = item.icon;
            const shared = {
              className: `roadmap-admin__tool${index === 0 ? " roadmap-admin__tool--primary" : ""}`,
              disabled: !item.enabled,
              title: item.enabled ? item.label : `${item.label} — ${copy.pendingTool}`,
            };
            const inner = (
              <>
                <Glyph size={18} aria-hidden="true" />
                <span>{item.label}</span>
                {item.count !== undefined && item.count > 0 ? <em className="roadmap-admin__count">{item.count}</em> : null}
              </>
            );
            return item.href ? (
              <a key={item.id} {...shared} href={item.href} target="_blank" rel="noreferrer">{inner}</a>
            ) : (
              <button key={item.id} {...shared} type="button" onClick={() => openTool(item.id)}>{inner}</button>
            );
          })}
        </div>
      </section>

      <div className="roadmap-admin__notices">
        <p className="roadmap-admin__notice"><strong>{copy.reorderLead}</strong> {copy.reorderRest}</p>
        <p className="roadmap-admin__notice"><strong>{copy.queueLead}</strong> {copy.queueRest}</p>
      </div>

      <div className="roadmap-admin__stages">
        {orderedCategories.map((category, index) => (
          <StageBlock
            key={`${category.id}-${category.title}`}
            category={category}
            index={index}
            stageIds={categories.map((item) => item.id)}
            draggedTask={grab?.kind === "task" ? categories.flatMap((item) => item.tasks).find((item) => item.id === grab.id) ?? null : null}
            copy={copy}
            busy={busy}
            grab={grab}
            onGrabChange={setGrab}
            onReorderStage={reorderStage}
            onDropStage={dropStage}
            onTouchDrop={touchDrop}
            onCrossStage={crossStage}
            onEditStage={() => setEditStage(category)}
            onDeleteStage={() => setConfirm({ kind: "stage", category })}
            onNewTask={(position) => setNewTask({ categoryId: category.id, ...(position ? { position } : {}) })}
            onEditTask={setEditTask}
            onDeleteTask={(task) => setConfirm({ kind: "task", task })}
            onTogglePin={(task) => void togglePin(task)}
            onReorderTask={(task, position, previousPosition) => void reorderTask(task, category.id, position, previousPosition)}
            onDropTask={(taskId, targetId, after) => dropTask(taskId, category.id, targetId, after)}
          />
        ))}
      </div>

      {tool === "personas" ? (
        <PeopleWindow
          title={copy.tools.people}
          kicker={copy.adminKicker}
          onClose={closeTool}
          onChanged={() => { roadmap.reload(); overview.reload(); }}
        />
      ) : null}

      {tool === "pendientes" ? (
        <PeopleWindow
          title={copy.tools.pending}
          kicker={copy.adminKicker}
          mode="pending"
          onClose={closeTool}
          onChanged={() => { roadmap.reload(); overview.reload(); }}
        />
      ) : null}

      {newTask ? (
        <NewTaskModal
          copy={copy}
          categories={categories}
          users={data.users}
          initial={newTask}
          onClose={() => setNewTask(null)}
          onCreated={() => { setNewTask(null); roadmap.reload(); }}
        />
      ) : null}

      {newStage ? (
        <NewStageModal copy={copy} onClose={() => setNewStage(false)} onCreated={() => { setNewStage(false); roadmap.reload(); }} />
      ) : null}

      {editStage ? (
        <EditStageModal
          copy={copy}
          category={editStage}
          onClose={() => setEditStage(null)}
          onSaved={() => { setEditStage(null); roadmap.reload(); }}
        />
      ) : null}

      {editTask ? (
        <EditTaskModal
          copy={copy}
          task={editTask}
          categories={categories}
          users={data.users}
          onClose={() => setEditTask(null)}
          onSaved={() => { setEditTask(null); roadmap.reload(); }}
        />
      ) : null}

      {confirm?.kind === "stage" ? (
        <ConfirmDialog
          title={copy.deleteStageTitle}
          description={copy.deleteStageText(confirm.category.title, confirm.category.tasks.length)}
          confirmLabel={copy.delete}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const category = confirm.category;
            setConfirm(null);
            await run(() => roadmapApi.deleteCategory(category.id, true), copy.toasts.stageDeleted);
          }}
        />
      ) : null}

      {confirm?.kind === "task" ? (
        <ConfirmDialog
          title={copy.deleteTaskTitle}
          description={copy.deleteTaskText(confirm.task.title)}
          confirmLabel={copy.delete}
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const task = confirm.task;
            setConfirm(null);
            await run(() => roadmapApi.deleteTask(task.id), copy.toasts.taskDeleted);
          }}
        />
      ) : null}

    </div>
  );
}

function StageBlock({ category, index, stageIds, draggedTask, copy, busy, grab, onGrabChange, onReorderStage, onDropStage, onTouchDrop, onCrossStage, onReorderTask, onEditStage, onDeleteStage, onNewTask, onEditTask, onDeleteTask, onTogglePin, onDropTask }: {
  category: AdminCategory;
  index: number;
  stageIds: number[];
  draggedTask: AdminTask | null;
  copy: ReturnType<typeof roadmapAdminCopy>;
  busy: boolean;
  grab: Grab;
  onGrabChange: (grab: Grab) => void;
  onReorderStage: (category: AdminCategory, position: number, previousPosition: number) => Promise<void>;
  onDropStage: (sourceId: number, targetId: number, after: boolean) => void;
  onTouchDrop: (kind: "task" | "stage", sourceId: number, x: number, y: number) => void;
  onCrossStage: (grab: Exclude<Grab, null> & { kind: "task" }, direction: -1 | 1) => void;
  onReorderTask: (task: AdminTask, position: number, previousPosition: number) => void;
  onEditStage: () => void;
  onDeleteStage: () => void;
  onNewTask: (position?: number) => void;
  onEditTask: (task: AdminTask) => void;
  onDeleteTask: (task: AdminTask) => void;
  onTogglePin: (task: AdminTask) => void;
  onDropTask: (taskId: number, targetId: number | null, after: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number | "all">(5);
  const [bubble, setBubble] = useState<number | null>(null);
  const touch = useRef<{ kind: "task" | "stage"; id: number; x: number; y: number } | null>(null);

  function beginTouch(event: ReactPointerEvent<HTMLButtonElement>, kind: "task" | "stage", id: number): void {
    if (event.pointerType !== "touch" || busy) return;
    touch.current = { kind, id, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endTouch(event: ReactPointerEvent<HTMLButtonElement>): void {
    const start = touch.current;
    touch.current = null;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) return;
    onTouchDrop(start.kind, start.id, event.clientX, event.clientY);
  }

  function moveTouch(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!touch.current) return;
    if (event.clientY < 64) window.scrollBy(0, -14);
    else if (event.clientY > window.innerHeight - 64) window.scrollBy(0, 14);
  }

  const taskOrder = grab?.kind === "task" && grab.categoryId === category.id ? grab.ids
    : category.tasks.map((task) => task.id).filter((id) => !(grab?.kind === "task" && grab.categoryId !== category.id && id === grab.id));
  const orderedTasks = useMemo(
    () => taskOrder.map((id) => category.tasks.find((task) => task.id === id) ?? (draggedTask?.id === id ? draggedTask : undefined)).filter((task): task is AdminTask => Boolean(task)),
    [taskOrder.join(","), category.tasks, draggedTask], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const totalTasks = orderedTasks.length;
  const perPage = size === "all" ? Math.max(1, totalTasks) : size;
  const pages = Math.max(1, Math.ceil(totalTasks / perPage));
  const currentPage = Math.min(page, Math.max(1, pages));
  const start = (currentPage - 1) * perPage;
  const visible = orderedTasks.slice(start, start + perPage);
  const pct = Math.round(category.progress.percentage);

  useEffect(() => {
    if (grab?.kind !== "task" || grab.categoryId !== category.id) return;
    const at = orderedTasks.findIndex((item) => item.id === grab.id);
    if (at < 0) return;
    const targetPage = Math.floor(at / perPage) + 1;
    if (targetPage !== currentPage) { setPage(targetPage); return; }
    const frame = window.requestAnimationFrame(() => {
      const handle = document.querySelector<HTMLButtonElement>(`[data-roadmap-task-id="${grab.id}"] .roadmap-admin__drag`);
      if (handle && document.activeElement !== handle) handle.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [grab, category.id, orderedTasks, perPage, currentPage]);

  function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const isGrabbed = grab?.kind === "stage" && grab.id === category.id;
    if (!isGrabbed && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      onGrabChange({ kind: "stage", id: category.id, ids: stageIds });
      return;
    }
    if (!isGrabbed || grab?.kind !== "stage") return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const from = grab.ids.indexOf(category.id);
      onGrabChange({ ...grab, ids: moveWithin(grab.ids, from, from + (event.key === "ArrowUp" ? -1 : 1)) });
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void onReorderStage(category, grab.ids.indexOf(category.id) + 1, stageIds.indexOf(category.id) + 1);
    }
    if (event.key === "Escape") { event.preventDefault(); onGrabChange(null); }
  }

  return (
    <section className={`roadmap-admin__stage roadmap-stage--${category.colorKey}`} data-category-id={category.id}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-crv-stage") || event.dataTransfer.types.includes("application/x-crv-task")) event.preventDefault(); }}
      onDrop={(event) => {
        const taskSource = Number(event.dataTransfer.getData("application/x-crv-task"));
        if (Number.isInteger(taskSource) && taskSource > 0) {
          event.preventDefault();
          onDropTask(taskSource, null, false);
          return;
        }
        const source = Number(event.dataTransfer.getData("application/x-crv-stage"));
        if (!Number.isInteger(source) || source < 1 || source === category.id) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onDropStage(source, category.id, event.clientY > rect.top + rect.height / 2);
      }}>
      <div className="roadmap-admin__stage-head">
        <button
          type="button" className="roadmap-admin__drag" draggable
          disabled={busy}
          aria-pressed={grab?.kind === "stage" && grab.id === category.id}
          aria-label={copy.reorderStageAria(category.title)} title={copy.dragToReorder}
          onDragStart={(event) => { event.dataTransfer.setData("application/x-crv-stage", String(category.id)); event.dataTransfer.effectAllowed = "move"; }}
          onPointerDown={(event) => beginTouch(event, "stage", category.id)}
          onPointerMove={moveTouch}
          onPointerUp={endTouch}
          onPointerCancel={() => { touch.current = null; }}
          onKeyDown={onHandleKeyDown}
        >
          <DotsSixVertical size={16} aria-hidden="true" />
        </button>
        <div className="roadmap-admin__stage-titles">
          <span className="roadmap-admin__phase">{copy.phase(index + 1)}</span>
          <h3>
            {category.title}
            <button type="button" className="roadmap-admin__icon" onClick={onEditStage} disabled={busy} aria-label={copy.editStageAria(category.title)} title={copy.editStageAria(category.title)}>
              <NotePencil size={15} aria-hidden="true" />
            </button>
            <button type="button" className="roadmap-admin__icon" onClick={onDeleteStage} disabled={busy} aria-label={copy.deleteStageAria(category.title)} title={copy.deleteStageAria(category.title)}>
              <Trash size={15} aria-hidden="true" />
            </button>
          </h3>
        </div>
        <div className="roadmap-admin__score">
          <strong>{pct}%</strong>
          <span>{copy.score(category.progress.completed, category.progress.total)}</span>
        </div>
      </div>

      <div className="roadmap-admin__bar roadmap-admin__bar--stage"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>

      <button type="button" className="roadmap-admin__add-top" onClick={() => onNewTask(1)} disabled={busy}>
        <Plus size={14} aria-hidden="true" />
        <span>{copy.addAtTop}</span>
        <em>{copy.position1}</em>
      </button>

      <ul className="roadmap-admin__rows">
        {visible.map((task) => {
          const StatusGlyph = STATUS_ICON[task.status];
          const names = task.assignedUsers.map((user) => user.displayName || user.name);
          return (
            <li
              key={`${task.id}-${task.updatedAt}`}
              data-roadmap-task-id={task.id}
              className={`roadmap-admin__row${task.status === "completed" ? " roadmap-admin__row--done" : ""}${grab?.kind === "task" && grab.id === task.id ? " roadmap-admin__row--grabbed" : ""}`}
              draggable
              onDragStart={(event) => { event.dataTransfer.setData("application/x-crv-task", String(task.id)); event.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-crv-task")) event.preventDefault(); }}
              onDrop={(event) => {
                const source = Number(event.dataTransfer.getData("application/x-crv-task"));
                if (!Number.isInteger(source) || source < 1) return;
                event.preventDefault();
                event.stopPropagation();
                if (source === task.id) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const after = event.clientY > rect.top + rect.height / 2;
                onDropTask(source, task.id, after);
              }}
            >
              <button
                type="button" className="roadmap-admin__drag" draggable
                disabled={busy}
                aria-pressed={grab?.kind === "task" && grab.id === task.id}
                aria-label={copy.reorderTaskAria(task.title)} title={copy.dragToReorder}
                onDragStart={(event) => { event.dataTransfer.setData("application/x-crv-task", String(task.id)); event.dataTransfer.effectAllowed = "move"; }}
                onPointerDown={(event) => beginTouch(event, "task", task.id)}
                onPointerMove={moveTouch}
                onPointerUp={endTouch}
                onPointerCancel={() => { touch.current = null; }}
                onKeyDown={(event) => {
                  if ((grab?.kind !== "task" || grab.id !== task.id) && (event.key === " " || event.key === "Enter")) {
                    event.preventDefault();
                    onGrabChange({ kind: "task", categoryId: category.id, id: task.id, ids: orderedTasks.map((item) => item.id) });
                    return;
                  }
                  if (grab?.kind !== "task" || grab.id !== task.id) return;
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    const from = grab.ids.indexOf(task.id);
                    const direction = event.key === "ArrowUp" ? -1 : 1;
                    if ((direction < 0 && from === 0) || (direction > 0 && from === grab.ids.length - 1)) onCrossStage(grab, direction);
                    else onGrabChange({ ...grab, ids: moveWithin(grab.ids, from, from + direction) });
                  }
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    const previousPosition = task.sortOrder;
                    const target = grab.ids.indexOf(task.id) + 1;
                    onReorderTask(task, target, previousPosition);
                  }
                  if (event.key === "Escape") { event.preventDefault(); onGrabChange(null); }
                }}
              >
                <DotsSixVertical size={15} aria-hidden="true" />
              </button>

              <StatusGlyph size={18} className={`roadmap-admin__status-icon roadmap-admin__status-icon--${task.status}`} aria-hidden="true" />
              <span className="roadmap-admin__row-title">{task.title}</span>
              <span className={`roadmap-admin__state roadmap-admin__state--${task.status}`}>{copy.status[task.status]}</span>

              <span className="roadmap-admin__bubble-wrap">
                <button
                  type="button" className="roadmap-admin__bubble"
                  aria-label={copy.assigneeAria(names.length)}
                  aria-expanded={bubble === task.id}
                  onClick={() => setBubble(bubble === task.id ? null : task.id)}
                >
                  <UsersThree size={13} aria-hidden="true" />
                  {names.length || copy.unassigned}
                </button>
                {bubble === task.id && names.length > 0 ? (
                  <span className="roadmap-admin__bubble-pop" role="tooltip">{names.join(" · ")}</span>
                ) : null}
              </span>

              <button
                type="button" className="roadmap-admin__icon"
                aria-pressed={task.orderPinned}
                aria-label={task.orderPinned ? copy.unpin : copy.pin}
                title={task.orderPinned ? copy.unpinnedTitle : copy.pinnedTitle}
                onClick={() => onTogglePin(task)} disabled={busy}
              >
                {task.orderPinned ? <PushPinSlash size={15} aria-hidden="true" /> : <PushPin size={15} aria-hidden="true" />}
              </button>
              <button type="button" className="roadmap-admin__icon" onClick={() => onEditTask(task)} disabled={busy} aria-label={copy.editTaskAria(task.title)} title={copy.editTaskAria(task.title)}>
                <NotePencil size={15} aria-hidden="true" />
              </button>
              <button type="button" className="roadmap-admin__icon" onClick={() => onDeleteTask(task)} disabled={busy} aria-label={copy.deleteTaskAria(task.title)} title={copy.deleteTaskAria(task.title)}>
                <Trash size={15} aria-hidden="true" />
              </button>
            </li>
          );
        })}
        {totalTasks === 0 ? <li className="roadmap-admin__empty">{copy.emptyStage}</li> : null}
      </ul>

      <footer className="roadmap-admin__stage-foot">
        <label>
          <span>{copy.perPageIn(category.title)}</span>
          <select value={String(size)} onChange={(event) => { const value = event.target.value; setSize(value === "all" ? "all" : Number(value)); setPage(1); }}>
            {[5, 10, 15, 20, 25].map((value) => <option key={value} value={value}>{value}</option>)}
            <option value="all">{copy.all}</option>
          </select>
        </label>
        <div className="roadmap-admin__pager">
          <button type="button" onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} aria-label={copy.previousPage}>
            <ArrowLeft size={14} aria-hidden="true" />
          </button>
          <span>{copy.pageOf(currentPage, pages, totalTasks)}</span>
          <button type="button" onClick={() => setPage(Math.min(pages, currentPage + 1))} disabled={currentPage >= pages} aria-label={copy.nextPage}>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  );
}

function NewTaskModal({ copy, categories, users, initial, onClose, onCreated }: {
  copy: ReturnType<typeof roadmapAdminCopy>;
  categories: AdminCategory[];
  users: AdminRoadmap["users"];
  initial: { categoryId?: number; position?: number };
  onClose: () => void;
  onCreated: () => void;
}) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const en = enValue(form);
    const categoryId = Number(form.get("categoryId"));
    const position = Number(form.get("position"));
    const status = String(form.get("status") ?? "pending") as TaskStatus;
    const assigned = assignedValues(form);
    setBusy(true);
    try {
      await roadmapApi.createTask({
        categoryId, title, status,
        ...(position > 0 ? { position } : {}),
        ...(en ? { translations: { en } } : {}),
        ...(assigned.length ? { assignedUserIds: assigned } : {}),
      });
      notify("success", copy.toasts.taskCreated);
      onCreated();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={copy.newTaskTitle} kicker={copy.newTaskKicker} onClose={onClose} closeOnOverlay={false}>
      <form className="roadmap-admin__form" onSubmit={(event) => void submit(event)}>
        <div className="field span-2">
          <label htmlFor="nt-title">{copy.activityLabel} *</label>
          <input id="nt-title" name="title" required maxLength={300} placeholder={copy.activityPlaceholder} autoFocus />
        </div>
        <div className="field span-2">
          <label htmlFor="nt-title-en">{copy.englishTitle}</label>
          <input id="nt-title-en" name="titleEn" maxLength={300} />
          <small className="community-muted">{copy.englishHelp}</small>
        </div>
        <div className="field">
          <label htmlFor="nt-category">{copy.category}</label>
          <select id="nt-category" name="categoryId" defaultValue={String(initial.categoryId ?? categories[0]?.id ?? "")}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nt-status">{copy.state}</label>
          <select id="nt-status" name="status" defaultValue="pending">
            {Object.entries(copy.status).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="nt-position">{copy.startPosition}</label>
          <input id="nt-position" name="position" type="number" min={1} step={1} defaultValue={initial.position ?? ""} placeholder={copy.endPlaceholder} />
        </div>
        <div className="field">
          <label htmlFor="nt-assignees">{copy.assignTo}</label>
          <select id="nt-assignees" name="assignees" multiple size={Math.min(5, Math.max(2, users.length))}>
            {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
          </select>
        </div>
        <div className="span-2 roadmap-admin__form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? copy.saving : copy.create}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>{copy.cancel}</button>
        </div>
      </form>
    </Modal>
  );
}

function NewStageModal({ copy, onClose, onCreated }: {
  copy: ReturnType<typeof roadmapAdminCopy>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const en = enValue(form);
    setBusy(true);
    try {
      await roadmapApi.createCategory({ title, ...(en ? { translations: { en } } : {}) });
      notify("success", copy.toasts.stageCreated);
      onCreated();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={copy.newStageTitle} kicker={copy.newStageKicker} onClose={onClose} closeOnOverlay={false}>
      <form className="roadmap-admin__form" onSubmit={(event) => void submit(event)}>
        <div className="field span-2">
          <label htmlFor="ns-title">{copy.stageTitleLabel} *</label>
          <input id="ns-title" name="title" required maxLength={300} autoFocus />
        </div>
        <div className="field span-2">
          <label htmlFor="ns-en">{copy.englishTitle}</label>
          <input id="ns-en" name="titleEn" maxLength={300} />
        </div>
        <div className="span-2 roadmap-admin__form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? copy.saving : copy.createStage}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>{copy.cancel}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditStageModal({ copy, category, onClose, onSaved }: {
  copy: ReturnType<typeof roadmapAdminCopy>;
  category: AdminCategory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const en = enValue(form);
    setBusy(true);
    try {
      await roadmapApi.updateCategory(category.id, { title, ...(en ? { translations: { en } } : { translations: {} }) });
      notify("success", copy.toasts.stageSaved);
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={copy.editStageTitle} kicker={copy.editStageKicker} onClose={onClose} closeOnOverlay={false}>
      <form className="roadmap-admin__form" onSubmit={(event) => void submit(event)}>
        <div className="field span-2">
          <label htmlFor="es-title">{copy.stageTitleLabel} *</label>
          <input id="es-title" name="title" defaultValue={category.title} required maxLength={300} autoFocus />
        </div>
        <div className="field span-2">
          <label htmlFor="es-en">{copy.englishTitle}</label>
          <input id="es-en" name="titleEn" defaultValue={category.i18n.en ?? ""} maxLength={300} />
        </div>
        <div className="span-2 roadmap-admin__form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? copy.saving : copy.save}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>{copy.cancel}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditTaskModal({ copy, task, categories, users, onClose, onSaved }: {
  copy: ReturnType<typeof roadmapAdminCopy>;
  task: AdminTask;
  categories: AdminCategory[];
  users: AdminRoadmap["users"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const en = enValue(form);
    const status = String(form.get("status") ?? task.status) as TaskStatus;
    const categoryId = Number(form.get("categoryId"));
    const assigned = assignedValues(form);
    setBusy(true);
    try {
      await roadmapApi.updateTask(task.id, {
        title, status, categoryId, assignedUserIds: assigned,
        ...(en ? { translations: { en } } : { translations: {} }),
      });
      if (status !== task.status) {
        // El estado es reversible: el aviso permite volver al anterior.
        notify("success", copy.toasts.taskSaved, {
          action: {
            label: copy.undo,
            onAction: async () => {
              try {
                await roadmapApi.updateTask(task.id, {
                  title: task.title, status: task.status, categoryId: task.categoryId,
                  position: task.sortOrder, pinned: task.orderPinned, completedAt: task.completedAt,
                  assignedUserIds: task.assignedUsers.map((person) => person.id), translations: task.i18n,
                });
                notify("success", copy.toasts.undone);
                onSaved();
              } catch (error) {
                notify("error", error instanceof Error ? error.message : copy.saveFailed);
              }
            },
          },
        });
      } else {
        notify("success", copy.toasts.taskSaved);
      }
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={copy.editTaskTitle} kicker={copy.editTaskKicker} onClose={onClose} closeOnOverlay={false}>
      <form className="roadmap-admin__form" onSubmit={(event) => void submit(event)}>
        <div className="field span-2">
          <label htmlFor="et-title">{copy.activityLabel} *</label>
          <input id="et-title" name="title" defaultValue={task.title} required maxLength={300} autoFocus />
        </div>
        <div className="field span-2">
          <label htmlFor="et-en">{copy.englishTitle}</label>
          <input id="et-en" name="titleEn" defaultValue={task.i18n.en ?? ""} maxLength={300} />
        </div>
        <div className="field">
          <label htmlFor="et-status">{copy.state}</label>
          <select id="et-status" name="status" defaultValue={task.status}>
            {Object.entries(copy.status).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="et-category">{copy.category}</label>
          <select id="et-category" name="categoryId" defaultValue={task.categoryId}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="et-assignees">{copy.assignTo}</label>
          <select id="et-assignees" name="assignees" multiple size={Math.min(5, Math.max(2, users.length))} defaultValue={task.assignedUsers.map((user) => String(user.id))}>
            {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
          </select>
        </div>
        <div className="span-2 roadmap-admin__form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? copy.saving : copy.save}</button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>{copy.cancel}</button>
        </div>
      </form>
    </Modal>
  );
}
