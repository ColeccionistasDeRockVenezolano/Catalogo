// CRV · Regla «en vivo» del título de un disco (plan v2 del primo, punto 5).
//
// Un título que dice que el disco se grabó en vivo («En Vivo», «Live at…»,
// «Unplugged», «En Concierto») afirma su tipo. La usan dos caminos:
//   * la normalización común de la ingesta (src/normalization/claims.ts), que
//     deriva un claim `album_type = live_album` cuando la fuente no da tipo;
//   * el aplicador por run sobre el catálogo (scripts/apply-live-album-types.ts).
//
// Qué NO cuenta:
//   * «Vivo» suelto, que es título de canción («Vivo», «Sigo Vivo»);
//   * «Concierto» como obra («Concierto de Aranjuez», «Concierto en la
//     Llanura», «Concierto Para Guitarra y Orquesta»): solo «En Concierto»,
//     «El Concierto» o «Concierto en el Teatro…» describen una actuación;
//   * la negación («Ni En Concierto Ni En Estudio…»);
//   * el nombre del artista dentro del título («Delirium Live»);
//   * los títulos que juntan dos publicaciones («Maquetas / En Vivo»): duda.

/** Marcas que por sí solas dicen «grabado en vivo». */
const LIVE_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\ben\s+vivo\b/iu, "en vivo"],
  [/\ben\s+directo\b/iu, "en directo"],
  [/\blive\s*(?:at|in|from|en|desde|@)(?=\s|@|$)/iu, "live at/in/from"],
  [/\blive\s*@/iu, "live@"],
  [/[([]\s*live\b[^)\]]*[)\]]/iu, "(live …)"],
  [/\blive\s+(?:sessions?|version|recordings?|in\s+concert)\b/iu, "live session/version"],
  [/(?:^|[\s:–-])live\s*[)\]]?\s*$/iu, "… live"],
  [/\bunplugged\b/iu, "unplugged"],
  [/\b(?:en|el)\s+concierto\b/iu, "en/el concierto"],
  [/\bconcierto\s+en\s+(?:el|la)\s+(?:teatro|sala|plaza|poliedro|estadio|platabanda|aula|auditorio|anfiteatro)\b/iu, "concierto en (lugar)"],
];

/** Palabras que sugieren un directo pero no bastan: van al informe como duda. */
const DOUBT_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\bconcierto\b/iu, "concierto (¿obra o actuación?)"],
  [/\blive\b/iu, "live (suelto)"],
  [/\bac[uú]stic[oa]\b/iu, "acústico (sin «en vivo»)"],
];

const NEGATION = /\bni\s+en\s+(?:vivo|directo|concierto)\b/iu;
/** «Maquetas / En Vivo», «Ep / En vivo en El Valle»: dos publicaciones en una ficha, sin tipo único. */
const MIXED = /(?:^|\/)\s*(?:maqu[eé]tas?|demos?|e\.?p\.?|singles?|estudio)\s*(?:\/|$)/iu;

export interface LiveTitleVerdict {
  live: boolean;
  /** La marca que decidió (o la duda), para la evidencia del claim. */
  marker: string | null;
  /** true cuando el título nombra algo parecido pero la regla no se atreve. */
  doubt: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** ¿El título dice que el disco es en vivo? `artist` evita leer el nombre del artista como marca. */
export function liveTitleVerdict(title: string, artist?: string | null): LiveTitleVerdict {
  let text = (title ?? "").normalize("NFC");
  const name = (artist ?? "").trim();
  if (name.length >= 3) text = text.replace(new RegExp(escapeRegExp(name.normalize("NFC")), "giu"), " ");
  text = text.replace(/\s+/gu, " ").trim();
  if (!text || NEGATION.test(text)) return { live: false, marker: null, doubt: NEGATION.test(text) };
  for (const [pattern, marker] of LIVE_MARKERS) {
    if (!pattern.test(text)) continue;
    return MIXED.test(text) ? { live: false, marker: `${marker} + otro tipo en el título`, doubt: true } : { live: true, marker, doubt: false };
  }
  for (const [pattern, marker] of DOUBT_MARKERS) if (pattern.test(text)) return { live: false, marker, doubt: true };
  return { live: false, marker: null, doubt: false };
}

export const isLiveTitle = (title: string, artist?: string | null): boolean => liveTitleVerdict(title, artist).live;
