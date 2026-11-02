// Versión en inglés de los textos propios de un proyecto.
//
// El diccionario de i18n.ts traduce a Herra; esto traduce al proyecto: su
// nombre, la portada, los metadatos para compartir y la sección de apoyo. Son
// textos que solo su administración puede escribir, así que viven en la base
// (projects.i18n_json) con el mismo patrón de dos capas que el tema y la
// identidad: lo que el proyecto escriba pisa al español; lo que deje vacío se
// sirve en español, que siempre es el original.
import { log } from './logger.js';
import { SOCIAL_PLATFORMS } from './social-icons.js';
import { DEFAULT_COLLABORATE_FORM, resolveCollaborateForm } from './collaborate-form.js';
import { DEFAULT_LANG, TRANSLATABLE_LANGS } from './i18n.js';
export { TRANSLATABLE_LANGS };
// Identidad y portada del proyecto. Estos campos siempre están: todo proyecto
// tiene nombre, portada y metadatos, aunque no los haya personalizado.
export const PROJECT_I18N_FIELDS = [
    { key: 'name', labelKey: 'projField.name', maxLength: 120, kind: 'text' },
    { key: 'heroTitleHtml', labelKey: 'projField.heroTitleHtml', maxLength: 300, kind: 'html', multiline: true },
    { key: 'heroSubPublic', labelKey: 'projField.heroSubPublic', maxLength: 300, kind: 'text', multiline: true },
    { key: 'landingHeadline', labelKey: 'projField.landingHeadline', maxLength: 300, kind: 'text' },
    { key: 'footerNote', labelKey: 'projField.footerNote', maxLength: 300, kind: 'text' },
    { key: 'metaTitle', labelKey: 'projField.metaTitle', maxLength: 160, kind: 'text' },
    { key: 'metaDescription', labelKey: 'projField.metaDescription', maxLength: 320, kind: 'text', multiline: true },
    { key: 'keywords', labelKey: 'projField.keywords', maxLength: 320, kind: 'text' },
    { key: 'ogTitle', labelKey: 'projField.ogTitle', maxLength: 160, kind: 'text' },
    { key: 'ogDescription', labelKey: 'projField.ogDescription', maxLength: 320, kind: 'text', multiline: true },
    { key: 'imageAlt', labelKey: 'projField.imageAlt', maxLength: 320, kind: 'text' },
    { key: 'aboutTitle', labelKey: 'projField.aboutTitle', maxLength: 160, kind: 'text' },
    { key: 'aboutDescription', labelKey: 'projField.aboutDescription', maxLength: 700, kind: 'text', multiline: true },
    { key: 'aboutStatus', labelKey: 'projField.aboutStatus', maxLength: 700, kind: 'text', multiline: true },
    { key: 'aboutScope', labelKey: 'projField.aboutScope', maxLength: 700, kind: 'text', multiline: true },
    { key: 'aboutSourceLabel', labelKey: 'projField.aboutSourceLabel', maxLength: 120, kind: 'text' },
    { key: 'faqTitle', labelKey: 'projField.faqTitle', maxLength: 160, kind: 'text' },
    { key: 'faq1Question', labelKey: 'projField.faq1Question', maxLength: 160, kind: 'text' },
    { key: 'faq1Answer', labelKey: 'projField.faq1Answer', maxLength: 700, kind: 'text', multiline: true },
    { key: 'faq2Question', labelKey: 'projField.faq2Question', maxLength: 160, kind: 'text' },
    { key: 'faq2Answer', labelKey: 'projField.faq2Answer', maxLength: 700, kind: 'text', multiline: true },
    { key: 'faq3Question', labelKey: 'projField.faq3Question', maxLength: 160, kind: 'text' },
    { key: 'faq3Answer', labelKey: 'projField.faq3Answer', maxLength: 700, kind: 'text', multiline: true },
    { key: 'faq4Question', labelKey: 'projField.faq4Question', maxLength: 160, kind: 'text' },
    { key: 'faq4Answer', labelKey: 'projField.faq4Answer', maxLength: 700, kind: 'text', multiline: true },
    { key: 'supportKicker', labelKey: 'projField.supportKicker', maxLength: 40, kind: 'text' },
    { key: 'supportTitle', labelKey: 'projField.supportTitle', maxLength: 160, kind: 'text' },
    { key: 'supportSub', labelKey: 'projField.supportSub', maxLength: 320, kind: 'text', multiline: true },
    { key: 'donationLabel', labelKey: 'projField.donationLabel', maxLength: 120, kind: 'text' },
    { key: 'donationNote', labelKey: 'projField.donationNote', maxLength: 320, kind: 'text', multiline: true },
];
// ---- Textos propios del formulario de colaboración --------------------------
//
// El formulario ya viene traducido de fábrica (ver collaborate-form.ts): esto
// es solo para el proyecto que escribe los suyos. Lo que no haya personalizado
// no aparece en el panel de idiomas, porque no hay nada que traducir ahí.
const COLLAB_PREFIX = 'collab.';
const COLLAB_TEXT_FIELDS = [
    { key: 'heroBadge', labelKey: 'admin.cfgHeroBadge' },
    { key: 'heroTitleHtml', labelKey: 'admin.cfgHeroTitle', kind: 'html', multiline: true },
    { key: 'heroSub', labelKey: 'admin.cfgHeroSub', multiline: true },
    { key: 'introNote', labelKey: 'admin.cfgIntroNote', multiline: true },
    { key: 'pillars', labelKey: 'admin.cfgPillars', list: 'comma' },
    { key: 'submitLabel', labelKey: 'admin.cfgSubmitLabel' },
    { key: 'nextStepsTitle', labelKey: 'admin.cfgNextStepsTitle' },
    { key: 'nextSteps', labelKey: 'admin.cfgNextSteps', multiline: true, list: 'lines' },
    { key: 'sentTitle', labelKey: 'admin.cfgSentTitle' },
    { key: 'sentBody', labelKey: 'admin.cfgSentBody', multiline: true },
];
const COLLAB_STEP_LABELS = {
    about: 'admin.cfgStepAbout',
    skills: 'admin.cfgStepSkills',
    contribution: 'admin.cfgStepContribution',
    ideas: 'admin.cfgStepIdeas',
    review: 'admin.cfgStepReview',
};
const COLLAB_HELP_LABELS = {
    birthDate: 'admin.cfgHelpBirthDate',
    contact: 'admin.cfgHelpContact',
    links: 'admin.cfgHelpLinks',
    ideas: 'admin.cfgHelpIdeas',
};
// Todas las claves traducibles del formulario, en el mismo orden en que el
// panel las edita en español. El diccionario del proyecto es plano, así que la
// sección viaja en la propia clave: «collab.labels.email».
const COLLABORATE_I18N_FIELDS = [
    ...COLLAB_TEXT_FIELDS.map(field => ({
        key: COLLAB_PREFIX + field.key,
        labelKey: field.labelKey,
        maxLength: 1000,
        kind: (field.kind ?? 'text'),
        multiline: field.multiline,
        list: field.list,
    })),
    ...Object.keys(DEFAULT_COLLABORATE_FORM.steps).map(key => ({
        key: `${COLLAB_PREFIX}steps.${key}`,
        labelKey: COLLAB_STEP_LABELS[key] ?? key,
        maxLength: 200,
        kind: 'text',
    })),
    ...Object.keys(DEFAULT_COLLABORATE_FORM.labels).map(key => ({
        key: `${COLLAB_PREFIX}labels.${key}`,
        labelKey: `cfgField.${key}`,
        maxLength: 200,
        kind: 'text',
    })),
    ...Object.keys(DEFAULT_COLLABORATE_FORM.helps).map(key => ({
        key: `${COLLAB_PREFIX}helps.${key}`,
        labelKey: COLLAB_HELP_LABELS[key] ?? key,
        maxLength: 400,
        kind: 'text',
        multiline: true,
    })),
    ...Object.keys(DEFAULT_COLLABORATE_FORM.placeholders).map(key => ({
        key: `${COLLAB_PREFIX}placeholders.${key}`,
        labelKey: `cfgPlaceholder.${key}`,
        maxLength: 200,
        kind: 'text',
    })),
];
// ---- Etiquetas de los enlaces de redes --------------------------------------
//
// Cada enlace puede llevar la etiqueta que el proyecto quiera («Correo»,
// «Escríbenos»). Sin etiqueta propia sale el nombre de la plataforma, que ya
// está traducido; con ella, es texto del proyecto y se traduce como el resto.
const SOCIAL_PREFIX = 'social.';
const SOCIAL_I18N_FIELDS = SOCIAL_PLATFORMS.map(platform => ({
    key: SOCIAL_PREFIX + platform.key,
    labelKey: 'admin.langSocialLabel',
    labelText: platform.label,
    maxLength: 60,
    kind: 'text',
}));
// Solo los enlaces que este proyecto configuró con etiqueta propia: los demás
// no tienen nada que traducir.
export function socialI18nFields(branding) {
    const withLabel = new Set(branding.socialLinks.filter(link => link.label).map(link => link.platform));
    return SOCIAL_I18N_FIELDS.filter(field => withLabel.has(field.key.slice(SOCIAL_PREFIX.length)));
}
export function socialI18nSource(branding) {
    const source = {};
    for (const link of branding.socialLinks) {
        if (link.label)
            source[SOCIAL_PREFIX + link.platform] = link.label;
    }
    return source;
}
export const ALL_PROJECT_I18N_FIELDS = [
    ...PROJECT_I18N_FIELDS,
    ...COLLABORATE_I18N_FIELDS,
    ...SOCIAL_I18N_FIELDS,
];
const FIELD_BY_KEY = new Map(ALL_PROJECT_I18N_FIELDS.map(field => [field.key, field]));
// Qué claves del formulario tiene sentido ofrecer para traducir: solo las que
// este proyecto personalizó. El resto sale del diccionario de Herra, que ya
// está en inglés, y pedir su traducción sería trabajo inventado.
export function collaborateI18nFields(overrides) {
    return COLLABORATE_I18N_FIELDS.filter(field => {
        const path = field.key.slice(COLLAB_PREFIX.length).split('.');
        if (path.length === 1)
            return path[0] in overrides;
        const section = overrides[path[0]];
        return Boolean(section && typeof section === 'object' && path[1] in section);
    });
}
// El texto en español de cada clave del formulario, tal como se publica hoy.
// Es la referencia que se traduce, así que sale del formulario ya resuelto en
// español y no de los valores de fábrica.
export function collaborateI18nSource(form) {
    const source = {};
    for (const field of COLLABORATE_I18N_FIELDS) {
        const path = field.key.slice(COLLAB_PREFIX.length).split('.');
        const value = path.length === 1
            ? form[path[0]]
            : (form[path[0]] ?? {})[path[1]];
        if (Array.isArray(value))
            source[field.key] = value.join(field.list === 'lines' ? '\n' : ', ');
        else if (typeof value === 'string')
            source[field.key] = value;
    }
    return source;
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
// El único marcado admitido en el título de portada es <br>, igual que en el
// tema: el resto se convierte en texto inocuo antes de guardarse.
function sanitizeHtmlField(value, maxLength) {
    return value.replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .slice(0, maxLength)
        .replace(/\n/g, '<br>');
}
export function parseProjectI18nOverrides(raw) {
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
        return { ok: false, error: 'La configuración de idiomas debe ser un objeto JSON.' };
    const sanitized = {};
    for (const [lang, values] of Object.entries(parsed)) {
        if (!TRANSLATABLE_LANGS.includes(lang)) {
            return { ok: false, error: `Idioma no admitido: ${lang}.` };
        }
        if (!isPlainObject(values))
            return { ok: false, error: `Los textos de ${lang} deben ser un objeto.` };
        const translation = {};
        for (const [key, value] of Object.entries(values)) {
            const field = FIELD_BY_KEY.get(key);
            if (!field)
                return { ok: false, error: `Clave no permitida: ${key}.` };
            if (typeof value !== 'string')
                return { ok: false, error: `Texto inválido: ${key}.` };
            const clean = field.kind === 'html'
                ? sanitizeHtmlField(value, field.maxLength)
                // Los metadatos viajan dentro de <meta>: los signos de marcado ahí solo
                // pueden ser ruido, igual que en la identidad del proyecto.
                : value.replace(/[<>]/g, '').trim().slice(0, field.maxLength);
            // Un campo vacío no es una traducción: se descarta para que caiga al
            // español en vez de publicar un hueco.
            if (clean !== '')
                translation[key] = clean;
        }
        if (Object.keys(translation).length > 0)
            sanitized[lang] = translation;
    }
    return { ok: true, value: sanitized };
}
// Traducciones crudas de un proyecto, tal como las escribió su administración.
export function projectTranslations(project) {
    if (!project.i18n_json)
        return {};
    const parsed = parseProjectI18nOverrides(project.i18n_json);
    if (!parsed.ok) {
        // Un JSON corrupto en la base no puede tumbar la página pública: se
        // registra y el proyecto se sirve en español.
        log.warn('project_i18n_invalid', { message: parsed.error });
        return {};
    }
    return parsed.value;
}
export function projectTranslation(project, lang) {
    if (lang === DEFAULT_LANG)
        return {};
    return projectTranslations(project)[lang] ?? {};
}
// El nombre manda en la marca, la cabecera y el pie, así que se resuelve sobre
// el tema ya calculado para el proyecto.
export function localizeTheme(theme, translation) {
    if (Object.keys(translation).length === 0)
        return theme;
    return {
        ...theme,
        projectName: translation.name || theme.projectName,
        heroTitleHtml: translation.heroTitleHtml || theme.heroTitleHtml,
        heroSubPublic: translation.heroSubPublic || theme.heroSubPublic,
        landingHeadline: translation.landingHeadline || theme.landingHeadline,
        footerNote: translation.footerNote || theme.footerNote,
    };
}
// El formulario público de un proyecto, listo para renderizar: los textos de
// fábrica en el idioma de la petición, encima lo que el proyecto personalizó y
// encima su traducción. Las tres capas en un solo sitio para que ninguna
// pantalla se salte una.
export function projectCollaborateForm(project, lang) {
    return localizeCollaborateForm(resolveCollaborateForm(project, lang), projectTranslation(project, lang));
}
// Formulario de colaboración en el idioma de la petición. Llega ya resuelto
// con los textos de fábrica traducidos (collaborate-form.ts) y con lo que el
// proyecto personalizó encima, en español; aquí se sustituye por su traducción
// aquello que la administración sí haya traducido. Lo que personalizó y no
// tradujo se queda en español a propósito: es su texto, y media frase traducida
// se lee peor que la frase entera en el idioma original.
export function localizeCollaborateForm(form, translation) {
    const entries = Object.entries(translation).filter(([key]) => key.startsWith(COLLAB_PREFIX));
    if (entries.length === 0)
        return form;
    const localized = {
        ...form,
        pillars: [...form.pillars],
        nextSteps: [...form.nextSteps],
        steps: { ...form.steps },
        labels: { ...form.labels },
        helps: { ...form.helps },
        placeholders: { ...form.placeholders },
        fields: { ...form.fields },
    };
    for (const [key, rawValue] of entries) {
        const value = rawValue ?? '';
        if (value === '')
            continue;
        const field = FIELD_BY_KEY.get(key);
        const path = key.slice(COLLAB_PREFIX.length).split('.');
        if (path.length === 2) {
            const section = localized[path[0]];
            if (section && path[1] in section)
                section[path[1]] = value;
            continue;
        }
        if (field?.list) {
            const items = value.split(field.list === 'lines' ? '\n' : ',')
                .map(item => item.trim())
                .filter(item => item !== '');
            if (items.length > 0)
                localized[path[0]] = items;
            continue;
        }
        if (path[0] in localized)
            localized[path[0]] = value;
    }
    return localized;
}
export function localizeBranding(branding, translation) {
    if (Object.keys(translation).length === 0)
        return branding;
    return {
        ...branding,
        metaTitle: translation.metaTitle || branding.metaTitle,
        metaDescription: translation.metaDescription || branding.metaDescription,
        keywords: translation.keywords || branding.keywords,
        ogTitle: translation.ogTitle || branding.ogTitle,
        ogDescription: translation.ogDescription || branding.ogDescription,
        imageAlt: translation.imageAlt || branding.imageAlt,
        aboutTitle: translation.aboutTitle || branding.aboutTitle,
        aboutDescription: translation.aboutDescription || branding.aboutDescription,
        aboutStatus: translation.aboutStatus || branding.aboutStatus,
        aboutScope: translation.aboutScope || branding.aboutScope,
        aboutSourceLabel: translation.aboutSourceLabel || branding.aboutSourceLabel,
        faqTitle: translation.faqTitle || branding.faqTitle,
        faq1Question: translation.faq1Question || branding.faq1Question,
        faq1Answer: translation.faq1Answer || branding.faq1Answer,
        faq2Question: translation.faq2Question || branding.faq2Question,
        faq2Answer: translation.faq2Answer || branding.faq2Answer,
        faq3Question: translation.faq3Question || branding.faq3Question,
        faq3Answer: translation.faq3Answer || branding.faq3Answer,
        faq4Question: translation.faq4Question || branding.faq4Question,
        faq4Answer: translation.faq4Answer || branding.faq4Answer,
        supportKicker: translation.supportKicker || branding.supportKicker,
        supportTitle: translation.supportTitle || branding.supportTitle,
        supportSub: translation.supportSub || branding.supportSub,
        socialLinks: branding.socialLinks.map(link => ({
            ...link,
            label: translation[SOCIAL_PREFIX + link.platform] || link.label,
        })),
        donation: {
            ...branding.donation,
            label: translation.donationLabel || branding.donation.label,
            note: translation.donationNote || branding.donation.note,
        },
    };
}
