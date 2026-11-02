// Capa de tema — separa marca, textos y colores del código. Se resuelve en
// tres capas: valores por defecto de Herra, tema de la instancia (theme.json)
// y tema propio de cada proyecto (projects.theme_json).
import fs from 'node:fs';
import { config } from './config.js';
import { log } from './logger.js';
export const DEFAULT_THEME = {
    projectName: 'Proyecto',
    heroTitleHtml: 'EL PROYECTO<br>AVANZA',
    heroSubPublic: 'Aquí se muestra el avance del proyecto: qué se hará, qué está en marcha y qué ya está listo, con sus etapas de trabajo.',
    landingHeadline: 'Así va el proyecto',
    brandBadgeLetter: '◆',
    footerNote: 'Roadmap del equipo.',
    mainSiteUrl: config.mainSiteUrl,
    mainSiteLabel: 'Sitio principal',
    youtubeUrl: config.youtubeUrl,
    youtubeLabel: 'Canal de YouTube',
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&display=swap',
    fontTitle: "'Anton', 'Arial Black', sans-serif",
    fontBody: "'Inter', system-ui, sans-serif",
    colors: {
        bg: '#0a0a0a',
        surface: '#141414',
        surface2: '#1c1c1c',
        red: '#e50914',
        redDark: '#8b0000',
        white: '#f5f5f5',
        gray: '#9a9a9a',
        border: '#242424',
        accentRed: '#e50914',
        accentAmber: '#ffb02e',
        accentViolet: '#b185e3',
        accentTeal: '#2ec4b6',
    },
};
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const TEXT_FIELDS = new Set([
    'projectName', 'heroSubPublic', 'landingHeadline', 'brandBadgeLetter', 'footerNote',
    'mainSiteLabel', 'youtubeLabel',
]);
const URL_FIELDS = new Set(['mainSiteUrl', 'youtubeUrl']);
const COLOR_RE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?$/;
const FONT_RE = /^[a-zA-Z0-9\s,.'"_-]{1,200}$/;
function sanitizeHeroTitle(value) {
    // El único HTML admitido es <br>; el resto se convierte en texto inocuo.
    return value.replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .slice(0, 300)
        .replace(/\n/g, '<br>');
}
function validHttpsUrl(value, allowedHost) {
    if (value === '')
        return true;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && (!allowedHost || url.hostname === allowedHost);
    }
    catch {
        return false;
    }
}
function normalizeGoogleFontsUrl(value) {
    if (value === '')
        return value;
    const url = new URL(value);
    // `optional` puede dejar el fallback durante toda la primera visita si la
    // fuente no llega en su ventana mínima. `swap` permite aplicarla al terminar.
    url.searchParams.set('display', 'swap');
    return url.toString();
}
// Merge superficial por sección: cada clave de nivel 1 (y 2 para `colors`)
// se sobrescribe si viene definida; el resto conserva el valor heredado.
function mergeTheme(base, overrides) {
    const merged = { ...base, colors: { ...base.colors } };
    for (const [key, value] of Object.entries(overrides)) {
        if (key === 'colors' && isPlainObject(value)) {
            for (const [colorKey, colorValue] of Object.entries(value)) {
                if (colorKey in merged.colors && typeof colorValue === 'string') {
                    merged.colors[colorKey] = colorValue;
                }
            }
            continue;
        }
        if (key in base && key !== 'colors' && typeof value === 'string') {
            merged[key] = value;
        }
    }
    return merged;
}
// Valida un JSON de tema recibido del panel. Devuelve el error legible en vez
// de lanzarlo para que las rutas puedan responder 400 con un mensaje útil.
export function parseThemeOverrides(raw) {
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
        return { ok: false, error: 'El tema debe ser un objeto JSON.' };
    const sanitized = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (key === 'heroTitleHtml') {
            if (typeof value !== 'string' || value.length > 1000)
                return { ok: false, error: 'Título principal inválido.' };
            sanitized[key] = sanitizeHeroTitle(value);
            continue;
        }
        if (TEXT_FIELDS.has(key)) {
            if (typeof value !== 'string' || value.length > 300)
                return { ok: false, error: `Campo de tema inválido: ${key}.` };
            sanitized[key] = value;
            continue;
        }
        if (URL_FIELDS.has(key)) {
            if (typeof value !== 'string' || !validHttpsUrl(value))
                return { ok: false, error: `URL de tema inválida: ${key}.` };
            sanitized[key] = value;
            continue;
        }
        if (key === 'googleFontsUrl') {
            if (typeof value !== 'string' || !validHttpsUrl(value, 'fonts.googleapis.com'))
                return { ok: false, error: 'La fuente debe venir de fonts.googleapis.com mediante HTTPS.' };
            sanitized[key] = normalizeGoogleFontsUrl(value);
            continue;
        }
        if (key === 'fontTitle' || key === 'fontBody') {
            if (typeof value !== 'string' || !FONT_RE.test(value))
                return { ok: false, error: `Fuente inválida: ${key}.` };
            sanitized[key] = value;
            continue;
        }
        if (key === 'colors') {
            if (!isPlainObject(value))
                return { ok: false, error: 'colors debe ser un objeto.' };
            const colors = {};
            for (const [colorKey, colorValue] of Object.entries(value)) {
                if (!(colorKey in DEFAULT_THEME.colors) || typeof colorValue !== 'string' || !COLOR_RE.test(colorValue)) {
                    return { ok: false, error: `Color inválido: ${colorKey}.` };
                }
                colors[colorKey] = colorValue;
            }
            sanitized.colors = colors;
            continue;
        }
        return { ok: false, error: `Clave de tema no permitida: ${key}.` };
    }
    return { ok: true, value: sanitized };
}
function loadInstanceTheme() {
    if (!fs.existsSync(config.themeConfigPath))
        return DEFAULT_THEME;
    const parsed = parseThemeOverrides(fs.readFileSync(config.themeConfigPath, 'utf8'));
    if (!parsed.ok) {
        log.warn('theme_load_failed', { path: config.themeConfigPath, message: parsed.error });
        return DEFAULT_THEME;
    }
    log.info('theme_loaded', { path: config.themeConfigPath });
    return mergeTheme(DEFAULT_THEME, parsed.value);
}
// Tema base de la instancia: se aplica a todos los proyectos que no lo pisen.
export const instanceTheme = loadInstanceTheme();
// Anton e Inter se sirven con `font-display: swap`. Tras cada una se inserta su
// Arial reescalado (ver @font-face «… Fallback» en roadmap.css) para que el
// intercambio de fuente no desplace el texto ya pintado.
export function withFontFallbacks(stack) {
    return stack.replace(/(['"]?)(Anton|Inter)\1\s*,/g, (match, _quote, family) => (stack.includes(`${family} Fallback`) ? match : `${match} '${family} Fallback',`));
}
// Tema efectivo de un proyecto. El nombre del proyecto manda salvo que su
// propio tema defina explícitamente otro `projectName`.
export function resolveTheme(project) {
    const base = { ...instanceTheme, projectName: project.name };
    if (!project.theme_json)
        return base;
    const parsed = parseThemeOverrides(project.theme_json);
    if (!parsed.ok) {
        log.warn('project_theme_invalid', { message: parsed.error });
        return base;
    }
    return mergeTheme(base, parsed.value);
}
