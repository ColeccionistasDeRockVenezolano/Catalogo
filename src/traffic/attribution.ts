// Datos de campaña, nunca URLs completas, términos de búsqueda ni datos de formularios.
export const ACQUISITION_PAGES = ['roadmap', 'collaborate', 'login', 'register', 'activate'] as const;
export type AcquisitionPage = typeof ACQUISITION_PAGES[number];
export const PUBLIC_PATHS: Record<AcquisitionPage, string> = {
  roadmap: '/', collaborate: '/colaborar', login: '/login', register: '/registro', activate: '/activar',
};
export interface Attribution {
  source: string; medium: string; campaign: string; content: string; ref: string;
  referrer: string; method: 'link' | 'utm' | 'referrer' | 'direct';
}
export interface AttributionInput {
  ref?: string | undefined; source?: string | undefined; medium?: string | undefined;
  campaign?: string | undefined; content?: string | undefined; referrer?: string | undefined;
}
export interface CampaignLink {
  id: number; code: string; label: string; source: string; medium: string;
  campaign: string; content: string; destination: '/' | '/colaborar'; archived: boolean;
}

/** Campañas son etiquetas, no texto libre: descartar valores con aspecto de datos personales. */
export function campaignTag(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 80) return '';
  const value = raw.normalize('NFKC').trim().toLowerCase();
  return /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,79}$/u.test(value) ? value : '';
}

export function referringHost(raw: unknown, ownOrigin: string): string {
  if (typeof raw !== 'string' || raw.length > 2048) return '';
  try {
    const url = new URL(raw);
    const own = new URL(ownOrigin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    const host = url.hostname.toLowerCase().replace(/^www\./u, '');
    if (host === own.hostname.toLowerCase().replace(/^www\./u, '')) return '';
    // No registrar orígenes locales, direcciones IP ni hosts malformados.
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u.test(host) || host.endsWith('.localhost')) return '';
    return host;
  } catch { return ''; }
}

export function attributionFromUrl(rawUrl: string, referrer: string): AttributionInput {
  try {
    const query = new URL(rawUrl, 'https://local.invalid').searchParams;
    return { ref: query.get('ref') ?? '', source: query.get('utm_source') ?? '',
      medium: query.get('utm_medium') ?? '', campaign: query.get('utm_campaign') ?? '',
      content: query.get('utm_content') ?? '', referrer };
  } catch { return { referrer }; }
}

export function resolveAttribution(input: AttributionInput, ownOrigin: string, link?: CampaignLink): Attribution {
  const referrer = referringHost(input.referrer, ownOrigin);
  const ref = typeof input.ref === 'string' && /^[a-z0-9][a-z0-9_-]{1,63}$/u.test(input.ref) ? input.ref : '';
  if (link) return { source: link.source, medium: link.medium, campaign: link.campaign, content: link.content,
    ref: link.code, referrer, method: 'link' };
  const source = campaignTag(input.source);
  if (source) return { source, medium: campaignTag(input.medium), campaign: campaignTag(input.campaign),
    content: campaignTag(input.content), ref, referrer, method: 'utm' };
  if (ref) return { source: 'unregistered-link', medium: '', campaign: '', content: '', ref, referrer, method: 'link' };
  if (referrer) {
    let source = referrer;
    let medium = 'referral';
    if (/(^|\.)google\.(?:com|[a-z]{2}|(?:com|co)\.[a-z]{2})$/u.test(referrer)) { source = 'google'; medium = 'organic'; }
    else if (/(^|\.)(bing|duckduckgo)\.com$/u.test(referrer)) { source = referrer.includes('bing') ? 'bing' : 'duckduckgo'; medium = 'organic'; }
    else for (const [pattern, name] of [[/(^|\.)(facebook\.com|fb\.com|fb\.me)$/u, 'facebook'],
      [/(^|\.)instagram\.com$/u, 'instagram'], [/(^|\.)(t\.co|twitter\.com|x\.com)$/u, 'x'],
      [/(^|\.)(youtube\.com|youtu\.be)$/u, 'youtube'], [/(^|\.)(t\.me|telegram\.org)$/u, 'telegram']] as const) {
      if (pattern.test(referrer)) { source = name; medium = 'social'; break; }
    }
    return { source, medium, campaign: '', content: '', ref: '', referrer, method: 'referrer' };
  }
  return { source: 'direct', medium: '', campaign: '', content: '', ref: '', referrer: '', method: 'direct' };
}
