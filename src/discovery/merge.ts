import type { PoolClient } from "pg";
/** No unicidad por artista: conservar ambas decisiones, incluidas evidencias
 * contradictorias. La lectura bloquea estados contradictorios hasta revisión. */
export async function transferDiscoveryDecisions(client: PoolClient, keepId: number, dropId: number): Promise<void> {
  // Compatibilidad con backend desplegado antes de la migración.
  if (!(await client.query("SELECT to_regclass('ingest.artist_search_suggestions') AS t")).rows[0]?.t) return;
  await client.query(`UPDATE ingest.artist_search_suggestions SET artist_id=$1 WHERE artist_id=$2`, [keepId, dropId]);
  await client.query(`UPDATE ingest.artist_discovery_labels SET artist_id=$1 WHERE artist_id=$2`, [keepId, dropId]);
  // Ninguna fila se descarta ni se cambia su decisión. La lectura bloquea
  // estados incompatibles hasta que una revisión explícita los resuelva.
}
