// Versión en inglés de los textos que la administración escribe como filas:
// las etapas y actividades del roadmap y los términos del catálogo.
//
// Es la tercera capa del mismo patrón que ya usan el tema, la identidad y los
// textos del proyecto (project-i18n.ts): lo que se escriba aquí pisa al
// español; lo que quede vacío se sirve en español, que siempre es el original.
// La diferencia es dónde vive. Cada fila lleva su traducción al lado, en su
// propia columna `i18n_json`, en vez de acumularlas todas en el proyecto:
// así viaja y se borra con la fila que traduce, sin huérfanos ni JOIN.
//
// Formato: { "en": "English text" }. Una sola cadena por idioma porque cada
// una de estas filas tiene exactamente un texto traducible —el título de la
// etapa, el de la actividad, la etiqueta del término—. El día que alguna gane
// un segundo texto, este módulo es el único sitio donde cambiar el formato.
import { log } from './logger.js';
import { DEFAULT_LANG, TRANSLATABLE_LANGS } from './i18n.js';
// Longitud máxima de una traducción. Coincide con la del título original:
// traducir no es un sitio para escribir más de lo que cabe en el original.
export const MAX_TRANSLATION = 300;
export function rowTranslations(row) {
    if (!row.i18n_json)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(row.i18n_json);
    }
    catch (error) {
        // Un JSON corrupto en la base no puede tumbar la página pública: se
        // registra y la fila se sirve en español.
        log.warn('content_i18n_invalid', { message: error instanceof Error ? error.message : String(error) });
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return {};
    const out = {};
    for (const lang of TRANSLATABLE_LANGS) {
        const value = parsed[lang];
        if (typeof value === 'string' && value.trim() !== '')
            out[lang] = value;
    }
    return out;
}
// El texto de una fila en el idioma de la petición. Sin traducción escrita
// devuelve el original, nunca un hueco.
export function rowText(row, original, lang) {
    if (lang === DEFAULT_LANG)
        return original;
    return rowTranslations(row)[lang] || original;
}
// Normaliza lo que llega del panel antes de guardarlo. Un idioma vacío no es
// una traducción: se descarta para que la fila caiga al español en vez de
// publicar un hueco, y una fila sin ninguna traducción guarda NULL.
export function serializeRowTranslations(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
        return null;
    const clean = {};
    for (const lang of TRANSLATABLE_LANGS) {
        const value = input[lang];
        if (typeof value !== 'string')
            continue;
        // Los títulos viajan a HTML y a atributos: los signos de marcado ahí solo
        // pueden ser ruido, igual que en la identidad del proyecto.
        const text = value.replace(/[<>]/g, '').trim().slice(0, MAX_TRANSLATION);
        if (text !== '')
            clean[lang] = text;
    }
    return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null;
}
// Comprueba la forma de lo que manda el panel sin llegar a guardarlo: la ruta
// responde 400 con un mensaje útil en vez de aceptar basura en silencio.
export function isTranslationsInput(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    return Object.entries(value).every(([lang, text]) => (TRANSLATABLE_LANGS.includes(lang)
        && typeof text === 'string'
        && text.length <= MAX_TRANSLATION * 2));
}
