const PREFIX = "crv.curation.resume.";

export function readCurationResume(username: string): string | null {
  try {
    const href = localStorage.getItem(`${PREFIX}${username}`);
    if (!href || !/^\/curaduria\/(?:aportes|hallazgos|categoria\/[a-z_]+)(?:\?|$)/u.test(href)) return null;
    return href;
  } catch { return null; }
}

export function saveCurationResume(username: string, href: string): void {
  try { localStorage.setItem(`${PREFIX}${username}`, href); } catch { /* El almacenamiento es opcional. */ }
}
