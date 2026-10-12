// CRV · Series y volúmenes (plan del primo, etapa 2, punto 13).
//
// Criterio de producto (Brian, 2026-10-12): un volumen publicado por separado
// tiene su página y entra en su serie con su número («Venezuela Electrónica –
// Vol. 1», como Discogs); un 2CD o una caja vendidos juntos siguen en una
// página con varios discos.

const ROMAN: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50, c: 100 };

function fromRoman(value: string): number | null {
  const chars = value.toLowerCase().split("");
  if (!chars.length || chars.some((char) => !(char in ROMAN))) return null;
  let total = 0;
  for (const [index, char] of chars.entries()) {
    const current = ROMAN[char]!;
    const next = ROMAN[chars[index + 1] ?? ""] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 && total < 200 ? total : null;
}

const VOLUME = /\b(vol(?:umen|ume|\.)?|parte|part|tomo|n[º°o]\.?)\s*[.:]?\s*(\d{1,3}|[ivxlc]{1,7})\b/iu;

/** Número de volumen de un título («Antología Vol. IV» → 4, «Vol. IV»). */
export function volumeOf(title: string): { number: number; label: string } | null {
  const match = title.match(VOLUME);
  if (!match) return null;
  const raw = match[2]!;
  const number = /^\d+$/u.test(raw) ? Number(raw) : fromRoman(raw);
  if (number === null) return null;
  const word = /^part/iu.test(match[1]!) ? "Parte" : /^tomo/iu.test(match[1]!) ? "Tomo" : "Vol.";
  return { number, label: `${word} ${/^\d+$/u.test(raw) ? String(number) : raw.toUpperCase()}` };
}

/** Título de la serie: el del grupo sin el volumen ni la puntuación que lo separa. */
export function seriesTitleOf(groupTitle: string, memberTitles: readonly string[]): string {
  const strip = (value: string) => value.replace(new RegExp(`[\\s,:;–—-]*\\(?${VOLUME.source}\\)?.*$`, "iu"), "").trim();
  const base = strip(groupTitle) || groupTitle.trim();
  if (base) return base;
  return strip(memberTitles[0] ?? "") || (memberTitles[0] ?? "");
}

/** «Serie: Venezuela Electrónica – Vol. 1». */
export function seriesLine(title: string, volumeLabel: string | null): string {
  return volumeLabel ? `${title} – ${volumeLabel}` : title;
}
