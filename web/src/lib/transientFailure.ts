// Un corte de red o una respuesta de paso (5xx, 408, 429) no dice nada de la
// solicitud: volver a pedirla es seguro. Un 4xx sí es la respuesta del servidor.
export function isTransientFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== "number") return true;
  return status >= 500 || status === 408 || status === 429;
}
