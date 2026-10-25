export const CRV_CONTACT_URL = "https://www.instagram.com/coleccionistasderockvenezolano/";

export const COMMUNITY_PAGES = [
  { id: "terms", path: "/terminos", label: "Términos de uso", navLabel: "Términos" },
  { id: "privacy", path: "/privacidad", label: "Política de privacidad", navLabel: "Privacidad" },
  { id: "help", path: "/ayuda", label: "Ayuda y comunidad", navLabel: "Ayuda y comunidad" },
] as const;

export type CommunityPageId = typeof COMMUNITY_PAGES[number]["id"];

// Conserva enlaces compartidos antes de reunir el contenido en tres páginas.
export const COMMUNITY_REDIRECTS = [
  { from: "/derechos-de-autor", to: "/terminos", anchor: "derechos-de-autor", anchors: { titulares: "derechos-de-autor", materiales: "derechos-de-autor", reclamos: "reclamos", colaboraciones: "aportes", reutilizacion: "reutilizacion" } },
  { from: "/reglas", to: "/ayuda", anchor: "reglas", anchors: { alcance: "archivo", fuentes: "reglas", discografia: "discografia", audiovisuales: "audiovisuales", respeto: "reglas", revision: "reglas" } },
  { from: "/preguntas-frecuentes", to: "/ayuda", anchor: "preguntas-frecuentes", anchors: { "que-es": "archivo", cuenta: "faq-cuenta", "falta-artista": "faq-falta-artista", corregir: "aportes", reproduccion: "faq-reproduccion", videos: "audiovisuales", diario: "faq-diario", fuentes: "reglas", autor: "faq-autor", ideas: "faq-ideas", menores: "faq-menores", apoyar: "apoyar" } },
  { from: "/apoyar", to: "/ayuda", anchor: "apoyar", anchors: { difundir: "apoyar", documentar: "aportes", colaborar: "apoyar", transparencia: "apoyar" } },
] as const;
