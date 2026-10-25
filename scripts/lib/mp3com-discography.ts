/** Una agrupación sin título en MP3.com no documenta una publicación. */
export interface Mp3AlbumGroup {
  album: string | null; media: string | null; label: string | null;
  tracks: Array<{ song_id: string; title: string; credits: string | null }>;
}
export interface Mp3Discography {
  name: string; url: string; location?: string; albums: Mp3AlbumGroup[];
}
export interface Mp3Song {
  song_id: string; credits: string | null; genre: string | null;
}

export function discographyCounts(d: Mp3Discography) {
  const titled = d.albums.filter(a => a.album?.trim());
  return {
    albums: titled.length,
    albumGroups: d.albums.length,
    untitledGroups: d.albums.length - titled.length,
    distinctAlbumTitles: new Set(titled.map(a => a.album!.normalize('NFKC').trim().toLocaleLowerCase('es').replace(/\s+/gu, ' '))).size,
    tracks: d.albums.reduce((n,a) => n+a.tracks.length,0),
    unassignedTracks: d.albums.filter(a => !a.album?.trim()).reduce((n,a) => n+a.tracks.length,0),
    countVersion: 2,
  };
}

export function discographyTitle(d: Mp3Discography): string {
  const c = discographyCounts(d);
  return `Discografía en MP3.com (2003) — ${c.albums} ${c.albums===1?'entrada':'entradas'} con título de disco, ${c.tracks} pistas (${c.unassignedTracks} sin disco identificado)`;
}

export function renderDiscography(d: Mp3Discography, songs: Mp3Song[], plays?: number): string {
  const c = discographyCounts(d);
  const bySong = new Map(songs.map(s => [s.song_id,s]));
  const out = [`Discografía publicada en MP3.com (noviembre de 2003) · ${d.name}`];
  if (d.location) out.push(`Ubicación declarada: ${d.location}`);
  if (plays) out.push(`Reproducciones acumuladas en MP3.com: ${plays.toLocaleString('es-VE')}`);
  out.push(`${c.albums} ${c.albums===1?'entrada':'entradas'} con título de disco; ${c.unassignedTracks} pistas sin disco identificado. Los grupos sin título no se cuentan como discos.`);
  if (!d.albums.length) out.push('Sin discos ni pistas conservados en el volcado.');
  for (const a of d.albums) {
    const heading = a.album?.trim() || 'Pistas sin disco identificado';
    out.push('', [heading,a.media ? `Soporte declarado: ${a.media}` : null,a.label ? `Sello: ${a.label}` : null].filter(Boolean).join(' · '));
    for (const t of a.tracks) {
      const song = bySong.get(t.song_id);
      const extra = [t.credits || song?.credits,song?.genre ? `género: ${song.genre}` : null].filter(Boolean).join(' — ');
      out.push(`  · ${t.title}${extra ? ` (${extra})` : ''}`);
    }
  }
  out.push('',`Ficha de origen: ${d.url}`);
  return out.join('\n');
}
