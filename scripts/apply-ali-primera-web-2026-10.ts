#!/usr/bin/env tsx
/**
 * Alí Primera — web oficial (aliprimera.com), campaña 2026-10-27.
 *
 * Aplica lo que el sitio de la Fundación Alí Primera documenta y el catálogo no
 * tenía. Todo pasa por el motor del operador (`withOperatorRun`): claims con
 * evidencia, merge determinista, diario y auditoría. El script no escribe SQL
 * sobre el core.
 *
 * Operaciones:
 *  - `alta`        disco que no existe: se crea con su lista de pistas y portada.
 *  - `correccion`  año equivocado en el core: lo resuelve una persona con
 *                  `settleEntityField` (cierra el conflicto, deja historia).
 *  - `relleno`     campos vacíos (sello, catálogo, portada) y notas de edición:
 *                  solo se escriben si están vacíos, nunca se pisa un valor.
 *  - `retiro`      ficha duplicada y vacía: se retira con `deleteEntity`.
 *
 * Evidencia por disco: carpeta de Drive enlazada desde la propia web
 * (contraportada CENDIS 2013 con «EDICIÓN ORIGINAL», depósito legal y créditos),
 * portada del sitio y release de Discogs citado en `src`.
 *
 * Uso:
 *   tsx scripts/apply-ali-primera-web-2026-10.ts            # ensayo (revierte)
 *   tsx scripts/apply-ali-primera-web-2026-10.ts --confirm  # aplica
 */
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import {
  OperatorError, createEntity, deleteEntity, settleEntityField, updateEntity,
  withOperatorRun, type OperatorContext,
} from "../src/merge/operator.js";

const ROOT = process.cwd();
const CAMP = "/home/brian/crv-staging/web/public/media/ali-primera-2026-10";
const MEDIA = path.join(ROOT, "web/public/media/album");
const REPORT = path.join(ROOT, "reports/2026-10-27-ali-primera-web-aplicado.json");
const SITE = "https://aliprimera.com/discografia-de-al%C3%AD";
const confirm = process.argv.includes("--confirm");

const ALI = 3677;
const PROMUS = 1978;

type Track = { n: number; title: string };
type Op =
  | { kind: "alta"; fields: Record<string, string | number>; cover: string; tracks: Track[]; src: string; note: string }
  | { kind: "correccion"; albumId: number; field: string; value: string | number; src: string; note: string }
  | { kind: "relleno"; albumId: number; fields: Record<string, string | number>; cover?: string; appendNotes?: string; src: string }
  | { kind: "portada"; albumId: number; cover: string; src: string }
  | { kind: "retiro"; albumId: number; expectTracks: number; src: string; note: string };

const EP_NOTE =
  "Compacto de 7\" a 33⅓ RPM, sello Ediciones Abejón Mono (catálogo 001), grabado en Colombia. " +
  "La Fundación Alí Primera lo sitúa en 1971 (tercera entrega de su discografía propia). " +
  `Fuente: ${SITE} (carpeta de Drive enlazada) y https://www.discogs.com/release/15469426`;

