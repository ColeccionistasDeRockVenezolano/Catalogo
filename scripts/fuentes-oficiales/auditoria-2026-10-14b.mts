// CRV · Segunda tanda de la auditoría del 2026-10-14 (decisiones de Brian tras el run 20050).
//
//   - Zeta: Daniel Hernández (16131) = Dani Debuto (41177). BandWagon (2022) lo llama Dani «Debuto» Hernandez y
//     el Bandcamp de Zeta acredita a «Daniel Hernandez Saud». Nombre principal Daniel Hernández Saud; Dani Debuto
//     queda como nombre artístico.
//   - José Miguel De Robertis (2173) = José Miguel de Robertis Padua (12649): la 12649 solo graba, mezcla y
//     masteriza «Jackturbo» (2009), el mismo disco que la 2173 produce y toca. Su nombre completo pasa a real_name.
//   - «Jackturbo» (12372) no es una persona: su único crédito es «composed» de «Jackturbo II» en el canal de
//     YouTube («Composed by Jackturbo»), composición colectiva. El crédito pasa a la banda (convertPerson) y la
//     ficha se retira con su auditoría; no se atribuye a Norton.
//   - «Caramelos» (9646) es la banda Caramelos De Cianuro (58) con el nombre cortado: sus 6 créditos de compositor
//     en «Solo Exitos» pasan a la banda (convertPerson, pedido por Brian).
//   - La cola abrió un alias ambiguo «Oscar Sánchez» (41200 frente a 31664, de Grupo Vera, 1988): son homónimos.
// Sin --confirm la transacción se revierte.
// Uso: tsx scripts/fuentes-oficiales/auditoria-2026-10-14b.mts [--confirm]
import { closeDb } from "../../src/db/client.js";
import { mergeEntities, previewEntityMerge } from "../../src/merge/entity-merge.js";
import { updateEntity, withOperatorRun, type OperatorContext } from "../../src/merge/operator.js";
import { createAlias, promotePrimaryAlias, updateAlias } from "../../src/api/repositories/aliases.js";
import { convertPerson } from "../../src/review/person-corrections.js";

const CONFIRM = process.argv.includes("--confirm");
const DANIEL = 16131, DANI_DEBUTO = 41177, DE_ROBERTIS = 2173, DE_ROBERTIS_PADUA = 12649, JACKTURBO_PERSON = 12372, JACKTURBO = 117;
const OSCAR_ALIAS_REVIEW = 1853505;
const CARAMELOS_PERSON = 9646, CARAMELOS_DE_CIANURO = 58;

async function expectName(context: OperatorContext, id: number, name: string): Promise<void> {
  const current = (await context.client.query<{ name: string }>("SELECT name FROM public.persons WHERE id=$1 FOR UPDATE", [id])).rows[0]?.name;
  if (current !== name) throw new Error(`persona ${id} es «${current ?? "inexistente"}», se esperaba «${name}»`);
}

async function mergePerson(context: OperatorContext, keepId: number, dropId: number, log: unknown[]): Promise<void> {
  const preview = await previewEntityMerge(context.client, "person", keepId, dropId, { lock: true });
  const merge = await mergeEntities(context, { kind: "person", keepId, dropId, previewHash: preview.previewHash, keepDropNameAsAlias: true });
  log.push({ merge: { keepId, dropId }, conflicts: preview.fieldConflicts, result: merge });
}

async function aliasId(context: OperatorContext, personId: number, alias: string): Promise<number | null> {
  const row = (await context.client.query<{ id: string }>("SELECT id::text FROM ingest.person_aliases WHERE person_id=$1 AND alias=$2", [personId, alias])).rows[0];
  return row ? Number(row.id) : null;
}

