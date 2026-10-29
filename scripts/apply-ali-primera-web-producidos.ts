#!/usr/bin/env tsx
/**
 * Alí Primera como productor — «Discos producidos por Alí», campaña 2026-10-27.
 *
 * El sitio de la Fundación lista dos discos que Alí Primera produjo y que no
 * existían en el catálogo: «Caíste por inocente» (Grupo Ahora) y «Cuando el
 * hombre es lo importante» (La Chiche Manaure). Se crean el artista y el disco
 * con su lista de pistas, portada del sitio y el crédito de producción, todo a
 * través del motor del operador (claims, merge, diario, run reversible).
 *
 * Evidencia: carpeta de Drive enlazada desde la web oficial (audio y arte) y
 * Discogs (sello, catálogo, lista de pistas, productor).
 *
 * Uso:
 *   tsx scripts/apply-ali-primera-web-producidos.ts            # ensayo
 *   tsx scripts/apply-ali-primera-web-producidos.ts --confirm  # aplica
 */
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import {
  OperatorError, createEntity, createRelation, updateEntity, withOperatorRun, type OperatorContext,
} from "../src/merge/operator.js";

const ROOT = process.cwd();
const CAMP = "/home/brian/crv-staging/web/public/media/ali-primera-2026-10";
const MEDIA = path.join(ROOT, "web/public/media/album");
const REPORT = path.join(ROOT, "reports/2026-10-27-ali-primera-producidos-aplicado.json");
const ALI = 3677;
const CIGARRON = 2021;
const confirm = process.argv.includes("--confirm");

type Item = {
  artist: { name: string; artist_type: string; notes: string };
  album: Record<string, string | number>;
  tracks: string[];
  cover: string;
  producer: string;
  src: string;
};

const ITEMS: Item[] = [
  {
    artist: {
      name: "Grupo Ahora",
      artist_type: "band",
      notes: "Agrupación venezolana. «Caíste por inocente» (Cigarrón LP. 006) fue producido por Alí Primera y el propio grupo.",
    },
    album: {
      title: "Caíste por Inocente",
      album_type: "studio_album",
      label_id: CIGARRON,
      catalog_id: "LP. 006",
      media_format: "Vinyl LP",
      notes: "Producido por Alí Primera y Grupo Ahora (Discogs). Sello Cigarrón, catálogo LP. 006; el año de edición no está documentado en las fuentes consultadas.",
    },
    tracks: ["Caíste por Inocente", "A Ellos", "Tu Amigo, Tu Hermano", "Nuevo Despertar", "Canto a Panamá",
      "Su Voz No Será Callada", "Todos los Caminos", "Tú", "Amor", "Zapatero"],
    cover: path.join(CAMP, "covers/grupo-ahora.jpg"),
    producer: "Producción",
    src: "https://www.discogs.com/release/8642784 · https://aliprimera.com/discografia-de-al%C3%AD",
  },
  {
    artist: {
      name: "La Chiche Manaure",
      artist_type: "solo_artist",
      notes: "Cantante venezolana. Su disco «Cuando el hombre es lo importante» (Cigarrón, 1985) fue producido por Alí Primera y arreglado por Alí Agüero.",
    },
    album: {
      title: "Cuando el Hombre Es Lo Importante",
      album_type: "studio_album",
      release_year: 1985,
      label_id: CIGARRON,
      catalog_id: "LPCS-0030",
      media_format: "Vinyl LP",
      notes: "Producido por Alí Primera; arreglos y dirección de Alí Agüero (Discogs release 9005516). Discogs le asigna el catálogo LPCS-0030, el mismo que «Le Canta a Latinoamérica» de Alí Primera (1987): numeración a revisar.",
    },
    tracks: ["Y No Te Olvides", "El Apamate Que Mece Niños", "Se Equivocó", "Luna, Lunita", "Tonada a Cantaura",
      "Yo Quiero Tener el Canto", "Cuando Te Amo", "Abre Paso a la Vida", "Serenata", "Canción por Nicaragua"],
    cover: path.join(CAMP, "covers/chiche.jpg"),
    producer: "Producción",
    src: "https://www.discogs.com/release/9005516 · https://aliprimera.com/discografia-de-al%C3%AD",
  },
];

