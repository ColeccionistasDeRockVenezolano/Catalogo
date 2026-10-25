// CRV · Emociones de la música (taxonomía Laya, migración 0081).
//
// «música para tener sexo» no es un nombre: se detecta la INTENCIÓN emocional
// de la consulta (léxico español, sin acentos) y se devuelven los artistas del
// catálogo con esa emoción, ordenados por peso de la evidencia (tags de
// Last.fm) y popularidad (oyentes). Los tags dudosos y las etiquetas sin
// emoción no participan: `entity_emotions` solo lleva emociones claras.
import { getPool } from "../../db/client.js";

export const EMOTION_VALUES = [
  "emocion", "tristeza", "enfocado", "libertad", "cachonda", "aumenta_mi_aura",
] as const;
export type Emotion = (typeof EMOTION_VALUES)[number];

export interface EmotionTag {
  tag: string;
  weight: number;
}

export interface EmotionArtist {
  id: number;
  name: string;
  emotion: Emotion;
  /** Suma de los pesos de los tags que sustentan la emoción. */
  score: number;
  /** Cuántos tags la sustentan. */
  evidence: number;
  listeners: number;
  /** Etiquetas de usuario (Last.fm) con su peso. */
  tags: EmotionTag[];
  /** Compatibilidad del contrato; +shoutbox está retirado y siempre devuelve []. */
  shouts: string[];
}

/** Frases y palabras de intención (normalizadas) por emoción, en orden de prioridad. */
const EMOTION_INTENTS: readonly (readonly [Emotion, readonly string[]])[] = [
  ["cachonda", [
    "sexo", "tener sexo", "para sexo", "coger", "cojer", "cogiendo", "follar", "follando",
    "cachondo", "cachonda", "ponerme cachondo", "caliente", "erotico", "erotica", "sensual",
    "seductor", "seductora", "horny", "excitar", "excitante", "intimo", "intima", "pasion",
    "pasional", "hacer el amor", "porno", "en la cama", "para la cama", "desnudo", "desnuda",
    "ponerme hot", "hot",
  ]],
  ["tristeza", [
    "triste", "tristeza", "tristes", "melancolico", "melancolica", "melancolia", "llorar",
    "para llorar", "llorando", "deprimido", "deprimida", "depresion", "nostalgia",
    "nostalgico", "nostalgica", "dolor", "desamor", "corazon roto", "soledad", "pena",
    "sufrir", "sufrimiento", "miedo", "angustia",
  ]],
  ["enfocado", [
    "estudiar", "para estudiar", "estudio", "concentrarme", "concentracion", "concentrar",
    "enfocarme", "foco", "trabajar", "para trabajar", "productividad", "productivo",
    "productiva", "dormir", "para dormir", "relajarme", "relajante", "relax", "tranquilo",
    "tranquila", "calma", "calmado", "paz", "meditar", "meditacion", "programar", "leer",
  ]],
  ["libertad", [
    "libre", "libertad", "rebelde", "revolucion", "escapar", "escapada", "huir", "viaje",
    "viajar", "road trip", "carretera", "aventura", "salvaje", "indomable", "sin ataduras",
    "romper cadenas",
  ]],
  ["aumenta_mi_aura", [
    "poderoso", "poderosa", "poder", "energia", "energetico", "energetica", "epico", "epica",
    "motivacion", "motivacional", "motivarme", "inspirador", "inspiracion", "heroico",
    "gloria", "triunfar", "victoria", "campeon", "fiesta", "para la fiesta", "bailar",
    "bailable", "festejar", "celebrar", "animarme", "animado", "subidon", "adrenalina",
    "intenso", "intensa", "vibras", "buenas vibras", "potente",
  ]],
  ["emocion", [
    "amor", "enamorado", "enamorada", "romantico", "romantica", "romance", "corazon", "beso",
    "besos", "sentimiento", "sentimental", "tierno", "ternura", "carino", "abrazo", "abrazos",
    "ilusion", "ilusionado", "ilusionada",
  ]],
];

