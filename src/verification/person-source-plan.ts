import { normalizeRymIdentity as norm } from './rym-identity.js';

export interface PersonCandidate { id: number; name: string; aliases: string[]; projects: number[] }
const normalizedPeople = new WeakMap<PersonCandidate, {name: string; aliases: string[]; normalized: string[]; parts: string[]}>();
const nameIndexes = new WeakMap<PersonCandidate[], {length: number; names: Map<string,PersonCandidate[]>}>();
function normalized(person: PersonCandidate) {
  let cached = normalizedPeople.get(person);
  if (!cached || cached.name !== person.name || cached.aliases !== person.aliases) {
    const name = norm(person.name);
    cached = {name:person.name,aliases:person.aliases,normalized:[name,...person.aliases.map(value=>norm(value))],parts:name.split(' ')};
    normalizedPeople.set(person,cached);
  }
  return cached;
}
export function exactSourcePeople(name: string, people: PersonCandidate[]): PersonCandidate[] {
  let index = nameIndexes.get(people);
  if (!index || index.length !== people.length) {
    const names = new Map<string,PersonCandidate[]>();
    for (const person of people) for (const value of new Set(normalized(person).normalized)) {
      const matches = names.get(value) ?? []; matches.push(person); names.set(value,matches);
    }
    index = {length:people.length,names}; nameIndexes.set(people,index);
  }
  return index.names.get(norm(name)) ?? [];
}
export function resolveSourcePerson(name: string, artistId: number, people: PersonCandidate[]): number | null {
  const key = norm(name), parts = key.split(' ');
  if (parts.length < 2) return null;
  const exact = exactSourcePeople(name,people);
  const linked = exact.filter(person => person.projects.includes(artistId));
  if (linked.length === 1) return linked[0]!.id;
  if (exact.length === 1 && normalized(exact[0]!).normalized[0] === key) return exact[0]!.id;
  if (exact.length) return null;
  const short = people.filter(person => {
    const full = normalized(person).parts;
    return person.projects.includes(artistId) && parts[0] === full[0] && parts.every(part => full.includes(part))
      && (parts.length >= 3 || parts.at(-1) === full.at(-1));
  });
  return short.length === 1 ? short[0]!.id : null;
}

export interface SourcePeriod { begin?: string | null; end?: string | null; isCurrent?: boolean; periodNeedsReview?: boolean }
export function sourcePeriod(sources: SourcePeriod[]): { from_year: number | null; to_year: number | null; is_current: boolean } | null {
  if (sources.some(source => source.periodNeedsReview)) return null;
  const year = (value: string | null | undefined): number | null => value && /^\d{4}(?:-|$)/u.test(value) ? Number(value.slice(0,4)) : null;
  const starts = [...new Set(sources.map(source => year(source.begin)).filter(value => value !== null))];
  const ends = [...new Set(sources.map(source => year(source.end)).filter(value => value !== null))];
  if (starts.length > 1 || ends.length > 1 || (ends.length && sources.some(source => source.isCurrent))) return null;
  const from = starts[0] ?? null, to = ends[0] ?? null;
  if (from !== null && to !== null && from > to) return null;
  return { from_year:from, to_year:to, is_current:sources.some(source => source.isCurrent === true) };
}

export function completePersonName(name: string): boolean {
  const parts = name.trim().split(/\s+/u);
  return parts.length >= 2 && parts.length <= 7 && parts.every(part => /^[\p{L}\p{M}'’‐-]+$/u.test(part))
    && parts.filter(part => part.replace(/[^\p{L}]/gu,'').length >= 2).length >= 2;
}

export function membershipPeriodConflict(existing: {from_year:number|null;to_year:number|null;is_current:boolean}, incoming: {from_year:number|null;to_year:number|null;is_current:boolean}): string | null {
  const from=existing.from_year ?? incoming.from_year, to=existing.to_year ?? incoming.to_year;
  if (from!==null && to!==null && from>to) return 'source_period_inverts_existing_membership';
  if (to!==null && (existing.is_current || incoming.is_current)) return 'source_period_conflicts_with_current_membership';
  return null;
}
