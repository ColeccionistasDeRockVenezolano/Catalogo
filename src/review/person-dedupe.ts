// CRV · Cascada de personas homónimas tras fusionar artistas (etapa 5).
//
// Una fusión puede dejar dos fichas de persona con el mismo nombre en el mismo
// artista (el caso Gustavo Guerrero 2858/57035). Solo se unen si el nombre
// normalizado coincide, los roles no se contradicen y los períodos se solapan.
// Cualquier duda se queda como hallazgo; nunca se borra una persona a ciegas.
import type { OperatorContext } from "../merge/operator.js";
import { mergeEntities, previewEntityMerge, type MergeFieldChoice } from "../merge/entity-merge.js";
import { nameKey } from "../curation/lexicon.js";

interface MembershipRow {
  person_id: string; name: string; role: string | null;
  from_year: number | null; to_year: number | null;
  links: string;
}

export interface PersonDedupeResult {
  merged: number;
  skipped: number;
  groups: number;
  details: string[];
}

const ROLE_SYNONYMS: Readonly<Record<string, string>> = {
  bajo: "bass", bass: "bass", bajista: "bass",
  bateria: "drums", batería: "drums", drums: "drums", baterista: "drums",
  guitarra: "guitar", guitar: "guitar", guitars: "guitar", guitarrista: "guitar",
  voz: "vocals", voces: "vocals", vocal: "vocals", vocals: "vocals",
  teclados: "keyboards", teclado: "keyboards", keyboards: "keyboards", keys: "keyboards",
  percusion: "percussion", percusión: "percussion", percussion: "percussion",
  tornamesas: "dj", sampler: "dj", dj: "dj",
  integrante: "*", miembro: "*", member: "*",
};

/** Conjunto canónico de roles; «integrante» o vacío actúa como comodín. */
function roleTokens(role: string | null): Set<string> {
  const text = (role ?? "").toLocaleLowerCase("es").normalize("NFD").replaceAll(/\p{Diacritic}/gu, "");
  if (!text.trim()) return new Set(["*"]);
  const tokens = text.split(/\s*(?:&|,|\/|\+|\by\b)\s*/u).map((token) => {
    const clean = token.trim();
    return ROLE_SYNONYMS[clean] ?? (clean.includes("guitar") ? "guitar"
      : clean.includes("vocal") ? "vocals"
        : clean.includes("drum") ? "drums"
          : clean.includes("bass") ? "bass"
            : clean.includes("keyboard") ? "keyboards"
              : clean.includes("percussion") ? "percussion"
                : clean);
  }).filter(Boolean);
  return new Set(tokens.length ? tokens : ["*"]);
}

function rolesCompatible(left: MembershipRow[], right: MembershipRow[]): boolean {
  const leftRoles = new Set(left.flatMap((row) => [...roleTokens(row.role)]));
  const rightRoles = new Set(right.flatMap((row) => [...roleTokens(row.role)]));
  if (leftRoles.has("*") || rightRoles.has("*")) return true;
  return [...leftRoles].some((role) => rightRoles.has(role));
}

function periodsOverlap(left: MembershipRow, right: MembershipRow): boolean {
  const leftFrom = left.from_year ?? -Infinity;
  const leftTo = left.to_year ?? Infinity;
  const rightFrom = right.from_year ?? -Infinity;
  const rightTo = right.to_year ?? Infinity;
  return leftFrom <= rightTo && rightFrom <= leftTo;
}

/** Fusiona personas homónimas exactas dentro de un artista. Corre en el run de la fusión. */
export async function dedupeArtistPersons(context: OperatorContext, artistId: number): Promise<PersonDedupeResult> {
  const { rows } = await context.client.query<MembershipRow>(`
    SELECT m.person_id::text, p.name, m.role, m.from_year, m.to_year,
           (SELECT count(*)::text FROM public.artist_members x WHERE x.person_id=m.person_id)
           || '/' || (SELECT count(*)::text FROM public.album_credits c WHERE c.person_id=m.person_id)
           || '/' || (SELECT count(*)::text FROM public.track_credits c WHERE c.person_id=m.person_id) AS links
      FROM public.artist_members m
      JOIN public.persons p ON p.id = m.person_id
     WHERE m.artist_id = $1
     ORDER BY p.name, m.person_id`, [artistId]);
  const groups = new Map<string, MembershipRow[]>();
  for (const row of rows) {
    const key = nameKey(row.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let merged = 0;
  let skipped = 0;
  let touched = 0;
  const details: string[] = [];
  for (const group of groups.values()) {
    const byPerson = new Map<number, MembershipRow[]>();
    for (const row of group) {
      const id = Number(row.person_id);
      byPerson.set(id, [...(byPerson.get(id) ?? []), row]);
    }
    if (byPerson.size < 2) continue;
    touched += 1;
    const people = [...byPerson.entries()].sort((left, right) => {
      const leftLinks = left[1].reduce((sum, row) => sum + Number(row.links.split("/").reduce((a, b) => a + Number(b), 0)), 0);
      const rightLinks = right[1].reduce((sum, row) => sum + Number(row.links.split("/").reduce((a, b) => a + Number(b), 0)), 0);
      return rightLinks - leftLinks || left[0] - right[0];
    });
    const [keepId, keepRows] = people[0]!;
    for (const [dropId, dropRows] of people.slice(1)) {
      const compatibleRoles = rolesCompatible(keepRows, dropRows);
      const compatiblePeriod = keepRows.some((left) => dropRows.some((right) => periodsOverlap(left, right)));
      if (!compatibleRoles || !compatiblePeriod) { skipped += 1; continue; }
      let preview;
      try {
        preview = await previewEntityMerge(context.client, "person", keepId, dropId, { lock: true });
      } catch (error) {
        // Época o datos contradictorios: no se fuerza; queda el hallazgo.
        skipped += 1;
        details.push(`persona ${dropId} sin unir: ${error instanceof Error ? error.message.slice(0, 120) : "error"}`);
        continue;
      }
      const choices: Partial<Record<string, MergeFieldChoice>> = {};
      for (const field of preview.combinableFields) choices[field] = "combine";
      await mergeEntities(context, {
        kind: "person", keepId, dropId, previewHash: preview.previewHash,
        fieldChoices: choices, rewriteLater: true, keepDropNameAsAlias: false,
      });
      merged += 1;
      details.push(`persona ${dropId} → ${keepId}`);
    }
  }
  return { merged, skipped, groups: touched, details };
}