/** Minúsculas, sin acentos, un solo espacio. */
export function normalizeQuery(q: string): string {
  return q
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

/** Frases de una sola palabra y frases compuestas, por emoción y en orden de prioridad. */
const EMOTION_SINGLES: readonly (readonly [Emotion, ReadonlySet<string>])[] = EMOTION_INTENTS.map(
  ([emotion, phrases]) => [emotion, new Set(phrases.filter((phrase) => !phrase.includes(" ")))],
);
const EMOTION_PHRASES: readonly (readonly [Emotion, readonly string[]])[] = EMOTION_INTENTS.map(
  ([emotion, phrases]) => [emotion, phrases.filter((phrase) => phrase.includes(" "))],
);

/** Emoción pedida por la consulta («música para tener sexo» → cachonda), o null. */
export function detectEmotionIntent(q: string): Emotion | null {
  const n = normalizeQuery(q);
  if (!n) return null;
  const padded = ` ${n} `;
  const words = n.split(" ");
  for (let i = 0; i < EMOTION_INTENTS.length; i += 1) {
    for (const phrase of EMOTION_PHRASES[i]![1]) {
      if (padded.includes(` ${phrase} `)) return EMOTION_INTENTS[i]![0];
    }
    const singles = EMOTION_SINGLES[i]![1];
    for (const word of words) {
      if (singles.has(word)) return EMOTION_INTENTS[i]![0];
      // Plural simple: «eroticos» → «erotico», «tristes» → «triste».
      if (word.length > 3 && word.endsWith("s") && singles.has(word.slice(0, -1))) return EMOTION_INTENTS[i]![0];
    }
  }
  return null;
}

interface EmotionRow {
  id: string;
  name: string;
  emotion: Emotion;
  score: number;
  evidence: number;
  details: { basis: string; detail: { tags?: EmotionTag[] } | null }[];
  listeners: string;
}

/** Artistas con esa emoción clara, mejor evidencia y más oyentes primero. */
export async function emotionArtists(emotion: Emotion, limit: number, offset = 0): Promise<EmotionArtist[]> {
  const { rows } = await getPool().query<EmotionRow>(
    `SELECT e.artist_id::text AS id, a.name, e.emotion,
            SUM(e.score)::real AS score, SUM(e.evidence)::int AS evidence,
            jsonb_agg(jsonb_build_object('basis', e.basis, 'detail', e.detail)) AS details,
            COALESCE(m.listeners, 0) AS listeners
       FROM public.entity_emotions e
       JOIN ingest.catalog_artists a ON a.id = e.artist_id
       LEFT JOIN LATERAL (
         SELECT mm.listeners FROM public.entity_metrics mm
          WHERE mm.artist_id = e.artist_id
          ORDER BY mm.captured_at DESC LIMIT 1
       ) m ON true
      WHERE e.artist_id IS NOT NULL AND e.emotion = $1 AND e.basis = 'tags'
        AND EXISTS (SELECT 1 FROM ingest.lastfm_artist_verifications v WHERE v.artist_id=e.artist_id)
      GROUP BY e.artist_id, a.name, e.emotion, m.listeners
      ORDER BY SUM(e.score) * ln(1 + COALESCE(m.listeners, 0)) DESC, SUM(e.score) DESC
      LIMIT $2 OFFSET $3`,
    [emotion, limit, offset],
  );
  return rows.map((row) => {
    const tags = row.details.flatMap((d) => d.detail?.tags ?? []);
    return {
      id: Number(row.id),
      name: row.name,
      emotion: row.emotion,
      score: row.score,
      evidence: row.evidence,
      listeners: Number(row.listeners),
      tags,
      shouts: [],
    };
  });
}

export async function emotionArtistCount(emotion: Emotion): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    `SELECT count(DISTINCT artist_id)::text AS n FROM public.entity_emotions
      WHERE artist_id IS NOT NULL AND emotion = $1 AND basis = 'tags'
        AND EXISTS (SELECT 1 FROM ingest.lastfm_artist_verifications v WHERE v.artist_id=entity_emotions.artist_id)`,
    [emotion],
  );
  return Number(rows[0]?.n ?? 0);
}
