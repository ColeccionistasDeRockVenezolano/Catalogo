// Capa de configuración del formulario público de colaboración. Sigue el mismo
// patrón que theme.ts, pero con dos capas en vez de tres: los valores por
// defecto de Herra y lo que cada proyecto pise en projects.collaborate_json.
// El catálogo de categorías NO vive aquí: es global a la instancia
// (catalog_terms) y se administra aparte.
import { log } from './logger.js';
import { DEFAULT_LANG, translate } from './i18n.js';
export const FIELD_MODES = ['off', 'optional', 'required'];
export function isFieldMode(value) {
    return typeof value === 'string' && FIELD_MODES.includes(value);
}
// Campos que el administrador puede apagar u obligar. `firstName` no está:
// una candidatura sin nombre no es identificable, así que es obligatorio
// siempre y no se ofrece como opción.
export const CONFIGURABLE_FIELDS = [
    'lastName', 'birthDate', 'whatsappPhone', 'email', 'contactPreference',
    'city', 'country', 'skills', 'experience', 'links',
    'areas', 'contributionText', 'availability', 'ideas',
];
// Parejas que no pueden quedar las dos en 'off': sin ellas la candidatura es
// inservible y el servidor las exige de todos modos (applications.service).
export const FIELD_FLOORS = [
    { a: 'whatsappPhone', b: 'email', error: 'No puedes desactivar WhatsApp y correo a la vez: sin una vía de contacto no hay forma de responder a quien se postula.' },
    { a: 'experience', b: 'contributionText', error: 'No puedes desactivar «experiencia» y «qué quieres aportar» a la vez: sin al menos uno de los dos la candidatura no dice nada.' },
];
export const MAX_LINKS_CAP = 10;
// Textos de fábrica del formulario, en el idioma de la petición. No son del
// proyecto: son de Herra, así que su versión en inglés vive en el diccionario
// (i18n.ts, espacio «collabForm») y no hay que escribirla a mano en ningún
// panel. Lo que el proyecto personalice pisa a esto, y esa personalización sí
// se traduce en su panel (ver project-i18n.ts).
export function defaultCollaborateForm(lang = DEFAULT_LANG) {
    const t = (key) => translate(lang, `collabForm.${key}`);
    return {
        heroBadge: t('heroBadge'),
        heroTitleHtml: t('heroTitleHtml'),
        heroSub: t('heroSub'),
        pillars: [t('pillar1'), t('pillar2'), t('pillar3'), t('pillar4')],
        introNote: '',
        steps: {
            about: t('stepAbout'),
            skills: t('stepSkills'),
            contribution: t('stepContribution'),
            ideas: t('stepIdeas'),
            review: t('stepReview'),
        },
        labels: {
            firstName: t('labelFirstName'),
            lastName: t('labelLastName'),
            birthDate: t('labelBirthDate'),
            whatsappPhone: t('labelWhatsappPhone'),
            email: t('labelEmail'),
            contactPreference: t('labelContactPreference'),
            city: t('labelCity'),
            country: t('labelCountry'),
            skills: t('labelSkills'),
            experience: t('labelExperience'),
            links: t('labelLinks'),
            areas: t('labelAreas'),
            contributionText: t('labelContributionText'),
            availability: t('labelAvailability'),
            idea: t('labelIdea'),
            ideaReason: t('labelIdeaReason'),
            wantsToImplement: t('labelWantsToImplement'),
        },
        helps: {
            birthDate: t('helpBirthDate'),
            contact: t('helpContact'),
            links: t('helpLinks'),
            ideas: t('helpIdeas'),
        },
        placeholders: {
            whatsappPhone: t('placeholderWhatsappPhone'),
            experience: t('placeholderExperience'),
            contributionText: t('placeholderContributionText'),
            availability: t('placeholderAvailability'),
        },
        submitLabel: t('submitLabel'),
        nextStepsTitle: t('nextStepsTitle'),
        nextSteps: [t('nextStep1'), t('nextStep2'), t('nextStep3')],
        sentTitle: t('sentTitle'),
        sentBody: t('sentBody'),
        maxLinks: 5,
        fields: {
            lastName: 'optional',
            birthDate: 'optional',
            whatsappPhone: 'optional',
            email: 'optional',
            contactPreference: 'optional',
            city: 'optional',
            country: 'optional',
            skills: 'optional',
            experience: 'optional',
            links: 'optional',
            areas: 'optional',
            contributionText: 'optional',
            availability: 'optional',
            ideas: 'optional',
        },
    };
}
// El español es el original: es la referencia que el panel muestra como valor
// de fábrica y la que valida qué claves existen, en cualquier idioma.
export const DEFAULT_COLLABORATE_FORM = defaultCollaborateForm(DEFAULT_LANG);
// Etiquetas legibles de cada campo configurable, para el panel de
// administración y para los mensajes de error del servidor. Son texto de
// Herra, así que salen del diccionario y no de aquí.
export function fieldLabels(lang = DEFAULT_LANG) {
    const labels = {};
    for (const field of CONFIGURABLE_FIELDS)
        labels[field] = translate(lang, `cfgField.${field}`);
    return labels;
}
export const FIELD_LABELS = fieldLabels(DEFAULT_LANG);
// A qué paso pertenece cada campo: el paso se oculta entero cuando todos sus
// campos están en 'off'.
export const FIELD_STEP = {
    lastName: 'about', birthDate: 'about', whatsappPhone: 'about', email: 'about',
    contactPreference: 'about', city: 'about', country: 'about',
    skills: 'skills', experience: 'skills', links: 'skills',
    areas: 'contribution', contributionText: 'contribution', availability: 'contribution',
    ideas: 'ideas',
};
const TEXT_KEYS = ['heroBadge', 'heroSub', 'introNote', 'submitLabel', 'nextStepsTitle', 'sentTitle', 'sentBody'];
const DICT_KEYS = ['labels', 'helps', 'placeholders'];
const MAX_TEXT = 400;
const MAX_LONG_TEXT = 1000;
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
// El único HTML admitido es <br>, igual que en el título del tema; el resto se
// convierte en texto inocuo antes de guardarse.
function sanitizeTitle(value) {
    return value.replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .slice(0, 300)
        .replace(/\n/g, '<br>');
}
function sanitizeStringList(value, max, maxLen) {
    if (!Array.isArray(value))
        return null;
    if (value.length > max)
        return null;
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string' || item.length > maxLen)
            return null;
        const trimmed = item.trim();
        if (trimmed !== '')
            out.push(trimmed);
    }
    return out;
}
// Solo se aceptan claves que existen en los diccionarios por defecto: así el
// panel no puede inyectar campos nuevos ni inflar el JSON guardado.
function sanitizeDict(value, allowed) {
    if (!isPlainObject(value))
        return null;
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        if (!(key in allowed))
            return null;
        if (typeof raw !== 'string' || raw.length > MAX_TEXT)
            return null;
        const trimmed = raw.trim();
        if (trimmed !== '')
            out[key] = trimmed;
    }
    return out;
}
// Valida el JSON recibido del panel. Devuelve el error legible en vez de
// lanzarlo, para que la ruta responda 400 con un mensaje útil.
export function parseCollaborateOverrides(raw) {
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
        if (key === 'heroTitleHtml') {
            if (typeof value !== 'string' || value.length > MAX_LONG_TEXT)
                return { ok: false, error: 'Título principal inválido.' };
            sanitized[key] = sanitizeTitle(value);
            continue;
        }
        if (TEXT_KEYS.includes(key)) {
            if (typeof value !== 'string' || value.length > MAX_LONG_TEXT)
                return { ok: false, error: `Texto inválido: ${key}.` };
            sanitized[key] = value.trim();
            continue;
        }
        if (key === 'pillars') {
            const list = sanitizeStringList(value, 6, 60);
            if (!list)
                return { ok: false, error: 'Los pilares deben ser hasta seis textos cortos.' };
            sanitized[key] = list;
            continue;
        }
        if (key === 'nextSteps') {
            const list = sanitizeStringList(value, 6, MAX_TEXT);
            if (!list)
                return { ok: false, error: 'Los pasos siguientes deben ser hasta seis textos.' };
            sanitized[key] = list;
            continue;
        }
        if (key === 'steps') {
            const dict = sanitizeDict(value, DEFAULT_COLLABORATE_FORM.steps);
            if (!dict)
                return { ok: false, error: 'Nombres de paso inválidos.' };
            sanitized[key] = dict;
            continue;
        }
        if (DICT_KEYS.includes(key)) {
            const allowed = DEFAULT_COLLABORATE_FORM[key];
            const dict = sanitizeDict(value, allowed);
            if (!dict)
                return { ok: false, error: `Textos inválidos en ${key}.` };
            sanitized[key] = dict;
            continue;
        }
        if (key === 'maxLinks') {
            const n = typeof value === 'number' ? Math.trunc(value) : NaN;
            if (!Number.isFinite(n) || n < 0 || n > MAX_LINKS_CAP) {
                return { ok: false, error: `El número de enlaces debe estar entre 0 y ${MAX_LINKS_CAP}.` };
            }
            sanitized[key] = n;
            continue;
        }
        if (key === 'fields') {
            if (!isPlainObject(value))
                return { ok: false, error: 'fields debe ser un objeto.' };
            const fields = {};
            for (const [fieldKey, mode] of Object.entries(value)) {
                if (!CONFIGURABLE_FIELDS.includes(fieldKey)) {
                    return { ok: false, error: `Campo no configurable: ${fieldKey}.` };
                }
                if (!isFieldMode(mode))
                    return { ok: false, error: `Estado inválido para ${fieldKey}.` };
                fields[fieldKey] = mode;
            }
            sanitized[key] = fields;
            continue;
        }
        return { ok: false, error: `Clave no permitida: ${key}.` };
    }
    // Los mínimos se comprueban sobre la configuración ya resuelta: apagar un
    // campo que el otro lado de la pareja ya tenía apagado también cuenta.
    const resolved = mergeForm(DEFAULT_COLLABORATE_FORM, sanitized);
    for (const floor of FIELD_FLOORS) {
        if (resolved.fields[floor.a] === 'off' && resolved.fields[floor.b] === 'off') {
            return { ok: false, error: floor.error };
        }
    }
    return { ok: true, value: sanitized };
}
// Merge superficial por sección: los diccionarios se funden clave a clave para
// que el proyecto solo tenga que guardar lo que realmente cambia.
function mergeForm(base, overrides) {
    const merged = {
        ...base,
        pillars: [...base.pillars],
        nextSteps: [...base.nextSteps],
        steps: { ...base.steps },
        labels: { ...base.labels },
        helps: { ...base.helps },
        placeholders: { ...base.placeholders },
        fields: { ...base.fields },
    };
    for (const [key, value] of Object.entries(overrides)) {
        if (key === 'steps' && isPlainObject(value)) {
            Object.assign(merged.steps, value);
            continue;
        }
        if (DICT_KEYS.includes(key) && isPlainObject(value)) {
            Object.assign(merged[key], value);
            continue;
        }
        if (key === 'fields' && isPlainObject(value)) {
            Object.assign(merged.fields, value);
            continue;
        }
        if ((key === 'pillars' || key === 'nextSteps') && Array.isArray(value)) {
            merged[key] = value;
            continue;
        }
        if (key === 'maxLinks' && typeof value === 'number') {
            merged.maxLinks = value;
            continue;
        }
        if (key in base && typeof value === 'string') {
            merged[key] = value;
        }
    }
    return merged;
}
// Configuración efectiva del formulario de un proyecto. Un JSON corrupto en la
// base no tumba la página pública: se registra y se cae a los valores por
// defecto.
export function resolveCollaborateForm(project, lang = DEFAULT_LANG) {
    const defaults = lang === DEFAULT_LANG ? DEFAULT_COLLABORATE_FORM : defaultCollaborateForm(lang);
    if (!project.collaborate_json)
        return defaults;
    const parsed = parseCollaborateOverrides(project.collaborate_json);
    if (!parsed.ok) {
        log.warn('project_collaborate_form_invalid', { message: parsed.error });
        return defaults;
    }
    // Lo que el proyecto escribió pisa al texto de fábrica aunque esté en
    // español: su propia traducción se aplica después, en project-i18n.ts.
    return mergeForm(defaults, parsed.value);
}
// ---- Ayudas de render ---------------------------------------------------------
export function isOn(form, field) {
    return form.fields[field] !== 'off';
}
export function isRequired(form, field) {
    return form.fields[field] === 'required';
}
// Pasos visibles, ya numerados. `review` siempre está; los demás desaparecen
// cuando todos sus campos se apagaron.
export function visibleSteps(form) {
    const keys = ['about', 'skills', 'contribution', 'ideas', 'review'];
    return keys
        .filter(key => {
        if (key === 'review')
            return true;
        // «Sobre ti» nunca desaparece: siempre lleva el nombre, que es obligatorio.
        if (key === 'about')
            return true;
        return CONFIGURABLE_FIELDS.some(field => FIELD_STEP[field] === key && form.fields[field] !== 'off');
    })
        .map(key => ({ key, label: form.steps[key], legend: form.steps[key] }));
}
