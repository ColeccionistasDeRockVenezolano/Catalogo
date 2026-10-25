// PostgreSQL conserva y ejecuta la cola. Este módulo solo envía solicitudes y consulta su estado.
import { useSyncExternalStore } from "react";
import type { ImageJob, ImageTask } from "../../../src/shared/image-curation-jobs";
import { ApiError, CATALOG_CHANGE_EVENT, CATALOG_DATA_CHANGED_EVENT, imageCandidatesApi, type CatalogChangeEvent, type ImageCandidateGroup } from "./api";
import { getSessionCsrf } from "./operator";
export type ImageWork = Omit<ImageJob, "status"> & { status: ImageJob["status"] | "sending"; hide: boolean };
export const imageGroupKey = (group: Pick<ImageCandidateGroup, "kind" | "entityId">) => `${group.kind}:${group.entityId}`;
let jobs: readonly ImageWork[] = [];
let localId = 0, epoch = 0, mutation = 0;
let enabled = false;
let fetchingEpoch: number | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const tasks = new Map<string, ImageTask>();
const submitting = new Set<string>();
const listeners = new Set<() => void>();
let connection = { loading: false, error: null as string | null };
const active = (job: ImageWork) => ["sending", "queued", "running"].includes(job.status);
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function emit() { for (const listener of listeners) listener(); }
function update(id: number, values: Partial<ImageWork>) { jobs = jobs.map(job => job.id === id ? { ...job, ...values } : job); emit(); }
export function useImageCurationQueue() { return useSyncExternalStore(subscribe, () => jobs); }
export function useImageQueueConnection() { return useSyncExternalStore(subscribe, () => connection); }
function message(error: unknown) { return error instanceof ApiError ? error.message : "No se pudo conectar con la cola del servidor. Comprueba la conexión y vuelve a intentarlo."; }
function schedule() {
  clearTimeout(timer);
  if (enabled) timer = setTimeout(() => { void refreshImageQueue(); }, jobs.some(active) ? 1000 : 15_000);
}
function reconcile(server: ImageJob[]) {
  const before = jobs;
  jobs = server.map(job => {
    const previous = before.find(old => old.id === job.id || old.requestId === job.requestId);
    return { ...job, hide: ["queued", "running"].includes(job.status) || (job.status === "done" && (previous?.hide ?? false)) };
  });
  jobs = [...jobs, ...before.filter(job => job.id < 0 && !server.some(item => item.requestId === job.requestId || (job.conflict && ["queued", "running"].includes(item.status) && item.type === job.type && imageGroupKey(item.groups[0]!) === imageGroupKey(job.groups[0]!))))];
  for (const job of server) tasks.delete(job.requestId);
  emit();
  let changed = false;
  for (const job of server) {
    const previous = before.find(old => old.id === job.id || old.requestId === job.requestId);
    if (previous && (active(previous) || previous.id < 0) && ["done", "error"].includes(job.status)) {
      changed = true;
      if (job.status === "done" && job.runId && job.type === "decision") window.dispatchEvent(new CustomEvent<CatalogChangeEvent>(CATALOG_CHANGE_EVENT, { detail: { runId: job.runId, method: "POST", path: `/curation/images/jobs/${job.id}` } }));
    } else if (!previous && job.status === "done") changed = true;
  }
  if (changed) window.dispatchEvent(new Event(CATALOG_DATA_CHANGED_EVENT));
}
export async function refreshImageQueue(): Promise<void> {
  if (!enabled || !getSessionCsrf() || fetchingEpoch === epoch) return;
  const generation = epoch, version = mutation; fetchingEpoch = generation;
  try {
    const server = await imageCandidatesApi.jobs();
    if (generation !== epoch || version !== mutation) return;
    connection = { loading: false, error: null }; reconcile(server);
  } catch (error) {
    if (generation === epoch && version === mutation) { connection = { loading: false, error: message(error) }; emit(); }
  } finally { if (generation === epoch) { fetchingEpoch = null; if (version !== mutation) { clearTimeout(timer); timer = setTimeout(() => { void refreshImageQueue(); }, 0); } else schedule(); } }
}
export function startImageQueue(): () => void {
  enabled = true; connection = { loading: true, error: null }; emit(); void refreshImageQueue();
  return () => { enabled = false; epoch++; clearTimeout(timer); };
}
async function submit(local: ImageWork[]): Promise<void> {
  const ready = local.filter(job => !submitting.has(job.requestId) && tasks.has(job.requestId));
  if (!ready.length) return;
  const generation = epoch;
  for (const job of ready) { submitting.add(job.requestId); update(job.id, { status: "sending", error: null }); }
  try {
    const accepted = await imageCandidatesApi.enqueue(ready.map(job => tasks.get(job.requestId)!));
    if (generation !== epoch) return;
    mutation++;
    jobs = jobs.map(job => {
      const index = ready.findIndex(item => item.requestId === job.requestId);
      const saved = index >= 0 ? accepted[index] : undefined;
      return saved ? { ...saved, hide: saved.status !== "error" } : job;
    });
    for (const job of ready) tasks.delete(job.requestId);
    emit(); void refreshImageQueue();
  } catch (error) {
    if (generation !== epoch) return;
    for (const job of ready) update(job.id, { status: "error", hide: false, error: `${message(error)} No se confirmó el envío; reintentar conserva la misma solicitud.`, conflict: error instanceof ApiError && error.status >= 400 && error.status < 500 });
    void refreshImageQueue();
  } finally { for (const job of ready) submitting.delete(job.requestId); }
}
function enqueue(groups: ImageCandidateGroup[], type: ImageWork["type"], candidateId: number | null = null) {
  const local: ImageWork[] = [];
  for (const group of groups) {
    if (jobs.some(job => job.type === type && active(job) && job.groups.some(other => imageGroupKey(other) === imageGroupKey(group)))) continue;
    const candidateIds = group.candidates.filter(candidate => candidate.quality === null || candidate.quality === "failed").map(candidate => candidate.id).slice(0, 100);
    if (type === "inspection" && !candidateIds.length) continue;
    const requestId = crypto.randomUUID();
    const task: ImageTask = type === "decision" ? { requestId, kind: group.kind, entityId: group.entityId, type, candidateId } : { requestId, kind: group.kind, entityId: group.entityId, type, candidateIds };
    tasks.set(requestId, task);
    local.push({ id: --localId, requestId, type, groups: [{ kind: group.kind, entityId: group.entityId, name: group.name }], candidateId, status: "sending", hide: true,
      error: null, conflict: false, result: null, runId: null, attempts: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  if (local.length) { jobs = [...jobs, ...local]; emit(); void submit(local); }
}
export function queueImageDecision(group: ImageCandidateGroup, candidateId: number | null) { enqueue([group], "decision", candidateId); }
export function queueKeepCurrent(groups: ImageCandidateGroup[]) { enqueue(groups, "decision"); }
export function queueImageInspection(groups: ImageCandidateGroup[]) { enqueue(groups, "inspection"); }
export async function retryImageWork(id: number): Promise<void> {
  const old = jobs.find(job => job.id === id);
  if (!old || old.status !== "error" || old.conflict) return;
  if (id < 0) { await submit([old]); return; }
  const generation = epoch; mutation++; update(id, { status: "sending", hide: true, error: null });
  try {
    const job = await imageCandidatesApi.retry(id);
    if (generation === epoch) { mutation++; update(id, { ...job, hide: true }); void refreshImageQueue(); }
  } catch (error) { if (generation === epoch) update(id, { status: "error", hide: false, error: message(error) }); }
}
export async function dismissImageWork(id: number): Promise<void> {
  const generation = epoch;
  try {
    if (id > 0) await imageCandidatesApi.dismiss(id);
    if (generation === epoch) { mutation++; jobs = jobs.filter(job => job.id !== id); emit(); }
  } catch (error) { if (generation === epoch) { connection = { loading: false, error: message(error) }; emit(); } }
}
window.addEventListener("beforeunload", event => {
  // Una vez recibido el 202, cerrar el navegador no afecta al trabajador.
  if (jobs.some(job => job.status === "sending")) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("crv-session-changed", () => { epoch++; jobs = []; tasks.clear(); submitting.clear(); fetchingEpoch = null; connection = { loading: false, error: null }; emit(); if (enabled && getSessionCsrf()) void refreshImageQueue(); });
window.addEventListener("focus", () => { void refreshImageQueue(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshImageQueue(); });
window.addEventListener(CATALOG_CHANGE_EVENT, event => {
  if (/^\/changes\/\d+\/undo$/u.test((event as CustomEvent<CatalogChangeEvent>).detail.path)) { jobs = jobs.map(job => job.status === "done" ? { ...job, hide: false } : job); emit(); }
});