const OPS: Op[] = [
  // ── Alta: único disco propio que faltaba en el catálogo ────────────────────
  {
    kind: "alta",
    fields: {
      title: "La Juventud Canta y Acusa",
      album_type: "ep",
      release_year: 1971,
      catalog_id: "001",
      label_id: 0, // se sustituye por el id del sello recién asegurado
      media_format: 'Vinyl 7" 33⅓ RPM',
      notes: EP_NOTE,
    },
    cover: path.join(CAMP, "covers/EP-juventud.jpg"),
    tracks: [
      { n: 1, title: "Ven Amigo Colombiano" },
      { n: 2, title: "Hay Que Aligerar La Carga" },
      { n: 3, title: "Yo No Sé Filosofar" },
      { n: 4, title: "Vietnam (Guerra Larga)" },
    ],
    src: "https://www.discogs.com/release/15469426",
    note: "Alta del compacto de 1971 documentado por la Fundación Alí Primera y Discogs.",
  },

  // ── Correcciones de año: master de Discogs + «EDICIÓN ORIGINAL» en la contraportada
  { kind: "correccion", albumId: 6681, field: "release_year", value: 1974,
    src: "https://www.discogs.com/master/585762 · contraportada CENDIS 2013",
    note: "Adiós en dolor mayor es de 1974 (Promus LPPS-2077), no de 1975." },
  { kind: "correccion", albumId: 6682, field: "release_year", value: 1974,
    src: "https://www.discogs.com/master/800792 · contraportada CENDIS 2013",
    note: "Canción para los valientes es de 1974 (Promus LPPS-2080), no de 1976." },
  { kind: "correccion", albumId: 6683, field: "release_year", value: 1975,
    src: "https://www.discogs.com/master/585761 · la web lo fecha en 1975",
    note: "La patria es el hombre: primera edición 1975; la ficha traía 1977, año de la edición Cigarrón LP-00P." },
  { kind: "correccion", albumId: 6685, field: "release_year", value: 1977,
    src: "contraportada CENDIS 2013 (EDICIÓN ORIGINAL 1977) · https://www.discogs.com/master/1481842",
    note: "Cuando nombro la poesía es de 1977, no de 1979." },

  { kind: "correccion", albumId: 6681, field: "label_id", value: PROMUS,
    src: "https://www.discogs.com/master/585762",
    note: "Adiós en dolor mayor salió por Promus (LPPS-2077); «Playback Productions» no corresponde." },
  { kind: "correccion", albumId: 6682, field: "label_id", value: PROMUS,
    src: "https://www.discogs.com/master/800792",
    note: "Canción para los valientes salió por Promus (LPPS-2080); la ficha traía el sello de la reedición." },

  // ── Rellenos: sello, catálogo y portada que faltaban ───────────────────────
  { kind: "relleno", albumId: 6681, fields: { label_id: PROMUS, catalog_id: "LPPS-2077", media_format: "Vinyl LP" },
    src: "https://www.discogs.com/master/585762" },
  { kind: "relleno", albumId: 6682, fields: { label_id: PROMUS, catalog_id: "LPPS-2080", media_format: "Vinyl LP" },
    src: "https://www.discogs.com/master/800792" },
  { kind: "relleno", albumId: 6685, fields: { catalog_id: "LP-009" },
    src: "https://www.discogs.com/master/1481842" },
  { kind: "relleno", albumId: 6686, fields: { catalog_id: "LPCS-0020" },
    src: "contraportada CENDIS 2013 (carpeta de Drive del sitio)" },
  { kind: "relleno", albumId: 6687, fields: { catalog_id: "LPCS-0022" }, src: "https://www.discogs.com/master/1481843" },
  { kind: "relleno", albumId: 6688, fields: { catalog_id: "LPCS-0027" }, src: "https://www.discogs.com/master/1600120" },
  { kind: "relleno", albumId: 6689, fields: { catalog_id: "LPCS-0028" }, src: "https://www.discogs.com/master/1124076" },
  { kind: "relleno", albumId: 6691, fields: { catalog_id: "LPCS-0029" }, src: "https://www.discogs.com/master/4189077" },
  { kind: "relleno", albumId: 6692, fields: { catalog_id: "LPCS-0030" }, src: "https://www.discogs.com/master/4189095" },
  { kind: "relleno", albumId: 6694, fields: { catalog_id: "LP-032" }, src: "https://www.discogs.com/master/2508223" },
  { kind: "relleno", albumId: 6678, fields: { media_format: "Vinyl LP" }, src: "https://www.discogs.com/release/15469426" },

  // ── Portadas que sustituyen a las que ya servía el catálogo ────────────────
  { kind: "portada", albumId: 6678, cover: path.join(CAMP, "covers/6678.jpg"),
    src: "carpeta de Drive del sitio (B1.jpg, 3633×3658 frente a los 595 px que servía el catálogo)" },
  { kind: "portada", albumId: 6682, cover: path.join(CAMP, "covers/6682.jpg"),
    src: "sitio (039-0, 953×953 frente a 599 px)" },
  { kind: "portada", albumId: 6686, cover: path.join(CAMP, "covers/6686.jpg"),
    src: "sitio (FRONTAL-bb8abd0, 953×953 frente a 600 px)" },
  { kind: "portada", albumId: 8403, cover: path.join(CAMP, "covers/8403.jpg"),
    src: "sitio (1181×1181 frente a los 160 px que servía el catálogo)" },

  // ── Retiro: fichas duplicadas y vacías de «Por si no lo sabía» ─────────────
  { kind: "retiro", albumId: 26756, expectTracks: 0,
    src: "duplicado sin pistas ni portada de 8403 (Alí Primera & José Montecano)",
    note: "Retiro de ficha duplicada vacía; el disco vive en 8403 con sus nueve pistas." },
  { kind: "retiro", albumId: 26712, expectTracks: 0,
    src: "duplicado sin pistas bajo José Montecano del mismo disco (8403)",
    note: "Retiro de ficha duplicada vacía; el disco es de Alí Primera & José Montecano (8403)." },
];

