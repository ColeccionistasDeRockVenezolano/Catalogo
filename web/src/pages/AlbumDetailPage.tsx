import { EntityVerification } from "../components/EntityVerification";
import { Fragment, useCallback, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RewritePendingMark } from "../components/RewritePendingMark";
import { BackLink } from "../components/BackLink";
import { GitMerge, PencilSimple, Play, Trash } from "@phosphor-icons/react";
import { albumFormatWrites, albumWrites, albumsApi, claimsApi, trackWrites, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useMovedToRedirect } from "../lib/useMovedTo";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { DetailSkeleton } from "../components/Skeletons";
import { AliasEditor } from "../components/AliasEditor";
import { AlbumVideoEditor } from "../components/AlbumVideoEditor";
import { GenreEditor } from "../components/GenreEditor";
import { PlatformLinkEditor } from "../components/PlatformLinkEditor";
import { EntityFormModal } from "../components/EntityFormModal";
import { TrackAliasesSection } from "../components/TrackAliasesSection";
import { EntityPicker } from "../components/EntityPicker";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CreditManager } from "../components/CreditManager";
import { AlbumMergeModal } from "../components/AlbumMergeModal";
import { EntityProvenance } from "../components/EntityProvenance";
import { EntityHistory } from "../components/EntityHistory";
import { EntityLoadError } from "../components/RemovedEntityState";
import { Modal } from "../components/Modal";
import { initialOf } from "../components/EntityCard";
import { entityFormValues, ALBUM_FIELDS, TRACK_FIELDS } from "../lib/entityFields";
import { albumTypeLabel, formatDuration } from "../lib/labels";
import type { AlbumFormat, Track } from "../lib/types";
import { PlatformLinks } from "../components/PlatformLinks";
import { AlbumYoutubePlayer, type AlbumYoutubePlayerHandle } from "../components/AlbumYoutubePlayer";
import { albumYoutubeVideoId, trackAtYoutubeTime, type YoutubePlayback } from "../lib/youtube";

const CREDIT_SECTIONS: ReadonlyArray<{ title: string; types: readonly string[] }> = [
  { title: "Músicos", types: ["musician"] },
  { title: "Colaboradores / invitados", types: ["guest"] },
  { title: "Producción", types: ["producer", "recording", "mixing", "mastering"] },
  { title: "Composición", types: ["writer", "composer"] },
  { title: "Arte", types: ["artwork", "photography"] },
  { title: "Otros créditos", types: ["other"] },
];

