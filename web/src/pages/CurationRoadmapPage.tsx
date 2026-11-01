// CRV · Curaduría › Roadmap (Fase 2).
//
// CRUD de etapas y actividades, orden manual, anclaje, responsables y
// traducciones EN. Cada escritura devuelve el roadmap completo y la página se
// refresca; el progreso se deriva siempre de los estados reales.
import { useState, type DragEvent, type FormEvent } from "react";
import { ArrowDown, ArrowUp, DotsSixVertical, Plus, PushPin, PushPinSlash, Trash, X } from "@phosphor-icons/react";
import {
  roadmapApi, type AdminCategory, type AdminRoadmap, type AdminTask, type TaskStatus,
} from "../lib/roadmap";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { ErrorState, LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";
import "../styles/roadmap-admin.css";

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pendiente", in_progress: "En curso", completed: "Completada",
};

function enValue(form: FormData): string {
  return String(form.get("titleEn") ?? "").trim();
}

function assignedValues(form: FormData): number[] {
  return form.getAll("assignees").map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

export function CurationRoadmapPage() {
  const { notify } = useToast();
  const roadmap = useAsync<AdminRoadmap>(() => roadmapApi.admin(), []);
  const [busy, setBusy] = useState(false);
  const [newTask, setNewTask] = useState<{ categoryId?: number; position?: number } | null>(null);

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    try {
      await action();
      notify("success", success);
      roadmap.reload();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const en = enValue(form);
    await run(() => roadmapApi.createCategory({ title, ...(en ? { translations: { en } } : {}) }), "Etapa creada.");
    event.currentTarget.reset();
  }

  if (roadmap.loading) return <div className="community-page"><LoadingState label="Cargando el roadmap…" /></div>;
  if (roadmap.error) return <div className="community-page"><ErrorState message={roadmap.error} onRetry={() => void roadmap.reload()} /></div>;
  const data = roadmap.data;
  if (!data) return null;

  return (
    <div className="community-page roadmap-admin">
      <div className="page-header">
        <div>
          <h1>Roadmap</h1>
          <p className="hint">Etapas, actividades, orden, responsables y traducciones. El progreso se calcula con los estados reales.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setNewTask({ categoryId: data.categories[0]?.id })} disabled={busy || data.categories.length === 0}>
          <Plus size={16} aria-hidden="true" /> Nueva actividad
        </button>
      </div>

      <div className="roadmap-admin__stats">
        <div><strong>{Math.round(data.overall.percentage)}%</strong><span>progreso general</span></div>
        <div><strong>{data.overall.completed}</strong><span>completadas</span></div>
        <div><strong>{data.overall.total}</strong><span>actividades</span></div>
        <div><strong>{data.categories.length}</strong><span>etapas</span></div>
        <div><strong>{data.visibility}</strong><span>visibilidad pública</span></div>
      </div>
      <p className="hint">Arrastra las etapas o actividades para ordenar. Una actividad movida a mano queda anclada; las abiertas van antes que las completadas.</p>

      <form className="community-card community-form" onSubmit={(event) => void createCategory(event)}>
        <h2 className="span-2">Nueva etapa</h2>
        <div className="field"><label htmlFor="new-cat-title">Título (ES) *</label><input id="new-cat-title" name="title" required maxLength={300} /></div>
        <div className="field"><label htmlFor="new-cat-en">Título (EN)</label><input id="new-cat-en" name="titleEn" maxLength={300} /></div>
        <div className="span-2"><button type="submit" className="btn btn--primary" disabled={busy}>Crear etapa</button></div>
      </form>

      {data.categories.map((category, index) => (
        <CategoryBlock key={`${category.id}-${category.title}`} category={category} index={index}
          categories={data.categories} users={data.users} busy={busy} run={run}
          onNewTask={(categoryId, position) => setNewTask({ categoryId, ...(position ? { position } : {}) })} />
      ))}

      {newTask ? (
        <NewTaskDialog
          categories={data.categories}
          users={data.users}
          initial={newTask}
          onClose={() => setNewTask(null)}
          onCreated={() => { setNewTask(null); roadmap.reload(); }}
        />
      ) : null}
    </div>
  );
}