const bumps: Record<string, number> = {};
const bump = (k: string): void => { bumps[k] = (bumps[k] ?? 0) + 1; };
const outcome: Array<Record<string, unknown>> = [];

async function ensureOrganization(ctx: OperatorContext, name: string, extra: Record<string, unknown>): Promise<number> {
  const found = await ctx.client.query<{ id: string }>(
    "SELECT id::text FROM public.organizations WHERE lower(name)=lower($1) LIMIT 1", [name]);
  if (found.rows[0]) return Number(found.rows[0].id);
  const created = await createEntity(ctx, "organization", { name, ...extra }, { allowSimilar: true });
  bump("sello_creado");
  return created.id;
}

async function ensureCover(albumId: number, source: string): Promise<boolean> {
  try {
    const info = await stat(source);
    if (!info.isFile() || info.size < 2000) return false;
  } catch { return false; }
  if (!confirm) return true; // ensayo: se informa la portada sin escribir el archivo
  await mkdir(MEDIA, { recursive: true });
  await copyFile(source, path.join(MEDIA, `${albumId}.jpg`));
  return true;
}

/** Rellena solo campos vacíos; nunca pisa un valor existente. */
async function fillEmpty(ctx: OperatorContext, albumId: number, fields: Record<string, string | number>): Promise<Record<string, string | number>> {
  const { rows } = await ctx.client.query<Record<string, unknown>>("SELECT * FROM public.albums WHERE id=$1", [albumId]);
  const row = rows[0];
  if (!row) throw new OperatorError("not_found", `álbum ${albumId} inexistente`);
  const values: Record<string, string | number> = {};
  for (const [field, value] of Object.entries(fields)) {
    const current = row[field];
    if (current === null || current === undefined || current === "") values[field] = value;
  }
  return values;
}

