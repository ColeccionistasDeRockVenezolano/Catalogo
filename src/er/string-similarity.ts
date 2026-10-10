function round(value: number): number { return Math.round(value * 100_000) / 100_000; }

/** Jaro-Winkler se usa solo como senal; jamas habilita merge por si sola. */
export function jaroWinkler(left: string, right: string): number {
  if (left === right) return 1;
  if (!left.length || !right.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(left.length, right.length) / 2) - 1);
  const leftMatches = new Array<boolean>(left.length).fill(false);
  const rightMatches = new Array<boolean>(right.length).fill(false);
  let matches = 0;
  for (let i = 0; i < left.length; i += 1) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, right.length);
    for (let j = start; j < end; j += 1) {
      if (rightMatches[j] || left[i] !== right[j]) continue;
      leftMatches[i] = true; rightMatches[j] = true; matches += 1; break;
    }
  }
  if (!matches) return 0;
  const leftOrdered = [...left].filter((_, index) => leftMatches[index]);
  const rightOrdered = [...right].filter((_, index) => rightMatches[index]);
  let transpositions = 0;
  for (let index = 0; index < leftOrdered.length; index += 1) {
    if (leftOrdered[index] !== rightOrdered[index]) transpositions += 1;
  }
  const m = matches;
  const jaro = (m / left.length + m / right.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && left[prefix] !== undefined && left[prefix] === right[prefix]) prefix += 1;
  return round(jaro + prefix * 0.1 * (1 - jaro));
}

