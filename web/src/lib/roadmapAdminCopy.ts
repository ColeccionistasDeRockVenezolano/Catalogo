// CRV · Copia del panel de administración del roadmap (B6).
//
// Los textos vienen del admin de Herra 1.1.34 (src/i18n.ts: claves admin.*),
// sin sus defectos: «En curso» como en el roadmap público de CRV y sin claves
// sin traducir. La página usa su propio diccionario, como RoadmapPage, porque
// la curaduría no pasa por el i18n global del catálogo.
import type { Lang } from "./i18n";
import type { TaskStatus } from "./roadmap";

export interface RoadmapAdminCopy {
  badge: string;
  title1: string;
  title2: string;
  heroSub: string;
  overallWord: string;
  completedOf: (done: number, total: number) => string;
  adminKicker: string;
  toolsTitle: string;
  toolsSub: string;
  tools: {
    newTask: string; newStage: string; people: string; pending: string; applications: string;
    metrics: string; form: string; invites: string; branding: string; languages: string;
    settings: string; password: string; viewPublic: string;
  };
  pendingTool: string;
  reorderLead: string;
  reorderRest: string;
  queueLead: string;
  queueRest: string;
  phase: (position: number) => string;
  score: (done: number, total: number) => string;
  addAtTop: string;
  position1: string;
  status: Record<TaskStatus, string>;
  unassigned: string;
  reorderTaskAria: (title: string) => string;
  reorderStageAria: (title: string) => string;
  dragToReorder: string;
  pin: string;
  unpin: string;
  pinnedTitle: string;
  unpinnedTitle: string;
  editTaskAria: (title: string) => string;
  deleteTaskAria: (title: string) => string;
  editStageAria: (title: string) => string;
  deleteStageAria: (title: string) => string;
  perPage: string;
  perPageIn: (stage: string) => string;
  pageOf: (page: number, pages: number, total: number) => string;
  previousPage: string;
  nextPage: string;
  all: string;
  assigneeAria: (count: number) => string;
  newTaskKicker: string;
  newTaskTitle: string;
  activityLabel: string;
  activityPlaceholder: string;
  englishTitle: string;
  englishHelp: string;
  category: string;
  state: string;
  startPosition: string;
  endPlaceholder: string;
  assignTo: string;
  searchPeople: string;
  noOwners: string;
  create: string;
  cancel: string;
  createStage: string;
  newStageKicker: string;
  newStageTitle: string;
  newStageSub: string;
  newStageLabel: string;
  newStagePlaceholder: string;
  editStageKicker: string;
  editStageTitle: string;
  stageTitleLabel: string;
  save: string;
  editTaskKicker: string;
  editTaskTitle: string;
  titleLabel: string;
  owners: string;
  saveChanges: string;
  deleteTaskTitle: string;
  deleteTaskText: (title: string) => string;
  deleteStageTitle: string;
  deleteStageText: (title: string, count: number) => string;
  delete: string;
  toasts: {
    taskCreated: string; stageCreated: string; stageSaved: string; taskSaved: string;
    taskDeleted: string; stageDeleted: string; taskMoved: (stage: string) => string;
    stageMoved: string; pinned: string; unpinned: string; unchanged: string; undone: string;
  };
  undo: string;
  drag: {
    picked: (title: string) => string;
    stagePicked: (title: string) => string;
    at: (stage: string, position: number, total: number) => string;
    cancelled: string;
    saving: string;
    failed: string;
  };
  loading: string;
  loadError: string;
  retry: string;
  saveFailed: string;
  saving: string;
  emptyStage: string;
}