async function run() {
  const result = await withOperatorRun({
    name: "catalogo:ali-primera-web-2026-10",
    operator: "Hermes (encargo de Brian)",
    note: "Completar la discografía de Alí Primera y sus fichas con la web oficial de la Fundación y las contraportadas CENDIS conservadas en la campaña.",
    params: { campaign: "ali-primera-2026-10", source: SITE, operations: OPS.length },
  }, async (ctx) => {
    await ctx.client.query("SET LOCAL lock_timeout='5s'");
    await ctx.client.query("SET LOCAL statement_timeout='120s'");
    const abejon = await ensureOrganization(ctx, "Ediciones Abejón Mono", {
      organization_type: "record_label", country: "Venezuela",
      notes: "Sello del compacto «La Juventud Canta y Acusa» (001), grabado en Colombia.",
    });

    for (const op of OPS) {
      try {
        if (op.kind === "alta") {
          const fields = { ...op.fields, ...(op.fields["label_id"] === 0 ? { label_id: abejon } : {}) };
          await ctx.client.query("SAVEPOINT ali_op");
          const created = await createEntity(ctx, "album", fields, { artistId: ALI });
          for (const t of op.tracks) {
            await createEntity(ctx, "track", { title: t.title, track_number: t.n, disc_number: 1 },
              { albumId: created.id, allowSimilar: true });
            bump("pista_creada");
          }
          if (await ensureCover(created.id, op.cover)) {
            await updateEntity(ctx, "album", created.id, { cover_url: `/crv/media/album/${created.id}.jpg` });
            bump("portada_copiada");
          }
          await ctx.client.query("RELEASE SAVEPOINT ali_op");
          outcome.push({ kind: op.kind, albumId: created.id, status: "created", tracks: op.tracks.length });
          continue;
        }
        if (op.kind === "correccion") {
          const applied = await settleEntityField(ctx, "album", op.albumId, op.field, op.value);
          bump(applied.action === "unchanged" ? "correccion_sin_cambio" : "correccion_aplicada");
          outcome.push({ kind: op.kind, albumId: op.albumId, field: op.field, value: op.value, action: applied.action });
          continue;
        }
        if (op.kind === "relleno") {
          const values = await fillEmpty(ctx, op.albumId, op.fields);
          if (op.cover) {
            const { rows } = await ctx.client.query<{ cover_url: string | null }>("SELECT cover_url FROM public.albums WHERE id=$1", [op.albumId]);
            if (!rows[0]?.cover_url && await ensureCover(op.albumId, op.cover)) {
              values["cover_url"] = `/crv/media/album/${op.albumId}.jpg`;
              bump("portada_copiada");
            }
          }
          if (Object.keys(values).length === 0) { bump("relleno_sin_cambios"); outcome.push({ kind: op.kind, albumId: op.albumId, status: "unchanged" }); continue; }
          await updateEntity(ctx, "album", op.albumId, values);
          bump("relleno_aplicado");
          for (const f of Object.keys(values)) bump(`campo_${f}`);
          outcome.push({ kind: op.kind, albumId: op.albumId, status: "updated", fields: Object.keys(values) });
          continue;
        }
        if (op.kind === "portada") {
          // El CDN sirve media con cache-control inmutable: una portada nueva
          // nunca reutiliza el nombre del archivo anterior.
          const suffix = "-2";
          if (confirm) await copyFile(op.cover, path.join(MEDIA, `${op.albumId}${suffix}.jpg`));
          const url = `/crv/media/album/${op.albumId}${suffix}.jpg`;
          await settleEntityField(ctx, "album", op.albumId, "cover_url", url);
          bump("portada_sustituida");
          outcome.push({ kind: op.kind, albumId: op.albumId, status: "replaced", cover_url: url });
          continue;
        }
        // retiro
        const live = await ctx.client.query<{ n: string }>("SELECT count(*)::text AS n FROM public.tracks WHERE album_id=$1", [op.albumId]);
        if (Number(live.rows[0]?.n ?? -1) !== op.expectTracks) {
          bump("retiro_saltado_por_pistas");
          outcome.push({ kind: op.kind, albumId: op.albumId, status: "skipped", tracks: Number(live.rows[0]?.n) });
          continue;
        }
        await deleteEntity(ctx, "album", op.albumId);
        bump("ficha_retirada");
        outcome.push({ kind: op.kind, albumId: op.albumId, status: "removed" });
      } catch (error) {
        if (!(error instanceof OperatorError)) throw error;
        bump(`error_${error.code}`);
        outcome.push({ kind: op.kind, albumId: "albumId" in op ? op.albumId : null, status: `skipped:${error.code}`, message: error.message });
      }
    }
    return { bumps, outcome };
  }, { rollbackOnly: !confirm });

  await writeFile(REPORT, JSON.stringify({
    runId: result.runId, dryRun: !confirm, source: SITE, bumps: result.result.bumps, outcome: result.result.outcome,
  }, null, 2) + "\n");
  console.log(`run ${result.runId} ${confirm ? "APLICADO" : "ensayado y revertido"}`);
  console.log(JSON.stringify(result.result.bumps, null, 1));
  for (const item of result.result.outcome) console.log(JSON.stringify(item));
}

run().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