async function main(): Promise<void> {
  const { runId, result } = await withOperatorRun({
    name: "fuentes-oficiales:auditoria-2026-10-14b",
    operator: "claude-code (delegado por Brian)",
    note: "Decisiones de Brian tras el run 20050: Daniel Hernández Saud = Dani Debuto (Zeta); José Miguel De Robertis = De Robertis Padua; los créditos de composición de «Jackturbo» y «Caramelos» pasan a sus bandas.",
    params: { merges: [[DANIEL, DANI_DEBUTO], [DE_ROBERTIS, DE_ROBERTIS_PADUA]], toArtist: [[JACKTURBO_PERSON, JACKTURBO], [CARAMELOS_PERSON, CARAMELOS_DE_CIANURO]] },
  }, async (context) => {
    const log: unknown[] = [];

    // Zeta: Daniel Hernández Saud, «Dani Debuto».
    await expectName(context, DANIEL, "Daniel Hernández");
    await expectName(context, DANI_DEBUTO, "Dani Debuto");
    await mergePerson(context, DANIEL, DANI_DEBUTO, log);
    await updateEntity(context, "person", DANIEL, { name: "Daniel Hernández Saud", real_name: "Daniel Hernández Saud" });
    await promotePrimaryAlias(context, "person", DANIEL, "Daniel Hernández Saud", "name_variant");
    if (await aliasId(context, DANIEL, "Daniel Hernández") === null) await createAlias(context, "person", DANIEL, { alias: "Daniel Hernández", aliasType: "name_variant", isPrimary: false });
    const debuto = await aliasId(context, DANIEL, "Dani Debuto");
    if (debuto === null) await createAlias(context, "person", DANIEL, { alias: "Dani Debuto", aliasType: "stage_name", isPrimary: false });
    else await updateAlias(context, "person", DANIEL, debuto, { aliasType: "stage_name", isPrimary: false });
    log.push({ person: DANIEL, name: "Daniel Hernández Saud", stageName: "Dani Debuto" });

    // José Miguel De Robertis.
    await expectName(context, DE_ROBERTIS, "José Miguel De Robertis");
    await expectName(context, DE_ROBERTIS_PADUA, "José Miguel de Robertis Padua");
    await mergePerson(context, DE_ROBERTIS, DE_ROBERTIS_PADUA, log);
    await updateEntity(context, "person", DE_ROBERTIS, { real_name: "José Miguel De Robertis Padua" });
    log.push({ person: DE_ROBERTIS, real_name: "José Miguel De Robertis Padua" });

    // «Jackturbo» como persona → la banda.
    await expectName(context, JACKTURBO_PERSON, "Jackturbo");
    const converted = await convertPerson(context.client, JACKTURBO_PERSON, { kind: "artist", id: JACKTURBO }, false,
      "Crédito «Composed by Jackturbo» (canal de YouTube, «Jackturbo II»): composición colectiva de la banda, no de una persona.", context.runId);
    log.push({ toArtist: { person: JACKTURBO_PERSON, artist: JACKTURBO }, converted });

    // «Caramelos» como persona → Caramelos De Cianuro.
    await expectName(context, CARAMELOS_PERSON, "Caramelos");
    const caramelos = await convertPerson(context.client, CARAMELOS_PERSON, { kind: "artist", id: CARAMELOS_DE_CIANURO }, false,
      "«Caramelos» es el nombre cortado de la banda Caramelos De Cianuro: sus créditos de compositor son de la banda.", context.runId);
    log.push({ toArtist: { person: CARAMELOS_PERSON, artist: CARAMELOS_DE_CIANURO }, converted: caramelos });

    // Alias ambiguo de Oscar Sánchez: homónimo de Grupo Vera.
    const review = await context.client.query(`UPDATE ingest.review_queue SET status='dismissed', resolved_at=now(), resolved_by='human',
        resolution_note='Homónimos: 41200 es el baterista de Necronomisurf (Finlandia, 2015) y 31664 aparece en Grupo Vera (1988); el alias no se comparte.'
      WHERE id=$1 AND status='open'`, [OSCAR_ALIAS_REVIEW]);
    log.push({ reviewClosed: OSCAR_ALIAS_REVIEW, rows: review.rowCount });
    return log;
  }, { rollbackOnly: !CONFIRM });
  console.log(JSON.stringify({ confirm: CONFIRM, run: CONFIRM ? runId : null, cambios: result }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