const bumps: Record<string, number> = {};
const bump = (k: string): void => { bumps[k] = (bumps[k] ?? 0) + 1; };
const outcome: Array<Record<string, unknown>> = [];

const norm = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

async function ensureArtist(ctx: OperatorContext, name: string, extra: Record<string, string>): Promise<number> {
  const { rows } = await ctx.client.query<{ id: string }>(
    "SELECT id::text FROM public.artists WHERE lower(name)=lower($1) LIMIT 1", [name]);
  if (rows[0]) return Number(rows[0].id);
  const created = await createEntity(ctx, "artist", { name, origin_country: "Venezuela", ...extra }, { allowSimilar: true });
  bump("artista_creado");
  return created.id;
}

async function ensureCover(albumId: number, source: string): Promise<boolean> {
  try { const info = await stat(source); if (!info.isFile() || info.size < 2000) return false; } catch { return false; }
  if (!confirm) return true;
  await mkdir(MEDIA, { recursive: true });
  await copyFile(source, path.join(MEDIA, `${albumId}.jpg`));
  return true;
}

async function run() {
  const result = await withOperatorRun({
    name: "catalogo:ali-primera-producidos-2026-10",
    operator: "Hermes (encargo de Brian)",
    note: "Alta de los discos que Alí Primera produjo, documentados en la web de la Fundación y en Discogs; con crédito de producción.",
    params: { campaign: "ali-primera-2026-10", items: ITEMS.length },
  }, async (ctx) => {
    await ctx.client.query("SET LOCAL lock_timeout='5s'");
    await ctx.client.query("SET LOCAL statement_timeout='120s'");
    for (const item of ITEMS) {
      try {
        const artistId = await ensureArtist(ctx, item.artist.name, {
          artist_type: item.artist.artist_type, notes: item.artist.notes,
        });
        const { rows } = await ctx.client.query<{ id: string; title: string }>(
          "SELECT id::text, title FROM public.albums WHERE artist_id=$1", [artistId]);
        const existing = rows.find((row) => norm(row.title) === norm(String(item.album["title"])));
        if (existing) {
          bump("disco_ya_existe");
          outcome.push({ artist: item.artist.name, albumId: Number(existing.id), status: "already_exists" });
          continue;
        }
        await ctx.client.query("SAVEPOINT prod_op");
        const album = await createEntity(ctx, "album", { ...item.album, notes: `${item.album["notes"]} Fuente: ${item.src}` },
          { artistId, allowSimilar: true });
        bump("disco_creado");
        for (const [index, title] of item.tracks.entries()) {
          await createEntity(ctx, "track", { title, track_number: index + 1, disc_number: 1 },
            { albumId: album.id, allowSimilar: true });
          bump("pista_creada");
        }
        if (await ensureCover(album.id, item.cover)) {
          await updateEntity(ctx, "album", album.id, { cover_url: `/crv/media/album/${album.id}.jpg` });
          bump("portada_copiada");
        }
        await createRelation(ctx, "album_credit", { albumId: album.id, artistId: ALI },
          { credit_type: "producer", credit_role: item.producer });
        bump("credito_produccion");
        await ctx.client.query("RELEASE SAVEPOINT prod_op");
        outcome.push({ artist: item.artist.name, artistId, albumId: album.id, status: "created", tracks: item.tracks.length });
      } catch (error) {
        if (!(error instanceof OperatorError)) throw error;
        bump(`error_${error.code}`);
        outcome.push({ artist: item.artist.name, status: `skipped:${error.code}`, message: error.message });
      }
    }
    return { bumps, outcome };
  }, { rollbackOnly: !confirm });

  await writeFile(REPORT, JSON.stringify({ runId: result.runId, dryRun: !confirm, ...result.result }, null, 2) + "\n");
  console.log(`run ${result.runId} ${confirm ? "APLICADO" : "ensayado y revertido"}`);
  console.log(JSON.stringify(result.result.bumps, null, 1));
  for (const item of result.result.outcome) console.log(JSON.stringify(item));
}

run().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
