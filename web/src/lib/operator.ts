// Estado efímero de la sesión. La identidad real vive en una cookie HttpOnly;
// el navegador no puede leerla ni guardarla en localStorage.
export interface OperatorUser {
  username: string;
  name: string;
  /** admin: todo; curator: catálogo; community: comunidad; reader: solo lectura. */
  role: "admin" | "reader" | "curator" | "community";
}

let csrfToken = "";

export function getSessionCsrf(): string {
  return csrfToken;
}

export function setSessionCsrf(value: string): void {
  const changed = csrfToken !== value;
  csrfToken = value;
  if (changed) window.dispatchEvent(new Event("crv-session-changed"));
}

/** Retira credenciales heredadas de versiones anteriores de la interfaz. */
export function clearLegacyOperatorStorage(): void {
  try {
    localStorage.removeItem("crv.operatorToken");
    localStorage.removeItem("crv.operatorName");
  } catch {
    // El acceso puede estar deshabilitado; la aplicación no depende de él.
  }
}