export function AlbumDetailPage() {
  const { id } = useParams();
  const albumId = Number(id);
  const navigate = useNavigate();
  const { isAdmin, user } = useOperator();
  const { notify } = useToast();
  const { data: album, loading, error, errorValue, reload } = useAsync(() => albumsApi.get(albumId), [albumId, user?.name]);
  const creditProvenance = useAsync(
    () => isAdmin && album ? claimsApi.creditSources("album", albumId) : Promise.resolve([]), [albumId, isAdmin, album],
  );
  useMovedToRedirect(errorValue);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mergingAlbum, setMergingAlbum] = useState(false);
  const [addingTrack, setAddingTrack] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [trackAlbumId, setTrackAlbumId] = useState<number | null>(null);
  const [trackAlbumLabel, setTrackAlbumLabel] = useState<string | null>(null);
  const [removingTrack, setRemovingTrack] = useState<Track | null>(null);
  const [expandedTrack, setExpandedTrack] = useState<number | null>(null);
  const [addingFormat, setAddingFormat] = useState(false);
  const [editingFormat, setEditingFormat] = useState<AlbumFormat | null>(null);
  const [artistId, setArtistId] = useState<number | null>(null);
  const [artistLabel, setArtistLabel] = useState<string | null>(null);
  const [labelId, setLabelId] = useState<number | null>(null);
  const [labelLabel, setLabelLabel] = useState<string | null>(null);
  const youtubePlayer = useRef<AlbumYoutubePlayerHandle>(null);
  const [playback, setPlayback] = useState<(YoutubePlayback & { albumId: number }) | null>(null);
  const onPlaybackChange = useCallback((value: YoutubePlayback | null) => {
    setPlayback(value ? { ...value, albumId } : null);
  }, [albumId]);

  if (loading && (!album || album.id !== albumId)) return <DetailSkeleton />;
  if (error || !album) return <EntityLoadError message={error ?? "Disco no encontrado."} errorValue={errorValue} onRetry={reload} />;
  const youtubeVideoId = albumYoutubeVideoId(album);
  const currentPlayback = playback?.albumId === album.id ? playback : null;
  const currentTrack = youtubeVideoId && currentPlayback && [1, 2, 3].includes(currentPlayback.state)
    ? trackAtYoutubeTime(album.tracklist, currentPlayback.seconds) : null;
  const playbackLabel = currentPlayback?.state === 1 ? "Reproduciendo" : currentPlayback?.state === 2 ? "En pausa" : "Cargando…";

  const meta = [
    album.releaseYear ? String(album.releaseYear) : null,
    albumTypeLabel(album.albumType),
    // Confirmados primero; un texto de fuente sin confirmar se muestra, pero marcado.
    ...(album.genres?.length ? album.genres.map((genre) => genre.name)
      : album.genre ? [album.genreStatus === "pending" ? `${album.genre} (sin confirmar)` : album.genre] : []),
  ].filter(Boolean);

  return (
    <>
      <BackLink fallback="/discos" />

      <div className="entity-hero">
        <span className="entity-hero__art">
          {album.coverUrl ? <img src={album.coverUrl} alt="" loading="lazy" decoding="async" /> : <span className="placeholder">{initialOf(album.title)}</span>}
        </span>
        <div>
          <h1 className="entity-hero__title">{album.title}</h1>
          <p style={{ margin: "6px 0 0" }}>
            <Link to={`/artistas/${album.artist.id}`} style={{ fontWeight: 600, color: "var(--text)" }}>{album.artist.name}</Link>
          </p>
          <div className="entity-hero__meta">
            {meta.map((item) => <span className="badge" key={String(item)}>{item}</span>)}
            {album.genreByLaya ? <span className="badge badge--amber" title="Género principal elegido por Laya (último recurso). Solo visible con sesión iniciada.">Género por Laya</span> : null}
            {album.label ? <Link to={`/organizaciones/${album.label.id}`} className="badge badge--violet">{album.label.name}</Link> : null}
          </div>
          {album.releaseDateText || album.catalogId || album.mediaFormat ? <dl className="album-edition-details">
            {album.releaseDateText ? <div><dt>Fecha de publicación</dt><dd>{album.releaseDateText}</dd></div> : null}
            {album.catalogId ? <div><dt>Número de catálogo</dt><dd>{album.catalogId}</dd></div> : null}
            {album.mediaFormat ? <div><dt>Formato de la edición</dt><dd>{album.mediaFormat}</dd></div> : null}
          </dl> : null}
          <PlatformLinks links={album.platforms ?? []} subject={`«${album.title}»`} />
          {album.description ? <p className="entity-hero__desc">{album.description}</p> : null}
          <RewritePendingMark kind="album" id={album.id} onDone={reload} />
        </div>
      </div>

      {isAdmin ? (
        <div className="page-actions" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn--sm" onClick={() => {
            setArtistId(album.artist.id); setArtistLabel(album.artist.name);
            setLabelId(album.label?.id ?? null); setLabelLabel(album.label?.name ?? null); setEditing(true);
          }}>
            <PencilSimple size={14} weight="bold" aria-hidden="true" />Editar
          </button>
          <button type="button" className="btn btn--sm" onClick={() => setMergingAlbum(true)}>
            <GitMerge size={14} weight="bold" aria-hidden="true" />Fusionar con…
          </button>
          <button type="button" className="btn btn--sm btn--danger" onClick={() => setDeleting(true)}>
            <Trash size={14} weight="bold" aria-hidden="true" />Retirar
          </button>
        </div>
      ) : null}

      {isAdmin ? <EntityVerification kind="album" id={album.id} revision={album} /> : null}

      <div className="section">
        <h2>Alias</h2>
        <AliasEditor path="albums" entityId={album.id} aliases={album.aliases} onChanged={reload} />
      </div>

      {youtubeVideoId ? (
        <div className="section">
          <h2>
            Escuchar disco
            <a className="album-youtube-link" href={`https://youtu.be/${youtubeVideoId}`} target="_blank" rel="noreferrer">Abrir en YouTube</a>
          </h2>
          <AlbumYoutubePlayer key={`${album.id}:${youtubeVideoId}`} ref={youtubePlayer} videoId={youtubeVideoId} title={album.title} onPlaybackChange={onPlaybackChange} />
          <p className="album-youtube-current" role="status">
            {currentTrack ? <>{playbackLabel}: <strong>{currentTrack.title}</strong></>
              : currentPlayback?.state === 1 ? "Reproduciendo el disco."
                : currentPlayback?.state === 2 ? "Reproducción en pausa."
                  : currentPlayback?.state === 3 ? "Cargando el video…"
                    : currentPlayback?.state === 0 ? "Reproducción finalizada."
                : "Elige una pista para escucharla desde su inicio."}
          </p>
        </div>
      ) : null}

      <div className="section">
        <h2>
          Lista de pistas <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({album.tracklist.length})</span>
          {isAdmin ? <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAddingTrack(true)}>+ Añadir pista</button> : null}
        </h2>
        {album.tracklist.length === 0 ? <p style={{ color: "var(--text-faint)", fontSize: 13.5 }}>Sin pistas registradas.</p> : (
          <div className="table-wrap table-wrap--scroll album-tracklist">
            <table role="table" aria-label="Lista de pistas">
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col" className="num">#</th><th role="columnheader" scope="col">Título</th><th role="columnheader" scope="col" className="num">Duración</th><th role="columnheader" scope="col" className="num">Inicio en YouTube</th><th role="columnheader" scope="col"><span className="visually-hidden">Acciones</span></th></tr></thead>
              <tbody role="rowgroup">
                {album.tracklist.map((track) => {
                  const isCurrent = currentTrack?.id === track.id;
                  return (
                  <Fragment key={track.id}>
                    <tr role="row" className={`album-track-row${isCurrent ? " is-current" : ""}`} aria-current={isCurrent ? "true" : undefined}>
                      <td role="cell" className="num album-track-number">{track.discNumber > 1 ? `${track.discNumber}.` : ""}{track.trackNumber}</td>
                      <td role="cell" className="album-track-title">
                        <span className="album-track-name">{track.title}</span>
                        {isCurrent ? <span className="track-playback-label">{playbackLabel}</span> : null}
                        {track.credits.length > 0 ? (
                          <button type="button" className="btn btn--sm btn--ghost track-credits-toggle"
                            onClick={() => setExpandedTrack(expandedTrack === track.id ? null : track.id)}>
                            {expandedTrack === track.id ? "ocultar créditos" : `créditos (${track.credits.length})`}
                          </button>
                        ) : null}
                      </td>
                      <td role="cell" className="num album-track-duration"><span className="album-track-duration-label">Duración </span>{formatDuration(track.durationSeconds)}</td>
                      <td role="cell" className="num album-track-start">
                        <span className="track-youtube-start">
                          <span className="track-youtube-time">{track.youtubeStartSeconds !== null ? formatDuration(track.youtubeStartSeconds) : "—"}</span>
                          {youtubeVideoId && track.youtubeStartSeconds !== null && track.youtubeStartSeconds >= 0 ? (
                            <button type="button" className="btn btn--sm track-youtube-play"
                              aria-label={`Reproducir «${track.title}» desde ${formatDuration(track.youtubeStartSeconds)}`}
                              title={`Reproducir desde ${formatDuration(track.youtubeStartSeconds)}`}
                              onClick={() => {
                                if (track.youtubeStartSeconds !== null) youtubePlayer.current?.playFrom(track.youtubeStartSeconds);
                              }}>
                              <Play size={16} weight="fill" aria-hidden="true" />
                            </button>
                          ) : null}
                        </span>
                      </td>
                      <td role="cell" className="row-actions album-track-actions">
                        {isAdmin ? (
                          <>
                            <button type="button" className="btn btn--sm" onClick={() => {
                              setEditingTrack(track); setTrackAlbumId(album.id); setTrackAlbumLabel(album.title);
                            }}>
                              <PencilSimple size={14} weight="bold" aria-hidden="true" />Editar
                            </button>
                            <button type="button" className="btn btn--sm btn--danger" onClick={() => setRemovingTrack(track)}>
                              <Trash size={14} weight="bold" aria-hidden="true" />Quitar
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                    {expandedTrack === track.id ? (
                      <tr role="row" className="album-track-credits">
                        <td role="cell" colSpan={5} style={{ background: "var(--surface-2)" }}>
                          <CreditManager target={{ kind: "track", trackId: track.id }} credits={track.credits} onChanged={reload} compact provenance={creditProvenance} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section">
        <h2>Créditos del disco</h2>
        <div className="credit-groups">
          {CREDIT_SECTIONS.map((section) => {
            const items = section.types.flatMap((type) => album.creditsByType[type] ?? []);
            const scoped = section.types.flatMap((type) => album.scopedCreditsByType[type] ?? []);
            return (
              <div className="credit-group" key={section.title}>
                <h3>{section.title}</h3>
                <CreditManager target={{ kind: "album", albumId: album.id }} credits={items} scoped={scoped} onChanged={reload} provenance={creditProvenance} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="section">
        <h2>
          Formatos
          {isAdmin ? <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAddingFormat(true)}>+ Añadir formato</button> : null}
        </h2>
        {album.formats.length === 0 ? <p style={{ color: "var(--text-faint)", fontSize: 13.5 }}>Sin formatos registrados.</p> : (
          <ul style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {album.formats.map((format) => (
              <li key={format.id} className="chip">
                <span>{format.format}</span>
                {format.quality ? <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{format.quality}</span> : null}
                <span className="badge" style={{ fontSize: 10 }}>{format.archiveStatus}</span>
                {isAdmin ? (
                  <>
                    <button type="button" title="Editar formato" aria-label={`Editar formato ${format.format}`} onClick={() => setEditingFormat(format)}>
                      <PencilSimple aria-hidden="true" />
                    </button>
                    <FormatRemoveButton id={format.id} format={format.format} onDone={reload} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="section">
        <h2>YouTube</h2>
        {album.youtubeLinks.length === 0 ? <p style={{ color: "var(--text-faint)", fontSize: 13.5 }}>Sin videos relacionados.</p> : (
          <ul style={{ display: "grid", gap: 8 }}>
            {album.youtubeLinks.map((link) => (
              <li key={link.videoId} className="credit-row">
                <a href={`https://youtu.be/${link.videoId}`} target="_blank" rel="noreferrer">{link.title ?? link.videoId}</a>
                <span className="role">{link.isPrimaryLink ? <span className="badge badge--red">Principal</span> : link.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <EntityProvenance entity="album" id={album.id} revision={album} />
      <EntityHistory entity="album" id={album.id} />

      {isAdmin && editing ? (
        <EntityFormModal
          title={`Editar «${album.title}»`}
          fields={ALBUM_FIELDS}
          panels={[
            { key: "videos", label: "Videos de YouTube", content: <AlbumVideoEditor albumId={album.id} links={album.youtubeLinks} onChanged={reload} /> },
            { key: "genres", label: "Géneros", content: <GenreEditor kind="album" id={album.id} genres={album.genres ?? []} primaryGenre={album.primaryGenre ?? null} onChanged={reload} /> },
            { key: "streaming", label: "Escuchar en", content: <PlatformLinkEditor kind="album" id={album.id} category="streaming" onChanged={reload} /> },
          ]}
          wide
          initialValues={entityFormValues(ALBUM_FIELDS, album)}
          extraFields={
            <>
              <EntityPicker kind="artist" label="Artista (atribución del disco)" value={artistId} valueLabel={artistLabel}
                onSelect={(pickedId, label) => { setArtistId(pickedId); setArtistLabel(label); }} />
              <EntityPicker kind="organization" label="Sello discográfico" value={labelId} valueLabel={labelLabel}
                onClear={() => { setLabelId(null); setLabelLabel(null); }}
                onSelect={(pickedId, label) => { setLabelId(pickedId); setLabelLabel(label); }} />
            </>
          }
          onSubmit={(values, note) => albumWrites.update(album.id, {
            ...values, labelId,
            ...(artistId !== null && artistId !== album.artist.id ? { artistId } : {}),
            note,
          })}
          onSuccess={() => { setEditing(false); reload(); notify("success", "Disco actualizado."); }}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Retirar «${album.title}»`}
          description="Se retira del catálogo. Si tiene pistas u otras dependencias, la API lo rechazará."
          confirmLabel="Retirar"
          danger
          onConfirm={async (note) => {
            await albumWrites.remove(album.id, note);
            notify("success", "Disco retirado.");
            navigate(`/artistas/${album.artist.id}`);
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}

      {addingTrack ? (
        <EntityFormModal
          title="Nueva pista"
          fields={TRACK_FIELDS}
          initialValues={{ discNumber: 1, trackNumber: album.tracklist.length + 1 }}
          onSubmit={(values, note) => trackWrites.create({ ...values, albumId: album.id, note })}
          onSuccess={() => { setAddingTrack(false); reload(); notify("success", "Pista añadida."); }}
          onClose={() => setAddingTrack(false)}
        />
      ) : null}

      {editingTrack ? (
        <EntityFormModal
          title={`Editar «${editingTrack.title}»`}
          fields={TRACK_FIELDS}
          panels={[{ key: "aliases", label: "Alias", content: <TrackAliasesSection trackId={editingTrack.id} onChanged={reload} /> }]}
          initialValues={entityFormValues(TRACK_FIELDS, editingTrack)}
          extraFields={
            <>
              <EntityPicker kind="album" label="Disco al que pertenece" value={trackAlbumId} valueLabel={trackAlbumLabel}
                onSelect={(pickedId, label) => { setTrackAlbumId(pickedId); setTrackAlbumLabel(label); }} />
            </>
          }
          onSubmit={(values, note) => trackWrites.update(editingTrack.id, {
            ...values,
            ...(trackAlbumId !== null && trackAlbumId !== album.id ? { albumId: trackAlbumId } : {}),
            note,
          })}
          onSuccess={() => { setEditingTrack(null); reload(); notify("success", "Pista actualizada."); }}
          onClose={() => setEditingTrack(null)}
        />
      ) : null}

      {removingTrack ? (
        <ConfirmDialog
          title={`Quitar «${removingTrack.title}»`}
          description="Se retira la pista y sus créditos propios; el historial queda en la ficha del disco."
          confirmLabel="Quitar"
          danger
          onConfirm={async (note) => {
            await trackWrites.remove(removingTrack.id, note);
            notify("success", "Pista retirada.");
            setRemovingTrack(null);
            reload();
          }}
          onClose={() => setRemovingTrack(null)}
        />
      ) : null}

      {addingFormat ? (
        <FormatFormModal albumId={album.id} onClose={() => setAddingFormat(false)} onDone={() => { setAddingFormat(false); reload(); }} />
      ) : null}

      {editingFormat ? (
        <FormatFormModal albumId={album.id} format={editingFormat} onClose={() => setEditingFormat(null)}
          onDone={() => { setEditingFormat(null); reload(); }} />
      ) : null}

      {mergingAlbum ? (
        <AlbumMergeModal
          albumId={album.id}
          albumTitle={album.title}
          onMerged={(keepId) => {
            setMergingAlbum(false);
            if (keepId === album.id) reload(); else navigate(`/discos/${keepId}`, { replace: true });
          }}
          onClose={() => setMergingAlbum(false)}
        />
      ) : null}
    </>
  );
}

function FormatRemoveButton({ id, format, onDone }: { id: number; format: string; onDone: () => void }) {
  const { notify } = useToast();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button type="button" aria-label={`Retirar formato ${format}`} title={`Retirar formato ${format}`} onClick={() => setConfirming(true)}>
        <Trash aria-hidden="true" />
      </button>
      {confirming ? (
        <ConfirmDialog
          title={`Retirar formato «${format}»`}
          description="El formato deja de estar disponible; su historia queda en la ficha del disco."
          confirmLabel="Retirar"
          danger
          onConfirm={async (note) => {
            await albumFormatWrites.remove(id, note);
            notify("success", "Formato retirado.");
            setConfirming(false);
            onDone();
          }}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

const QUALITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Sin dato" }, { value: "unknown", label: "Desconocida" }, { value: "HQ", label: "Alta" }, { value: "LQ", label: "Baja" },
];
const ARCHIVE_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "unknown", label: "Desconocido" }, { value: "published", label: "Publicado" }, { value: "unpublished", label: "Sin publicar" },
];

/**
 * Alta y edición de un formato de archivo del disco (MP3, FLAC, vinilo…).
 * La edición viaja solo con lo que cambió y exige motivo, como el resto.
 */
function FormatFormModal({ albumId, format, onDone, onClose }: {
  albumId: number; format?: AlbumFormat; onDone: () => void; onClose: () => void;
}) {
  const editing = format !== undefined;
  const [name, setName] = useState(format?.format ?? "");
  const [quality, setQuality] = useState(format?.quality ?? "");
  const [archiveStatus, setArchiveStatus] = useState(format?.archiveStatus ?? "unknown");
  const [filePath, setFilePath] = useState(format?.filePath ?? "");
  const [notes, setNotes] = useState(format?.notes ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("El formato es obligatorio (MP3, FLAC, vinilo…)."); return; }
    if (editing && !note.trim()) { setError("El motivo es obligatorio (queda en la auditoría)."); return; }
    setBusy(true);
    setError(undefined);
    try {
      if (!format) {
        await albumFormatWrites.create({
          albumId, format: name.trim(), quality: quality === "" ? null : quality, archiveStatus,
          ...(filePath.trim() ? { filePath: filePath.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        });
      } else {
        const changes: Record<string, unknown> = {};
        if (name.trim() !== format.format) changes["format"] = name.trim();
        if ((quality === "" ? null : quality) !== format.quality) changes["quality"] = quality === "" ? null : quality;
        if (archiveStatus !== format.archiveStatus) changes["archiveStatus"] = archiveStatus;
        if ((filePath.trim() || null) !== format.filePath) changes["filePath"] = filePath.trim() || null;
        if ((notes.trim() || null) !== format.notes) changes["notes"] = notes.trim() || null;
        if (Object.keys(changes).length === 0) { setError("No hay cambios que guardar."); setBusy(false); return; }
        await albumFormatWrites.update(format.id, { ...changes, note: note.trim() });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar.");
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Editar formato «${format.format}»` : "Añadir formato"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <p className="form-error-banner" role="alert">{error}</p> : null}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="format-name">Formato *</label>
            <input id="format-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="MP3, FLAC, Vinilo…" />
          </div>
          <div className="field">
            <label htmlFor="format-quality">Calidad</label>
            <select id="format-quality" value={quality} onChange={(event) => setQuality(event.target.value)}>
              {QUALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="format-status">Estado del archivo</label>
            <select id="format-status" value={archiveStatus} onChange={(event) => setArchiveStatus(event.target.value)}>
              {ARCHIVE_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="format-path">Ruta del archivo</label>
            <input id="format-path" value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="/mnt/datos/… (opcional)" />
          </div>
          <div className="field span-2">
            <label htmlFor="format-notes">Notas internas</label>
            <textarea id="format-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
          {editing ? (
            <div className="field span-2">
              <label htmlFor="format-note">Motivo *</label>
              <textarea id="format-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
          ) : null}
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Guardando…" : editing ? "Guardar corrección" : "Añadir"}</button>
        </div>
      </form>
    </Modal>
  );
}
