// Identidad pública del proyecto: metadatos de la página, tarjeta al compartir
// el enlace, redes sociales y enlace de donación.
//
// Sigue el mismo patrón de dos capas que collaborate-form.ts: los valores por
// defecto de Herra y lo que cada proyecto pise en projects.branding_json. Las
// imágenes (favicon e imagen de la tarjeta) NO viven aquí: son binarios y se
// guardan aparte, en project_assets (ver services/assets.service.ts).
import { log } from './logger.js';
import { detectPlatform, getPlatform, isDonationPlatform, isSocialPlatform, platformLabel } from './social-icons.js';
import { DEFAULT_LANG, translate } from './i18n.js';
export const MAX_SOCIAL_LINKS = 12;
const MAX_TITLE = 160;
const MAX_DESCRIPTION = 320;
const MAX_LONG_TEXT = 700;
const MAX_SHORT = 120;
const MAX_URL = 500;
export const DEFAULT_DONATION = {
    enabled: false,
    platform: 'buymeacoffee',
    url: '',
    label: 'Apoya el proyecto',
    note: '',
};
export const DEFAULT_BRANDING = {
    metaTitle: '',
    metaDescription: '',
    keywords: '',
    ogTitle: '',
    ogDescription: '',
    imageAlt: '',
    twitterCard: 'summary_large_image',
    twitterSite: '',
    siteUrl: '',
    // El roadmap nace sin indexar: abrirlo a buscadores es una decisión
    // deliberada de cada proyecto, no algo que ocurra por olvido.
    allowIndexing: false,
    aboutTitle: '',
    aboutDescription: '',
    aboutStatus: '',
    aboutScope: '',
    aboutSourceUrl: '',
    aboutSourceLabel: '',
    faqTitle: '',
    faq1Question: '',
    faq1Answer: '',
    faq2Question: '',
    faq2Answer: '',
    faq3Question: '',
    faq3Answer: '',
    faq4Question: '',
    faq4Answer: '',
    supportKicker: 'SÍGUENOS',
    supportTitle: 'El proyecto también vive fuera de este roadmap',
    supportSub: 'Ahí publicamos hallazgos, avances y todo lo que no cabe en una lista de tareas.',
    socialLinks: [],
    donation: { ...DEFAULT_DONATION },
};
const TEXT_FIELDS = {
    metaTitle: MAX_TITLE,
    ogTitle: MAX_TITLE,
    metaDescription: MAX_DESCRIPTION,
    ogDescription: MAX_DESCRIPTION,
    keywords: MAX_DESCRIPTION,
    imageAlt: MAX_DESCRIPTION,
    aboutTitle: MAX_TITLE,
    aboutDescription: MAX_LONG_TEXT,
    aboutStatus: MAX_LONG_TEXT,
    aboutScope: MAX_LONG_TEXT,
    aboutSourceLabel: MAX_SHORT,
    faqTitle: MAX_TITLE,
    faq1Question: MAX_TITLE,
    faq1Answer: MAX_LONG_TEXT,
    faq2Question: MAX_TITLE,
    faq2Answer: MAX_LONG_TEXT,
    faq3Question: MAX_TITLE,
    faq3Answer: MAX_LONG_TEXT,
    faq4Question: MAX_TITLE,
    faq4Answer: MAX_LONG_TEXT,
    supportKicker: 40,
    supportTitle: MAX_TITLE,
    supportSub: MAX_DESCRIPTION,
};
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
// Solo http(s): un `javascript:` en un href del roadmap sería XSS con la firma
// de la propia administración. `mailto:` se admite únicamente en el correo.
export function normalizeLinkUrl(raw, platformKey) {
    const value = raw.trim();
    if (value === '')
        return null;
    if (value.length > MAX_URL)
        return null;
    const platform = getPlatform(platformKey);
    if (platform.scheme === 'mailto') {
        const address = value.replace(/^mailto:/i, '').trim();
        if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(address))
            return null;
        return `mailto:${address}`;
    }
    // Sin esquema se asume https: pegar «instagram.com/proyecto» es lo normal.
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    let url;
    try {
        url = new URL(candidate);
    }
    catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return null;
    if (!url.hostname.includes('.'))
        return null;
    return url.toString();
}
function normalizeTwitterHandle(raw) {
    const value = raw.trim();
    if (value === '')
        return '';
    const handle = value.replace(/^@/, '').replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, '').replace(/\/.*$/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle))
        return null;
    return `@${handle}`;
}
function normalizeSiteUrl(raw) {
    const value = raw.trim();
    if (value === '')
        return '';
    const normalized = normalizeLinkUrl(value, 'link');
    if (!normalized)
        return null;
    return normalized.replace(/\/+$/, '');
}
function sanitizeSocialLinks(value) {
    if (!Array.isArray(value))
        return { ok: false, error: 'Las redes sociales deben ser una lista.' };
    if (value.length > MAX_SOCIAL_LINKS) {
        return { ok: false, error: `Como máximo ${MAX_SOCIAL_LINKS} redes sociales.` };
    }
    const links = [];
    for (const entry of value) {
        if (!isPlainObject(entry))
            return { ok: false, error: 'Cada red social debe ser un objeto.' };
        const rawUrl = typeof entry.url === 'string' ? entry.url : '';
        if (rawUrl.trim() === '')
            continue;
        // Una plataforma desconocida no invalida el enlace: se deduce del dominio,
        // que es justo lo que hace el panel al pegar la URL.
        const platform = isSocialPlatform(entry.platform) ? String(entry.platform) : detectPlatform(rawUrl);
        const url = normalizeLinkUrl(rawUrl, platform);
        if (!url)
            return { ok: false, error: `Enlace inválido: ${rawUrl.slice(0, 80)}` };
        const label = typeof entry.label === 'string' ? entry.label.trim().slice(0, MAX_SHORT) : '';
        links.push({ platform, url, label });
    }
    return { ok: true, value: links };
}
function sanitizeDonation(value) {
    if (!isPlainObject(value))
        return { ok: false, error: 'La donación debe ser un objeto.' };
    const platform = isDonationPlatform(value.platform) ? String(value.platform) : DEFAULT_DONATION.platform;
    const rawUrl = typeof value.url === 'string' ? value.url : '';
    const url = rawUrl.trim() === '' ? '' : normalizeLinkUrl(rawUrl, platform);
    if (url === null)
        return { ok: false, error: 'El enlace de donación no es una URL válida.' };
    const enabled = value.enabled === true || value.enabled === 'true';
    if (enabled && url === '') {
        return { ok: false, error: 'Para mostrar el botón de donación hace falta su enlace.' };
    }
    const label = typeof value.label === 'string' ? value.label.trim().slice(0, MAX_SHORT) : '';
    const note = typeof value.note === 'string' ? value.note.trim().slice(0, MAX_DESCRIPTION) : '';
    return {
        ok: true,
        value: { enabled, platform, url, label: label || DEFAULT_DONATION.label, note },
    };
}
// Valida el JSON recibido del panel. Igual que en el tema y el formulario de
// colaboración, devuelve el error legible para poder responder 400 con algo útil.
export function parseBrandingOverrides(raw) {
    const trimmed = raw.trim();
    if (trimmed === '')
        return { ok: true, value: {} };
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch (error) {
        return { ok: false, error: `JSON inválido: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!isPlainObject(parsed))
        return { ok: false, error: 'La configuración debe ser un objeto JSON.' };
    const sanitized = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (key in TEXT_FIELDS) {
            if (typeof value !== 'string')
                return { ok: false, error: `Texto inválido: ${key}.` };
            // Las etiquetas de texto no admiten marcado: van dentro de <meta>, donde
            // cualquier HTML sería ruido en el mejor de los casos.
            const clean = value.replace(/[<>]/g, '').trim().slice(0, TEXT_FIELDS[key]);
            sanitized[key] = clean;
            continue;
        }
        if (key === 'twitterCard') {
            if (value !== 'summary' && value !== 'summary_large_image') {
                return { ok: false, error: 'Tipo de tarjeta de X/Twitter inválido.' };
            }
            sanitized[key] = value;
            continue;
        }
        if (key === 'twitterSite') {
            if (typeof value !== 'string')
                return { ok: false, error: 'Usuario de X/Twitter inválido.' };
            const handle = normalizeTwitterHandle(value);
            if (handle === null)
                return { ok: false, error: 'Usuario de X/Twitter inválido: usa @nombre.' };
            sanitized[key] = handle;
            continue;
        }
        if (key === 'siteUrl') {
            if (typeof value !== 'string')
                return { ok: false, error: 'URL del sitio inválida.' };
            const site = normalizeSiteUrl(value);
            if (site === null)
                return { ok: false, error: 'La URL pública del proyecto no es válida.' };
            sanitized[key] = site;
            continue;
        }
        if (key === 'aboutSourceUrl') {
            if (typeof value !== 'string')
                return { ok: false, error: 'URL de la fuente inválida.' };
            const source = value.trim() === '' ? '' : normalizeLinkUrl(value, 'link');
            if (source === null)
                return { ok: false, error: 'La URL de la fuente no es válida.' };
            sanitized[key] = source;
            continue;
        }
        if (key === 'allowIndexing') {
            sanitized[key] = value === true || value === 'true';
            continue;
        }
        if (key === 'socialLinks') {
            const links = sanitizeSocialLinks(value);
            if (!links.ok)
                return links;
            sanitized[key] = links.value;
            continue;
        }
        if (key === 'donation') {
            const donation = sanitizeDonation(value);
            if (!donation.ok)
                return donation;
            sanitized[key] = donation.value;
            continue;
        }
        return { ok: false, error: `Clave no permitida: ${key}.` };
    }
    return { ok: true, value: sanitized };
}
function mergeBranding(base, overrides) {
    const merged = {
        ...base,
        socialLinks: base.socialLinks.map(link => ({ ...link })),
        donation: { ...base.donation },
    };
    for (const [key, value] of Object.entries(overrides)) {
        if (key === 'socialLinks' && Array.isArray(value)) {
            merged.socialLinks = value;
            continue;
        }
        if (key === 'donation' && isPlainObject(value)) {
            merged.donation = { ...merged.donation, ...value };
            continue;
        }
        if (key === 'allowIndexing') {
            merged.allowIndexing = value === true;
            continue;
        }
        if (key in base && typeof value === 'string') {
            merged[key] = value;
        }
    }
    return merged;
}
// Un JSON corrupto en la base no puede tumbar la página pública: se registra y
// se cae a los valores por defecto, igual que con el tema.
export function resolveBranding(project) {
    if (!project.branding_json)
        return DEFAULT_BRANDING;
    const parsed = parseBrandingOverrides(project.branding_json);
    if (!parsed.ok) {
        log.warn('project_branding_invalid', { message: parsed.error });
        return DEFAULT_BRANDING;
    }
    return mergeBranding(DEFAULT_BRANDING, parsed.value);
}
// Títulos que Herra venía usando en el roadmap público. Viven aquí, y no en la
// plantilla, para que el panel pueda enseñarlos como marcador de los campos
// vacíos: lo que el administrador ve en gris es literalmente lo que se publica
// si no escribe nada.
export function defaultPageMeta(projectName, lang = DEFAULT_LANG) {
    return {
        title: translate(lang, 'meta.defaultTitle', { project: projectName }),
        description: translate(lang, 'meta.defaultDescription', { project: projectName }),
    };
}
// Metadatos efectivos de una página: lo que el proyecto configuró, y si no lo
// configuró, el texto que Herra venía usando. Así una instalación que nunca
// abra este panel mantiene exactamente los títulos que ya tenía.
export function pageMeta(branding, fallback, options = {}) {
    const title = branding.metaTitle || fallback.title;
    const description = branding.metaDescription || fallback.description;
    return {
        title,
        description,
        ogTitle: branding.ogTitle || title,
        ogDescription: branding.ogDescription || description,
        keywords: branding.keywords,
        imageAlt: branding.imageAlt || title,
        twitterCard: branding.twitterCard,
        twitterSite: branding.twitterSite,
        // `indexable: false` es una página que nunca debe indexarse (paneles,
        // formularios con sesión); solo el resto consulta la preferencia.
        noindex: options.indexable === false ? true : !branding.allowIndexing,
    };
}
// ¿Hay algo que mostrar en la sección pública de redes y apoyo?
export function hasSocialPresence(branding) {
    return branding.socialLinks.length > 0 || (branding.donation.enabled && branding.donation.url !== '');
}
export function socialLinkLabel(link, lang = DEFAULT_LANG) {
    // La etiqueta que escribió el proyecto manda: es suya y no se traduce sola.
    return link.label || platformLabel(getPlatform(link.platform), lang);
}
