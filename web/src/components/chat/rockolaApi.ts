// CRV · Llamadas del widget de La Rockola a la API del chat.
//
// El widget es un IIFE con Shadow DOM y no comparte el estado de sesión del
// catálogo (`web/src/lib/api.ts`): habla con la API del mismo origen usando la
// cabecera CSRF que el documento de la portada publica en su `<meta>`.
export function chatApiBase(): string {
  return (document.body.getAttribute('data-api-base') ?? '/api').replace(/\/$/u, '');
}

export function csrfToken(): string {
  return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
}

/** GET sin cuerpo; POST cuando hay cuerpo. Lanza Error con el mensaje del servidor. */
export async function chatCall<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${chatApiBase()}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-crv-csrf': csrfToken() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? 'Tu sesión no tiene permiso de moderación.'
      : data?.error?.message ?? 'No se pudo completar la acción.');
  }
  return data as T;
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
