// CRV · Plan del primo, etapa 1 (2026-10-12): casos puntuales de 1B.
//
//   --stage=antes    alias (variantes de fuente, DJ como nombre artístico), titulares de los
//                    solistas que ya tenían a su persona como «Miembro», 1ra Edición ⇐ Primera
//                    Edición (con sus discos) e Ignacio «Indio» Figueredo (dos fichas de artista)
//   --stage=despues  tras el plan de personas: José Luis «Cheo» Pardo titular de DJ Afro
//   --stage=variantes  lo claro de la pasada del detector (regla «variante_de_nombre»):
//                    «4to Poder» (Rock De Vzla) ⇐ «Cuarto Poder» (Sincopa, manda), mismos discos
//   --stage=otrebor  deshace el titular de Otrebor: «Jesús Méndez» (30130) es un homónimo sin
//                    proyecto común (ingeniero de Sonero Clásico del Caribe)
//
// Sin --confirm solo muestra las previsualizaciones de fusión. Todo va en un run.
import { closeDb, getPool } from "../src/db/client.js";
import { mergeAlbums, previewAlbumMerge } from "../src/merge/album-merge.js";
import { mergeEntities, previewEntityMerge } from "../src/merge/entity-merge.js";
import { deleteRelation, updateEntity, updateRelation, withOperatorRun, type OperatorContext } from "../src/merge/operator.js";

const stage = process.argv.find((arg) => arg.startsWith("--stage="))?.slice("--stage=".length);
const confirm = process.argv.includes("--confirm");
const NOTE = "Plan del primo, etapa 1 (2026-10-12)";
const TITULAR = "Titular del proyecto";
const pool = getPool();

/** Membresías de solistas con su propia persona como «Miembro» (u otro rol): pasan a titular. */
const TITULAR_FIXES: Array<{ membershipId: number; artist: string; person: string }> = [
  { membershipId: 1462, artist: "Yordano", person: "Giordano Di Marzo" },
  { membershipId: 1478, artist: "Ricardo Montaner", person: "Ricardo Montaner" },
  { membershipId: 1528, artist: "Karina", person: "Karina" },
  { membershipId: 1469, artist: "Rudy La Scala", person: "Rudy La Scala" },
  { membershipId: 1505, artist: "Miguel Noya", person: "Miguel Noya" },
  { membershipId: 1438, artist: "María Rivas", person: "María Rivas" },
  { membershipId: 10334, artist: "Saúl Vera", person: "Saúl Vera" },
  { membershipId: 11224, artist: "Jeremías", person: "Carlos Eduardo López Ávila" },
];

async function toTitular(context: OperatorContext, membershipId: number, expect?: { artist: string; person: string }): Promise<void> {
  const row = (await context.client.query<{ role: string; notes: string | null; artist: string; person: string }>(
    `SELECT m.role, m.notes, a.name AS artist, p.name AS person FROM public.artist_members m
       JOIN public.artists a ON a.id = m.artist_id JOIN public.persons p ON p.id = m.person_id WHERE m.id = $1`, [membershipId])).rows[0];
  if (!row) throw new Error(`membresía ${membershipId} inexistente`);
  if (expect && (row.artist !== expect.artist || row.person !== expect.person)) throw new Error(`membresía ${membershipId}: ${row.person} en ${row.artist}, se esperaba ${expect.person} en ${expect.artist}`);
  if (row.role === TITULAR) return;
  // El rol que traía (instrumento) no se pierde: pasa a las notas de la membresía.
  const kept = row.role.replace(/^Titular del proyecto,\s*/u, "").trim();
  const generic = /^(miembro|member)$/iu.test(kept);
  const notes = generic || !kept ? row.notes : [row.notes, `Rol anterior: ${kept}`].filter(Boolean).join("\n");
  await updateRelation(context, "artist_membership", membershipId, { role: TITULAR, ...(notes !== row.notes ? { notes } : {}) });
  console.log(`  titular: ${row.person} en ${row.artist} (antes «${row.role}»)`);
}

async function mergeAlbum(context: OperatorContext, keepId: number, dropId: number, keepDropNameAsAlias: boolean): Promise<void> {
  const preview = await previewAlbumMerge(context.client, keepId, dropId);
  console.log(`  disco ${dropId} → ${keepId}`, (preview as { fieldConflicts?: unknown }).fieldConflicts ?? "", preview.warnings ?? "");
  if (confirm) console.log("   ", await mergeAlbums(context, { keepId, dropId, previewHash: preview.previewHash, keepDropNameAsAlias }));
}

async function mergeArtist(context: OperatorContext, keepId: number, dropId: number): Promise<void> {
  const preview = await previewEntityMerge(context.client, "artist", keepId, dropId);
  console.log(`  artista ${dropId} → ${keepId}`, preview.warnings, preview.fieldConflicts);
  if (confirm) console.log("   ", await mergeEntities(context, { kind: "artist", keepId, dropId, previewHash: preview.previewHash, keepDropNameAsAlias: true }));
}