const ES: RoadmapAdminCopy = {
  badge: "Panel de administración",
  title1: "EDITAR EL",
  title2: "ROADMAP",
  heroSub: "Misma vista que el público. Usa el botón de edición de cada actividad para cambiar título, estado, categoría y responsables; los cambios se reflejan de inmediato en la página pública.",
  overallWord: "progreso general",
  completedOf: (done, total) => `${done} de ${total} actividades completadas`,
  adminKicker: "ADMINISTRACIÓN",
  toolsTitle: "Panel de edición",
  toolsSub: "Gestiona actividades, categorías, personas y la apariencia del roadmap. Cada opción se abre en su propia ventana, sin perder de vista el roadmap.",
  tools: {
    newTask: "Nueva actividad",
    newStage: "Nueva etapa",
    people: "Personas y colaboradores",
    pending: "Solicitudes pendientes",
    applications: "Candidaturas",
    metrics: "Métricas",
    form: "Formulario de colaboración",
    invites: "Enlaces de registro",
    branding: "Identidad y compartir",
    languages: "Idiomas del proyecto",
    settings: "Configuración del proyecto",
    password: "Mi contraseña",
    viewPublic: "Ver vista pública",
  },
  pendingTool: "se porta en B7–B10",
  reorderLead: "Reordena por arrastre.",
  reorderRest: "Toma el tirador de una actividad o de una etapa y suéltala donde quieras (las actividades también pueden pasar a otra etapa). Con teclado, usa Espacio para tomarla, las flechas para moverla y Enter para guardar.",
  queueLead: "Orden automático.",
  queueRest: "Al completar una actividad baja al pie de su etapa, detrás de las que ya estaban terminadas y por orden de finalización. Si la colocas a mano queda anclada (chincheta encendida) y se queda ahí; pulsa la chincheta otra vez para devolverla a la cola.",
  phase: (position) => `Fase ${String(position).padStart(2, "0")}`,
  score: (done, total) => `${done} DE ${total}`,
  addAtTop: "Añadir actividad al inicio",
  position1: "Posición 1",
  status: { pending: "Pendiente", in_progress: "En curso", completed: "Completada" },
  unassigned: "Sin asignar",
  reorderTaskAria: (title) => `Reordenar la actividad «${title}»`,
  reorderStageAria: (title) => `Reordenar la etapa «${title}»`,
  dragToReorder: "Arrastra para reordenar",
  pin: "Anclar esta actividad en su posición",
  unpin: "Devolver esta actividad al orden automático",
  pinnedTitle: "Anclada: conserva esta posición. Pulsa para devolverla al orden automático.",
  unpinnedTitle: "Anclar en esta posición",
  editTaskAria: (title) => `Editar la actividad «${title}»`,
  deleteTaskAria: (title) => `Eliminar la actividad «${title}»`,
  editStageAria: (title) => `Editar el título de la etapa «${title}»`,
  deleteStageAria: (title) => `Eliminar la etapa «${title}»`,
  perPage: "Actividades por página",
  perPageIn: (stage) => `Actividades por página en ${stage}`,
  pageOf: (page, pages, total) => `Página ${page} de ${pages} · ${total} ${total === 1 ? "actividad" : "actividades"}`,
  previousPage: "Página anterior",
  nextPage: "Página siguiente",
  all: "Todas",
  assigneeAria: (count) => count === 1 ? "1 responsable, ver lista" : `${count} responsables, ver lista`,
  newTaskKicker: "NUEVA ACTIVIDAD",
  newTaskTitle: "Crear una actividad",
  activityLabel: "Actividad",
  activityPlaceholder: "Qué se hará…",
  englishTitle: "Título en inglés (opcional)",
  englishHelp: "Si lo dejas vacío se publica el título en español también en la página en inglés. Puedes traducirlo después en Idiomas.",
  category: "Categoría",
  state: "Estado",
  startPosition: "Posición inicial",
  endPlaceholder: "Final",
  assignTo: "Asignar a",
  searchPeople: "Buscar colaboradores…",
  noOwners: "Sin responsables",
  create: "Crear",
  cancel: "Cancelar",
  createStage: "Crear etapa",
  newStageKicker: "NUEVA ETAPA",
  newStageTitle: "Crear una etapa",
  newStageSub: "Las etapas agrupan las actividades del roadmap. Podrás renombrarla después desde su propio título.",
  newStageLabel: "Título de la nueva etapa",
  newStagePlaceholder: "Ej. Investigación de campo",
  editStageKicker: "EDITAR ETAPA",
  editStageTitle: "Editar título de la etapa",
  stageTitleLabel: "Título de la etapa",
  save: "Guardar",
  editTaskKicker: "EDITAR ACTIVIDAD",
  editTaskTitle: "Editar la actividad",
  titleLabel: "Título",
  owners: "Responsables",
  saveChanges: "Guardar cambios",
  deleteTaskTitle: "Eliminar actividad",
  deleteTaskText: (title) => `Se borrará «${title}» del roadmap. Esta acción no se puede deshacer.`,
  deleteStageTitle: "Eliminar etapa",
  deleteStageText: (title, count) => count === 0
    ? `Se borrará la etapa «${title}». Esta acción no se puede deshacer.`
    : `Se borrará la etapa «${title}» y sus ${count} ${count === 1 ? "actividad" : "actividades"}. Esta acción no se puede deshacer.`,
  delete: "Eliminar",
  toasts: {
    taskCreated: "Actividad creada.",
    stageCreated: "Etapa creada.",
    stageSaved: "Etapa guardada.",
    taskSaved: "Actividad guardada.",
    taskDeleted: "Actividad borrada.",
    stageDeleted: "Etapa borrada.",
    taskMoved: (stage) => `Actividad reordenada en «${stage}».`,
    stageMoved: "Etapa reordenada.",
    pinned: "Actividad anclada en su posición.",
    unpinned: "Actividad devuelta al orden automático.",
    unchanged: "El orden no cambió.",
    undone: "Cambio deshecho.",
  },
  undo: "Deshacer",
  drag: {
    picked: (title) => `Actividad «${title}» tomada.`,
    stagePicked: (title) => `Etapa «${title}» tomada.`,
    at: (stage, position, total) => `${stage}, posición ${position} de ${total}.`,
    cancelled: "Reordenamiento cancelado.",
    saving: "Guardando la nueva posición…",
    failed: "No se pudo guardar el orden.",
  },
  loading: "Cargando el panel del roadmap…",
  loadError: "No se pudo cargar el roadmap.",
  retry: "Reintentar",
  saveFailed: "No se pudo guardar.",
  saving: "Guardando…",
  emptyStage: "Todavía no hay actividades en esta etapa.",
};

