// Plan Aqustico · fila de procedencia `aqustico` en ingest.sources.
//
// Solo procedencia (como deezer, itunes o crv-duraciones): enabled=false y sin
// adapter, así que NO es el alta formal de la fuente (decisión D7 del plan:
// no). Sirve para que cada dato rellenado desde Aqustico tenga claim y evidencia.
import type { PoolClient } from "pg";

export async function ensureAqusticoSource(client: PoolClient): Promise<number> {
  await client.query(`
    INSERT INTO ingest.sources(slug,name,url,site_type,trust_level,enabled,notes)
    VALUES('aqustico','Aqustico (procedencia de rellenos)','https://aqustico.com/','database','low',false,
           'Volcado público de api.aqustico.com del 2026-10-11/12 (data/raw/aqustico-2026-10-11/). Solo rellena huecos de CRV (plan ~/Desktop/PLAN_AQUSTICO_2026-10-12.md). No es una fuente dada de alta: sin adapter ni scraping.')
    ON CONFLICT (slug) DO NOTHING`);
  return Number((await client.query<{ id: string }>("SELECT id::text FROM ingest.sources WHERE slug='aqustico'")).rows[0]!.id);
}
