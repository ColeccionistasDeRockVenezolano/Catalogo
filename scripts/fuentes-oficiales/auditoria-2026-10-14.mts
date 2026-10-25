// CRV · Auditoría externa del 2026-10-14 (documento de Brian) cotejada contra las fuentes y el catálogo.
//
// Solo entra lo que Claude comprobó en la fuente el 2026-10-14:
//   - Jorge Ramírez 41189 → 422: la 422 toca en «Grabaciones Olvidadas» junto a Batoni, Márquez y Avellaneda
//     (demo de Zapato 3); la biografía oficial lo pone en la formación 1987–principios de 1988.
//   - Zeta: «Founded in 2003 in a little town in the coast of the Caribbean Sea called Lecheria» (press kit).
//     Juan Chi 16135 = Juan Ricardo Yilo 41180 (crédito «Guitar / Vocals: Juan "Chi" Yilo», Live at Parish).
//     Antonio Pereira firma «Bass: Antonio Figueroa Pereira» (nombre real). La formación actual es Juan Chi, Dani
//     Debuto, Chino Sandoval y Antonio Pereira: González, Guerrero y Cabello (Zeta Once, Last.fm) dejan de figurar
//     como actuales; Daniel Hernández no se toca (podría ser Dani Debuto: decisión aparte).
//   - Arkangel: Power Age se formó en 1978 (Bandcamp oficial y biografía de Paul Gillman), no en 1977.
//   - Necronomisurf: Norton la crea con el baterista «Oscar Sanches» (entrevista CRV 2015-09-03) / «Oscar Sánchez»
//     (El Miope 2016); el sitio oficial dice «Oscar García»: dos entrevistas en primera persona mandan. Igor del
//     Toro al bajo. Turku según el sitio oficial; sin año de fundación (ya existía en septiembre de 2015).
//   - Jacktürbo: Carles Molet a la batería (sitio oficial de La Puta Eléctrica); estreno en Barcelona en noviembre
//     de 2009 (Bandcamp). Norton fundador.
//   - Los Mentas: Luis «Drupy» Pulido, guitarras y coros (créditos de «Museo de los Pillos»).
// Sin --confirm la transacción se revierte.
// Uso: tsx scripts/fuentes-oficiales/auditoria-2026-10-14.mts [--confirm]
import { closeDb } from "../../src/db/client.js";
import { mergeEntities, previewEntityMerge } from "../../src/merge/entity-merge.js";
import { createEntity, createRelation, updateEntity, updateRelation, withOperatorRun, type OperatorContext } from "../../src/merge/operator.js";
import { createAlias } from "../../src/api/repositories/aliases.js";

const CONFIRM = process.argv.includes("--confirm");
const ARKANGEL = 46, ZETA = 459, NECRONOMISURF = 376, JACKTURBO = 117, LOS_MENTAS = 277, NORTON = 372;
const CRV_2015 = "https://coleccionistasderockvenezolano.wordpress.com/2015/09/03/entrevista-exclusiva-a-norton-perez/";
const MIOPE_2016 = "https://elmiope.com/2016/11/03/norton-perez-el-pais-necesita-bandas-que-digan-verdades/";
const LPE_SITE = "https://sites.google.com/view/laputaelectrica/discografia";

type Changes = Record<string, string | number | boolean | null | undefined>;

async function row<T>(context: OperatorContext, sql: string, params: unknown[]): Promise<T> {
  const found = (await context.client.query(sql, params)).rows[0] as T | undefined;
  if (!found) throw new Error(`sin fila: ${sql} ${JSON.stringify(params)}`);
  return found;
}

/** Cambia un campo de la ficha solo si sigue teniendo el valor que se revisó. */
async function setArtist(context: OperatorContext, id: number, field: string, expected: unknown, value: unknown, log: unknown[]): Promise<void> {
  const current = (await row<Record<string, unknown>>(context, `SELECT ${field} AS v FROM public.artists WHERE id=$1 FOR UPDATE`, [id]))["v"];
  if (current !== expected) throw new Error(`artista ${id}.${field} es «${String(current)}», se esperaba «${String(expected)}»`);
  await updateEntity(context, "artist", id, { [field]: value });
  log.push({ artist: id, field, from: current, to: value });
}

