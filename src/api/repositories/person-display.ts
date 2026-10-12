// CRV · Nombre de pantalla de las personas con apodo (plan del primo, punto 2):
// «José Luis "Cheo" Pardo» se compone aquí; la base guarda «José Luis Pardo» y
// el apodo como alias `nickname`.
import { getPool } from "../../db/client.js";
import { composeNicknameName, markPublicAliases, type AliasLike } from "../../normalization/public-names.js";

/** Nombre compuesto de cada persona que tiene apodo; las demás no aparecen en el mapa. */
export async function personDisplayNames(personIds: readonly number[]): Promise<Map<number, string>> {
  const ids = [...new Set(personIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, string>();
  if (!ids.length) return result;
  const { rows } = await getPool().query<{ person_id: string; name: string; alias: string; alias_type: string }>(
    `SELECT a.person_id::text, p.name, a.alias, a.alias_type::text
       FROM ingest.person_aliases a JOIN public.persons p ON p.id = a.person_id
      WHERE a.person_id = ANY($1::bigint[])
        AND EXISTS (SELECT 1 FROM ingest.person_aliases n WHERE n.person_id = a.person_id AND n.alias_type::text = 'nickname')`,
    [ids],
  );
  const byPerson = new Map<number, { name: string; aliases: AliasLike[] }>();
  for (const row of rows) {
    const id = Number(row.person_id);
    const entry = byPerson.get(id) ?? { name: row.name, aliases: [] };
    entry.aliases.push({ alias: row.alias, aliasType: row.alias_type });
    byPerson.set(id, entry);
  }
  for (const [id, entry] of byPerson) {
    const composed = composeNicknameName(entry.name, entry.aliases);
    if (composed) result.set(id, composed);
  }
  return result;
}

/** Añade `publicHidden` a los alias de una ficha (ver markPublicAliases). */
export function withPublicAliases<T extends AliasLike>(name: string, aliases: readonly T[] | null | undefined, alsoShownAs: ReadonlyArray<string | null> = []): Array<T & { publicHidden: boolean }> {
  return markPublicAliases(name, aliases ?? [], alsoShownAs.filter((value): value is string => Boolean(value)));
}