const EN: RoadmapAdminCopy = {
  badge: "Administration panel",
  title1: "EDIT THE",
  title2: "ROADMAP",
  heroSub: "The same view the public gets. Use the edit button on any activity to change its title, status, stage and owners; the changes show on the public page straight away.",
  overallWord: "overall progress",
  completedOf: (done, total) => `${done} of ${total} activities completed`,
  adminKicker: "ADMINISTRATION",
  toolsTitle: "Editing panel",
  toolsSub: "Manage activities, stages, people and how the roadmap looks. Each option opens in its own window, without losing sight of the roadmap.",
  tools: {
    newTask: "New activity",
    newStage: "New stage",
    people: "People and collaborators",
    pending: "Pending requests",
    applications: "Applications",
    metrics: "Metrics",
    form: "Collaboration form",
    invites: "Sign-up links",
    branding: "Identity and sharing",
    languages: "Project languages",
    settings: "Project settings",
    password: "My password",
    viewPublic: "View public page",
  },
  pendingTool: "ported in B7–B10",
  reorderLead: "Reorder by dragging.",
  reorderRest: "Grab the handle of an activity or a stage and drop it wherever you want (activities can also move to another stage). With the keyboard, use Space to pick it up, the arrows to move it and Enter to save.",
  queueLead: "Automatic order.",
  queueRest: "Completing an activity sends it to the bottom of its stage, behind the ones already finished and in the order they were completed. If you place it by hand it becomes pinned (the pin lights up) and stays there; press the pin again to send it back to the queue.",
  phase: (position) => `Phase ${String(position).padStart(2, "0")}`,
  score: (done, total) => `${done} OF ${total}`,
  addAtTop: "Add activity at the top",
  position1: "Position 1",
  status: { pending: "Pending", in_progress: "In progress", completed: "Completed" },
  unassigned: "Unassigned",
  reorderTaskAria: (title) => `Reorder the activity “${title}”`,
  reorderStageAria: (title) => `Reorder the stage “${title}”`,
  dragToReorder: "Drag to reorder",
  pin: "Pin this activity to its position",
  unpin: "Return this activity to the automatic order",
  pinnedTitle: "Pinned: it keeps this position. Press to return it to the automatic order.",
  unpinnedTitle: "Pin to this position",
  editTaskAria: (title) => `Edit the activity “${title}”`,
  deleteTaskAria: (title) => `Delete the activity “${title}”`,
  editStageAria: (title) => `Edit the stage title “${title}”`,
  deleteStageAria: (title) => `Delete the stage “${title}”`,
  perPage: "Activities per page",
  perPageIn: (stage) => `Activities per page in ${stage}`,
  pageOf: (page, pages, total) => `Page ${page} of ${pages} · ${total} ${total === 1 ? "activity" : "activities"}`,
  previousPage: "Previous page",
  nextPage: "Next page",
  all: "All",
  assigneeAria: (count) => count === 1 ? "1 owner, see list" : `${count} owners, see list`,
  newTaskKicker: "NEW ACTIVITY",
  newTaskTitle: "Create an activity",
  activityLabel: "Activity",
  activityPlaceholder: "What will be done…",
  englishTitle: "English title (optional)",
  englishHelp: "Left empty, the Spanish title is published on the English page too. You can translate it later under Languages.",
  category: "Stage",
  state: "Status",
  startPosition: "Starting position",
  endPlaceholder: "End",
  assignTo: "Assign to",
  searchPeople: "Search collaborators…",
  noOwners: "No owners",
  create: "Create",
  cancel: "Cancel",
  createStage: "Create stage",
  newStageKicker: "NEW STAGE",
  newStageTitle: "Create a stage",
  newStageSub: "Stages group the activities of the roadmap. You can rename it later from its own title.",
  newStageLabel: "Title of the new stage",
  newStagePlaceholder: "E.g. Field research",
  editStageKicker: "EDIT STAGE",
  editStageTitle: "Edit the stage title",
  stageTitleLabel: "Stage title",
  save: "Save",
  editTaskKicker: "EDIT ACTIVITY",
  editTaskTitle: "Edit the activity",
  titleLabel: "Title",
  owners: "Owners",
  saveChanges: "Save changes",
  deleteTaskTitle: "Delete activity",
  deleteTaskText: (title) => `“${title}” will be removed from the roadmap. This cannot be undone.`,
  deleteStageTitle: "Delete stage",
  deleteStageText: (title, count) => count === 0
    ? `The stage “${title}” will be removed. This cannot be undone.`
    : `The stage “${title}” and its ${count} ${count === 1 ? "activity" : "activities"} will be removed. This cannot be undone.`,
  delete: "Delete",
  toasts: {
    taskCreated: "Activity created.",
    stageCreated: "Stage created.",
    stageSaved: "Stage saved.",
    taskSaved: "Activity saved.",
    taskDeleted: "Activity deleted.",
    stageDeleted: "Stage deleted.",
    taskMoved: (stage) => `Activity reordered in “${stage}”.`,
    stageMoved: "Stage reordered.",
    pinned: "Activity pinned to its position.",
    unpinned: "Activity returned to the automatic order.",
    unchanged: "The order did not change.",
    undone: "Change undone.",
  },
  undo: "Undo",
  drag: {
    picked: (title) => `Activity “${title}” picked up.`,
    stagePicked: (title) => `Stage “${title}” picked up.`,
    at: (stage, position, total) => `${stage}, position ${position} of ${total}.`,
    cancelled: "Reordering cancelled.",
    saving: "Saving the new position…",
    failed: "The order could not be saved.",
  },
  loading: "Loading the roadmap panel…",
  loadError: "The roadmap could not be loaded.",
  retry: "Retry",
  saveFailed: "Could not save.",
  saving: "Saving…",
  emptyStage: "No activities in this stage yet.",
};

export function roadmapAdminCopy(lang: Lang): RoadmapAdminCopy {
  return lang === "en" ? EN : ES;
}