async function setMember(context: OperatorContext, memberId: number, expected: Changes, changes: Changes, log: unknown[]): Promise<void> {
  const current = await row<Changes>(context, "SELECT role, from_year, to_year, is_current FROM public.artist_members WHERE id=$1", [memberId]);
  for (const [field, value] of Object.entries(expected)) {
    if (current[field] !== value) throw new Error(`membresía ${memberId}.${field} es «${String(current[field])}», se esperaba «${String(value)}»`);
  }
  await updateRelation(context, "artist_membership", memberId, changes);
  log.push({ member: memberId, changes });
}

async function mergePerson(context: OperatorContext, keepId: number, dropId: number, log: unknown[]): Promise<void> {
  const preview = await previewEntityMerge(context.client, "person", keepId, dropId, { lock: true });
  const merge = await mergeEntities(context, { kind: "person", keepId, dropId, previewHash: preview.previewHash, keepDropNameAsAlias: true });
  log.push({ merge: { keepId, dropId }, conflicts: preview.fieldConflicts, result: merge });
}

async function founder(context: OperatorContext, memberId: number, evidence: string): Promise<void> {
  await context.client.query(`
    INSERT INTO ingest.membership_details(artist_member_id, is_founder, founder_evidence, founder_source, run_id) VALUES ($1, true, $2, 'sitio oficial', $3)
    ON CONFLICT (artist_member_id) DO UPDATE SET is_founder = true, founder_evidence = EXCLUDED.founder_evidence, founder_source = EXCLUDED.founder_source, run_id = EXCLUDED.run_id, updated_at = now()
     WHERE ingest.membership_details.is_founder IS NULL`, [memberId, evidence, context.runId]);
}

async function newMember(context: OperatorContext, artistId: number, personId: number, fields: Changes, log: unknown[]): Promise<number> {
  const twin = await context.client.query("SELECT 1 FROM public.artist_members WHERE artist_id=$1 AND person_id=$2", [artistId, personId]);
  if (twin.rowCount) throw new Error(`la persona ${personId} ya es integrante de ${artistId}`);
  const relation = await createRelation(context, "artist_membership", { artistId, personId }, fields);
  log.push({ artist: artistId, person: personId, member: relation.id, fields });
  return relation.id;
}

async function newPerson(context: OperatorContext, name: string, notes: string, log: unknown[]): Promise<number> {
  const person = await createEntity(context, "person", { name, notes }, { allowSimilar: true });
  log.push({ person: person.id, name });
  return person.id;
}

