type Feature = { key: string; value: number; evidence: string };

interface SignalInfo {
  label: string;
  /** Peso en puntos tal como lo aplica el detector. */
  weight: string;
  sign: 1 | -1;
  explain: string;
  detail?: (evidence: string) => string | null;
}

/**
 * Traducción de cada feature del detector a lenguaje de curaduría. Los pesos
 * son los de `scorePersonPair`; si allí cambian, hay que cambiarlos aquí.
 */
export const SIGNALS: Readonly<Record<string, SignalInfo>> = {
  nickname_equal: {
    label: "Mismo nombre sin el apodo", weight: "+45", sign: 1,
    explain: "Al quitar el apodo (entre comillas o paréntesis), los dos nombres son idénticos.",
    detail: (evidence) => after(evidence, "coinciden:"),
  },
  alias_cross: {
    label: "Registrado como alias", weight: "+45", sign: 1,
    explain: "El nombre de una ficha ya figura como alias declarado de la otra.",
    detail: () => "Uno figura como alias del otro",
  },
  first_last_equal: {
    label: "Mismo primer nombre y apellido", weight: "+25", sign: 1,
    explain: "Coinciden el primer nombre y el último apellido, aunque cambie lo del medio.",
    detail: (evidence) => after(evidence, "token:"),
  },
  jaro_winkler: {
    label: "Se escriben casi igual", weight: "hasta +15", sign: 1,
    explain: "Similitud de escritura del nombre sin apodo; solo cuenta desde el 92 %.",
    detail: (evidence) => {
      const match = /=([\d.]+)/u.exec(evidence);
      return match ? `Similitud de escritura del ${Math.round(Number(match[1]) * 100)} %` : null;
    },
  },
  shared_band: {
    label: "Tocan en la misma banda", weight: "+20", sign: 1,
    explain: "Las dos fichas figuran como integrantes de al menos una misma banda.",
  },
  shared_album: {
    label: "Acreditados en el mismo disco", weight: "+15", sign: 1,
    explain: "Las dos fichas tienen créditos en al menos un mismo disco.",
    detail: (evidence) => {
      const count = Number(after(evidence, ":"));
      return Number.isFinite(count) && count > 0 ? `${plural(count, "disco", "discos")} en común` : null;
    },
  },
  middle_name_clash: {
    label: "Segundo nombre distinto", weight: "−10", sign: -1,
    explain: "Los nombres intermedios no coinciden: resta, pero no descarta (hay quien firma sin él).",
    detail: (evidence) => {
      const names = after(evidence, "distintos:");
      return names ? `Intermedios distintos: ${names}` : null;
    },
  },
};

function after(text: string, marker: string): string | null {
  const index = text.indexOf(marker);
  return index === -1 ? null : text.slice(index + marker.length).trim() || null;
}

/** Puntos con signo; el detector guarda la resta de `middle_name_clash` en positivo. */
export function featurePoints(feature: Feature): number {
  return Math.round(feature.value * 100) * (SIGNALS[feature.key]?.sign ?? 1);
}


function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
