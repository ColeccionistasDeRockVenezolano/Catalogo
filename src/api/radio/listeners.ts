// CRV · Presencia efímera de oyentes (Fase 3).
//
// Solo memoria: no guarda IP, cuenta ni historial. Un latido cada 30 s y una
// caducidad de 2 minutos cubren pestañas en segundo plano sin inflar el
// recuento. Es el mismo contrato que usa el cliente de Herra.
const LISTENER_TTL_MS = 120_000;
const listeners = new Map<number, Map<string, number>>();

export function touchRadioListener(projectId: number, sessionId: string, active: boolean, nowMs = Date.now()): number {
  let project = listeners.get(projectId);
  if (!project && active) {
    project = new Map();
    listeners.set(projectId, project);
  }
  if (project) {
    if (active) project.set(sessionId, nowMs);
    else project.delete(sessionId);
  }
  return radioListenerCount(projectId, nowMs);
}

export function radioListenerCount(projectId: number, nowMs = Date.now()): number {
  const project = listeners.get(projectId);
  if (!project) return 0;
  for (const [sessionId, seenAt] of project) {
    if (nowMs - seenAt > LISTENER_TTL_MS) project.delete(sessionId);
  }
  if (project.size === 0) listeners.delete(projectId);
  return project.size;
}

export function resetRadioListenersForTests(): void {
  listeners.clear();
}