async function main(): Promise<void> {
  const { runId, result } = await withOperatorRun({
    name: "fuentes-oficiales:auditoria-2026-10-14",
    operator: "claude-code (delegado por Brian)",
    note: "Auditoría externa del 2026-10-14 cotejada por Claude contra las fuentes: Jorge Ramírez y Juan Chi unificados, origen de Zeta (Lechería), Power Age 1978, integrantes de Necronomisurf y Jacktürbo, rol de Luis «Drupy» Pulido.",
    params: { artists: [ARKANGEL, ZETA, NECRONOMISURF, JACKTURBO, LOS_MENTAS] },
  }, async (context) => {
    const log: unknown[] = [];

    // Zapato 3: Jorge Ramírez.
    await mergePerson(context, 422, 41189, log);
    await setMember(context, 12212, { role: "guitarra", from_year: null, to_year: null }, { from_year: 1987, to_year: 1988 }, log);

    // Zeta.
    await setArtist(context, ZETA, "origin_city", "Puerto Ordaz – Anzoátegui", "Lechería, Anzoátegui", log);
    await mergePerson(context, 41180, 16135, log);
    await updateEntity(context, "person", 41178, { real_name: "Antonio Figueroa Pereira" });
    log.push({ person: 41178, real_name: "Antonio Figueroa Pereira" });
    for (const member of [6130, 6131, 6132]) {
      await setMember(context, member, { is_current: true }, { is_current: "false" }, log);
    }

    // Arkangel.
    await setArtist(context, ARKANGEL, "years_active", "1977-1981 (as Power Age ), 1981-present", "1978-1981 (as Power Age), 1981-present", log);

    // Necronomisurf.
    const necro = `Necronomisurf. Entrevista CRV 2015 (${CRV_2015}): «conocí a Oscar Sanches -batería-»; El Miope 2016 (${MIOPE_2016}): «conocí al baterista Oscar Sánchez»; el sitio oficial (${LPE_SITE}) lo llama «Oscar García».`;
    const oscar = await newPerson(context, "Oscar Sánchez", `Alta 2026-10-14 como baterista de ${necro}`, log);
    await createAlias(context, "person", oscar, { alias: "Oscar Sanches", aliasType: "misspelling", isPrimary: false });
    const igor = await newPerson(context, "Igor del Toro", `Alta 2026-10-14 como bajista de Necronomisurf. ${CRV_2015}: «Luego llegó Igor del Toro (Bajo) y así nació “Necronomisurf”».`, log);
    const nortonNecro = await newMember(context, NECRONOMISURF, NORTON, { role: "voz y guitarra", is_current: "false", notes: `Música y letras (Bandcamp). ${CRV_2015}` }, log);
    await founder(context, nortonNecro, `${CRV_2015}: «Ahora llega con su nueva banda «Necronomisurf»»`);
    await newMember(context, NECRONOMISURF, oscar, { role: "batería", is_current: "false", notes: necro.slice(0, 500) }, log);
    await newMember(context, NECRONOMISURF, igor, { role: "bajo", is_current: "false", notes: `${CRV_2015}: «Luego llegó Igor del Toro (Bajo)»` }, log);
    await setArtist(context, NECRONOMISURF, "origin_city", null, "Turku, Finlandia", log);

    // Jacktürbo.
    const molet = await newPerson(context, "Carles Molet", `Alta 2026-10-14 como baterista de Jacktürbo. ${LPE_SITE}: «Norton logró conectar con Ismael García (bajo) y Carles Molet (batería)».`, log);
    await newMember(context, JACKTURBO, molet, { role: "batería", is_current: "false", notes: `${LPE_SITE}: «Norton logró conectar con Ismael García (bajo) y Carles Molet (batería)»` }, log);
    await setArtist(context, JACKTURBO, "origin_city", null, "Barcelona, España", log);
    await setArtist(context, JACKTURBO, "formed_year", null, 2009, log);
    const nortonJack = (await row<{ id: string }>(context, "SELECT id::text FROM public.artist_members WHERE artist_id=$1 AND person_id=$2", [JACKTURBO, NORTON])).id;
    await founder(context, Number(nortonJack), "https://jackturbo.bandcamp.com: «In November 2009 JACKTÜRBO debuted… in Barcelona (Spain). Jack Norton (vocals gtr)»; escribió casi todas las canciones del primer disco (entrevista CRV 2015)");

    // Los Mentas: Luis «Drupy» Pulido.
    const pulido = (await row<{ id: string }>(context, "SELECT id::text FROM public.artist_members WHERE artist_id=$1 AND person_id=41175", [LOS_MENTAS])).id;
    await setMember(context, Number(pulido), { role: "Integrante" }, { role: "guitarras y coros" }, log);
    await createAlias(context, "person", 41175, { alias: "Drupy", aliasType: "nickname", isPrimary: false });

    return log;
  }, { rollbackOnly: !CONFIRM });
  console.log(JSON.stringify({ confirm: CONFIRM, run: CONFIRM ? runId : null, cambios: result }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
