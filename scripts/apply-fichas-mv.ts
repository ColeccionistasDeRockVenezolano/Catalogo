// Alta de fichas completas (artista + álbum + pistas) desde un dossier con evidencia.
// Todo pasa por el operador: createEntity/updateEntity dentro de withOperatorRun, con
// auditoría por campo. Las imágenes ya descargadas se copian a los medios del
// catálogo (nunca queda solo la URL) y su origen + sha256 se anotan en el reporte.
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeDb } from "../src/db/client.js";
import { createEntity, updateEntity, withOperatorRun } from "../src/merge/operator.js";
import { copyFileSync, existsSync } from "node:fs";

const DOSSIER = process.argv[2] ?? "/home/brian/data/letras-musicavenezuela/dossier_fichas.json";
const OUT = "reports/fichas-mv-2026-10-19";
const MEDIA_ROOT = path.resolve("web/public/media");

interface Track { track_number: number; title: string; duration_seconds?: number; lyrics?: string | null }
interface Album {
  cover_local?: string;
  title: string; release_year?: number; album_type?: string; notes?: string; source?: string; cover?: string | null; cover_source?: string; tracks: Track[]; lyrics_source?: string }
interface Ficha {
  key: string;
  artist_local?: string;
  only?: string;
  artist: { name: string; artist_type?: string; origin_country?: string; origin_city?: string; formed_year?: number; biography?: string; notes?: string; source?: string; picture?: string; picture_local?: string; picture_source?: string };
  albums: Album[];
}

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Copia la imagen ya descargada a los medios del catálogo, validando el formato por bytes mágicos. */
function guardarImagen(origen: string): { url: string; sha256: string; bytes: number } {
  if (!existsSync(origen)) throw new Error(`imagen no descargada: ${origen}`);
  const bytes = readFileSync(origen);
  if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024) throw new Error(`tamaño de imagen inválido: ${origen}`);
  const head = bytes.subarray(0, 12);
  const ext = head[0] === 0xff && head[1] === 0xd8 ? "jpg"
    : head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png"
    : head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP" ? "webp"
    : "";
  if (!ext) throw new Error(`no es una imagen reconocible: ${origen}`);
  const digest = sha(bytes);
  const directory = path.join(MEDIA_ROOT, "curated");
  mkdirSync(directory, { recursive: true });
  copyFileSync(origen, path.join(directory, `${digest}.${ext}`));
  return { url: `/crv/media/curated/${digest}.${ext}`, sha256: digest, bytes: bytes.length };
}

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase()
  .replace(/[^a-z0-9 ]/gu, "").replace(/\s+/gu, " ").trim();

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm") || process.env["CONFIRM"] === "1";
  const only = process.argv.find((a) => a.startsWith("--solo="))?.slice(7) ?? process.env["SOLO"];
  const all = JSON.parse(readFileSync(DOSSIER, "utf8")) as { artists: Ficha[] };
  const fichas = only ? all.artists.filter((f) => f.key === only) : all.artists;
  if (!fichas.length) throw new Error("dossier sin fichas que aplicar");
  for (const f of fichas) {
    if (!f.artist.name.trim()) throw new Error(`${f.key}: artista sin nombre`);
    if (!f.artist.source) throw new Error(`${f.key}: falta la URL de la fuente`);
    for (const al of f.albums) {
      if (!al.title.trim()) throw new Error(`${f.key}: álbum sin título`);
      if (!al.tracks.length) throw new Error(`${f.key}/${al.title}: álbum sin pistas`);
      const nums = new Set(al.tracks.map((t) => t.track_number));
      if (nums.size !== al.tracks.length) throw new Error(`${f.key}/${al.title}: números de pista repetidos`);
    }
  }
  mkdirSync(OUT, { recursive: true });

  const result = await withOperatorRun({
    name: "catalogo:fichas-musicavenezuela",
    operator: "Hermes (encargo de Brian)",
    note: "Crear las fichas de los intérpretes venezolanos que faltaban en el catálogo, con " +
      "biografía e imagen de musicavenezuela.com (y tracklist/portada de iTunes cuando la fuente " +
      "musical no los trae), y cargar la letra documentada en su pista. Datos literales de la " +
      "fuente; sin inventar campos que la fuente no documente.",
    params: { dossier: DOSSIER, fichas: fichas.map((f) => f.key), confirm },
  }, async (context) => {
    const { client, runId } = context;
    const source = (await client.query<{ id: string }>(
      "SELECT id::text FROM ingest.sources WHERE slug='musicavenezuela'")).rows[0];
    if (!source) throw new Error("falta la fuente musicavenezuela");

    const report: Array<Record<string, unknown>> = [];
    for (const ficha of fichas) {
      const reuse = process.env["REUSE"] === "1";
      const exists = (await client.query<{ id: string }>(
        "SELECT id::text FROM public.artists WHERE lower(name)=lower($1)", [ficha.artist.name])).rows[0];
      if (exists && !reuse) throw new Error(`${ficha.artist.name} ya existe (id ${exists.id}); usa REUSE=1 para colgarle álbum y pistas`);
      if (exists) {
        const albumExists = (await client.query<{ id: string }>(
          "SELECT id::text FROM public.albums WHERE artist_id=$1 AND lower(title)=lower($2)",
          [exists.id, ficha.albums[0]?.title ?? ""])).rows[0];
        if (albumExists) throw new Error(`${ficha.artist.name}: el álbum «${ficha.albums[0]?.title}» ya existe (id ${albumExists.id})`);
      }

      const artistValues: Record<string, unknown> = { name: ficha.artist.name };
      for (const k of ["artist_type", "origin_country", "origin_city", "formed_year", "biography", "notes"] as const) {
        const value = ficha.artist[k];
        if (value !== undefined && value !== null && value !== "") artistValues[k] = value;
      }
      const artist = exists ? { kind: "artist" as const, id: Number(exists.id), fields: [] } : await createEntity(context, "artist", artistValues);
      const row: Record<string, unknown> = { artist: ficha.artist.name, artistId: artist.id, albums: [], images: [] };

      if (ficha.artist.picture_local && !exists) {
        const saved = guardarImagen(ficha.artist.picture_local);
        await updateEntity(context, "artist", artist.id, { picture_url: saved.url });
        (row["images"] as unknown[]).push({ kind: "artist", sourceUrl: ficha.artist.picture, ...saved });
      }

      for (const al of ficha.albums) {
        const albumValues: Record<string, unknown> = { title: al.title };
        if (al.release_year) albumValues["release_year"] = al.release_year;
        if (al.album_type) albumValues["album_type"] = al.album_type;
        if (al.notes) albumValues["notes"] = al.notes;
        const album = await createEntity(context, "album", albumValues, { artistId: artist.id });
        const albumRow: Record<string, unknown> = { title: al.title, albumId: album.id, cover: null, tracks: [] };

        if (al.cover_local) {
          const saved = guardarImagen(al.cover_local);
          await updateEntity(context, "album", album.id, { cover_url: saved.url });
          albumRow["cover"] = saved;
          (row["images"] as unknown[]).push({ kind: "album", sourceUrl: al.cover, ...saved });
        }

        for (const tr of al.tracks) {
          const values: Record<string, unknown> = {
            title: tr.title, track_number: tr.track_number, disc_number: 1,
          };
          if (tr.duration_seconds) values["duration_seconds"] = tr.duration_seconds;
          if (tr.lyrics && tr.lyrics.trim()) {
            values["lyrics"] = tr.lyrics;
            values["notes"] = `Letra: ${al.lyrics_source ?? ficha.artist.source}`;
          }
          const track = await createEntity(context, "track", values, { albumId: album.id });
          (albumRow["tracks"] as unknown[]).push({ id: track.id, title: tr.title, lyrics: Boolean(tr.lyrics) });

          if (tr.lyrics && tr.lyrics.trim()) {
            const claim = await client.query<{ id: string }>(`
              INSERT INTO ingest.claims(source_id,entity_kind,track_id,field,raw_value,normalized_value,
                raw_hash,extractor,extractor_version,confidence,status,created_by,run_id,notes,identity_key)
              VALUES($1,'track',$2,'lyrics',to_jsonb($3::text),to_jsonb($3::text),
                $4,'musicavenezuela-letras','1','medium','accepted','human',$5,$6,$7)
              ON CONFLICT DO NOTHING RETURNING id::text`,
            [source.id, track.id, tr.lyrics, sha(`lyrics|${tr.title}|${tr.lyrics}`),
              runId, `letra de ${tr.title} (${ficha.artist.name}) desde ${al.lyrics_source ?? ""}`,
              `musicavenezuela-letras:${ficha.key}:${al.title}:${tr.track_number}`]);
            const claimId = claim.rows[0]?.id;
            if (claimId) {
              const excerpt = tr.lyrics.slice(0, 480);
              await client.query(`
                INSERT INTO ingest.claim_evidence(claim_id,url,excerpt,selector,position,evidence_hash)
                VALUES($1,$2,$3,'[itemprop=lyrics]',0,$4) ON CONFLICT DO NOTHING`,
              [claimId, al.lyrics_source ?? ficha.artist.source, excerpt,
                sha(`${al.lyrics_source}|${excerpt}`)]);
            }
          }
        }
        (row["albums"] as unknown[]).push(albumRow);
      }
      report.push(row);
    }
    return { runId, artistas: report.length, report };
  }, { rollbackOnly: !confirm });

  const out = { dryRun: !confirm, ...result.result, runId: confirm ? result.runId : null };
  writeFileSync(`${OUT}/fichas-${confirm ? "aplicadas" : "ensayo"}.json`, JSON.stringify(out, null, 2) + "\n");
  for (const row of (result.result as { report: Array<Record<string, unknown>> }).report) {
    console.log(`OK ${row["artist"]} id=${row["artistId"]} álbumes=${(row["albums"] as unknown[]).length} ` +
      `pistas=${(row["albums"] as Array<{ tracks: unknown[] }>).reduce((n, a) => n + a.tracks.length, 0)} ` +
      `imágenes=${(row["images"] as unknown[]).length}`);
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(() => closeDb());
