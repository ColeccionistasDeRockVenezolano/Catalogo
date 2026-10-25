// Ficha de Claroscuro (artist 67) alimentada con su web oficial
// https://claroscuroband.com/ — lectura 2026-10-19.
//
// Solo se escriben datos que la ficha NO tenía y que el sitio oficial declara:
//   · enlaces de escucha que faltaban (canal de YouTube, perfil de Spotify/Apple/TIDAL
//     sin identificador estable) y redes (Instagram, TikTok)
//   · Bandcamp oficial de Supereterodino y del single Miel, verificados por título,
//     año y lista de pistas contra el catálogo
//   · Javier Del Castillo como baterista de la etapa 2001-2003
//   · párrafo de la etapa actual (reunión y rescate del catálogo) al final de la biografía
//
// No se toca: Facebook (el sitio enlaza /claroscurobandoficial y la ficha tiene un
// perfil numérico: no se pudo verificar cuál es la cuenta viva), portadas, géneros,
// ni la asignación del Bandcamp remasterizado de El Viaje (choca con dos fichas).
import { closeDb, getPool } from "../../src/db/client.js";
import { createRelation, updateEntity, withOperatorRun } from "../../src/merge/operator.js";
import { writePlatformLink, type EditablePlatformLink } from "../../src/merge/platform-links.js";

const ARTIST = 67;
const NOTE = "Web oficial claroscuroband.com: enlaces, redes, miembro 2001-2003 y etapa actual (2026-10-19)";
const BIO_APPEND = "En los últimos años Claroscuro volvió a reunirse para preservar y renovar su catálogo: grabaciones inéditas, demos, temas remasterizados, versiones en vivo y videos restaurados, que la banda publica en su canal de YouTube y en las plataformas de streaming.";
const SERVER = "https://claroscuroband.com/";

type ArtistLink = { platform: string; category: "streaming" | "social"; link: Omit<EditablePlatformLink, "platform"> };

const ARTIST_LINKS: ArtistLink[] = [
  { platform: "spotify", category: "streaming", link: { url: "https://open.spotify.com/artist/6pC4fPhvDb28uyPljTPH1H", handle: null, verified: true, externalId: "6pC4fPhvDb28uyPljTPH1H" } },
  { platform: "apple_music", category: "streaming", link: { url: "https://music.apple.com/us/artist/claroscuro/1710366371", handle: null, verified: true, externalId: "1710366371" } },
  { platform: "tidal", category: "streaming", link: { url: "https://tidal.com/artist/6553499", handle: null, verified: true, externalId: "6553499" } },
  { platform: "youtube", category: "streaming", link: { url: "https://www.youtube.com/@ClaroscuroBand", handle: null, verified: true } },
  { platform: "instagram", category: "social", link: { url: "https://www.instagram.com/claroscuroband_", handle: "claroscuroband_", verified: true } },
  { platform: "tiktok", category: "social", link: { url: "https://www.tiktok.com/@claroscuroband_", handle: "claroscuroband_", verified: true } },
];

