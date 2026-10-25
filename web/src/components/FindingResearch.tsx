import { Link } from "react-router-dom";
import { useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import type { DocumentedResearch } from "../lib/curationResearch";
import { albumsApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { ErrorState } from "./StateViews";

function sourceLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./u, ""); } catch { return url; }
}

export function FindingResearch({ research }: { research: DocumentedResearch }) {
  const sources = research.sources.filter((url) => /^https?:\/\//iu.test(url));
  return <section className="cresearch" aria-label="Investigación documentada">
    <h4>{research.label}</h4>
    <p>{research.finding}</p>
    {research.changedAlbumIds.length ? <p className="cresearch__warning" role="status">
      Las fichas {research.changedAlbumIds.map((id) => `#${id}`).join(", ")} cambiaron desde esta investigación.
      Revisa los datos actuales antes de decidir.
    </p> : null}
    <ul className="cresearch__albums">
      {research.albums.map((album) => <li key={album.id}>
        <Link to={`/discos/${album.id}`} target="_blank" rel="noopener noreferrer">
          {album.title} <ArrowSquareOut size={13} aria-hidden="true" />
        </Link>
        <span>{album.artist} · {album.year ?? "Sin año"} · {album.tracks} pistas en la investigación · #{album.id}</span>
        {research.suggestedKeep === album.id ? <strong>Ficha sugerida para conservar</strong> : null}
      </li>)}
    </ul>
    <CurrentTracklists research={research} />
    {research.mergePreview?.positionOnly.length ? <p className="cresearch__warning">
      Hay pistas emparejadas solo por posición. Comprueba sus títulos antes de fusionar.
    </p> : null}
    {research.mergePreview?.engineSuggestedMode === "append" ? <p className="cresearch__warning">
      La investigación recomienda emparejar las pistas del mismo disco; añadir otro disco repetiría el repertorio.
    </p> : null}
    <details className="cresearch__sources">
      <summary>Fuentes consultadas ({sources.length})</summary>
      <ul>{sources.map((url, index) => <li key={url}>
        <a href={url} target="_blank" rel="noopener noreferrer">{sourceLabel(url)} · fuente {index + 1}
          <ArrowSquareOut size={13} aria-hidden="true" /></a>
        <span>{url}</span>
      </li>)}</ul>
      <p>Investigación del {research.researchedAt.slice(0, 10)}. Algunas fuentes se consultaron mediante capturas conservadas.</p>
    </details>
  </section>;
}

function CurrentTracklists({ research }: { research: DocumentedResearch }) {
  const [open, setOpen] = useState(false);
  const first = research.albums[0]?.id;
  const second = research.albums[1]?.id;
  const { data, loading, error, reload } = useAsync(async () => {
    if (!open || !first || !second) return null;
    const albums = await Promise.all([albumsApi.get(first), albumsApi.get(second)]);
    return { first, second, albums };
  }, [open, first, second]);
  const current = data?.first === first && data?.second === second ? data.albums : null;
  const positions = new Map<string, { disc: number; track: number }>();
  for (const album of current ?? []) for (const track of album.tracklist) {
    positions.set(`${track.discNumber}:${track.trackNumber}`, { disc: track.discNumber, track: track.trackNumber });
  }
  const sorted = [...positions.entries()].sort((a, b) => a[1].disc - b[1].disc || a[1].track - b[1].track);
  const duration = (seconds: number | null) => seconds === null ? "Sin duración" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <details className="cresearch__tracks" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Comparar pistas actuales</summary>
    {open ? loading ? <p role="status">Cargando las dos listas…</p> : error ? <ErrorState message={error} onRetry={reload} /> : current ? <>
      <p>Comparación por posición. Una fila compartida no demuestra que sea la misma grabación.</p>
      {sorted.length ? <div className="cresearch__track-table" tabIndex={0} role="region" aria-label="Comparación de pistas con desplazamiento horizontal">
        <table>
          <thead><tr><th scope="col">Posición</th>{current.map((album) => <th scope="col" key={album.id}>{album.title} · {album.tracklist.length} pistas</th>)}</tr></thead>
          <tbody>{sorted.map(([position, number]) => <tr key={position}>
            <th scope="row">{number.disc}.{number.track}</th>
            {current.map((album) => {
              const tracks = album.tracklist.filter((track) => track.discNumber === number.disc && track.trackNumber === number.track);
              return <td key={album.id}>{tracks.length ? tracks.map((track) => <span key={track.id}>{track.title}<small>{duration(track.durationSeconds)}</small></span>) : "Sin pista"}</td>;
            })}
          </tr>)}</tbody>
        </table>
      </div> : <p>Ninguna de las dos fichas tiene pistas registradas.</p>}
    </> : null : null}
  </details>;
}