function NewTaskDialog({ categories, users, initial, onClose, onCreated }: {
  categories: AdminCategory[]; users: AdminRoadmap["users"];
  initial: { categoryId?: number; position?: number };
  onClose: () => void; onCreated: () => void;
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
      notify("success", "Actividad creada.");
      onCreated();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo crear la actividad.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="roadmap-admin__modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="roadmap-admin__modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
        <header className="roadmap-admin__modal-head">
          <div>
            <span className="badge badge--outline">Nueva actividad</span>
            <h2 id="new-task-title">Crear actividad</h2>
          </div>
          <button type="button" className="btn btn--sm" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </header>
        <form className="community-form" onSubmit={(event) => void submit(event)}>
          <div className="field span-2"><label htmlFor="nt-title">Título (ES) *</label><input id="nt-title" name="title" required maxLength={300} autoFocus /></div>
          <div className="field span-2"><label htmlFor="nt-title-en">Título (EN)</label><input id="nt-title-en" name="titleEn" maxLength={300} /></div>
          <div className="field"><label htmlFor="nt-category">Etapa</label>
            <select id="nt-category" name="categoryId" defaultValue={String(initial.categoryId ?? categories[0]?.id ?? "")}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="nt-status">Estado</label>
            <select id="nt-status" name="status" defaultValue="pending">
              {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="nt-position">Posición</label><input id="nt-position" name="position" type="number" min={1} step={1} defaultValue={initial.position ?? ""} placeholder="Al final" /></div>
          <div className="field"><label htmlFor="nt-assignees">Responsables</label>
            <select id="nt-assignees" name="assignees" multiple size={Math.min(5, Math.max(2, users.length))}>
              {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
            </select>
          </div>
          <div className="span-2 community-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Creando…" : "Crear actividad"}</button>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function CategoryBlock({ category, index, categories, users, busy, run, onNewTask }: {
  category: AdminCategory; index: number; categories: AdminCategory[]; users: AdminRoadmap["users"];
  busy: boolean; run: (action: () => Promise<unknown>, success: string) => Promise<void>;
  onNewTask: (categoryId: number, position: number) => void;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number | "all">(5);
  async function saveCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const en = enValue(form);
    await run(() => roadmapApi.updateCategory(category.id, { title, ...(en ? { translations: { en } } : {}) }), "Etapa guardada.");
  }

  async function moveCategory(direction: "up" | "down"): Promise<void> {
    await run(() => roadmapApi.updateCategory(category.id, { position: direction === "up" ? index : index + 2 }), "Etapa movida.");
  }

  async function dropCategory(event: DragEvent<HTMLElement>): Promise<void> {
    const source = Number(event.dataTransfer.getData("application/x-crv-category"));
    if (!source || source === category.id) return;
    event.preventDefault();
    await run(() => roadmapApi.updateCategory(source, { position: index + 1 }), "Etapa movida.");
  }

  async function deleteCategory(): Promise<void> {
    if (!window.confirm(`¿Borrar la etapa "${category.title}" y sus ${category.tasks.length} actividades?`)) return;
    await run(() => roadmapApi.deleteCategory(category.id, true), "Etapa borrada.");
  }

  const total = category.tasks.length;
  const perPage = size === "all" ? Math.max(1, total) : size;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * perPage;
  const visible = category.tasks.slice(start, start + perPage);

  return (
    <section
      className={`community-card roadmap-admin__stage roadmap-stage--${category.colorKey}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-crv-category")) event.preventDefault(); }}
      onDrop={(event) => void dropCategory(event)}
    >
      <form className="roadmap-admin__stage-head" onSubmit={(event) => void saveCategory(event)}>
        <button
          type="button" className="roadmap-admin__drag-handle" draggable
          onDragStart={(event) => { event.dataTransfer.setData("application/x-crv-category", String(category.id)); event.dataTransfer.effectAllowed = "move"; }}
          aria-label={`Arrastrar la etapa ${category.title}`} title="Arrastrar para reordenar"
        >
          <DotsSixVertical size={16} aria-hidden="true" />
        </button>
        <span className="badge badge--outline">Etapa {index + 1}</span>
        <div className="field"><label htmlFor={`cat-${category.id}`}>Título (ES)</label><input id={`cat-${category.id}`} name="title" defaultValue={category.title} maxLength={300} required /></div>
        <div className="field"><label htmlFor={`cat-en-${category.id}`}>Título (EN)</label><input id={`cat-en-${category.id}`} name="titleEn" defaultValue={category.i18n.en ?? ""} maxLength={300} /></div>
        <div className="community-actions">
          <button type="submit" className="btn btn--sm" disabled={busy}>Guardar</button>
          <button type="button" className="btn btn--sm" disabled={busy || index === 0} onClick={() => void moveCategory("up")} aria-label="Subir etapa"><ArrowUp size={14} /></button>
          <button type="button" className="btn btn--sm" disabled={busy || index === categories.length - 1} onClick={() => void moveCategory("down")} aria-label="Bajar etapa"><ArrowDown size={14} /></button>
          <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void deleteCategory()} aria-label="Borrar etapa"><Trash size={14} /></button>
        </div>
      </form>

      <div className="roadmap-admin__progress">
        <div className="roadmap-bar"><i style={{ width: `${category.progress.percentage}%` }} /></div>
        <span>{category.progress.completed} / {category.progress.total} · {Math.round(category.progress.percentage)}%</span>
      </div>

      <button type="button" className="roadmap-admin__add-top" onClick={() => onNewTask(category.id, 1)} disabled={busy}>
        <Plus size={14} aria-hidden="true" /> Añadir actividad al principio
      </button>

      <div className="roadmap-admin__tasks">
        {visible.map((task, taskIndex) => (
          <TaskEditor key={`${task.id}-${task.updatedAt}`} task={task} categories={categories} users={users}
            busy={busy} run={run} position={start + taskIndex + 1} />
        ))}
        {total === 0 ? <p className="community-muted">Todavía no hay actividades en esta etapa.</p> : null}
      </div>

      {total > 5 ? (
        <div className="roadmap-admin__pagination">
          <label>
            <span>Por página</span>
            <select value={String(size)} onChange={(event) => { const value = event.target.value; setSize(value === "all" ? "all" : Number(value)); setPage(1); }}>
              {[5, 10, 15, 20, 25].map((value) => <option key={value} value={value}>{value}</option>)}
              <option value="all">Todas</option>
            </select>
          </label>
          <div className="community-actions">
            <button type="button" className="btn btn--sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1}>Anterior</button>
            <span className="community-muted">{total ? start + 1 : 0}–{Math.min(start + perPage, total)} de {total}</span>
            <button type="button" className="btn btn--sm" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={currentPage >= pages}>Siguiente</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TaskEditor({ task, categories, users, busy, run, position }: {
  task: AdminTask; categories: AdminCategory[]; users: AdminRoadmap["users"];
  busy: boolean; run: (action: () => Promise<unknown>, success: string) => Promise<void>;
  position: number;
}) {
  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const en = enValue(form);
    const status = String(form.get("status") ?? task.status) as TaskStatus;
    const categoryId = Number(form.get("categoryId"));
    const assigned = assignedValues(form);
    await run(() => roadmapApi.updateTask(task.id, {
      title, status, categoryId, assignedUserIds: assigned,
      ...(en ? { translations: { en } } : { translations: {} }),
    }), "Actividad guardada.");
  }

  async function move(direction: "up" | "down"): Promise<void> {
    await run(() => roadmapApi.moveTask(task.id, direction), "Actividad movida.");
  }

  async function togglePin(): Promise<void> {
    await run(() => roadmapApi.updateTask(task.id, { pinned: !task.orderPinned }), task.orderPinned ? "Actividad desanclada." : "Actividad anclada.");
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`¿Borrar la actividad "${task.title}"?`)) return;
    await run(() => roadmapApi.deleteTask(task.id), "Actividad borrada.");
  }

  async function dropTask(event: DragEvent<HTMLFormElement>): Promise<void> {
    const source = Number(event.dataTransfer.getData("application/x-crv-task"));
    if (!source || source === task.id) return;
    event.preventDefault();
    await run(() => roadmapApi.updateTask(source, { categoryId: task.categoryId, position }), "Actividad movida.");
  }

  return (
    <form
      className="roadmap-admin__task"
      data-task-id={task.id}
      onSubmit={(event) => void save(event)}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-crv-task")) event.preventDefault(); }}
      onDrop={(event) => void dropTask(event)}
    >
      <div className="roadmap-admin__task-top">
        <button
          type="button" className="roadmap-admin__drag-handle" draggable
          onDragStart={(event) => { event.dataTransfer.setData("application/x-crv-task", String(task.id)); event.dataTransfer.effectAllowed = "move"; }}
          aria-label={`Arrastrar la actividad ${task.title}`} title="Arrastrar para reordenar"
        >
          <DotsSixVertical size={15} aria-hidden="true" />
        </button>
        <span className={`roadmap-admin__dot roadmap-admin__dot--${task.status}`} aria-hidden="true" />
        <input name="title" defaultValue={task.title} maxLength={300} required aria-label="Título en español" />
        <input name="titleEn" defaultValue={task.i18n.en ?? ""} maxLength={300} placeholder="English title" aria-label="Título en inglés" />
      </div>
      <div className="roadmap-admin__task-controls">
        <label>Estado
          <select name="status" defaultValue={task.status}>
            {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Etapa
          <select name="categoryId" defaultValue={task.categoryId}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
          </select>
        </label>
        <label>Responsables
          <select name="assignees" multiple size={Math.min(3, Math.max(2, users.length))} defaultValue={task.assignedUsers.map((user) => String(user.id))}>
            {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}</option>)}
          </select>
        </label>
      </div>
      <div className="roadmap-admin__task-actions">
        <button type="submit" className="btn btn--sm" disabled={busy}>Guardar</button>
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void move("up")} aria-label="Subir actividad"><ArrowUp size={14} /></button>
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void move("down")} aria-label="Bajar actividad"><ArrowDown size={14} /></button>
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void togglePin()} title={task.orderPinned ? "Desanclar" : "Anclar"}>
          {task.orderPinned ? <PushPinSlash size={14} /> : <PushPin size={14} />}
          {task.orderPinned ? "Desanclar" : "Anclar"}
        </button>
        {task.orderPinned ? <span className="badge badge--outline">Anclada</span> : null}
        <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void remove()} aria-label="Borrar actividad"><Trash size={14} /></button>
      </div>
    </form>
  );
}