const ALBUM_LINKS: Array<{ albumId: number; title: string; url: string }> = [
  { albumId: 546, title: "Supereterodino", url: "https://reyesmusic.bandcamp.com/album/supereterodino" },
  { albumId: 155, title: "Miel", url: "https://reyesmusic.bandcamp.com/album/miel" },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = getPool();

  const before = await pool.query(
    `SELECT (SELECT biography FROM public.artists WHERE id=$1) AS biography,
            (SELECT count(*) FROM public.streaming_links s WHERE s.artist_id=$1)::int AS streaming,
            (SELECT count(*) FROM public.social_links s WHERE s.artist_id=$1)::int AS social,
            (SELECT count(*) FROM public.artist_members m WHERE m.artist_id=$1)::int AS members`,
    [ARTIST],
  );
  const bioActual = (before.rows[0] as { biography: string | null }).biography ?? "";
  const yaTieneParrafo = bioActual.includes("volvió a reunirse para preservar");
  const nuevaBio = yaTieneParrafo ? bioActual : `${bioActual.trimEnd()}\n\n${BIO_APPEND}`;

  console.log(`Antes: ${(before.rows[0] as { streaming: number }).streaming} enlaces de escucha, ` +
    `${(before.rows[0] as { social: number }).social} redes, ${(before.rows[0] as { members: number }).members} miembros, ` +
    `biografía ${bioActual.length} car.`);
  console.log(yaTieneParrafo ? "La biografía ya trae el párrafo de la etapa actual." : `Biografía -> ${nuevaBio.length} car.`);

  const memberExists = await pool.query(
    "SELECT 1 FROM public.artist_members WHERE artist_id=$1 AND person_id=685", [ARTIST],
  );
  if (memberExists.rowCount) console.log("Javier Del Castillo ya figura como miembro: se omite.");

  if (!apply) {
    console.log("\n(dry-run) se escribirían:");
    for (const l of ARTIST_LINKS) console.log(`  artista ${l.category}/${l.platform} -> ${l.link.url}`);
    for (const a of ALBUM_LINKS) console.log(`  disco ${a.albumId} ${a.title} bandcamp -> ${a.url}`);
    if (!memberExists.rowCount) console.log("  miembro: Javier Del Castillo (685) Drums 2001-2003");
    if (!yaTieneParrafo) console.log("  biografía: + párrafo de la etapa actual");
    await closeDb();
    return;
  }

  const { runId } = await withOperatorRun({ name: "claroscuro-web-oficial", operator: "hermes", note: NOTE, params: { artistId: ARTIST, source: SERVER } }, async (ctx) => {
    for (const l of ARTIST_LINKS) {
      await writePlatformLink(ctx, "artist", ARTIST, l.category, l.platform, l.link);
    }
    for (const a of ALBUM_LINKS) {
      await writePlatformLink(ctx, "album", a.albumId, "streaming", "bandcamp", {
        url: a.url, handle: null, verified: true, externalId: null,
      });
    }
    if (!memberExists.rowCount) {
      await createRelation(ctx, "artist_membership", { artistId: ARTIST, personId: 685 }, {
        role: "Drums", from_year: 2001, to_year: 2003, is_current: false,
        notes: "Baterista de la banda en la etapa 2001-2003; aparece en el video de Miel. La grabación original de la batería de ese tema es de Javier Weyler.",
      });
    }
    if (!yaTieneParrafo) await updateEntity(ctx, "artist", ARTIST, { biography: nuevaBio });
    return { links: ARTIST_LINKS.length + ALBUM_LINKS.length };
  });

  const after = await pool.query(
    `SELECT (SELECT count(*) FROM public.streaming_links s WHERE s.artist_id=$1)::int AS streaming,
            (SELECT count(*) FROM public.social_links s WHERE s.artist_id=$1)::int AS social,
            (SELECT count(*) FROM public.artist_members m WHERE m.artist_id=$1)::int AS members,
            (SELECT count(*) FROM public.streaming_links s WHERE s.album_id IN (546,155) AND s.platform='bandcamp')::int AS bandcamp_discos,
            length((SELECT biography FROM public.artists WHERE id=$1)) AS bio`,
    [ARTIST],
  );
  console.log(`\nrun ${runId} aplicado. Después:`, after.rows[0]);
  await pool.query(
    `SELECT platform, url FROM public.streaming_links WHERE artist_id=$1
     UNION ALL SELECT platform, url FROM public.social_links WHERE artist_id=$1 ORDER BY 1`,
    [ARTIST],
  ).then((r) => { for (const row of r.rows) console.log(`  ${row.platform}: ${row.url}`); });
  await closeDb();
}

main().catch(async (error) => { console.error(error); await closeDb(); process.exitCode = 1; });