async function antes(context: OperatorContext): Promise<void> {
  const client = context.client;
  // Punto 1: variantes de fuente de La Banana Voladora y de Atkinson (no se borran).
  await client.query("UPDATE ingest.artist_aliases SET is_primary = false WHERE id = 1306 AND artist_id = 1212");
  await client.query("UPDATE ingest.artist_aliases SET is_primary = true WHERE id = 127 AND artist_id = 1212 AND alias = 'La Banana Voladora'");
  const marked = await client.query(
    `UPDATE ingest.artist_aliases SET alias_type = 'source_variant', notes = concat_ws(' · ', notes, $1::text)
      WHERE (artist_id = 1212 AND id IN (1306, 1866)) OR (artist_id = 47 AND id = 2385)`, [`${NOTE}: variante de fuente (punto 1)`]);
  console.log(`  ${marked.rowCount} alias marcados como variante de fuente`);
  // «DJ …» es nombre artístico, no apodo: no se intercala en el nombre.
  const dj = await client.query(`UPDATE ingest.person_aliases SET alias_type = 'stage_name' WHERE alias_type = 'nickname' AND alias ~* '^dj '`);
  console.log(`  ${dj.rowCount} alias «DJ …» pasan a nombre artístico`);

  // Punto 6: solistas cuya persona ya figuraba como integrante.
  for (const fix of TITULAR_FIXES) await toTitular(context, fix.membershipId, fix);
  const gillman = (await client.query<{ id: string }>("SELECT id::text FROM public.artist_members WHERE artist_id = 1951 AND role = 'Titular del proyecto, Vocals'")).rows[0];
  if (gillman) await toTitular(context, Number(gillman.id));

  // Punto 1: 1ra Edición (31, hoja del canal) ⇐ Primera Edición (1172, Rockzuela). Manda el canal.
  await mergeAlbum(context, 102, 2104, true);   // «Tiempo De Actuar» (2008) ⇐ «Es Tiempo de Actuar» (2007)
  await mergeAlbum(context, 101, 15565, false); // «1986» ⇐ «1986»
  await mergeArtist(context, 31, 1172);
  if (confirm) {
    // Año de formación del canal (2002); el de Rockzuela (2001) queda en las notas.
    const notes = (await client.query<{ notes: string | null }>("SELECT notes FROM public.artists WHERE id = 31")).rows[0]?.notes ?? null;
    await updateEntity(context, "artist", 31, {
      formed_year: 2002,
      notes: [notes, "Rockzuela (ficha «Primera Edición») da 2001 como año de formación y 2007 para «Es Tiempo de Actuar»; manda el canal: 2002 y 2008."].filter(Boolean).join("\n"),
    });
  }

  // Ignacio «Indio» Figueredo: dos fichas de artista de la misma persona (la fuente
  // escribe «Ignacio "Indio" Figueredo»). Queda la que tiene discos, con el nombre real.
  await mergeArtist(context, 6664, 4295);
}

async function despues(context: OperatorContext): Promise<void> {
  // DJ Afro (72): su persona es José Luis Pardo (386), titular del proyecto.
  const row = (await context.client.query<{ id: string }>("SELECT id::text FROM public.artist_members WHERE artist_id = 72 AND person_id = 386")).rows[0];
  if (!row) throw new Error("José Luis Pardo aún no figura en DJ Afro: aplicar antes el plan de personas");
  await toTitular(context, Number(row.id), { artist: "DJ Afro", person: "José Luis Pardo" });
}

async function variantes(context: OperatorContext): Promise<void> {
  await mergeAlbum(context, 3932, 3270, true);  // «La Real Academia» (Sincopa) ⇐ «La Real Academia del Flow»
  await mergeAlbum(context, 3269, 15472, true); // «Tamos Bien» (13 pistas) ⇐ «'Tamos bien» (sin pistas)
  await mergeArtist(context, 1905, 1767);       // Cuarto Poder ⇐ 4to Poder
}

async function otrebor(context: OperatorContext): Promise<void> {
  const row = (await context.client.query<{ id: string }>(
    "SELECT id::text FROM public.artist_members WHERE artist_id = 6213 AND person_id = 30130 AND role = $1", [TITULAR])).rows[0];
  if (!row) return;
  await deleteRelation(context, "artist_membership", Number(row.id));
  console.log("  retirado: Jesús Méndez (30130) como titular de Otrebor (6213)");
}

const STAGES: Record<string, (context: OperatorContext) => Promise<void>> = { antes, despues, variantes, otrebor };
if (!stage || !STAGES[stage]) throw new Error("uso: --stage=antes|despues|variantes|otrebor [--confirm]");
if (!confirm && stage === "antes") {
  const client = await pool.connect();
  try {
    for (const [keep, drop] of [[102, 2104], [101, 15565]] as const) console.log(drop, "→", keep, (await previewAlbumMerge(client, keep, drop)).warnings);
    for (const [keep, drop] of [[31, 1172], [6664, 4295]] as const) {
      const preview = await previewEntityMerge(client, "artist", keep, drop);
      console.log(drop, "→", keep, preview.warnings, JSON.stringify(preview.fieldConflicts));
    }
  } finally { client.release(); }
  console.log("(previsualización) añade --confirm para aplicar");
} else if (confirm) {
  const { runId } = await withOperatorRun({ name: `primo-etapa1:casos-${stage}`, operator: "claude-code", note: `${NOTE}: casos puntuales (${stage})` },
    (context) => STAGES[stage]!(context));
  console.log(`run ${runId}`);
}
await closeDb();
