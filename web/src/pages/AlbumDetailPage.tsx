import { GenrePeriods } from "../components/GenrePeriods";
import { AlbumPublishingEditor } from "../components/CatalogResourceEditor";
import { ImageViewer } from "../components/ImageViewer";
import { formatDate } from "../lib/format";
import { CatalogModelPanel } from "../components/CatalogModelPanel";
import { EntityVerification } from "../components/EntityVerification";
import { CompleteRecord } from "../components/CompleteRecord";
import { goToCompleteRecord } from "../lib/completeRecord";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { RewritePendingMark } from "../components/RewritePendingMark";
import { BackLink } from "../components/BackLink";
import { ArrowsOutSimple, CalendarBlank, Clock, MusicNotes, PencilSimple, Play, Record, Trash } from "@phosphor-icons/react";
import { EntityAdminBar } from "../components/EntityAdminBar";
import { albumFormatWrites, albumWrites, albumsApi, claimsApi, trackWrites, tracksApi, ApiError } from "../lib/api";
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
import { AlbumSeriesEditor } from "../components/SeriesEditor";
import { TrackAliasesSection } from "../components/TrackAliasesSection";
import { EntityPicker } from "../components/EntityPicker";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CreditManager } from "../components/CreditManager";
import { AlbumVersions, CreditChips, CreditLines, CreditStatements, SeriesLines } from "../components/Discography";
import { creditLines, otherCreditsWithChannel, otherWithoutRepeats, PRODUCTION_TYPES } from "../lib/creditLayout";
import { AlbumMergeModal } from "../components/AlbumMergeModal";
import { EntityProvenance } from "../components/EntityProvenance";
import { EntityHistory } from "../components/EntityHistory";
import { EntityLoadError } from "../components/RemovedEntityState";
import { Modal } from "../components/Modal";
import { initialOf } from "../components/EntityCard";
import { entityFormValues, ALBUM_FIELDS, TRACK_FIELDS } from "../lib/entityFields";
import { albumClassificationBadges, albumTypeLabel, formatDuration, knownFormat } from "../lib/labels";
import type { AlbumFormat, Credit, CreditStatement, ScopedCredit, Track } from "../lib/types";
import { PlatformLinks, type PlatformLink } from "../components/PlatformLinks";
import { CatalogGenres, CatalogYear } from "../components/CatalogMetadata";
import { AlbumYoutubePlayer, type AlbumYoutubePlayerHandle } from "../components/AlbumYoutubePlayer";
import { albumDiscVideos, albumYoutubeVideoId, trackAtYoutubeTime, type DiscVideo, type YoutubePlayback } from "../lib/youtube";
import { useVideoPlayer, type CatalogVideoTrack } from "../components/VideoPlayer";
import { EmbedPanel, resolveListenPlatform, useListenChoice, type ListenTab } from "../components/ListenPlayer";
import { compareEmbedPlatforms, embedOptions } from "../lib/embeds";
import { mediaImage } from "../lib/media";
import { AlbumListenPanel } from "../components/AlbumListenPanel";
import "../styles/album-detail.css";

// «Músicos Invitados» y «Otros Créditos» no se muestran al público sin datos (plan v2, puntos 11 y 12).
// El operador edita por sección; el público ve la estructura de `PublicCredits`.
const CREDIT_SECTIONS: ReadonlyArray<{ title: string; types: readonly string[] }> = [
  { title: "Músicos", types: ["musician"] },
  { title: "Músicos Invitados", types: ["guest"] },
  { title: "Producción", types: PRODUCTION_TYPES },
  { title: "Composición", types: ["writer", "composer"] },
  { title: "Arte", types: ["artwork", "photography"] },
  { title: "Otros Créditos", types: ["other"] },
];

type CreditsByType = Record<string, Credit[] | undefined>;
type ScopedByType = Record<string, ScopedCredit[] | undefined>;

/**
 * Créditos para el público (plan v2, etapa 4): con créditos del canal, sus
 * líneas reemplazan la columna «Producción» bajo «Otros Créditos»; sin canal,
 * «Producción» va en el mismo formato de línea. Composición y Arte siguen
 * aparte. Las secciones sin datos que sobran no se muestran.
 */
function PublicCredits({ creditsByType, scopedByType, statements }: { creditsByType: CreditsByType; scopedByType: ScopedByType; statements: CreditStatement[] }) {
  const pick = (types: readonly string[]) => ({
    credits: types.flatMap((type) => creditsByType[type] ?? []),
    scoped: types.flatMap((type) => scopedByType[type] ?? []),
  });
  const musicians = pick(["musician"]);
  const guests = pick(["guest"]);
  const composition = pick(["writer", "composer"]);
  const art = pick(["artwork", "photography"]);
  const other = { credits: otherWithoutRepeats(creditsByType.other ?? [], creditsByType, scopedByType), scoped: otherWithoutRepeats(scopedByType.other ?? [], creditsByType, scopedByType) };
  const channel = statements.length > 0 ? otherCreditsWithChannel(statements, creditsByType, scopedByType) : null;
  const production = channel ? [] : creditLines(pick(PRODUCTION_TYPES).credits, pick(PRODUCTION_TYPES).scoped);
  const empty = <p className="credit-chips__empty">Sin créditos registrados.</p>;
  return (
    <div className="credit-groups">
      <div className="credit-group"><h3>Músicos</h3><CreditChips credits={musicians.credits} scoped={musicians.scoped} musicians /></div>
      {guests.credits.length || guests.scoped.length ? <div className="credit-group"><h3>Músicos Invitados</h3><CreditChips credits={guests.credits} scoped={guests.scoped} /></div> : null}
      {channel ? (channel.statements.length || channel.lines.length ? (
        <div className="credit-group credit-group--lines">
          <h3>Otros Créditos</h3>
          <CreditStatements statements={channel.statements} title={null} />
          <CreditLines lines={channel.lines} />
        </div>
      ) : null) : <div className="credit-group credit-group--lines"><h3>Producción</h3>{production.length ? <CreditLines lines={production} /> : empty}</div>}
      <div className="credit-group"><h3>Composición</h3><CreditChips credits={composition.credits} scoped={composition.scoped} /></div>
      <div className="credit-group"><h3>Arte</h3><CreditChips credits={art.credits} scoped={art.scoped} /></div>
      {!channel && (other.credits.length || other.scoped.length) ? <div className="credit-group"><h3>Otros Créditos</h3><CreditChips credits={other.credits} scoped={other.scoped} /></div> : null}
    </div>
  );
}

const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

export function AlbumDetailPage() {
  const { id } = useParams();
  const albumId = Number(id);
  const navigate = useNavigate();
  const { isAdmin, user } = useOperator();
  const { notify } = useToast();
  const { data: album, loading, error, errorValue, reload } = useAsync(() => albumsApi.get(albumId), [albumId, user?.name]);
  // A track found in search opens its album at that track (#pista-<id>), once per visit.
  const { hash } = useLocation();
  const targetTrack = Number(/^#pista-(\d+)$/u.exec(hash)?.[1] ?? 0) || null;
  const [highlightedTrack, setHighlightedTrack] = useState<number | null>(null);
  const shownTarget = useRef<string | null>(null);
  useEffect(() => {
    if (!targetTrack || !album || album.id !== albumId || shownTarget.current === `${albumId}:${targetTrack}`) return;
    const row = document.getElementById(`pista-${targetTrack}`);
    if (!row) return;
    shownTarget.current = `${albumId}:${targetTrack}`;
    row.scrollIntoView({ block: "center" });
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
    setHighlightedTrack(targetTrack);
  }, [targetTrack, album, albumId]);
  // A reload (e.g. once the session is known) remounts the rows: give focus back only if nobody else took it.
  useEffect(() => {
    const row = highlightedTrack ? document.getElementById(`pista-${highlightedTrack}`) : null;
    if (row && (!document.activeElement || document.activeElement === document.body)) row.focus({ preventScroll: true });
  }, [highlightedTrack, album]);
  // Cover, player and credits load above the row after it is centred: keep it in view while the page settles,
  // until the visitor scrolls or acts, for a few seconds at most.
  useEffect(() => {
    if (!highlightedTrack) return;
    const centre = () => document.getElementById(`pista-${highlightedTrack}`)?.scrollIntoView({ block: "center" });
    const observer = new ResizeObserver(centre);
    observer.observe(document.body);
    const stop = () => { observer.disconnect(); window.clearTimeout(timer); for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, stop, true); };
    const timer = window.setTimeout(stop, 5000);
    for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });
    return stop;
  }, [highlightedTrack]);
  const creditProvenance = useAsync(
    () => isAdmin && album ? claimsApi.creditSources("album", albumId) : Promise.resolve([]), [albumId, isAdmin, album],
  );
  useMovedToRedirect(errorValue);
  const [viewingCover, setViewingCover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mergingAlbum, setMergingAlbum] = useState(false);
  const [addingTrack, setAddingTrack] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [trackAlbumId, setTrackAlbumId] = useState<number | null>(null);
  const [trackAlbumLabel, setTrackAlbumLabel] = useState<string | null>(null);
  const [removingTrack, setRemovingTrack] = useState<Track | null>(null);
  const [expandedTrack, setExpandedTrack] = useState<number | null>(null);
  // Letra de la pista (0073): se carga bajo demanda con el detalle de pista.
  const [letra, setLetra] = useState<{ id: number; texto: string | null; cargando: boolean } | null>(null);
  const verLetra = useCallback(async (track: Track) => {
    if (letra?.id === track.id) { setLetra(null); return; }
    setLetra({ id: track.id, texto: null, cargando: true });
    try {
      const detalle = await tracksApi.get(track.id);
      setLetra({ id: track.id, texto: detalle.lyrics, cargando: false });
    } catch {
      setLetra({ id: track.id, texto: null, cargando: false });
    }
  }, [letra?.id]);
  const [addingFormat, setAddingFormat] = useState(false);
  const [editingFormat, setEditingFormat] = useState<AlbumFormat | null>(null);
  const [artistId, setArtistId] = useState<number | null>(null);
  const [artistLabel, setArtistLabel] = useState<string | null>(null);
  const youtubePlayer = useRef<AlbumYoutubePlayerHandle>(null);
  const [playback, setPlayback] = useState<(YoutubePlayback & { albumId: number }) | null>(null);
  // Video elegido entre los de los discos (Lado A / Lado B, CD 1 / CD 2).
  const [chosenVideo, setChosenVideo] = useState<{ albumId: number; videoId: string } | null>(null);
  const { session: videoSession, play: playVideo } = useVideoPlayer();
  const [chosenPlatform, choosePlatform] = useListenChoice(albumId);
  const listenSection = useRef<HTMLDivElement>(null);
  const onPlaybackChange = useCallback((value: YoutubePlayback | null) => {
    setPlayback(value ? { ...value, albumId } : null);
  }, [albumId]);

  if (loading && (!album || album.id !== albumId)) return <DetailSkeleton />;
  if (error || !album) return <EntityLoadError message={error ?? "Disco no encontrado."} errorValue={errorValue} onRetry={reload} />;
  const shownFormats = isAdmin ? album.formats : album.formats.filter((format) => knownFormat(format.format));
  const discGroups = groupTracksByDisc(album.tracklist, album.discs ?? []);
  const albumVideoId = albumYoutubeVideoId(album);
  const discVideos = albumDiscVideos(albumVideoId, discGroups);
  const videoOfDisc = new Map(discVideos.map((video) => [video.discNumber, video]));
  // Una pestaña por video distinto; varios discos con el mismo video comparten la suya.
  const videoTabs = discVideos.filter((video, index) => discVideos.findIndex((other) => other.videoId === video.videoId) === index);
  const multipleVideos = videoTabs.length > 1;
  const sessionVideoId = videoSession?.owner === `album-${album.id}` ? videoSession.video.videoId : null;
  const youtubeVideoId = [sessionVideoId, chosenVideo?.albumId === album.id ? chosenVideo.videoId : null]
    .find((videoId) => videoId && videoTabs.some((tab) => tab.videoId === videoId))
    ?? videoTabs.find(video => album.crvYoutubeVideoIds?.includes(video.videoId))?.videoId
    ?? albumVideoId ?? videoTabs[0]?.videoId ?? null;
  const nativeYoutubePlatform = youtubeVideoId && album.crvYoutubeVideoIds?.includes(youtubeVideoId) ? "crv_youtube" : "youtube";
  const tabLabel = (video: DiscVideo) => discVideos.filter((other) => other.videoId === video.videoId)
    .map((other) => discGroups.find((group) => group.discNumber === other.discNumber)?.title ?? `Disco ${other.discNumber}`).join(" · ");
  const activeTab = videoTabs.find((tab) => tab.videoId === youtubeVideoId);
  const playerTitle = multipleVideos && activeTab ? `${album.title} · ${tabLabel(activeTab)}` : album.title;
  const videoTracks: CatalogVideoTrack[] = discGroups.flatMap(group => group.tracks.flatMap(track => {
    const video = videoOfDisc.get(track.discNumber);
    if (!video || track.youtubeStartSeconds === null || !Number.isFinite(track.youtubeStartSeconds) || track.youtubeStartSeconds < 0) return [];
    const title = multipleVideos ? `${album.title} · ${tabLabel(video)}` : album.title;
    return [{ video: { videoId: video.videoId, title, album: { id: album.id, title: album.title } }, title: track.title, seconds: track.youtubeStartSeconds }];
  }));
  const currentPlayback = playback?.albumId === album.id ? playback : null;
  // Los segundos de inicio se miden sobre el video del disco: solo cuentan las pistas de los discos que suenan.
  const playingTracks = album.tracklist.filter((track) => videoOfDisc.get(track.discNumber)?.videoId === youtubeVideoId);
  const currentTrack = youtubeVideoId && currentPlayback && [1, 2, 3].includes(currentPlayback.state)
    ? trackAtYoutubeTime(playingTracks, currentPlayback.seconds) : null;
  const playbackLabel = currentPlayback?.state === 1 ? "Reproduciendo" : currentPlayback?.state === 2 ? "En pausa" : "Cargando…";
  // Plataformas con reproductor: YouTube (el canal, suena completo para todos) y las demás.
  const embeds = embedOptions([
    { label: null, links: album.platforms ?? [] },
    ...(album.discs ?? []).map((disc) => ({ label: disc.title ?? `Disco ${disc.discNumber}`, links: disc.platforms.filter((link) => link.platform !== "youtube") })),
  ], "album");
  const listenTabs: ListenTab[] = [
    ...(youtubeVideoId ? [{ platform: nativeYoutubePlatform, url: `https://youtu.be/${youtubeVideoId}` }] : []),
    ...embeds.map((option) => ({ platform: option.platform, url: option.targets[0]!.url })),
  ].sort((a, b) => compareEmbedPlatforms(a.platform, b.platform, "album"));
  const listenPlatform = resolveListenPlatform(listenTabs.map((tab) => tab.platform), chosenPlatform, listenTabs[0]?.platform);
  const activeEmbed = embeds.find((option) => option.platform === listenPlatform) ?? null;
  const switchPlatform = (platform: string) => {
    choosePlatform(platform);
  };
  const playDisc = (video: DiscVideo, seconds = 0) => {
    setChosenVideo({ albumId: album.id, videoId: video.videoId });
    const title = multipleVideos ? `${album.title} · ${tabLabel(video)}` : album.title;
    if (youtubePlayer.current) { youtubePlayer.current.playFrom(seconds, { videoId: video.videoId, title }); return; }
    // Una pista pulsada mientras suena otra plataforma vuelve a YouTube desde su inicio.
    switchPlatform(album.crvYoutubeVideoIds?.includes(video.videoId) ? "crv_youtube" : "youtube");
    playVideo({ videoId: video.videoId, title, album: { id: album.id, title } }, `album-${album.id}`, seconds, true, videoTracks);
    setPlayback({ seconds, state: 3, albumId: album.id });
  };
  // Un solo disco sin nombre no lleva encabezado; con varios, o con nombre
  // («Lado A», «DVD»), cada lista va bajo el suyo.
  const showDiscHeadings = discGroups.length > 1 || (album.discs?.length ?? 0) > 0;

  const totalSeconds = album.tracklist.reduce((total, track) => total + (track.durationSeconds ?? 0), 0);
  const hasCompleteDuration = album.tracklist.length > 0 && album.tracklist.every((track) => track.durationSeconds !== null);
  const durationSummary = album.tracklist.some((track) => track.durationSeconds !== null) ? `${formatDuration(totalSeconds)}${hasCompleteDuration ? "" : " (parcial)"}` : null;
  const trackCount = `${album.tracklist.length} ${album.tracklist.length === 1 ? "pista" : "pistas"}`;

  return (
    <>
      <BackLink fallback="/discos" />

      {isAdmin ? <EntityAdminBar
        onEdit={() => { setArtistId(album.artist.id); setArtistLabel(album.artist.name); setEditing(true); }}
        onComplete={goToCompleteRecord}
        onMerge={() => setMergingAlbum(true)}
        onRemove={() => setDeleting(true)} /> : null}

      <p className="album-listening-title">Escuchar disco</p>
      <div className="album-listening-layout">
      <section className="album-profile" aria-label="Información del disco">
        {album.coverUrl ? <button type="button" className="entity-hero__art album-profile__image-button" aria-label={`Ampliar portada de ${album.title}`} onClick={() => setViewingCover(true)}>
          <img {...mediaImage(album.coverUrl, 440)} alt={`Portada de ${album.title}`} loading="eager" decoding="async" />
          <span className="album-profile__image-hint" aria-hidden="true"><ArrowsOutSimple size={16} /><span>Ampliar portada</span></span>
        </button> : <span className="entity-hero__art"><span className="placeholder">{initialOf(album.title)}</span></span>}
        <div>
          <h1 className="entity-hero__title"><Link to={`/discos/${album.id}`}>{album.title}</Link></h1>
          <p style={{ margin: "6px 0 0" }}>
            <Link to={`/artistas/${album.artist.id}`} style={{ fontWeight: 600, color: "var(--text)" }}>{album.artist.name}</Link>
          </p>
          <div className="entity-hero__meta">
            {album.releaseYear !== null ? <CatalogYear year={album.releaseYear} className="badge" /> : null}
            {album.albumType !== "other" || !albumClassificationBadges(album).length ? <Link to={`/discos?tipo=${album.albumType}`} className="badge">{albumTypeLabel(album.albumType)}</Link> : null}
            {albumClassificationBadges(album).map(badge => <Link key={badge.key} to={`/discos?tipo=${badge.key}`} className="badge">{badge.label}</Link>)}
            {album.genres?.length ? <CatalogGenres genres={album.genres} className="badge" /> : album.genre ? <span className="badge">{album.genre}{album.genreStatus === "pending" ? " (sin confirmar)" : ""}</span> : null}
            {album.genreByLaya ? <span className="badge badge--amber" title="Género principal elegido por Laya (último recurso). Solo visible con sesión iniciada.">Género por Laya</span> : null}
            {album.labels?.length ? album.labels.map((label) => (
              <Link key={`${label.organizationId}:${label.role}`} to={`/organizaciones/${label.organizationId}`} className="badge badge--violet"
                title={label.roleLabel}>{label.name}{label.role !== "label" ? ` (${label.roleLabel.toLowerCase()})` : ""}</Link>
            )) : album.label ? <Link to={`/organizaciones/${album.label.id}`} className="badge badge--violet">{album.label.name}</Link> : null}
          </div>
          {album.description ? <p className="entity-hero__desc">{album.description}</p> : null}
          <RewritePendingMark kind="album" id={album.id} onDone={reload} />
          <dl className="album-profile__facts">
            <div><dt><Record size={22} aria-hidden="true" />Sello discográfico</dt><dd>{album.labels?.some((label) => label.role === "label") ? album.labels.filter((label) => label.role === "label").map((label, index) => <Fragment key={label.organizationId}>{index > 0 ? ", " : ""}<Link to={`/organizaciones/${label.organizationId}`}>{label.name}</Link></Fragment>) : album.label ? <Link to={`/organizaciones/${album.label.id}`}>{album.label.name}</Link> : "Sin registrar"}</dd></div>
            <div><dt><CalendarBlank size={22} aria-hidden="true" />Año de lanzamiento</dt><dd>{album.releaseYear !== null ? <CatalogYear year={album.releaseYear} /> : "Sin registrar"}</dd></div>
            <div><dt><MusicNotes size={22} aria-hidden="true" />Género</dt><dd>{album.primaryGenre ? <CatalogGenres genres={[album.primaryGenre]} /> : album.genres?.length ? <CatalogGenres genres={album.genres} /> : album.genre ? `${album.genre}${album.genreStatus === "pending" ? " (sin confirmar)" : ""}` : "Sin registrar"}</dd></div>
            <div><dt><Clock size={22} aria-hidden="true" />{hasCompleteDuration ? "Duración total" : "Duración registrada"}</dt><dd>{durationSummary ? `${durationSummary} · ` : ""}{trackCount}</dd></div>
          </dl>
        </div>
      </section>

      <div className="album-listening-layout__content">
        <div ref={listenSection} className="listen-anchor">
          <AlbumListenPanel subject={`«${album.title}»`} links={album.platforms ?? []} tabs={listenTabs} active={listenPlatform} onChange={switchPlatform} hasVideo={Boolean(youtubeVideoId)}>
            {listenPlatform ? <>
            {listenPlatform === nativeYoutubePlatform && youtubeVideoId ? (
                <>
                  {multipleVideos ? (
                    <div className="album-disc-videos" role="group" aria-label="Video de cada disco">
                      {videoTabs.map((video) => {
                        const active = video.videoId === youtubeVideoId;
                        return (
                          <button key={video.videoId} type="button" className={`album-disc-video${active ? " is-active" : ""}`} aria-pressed={active}
                            onClick={() => playDisc(video)}>
                            <img src={`https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`} alt="" loading="lazy" decoding="async" />
                            <span><Play size={12} weight="fill" aria-hidden="true" />{tabLabel(video)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <AlbumYoutubePlayer key={album.id} ref={youtubePlayer} albumId={album.id} videoId={youtubeVideoId} title={playerTitle} tracks={videoTracks} onPlaybackChange={onPlaybackChange} />
                  <p className="album-youtube-current" role="status">
                    {currentTrack ? <>{playbackLabel}: <strong>{currentTrack.title}</strong></>
                      : currentPlayback?.state === 1 ? "Reproduciendo el disco."
                        : currentPlayback?.state === 2 ? "Reproducción en pausa."
                          : currentPlayback?.state === 3 ? "Cargando el video…"
                            : currentPlayback?.state === 0 ? "Reproducción finalizada."
                        : multipleVideos ? "Cada disco tiene su video: elige uno arriba o una pista para escucharla desde su inicio."
                        : "Elige una pista para escucharla desde su inicio."}
                  </p>
                </>
            ) : activeEmbed ? (
              <EmbedPanel embeddedVideo key={`${album.id}:${activeEmbed.platform}`} option={activeEmbed} subject={`«${album.title}»`}
                fullElsewhere={youtubeVideoId ? "youtube" : embeds.some((option) => option.platform === "youtube_music") ? "youtube_music" : null} />
            ) : null}
            </> : null}
          </AlbumListenPanel>
        </div>

      <section className="section album-tracks">
        <h2>
          <span>Lista de pistas</span>
          <span className="album-tracks__summary">{trackCount}{durationSummary ? ` · ${durationSummary}` : ""}</span>
          {isAdmin ? <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAddingTrack(true)}>+ Añadir pista</button> : null}
        </h2>
        {album.tracklist.length === 0 ? <p style={{ color: "var(--text-faint)", fontSize: 13.5 }}>Sin pistas registradas.</p> : (
          <div className="table-wrap table-wrap--scroll album-tracklist" tabIndex={0} role="region" aria-label="Pistas del disco">
            <table role="table" aria-label="Lista de pistas">
              <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col" className="num">#</th><th role="columnheader" scope="col">Título</th><th role="columnheader" scope="col" className="num">Duración</th><th role="columnheader" scope="col" className="num">Inicio en YouTube</th><th role="columnheader" scope="col"><span className="visually-hidden">Acciones</span></th></tr></thead>
              {discGroups.map((group) => (
              <tbody role="rowgroup" key={group.discNumber}>
                {showDiscHeadings ? (
                  <tr role="row" className="album-disc-heading">
                    <th role="columnheader" scope="colgroup" colSpan={5}>
                      {group.title}
                      <span className="album-disc-meta">{group.tracks.length === 0 ? "sin pistas registradas" : `${group.tracks.length} ${group.tracks.length === 1 ? "pista" : "pistas"}`}{group.totalSeconds ? ` · ${formatDuration(group.totalSeconds)}` : ""}</span>
                      {multipleVideos && videoOfDisc.get(group.discNumber) ? (() => {
                        const video = videoOfDisc.get(group.discNumber)!;
                        const active = video.videoId === youtubeVideoId && currentPlayback?.state === 1;
                        return (
                          <button type="button" className={`btn btn--sm album-disc-play${active ? " is-active" : ""}`}
                            aria-label={`Reproducir «${group.title}»`} onClick={() => playDisc(video)}>
                            <Play size={12} weight="fill" aria-hidden="true" />{active ? "Sonando" : "Reproducir"}
                          </button>
                        );
                      })() : null}
                      <PlatformLinks links={group.platforms} subject={`«${album.title}» · ${group.title}`} size="small" />
                    </th>
                  </tr>
                ) : null}
                {group.tracks.map((track) => {
                  const isCurrent = currentTrack?.id === track.id;
                  return (
                  <Fragment key={track.id}>
                    <tr id={`pista-${track.id}`} role="row" tabIndex={highlightedTrack === track.id ? -1 : undefined} className={`album-track-row${isCurrent ? " is-current" : ""}${highlightedTrack === track.id ? " is-target" : ""}`} aria-current={isCurrent ? "true" : undefined}>
                      <td role="cell" className="num album-track-number">{!showDiscHeadings && track.discNumber > 1 ? `${track.discNumber}.` : ""}{track.trackNumber}</td>
                      <td role="cell" className="album-track-title">
                        <span className="album-track-name">{track.title}</span>
                        {isCurrent ? <span className="track-playback-label">{playbackLabel}</span> : null}
                        {track.credits.length > 0 ? (
                          <button type="button" className="btn btn--sm btn--ghost track-credits-toggle"
                            onClick={() => setExpandedTrack(expandedTrack === track.id ? null : track.id)}>
                            {expandedTrack === track.id ? "ocultar créditos" : `créditos (${track.credits.length})`}
                          </button>
                        ) : null}
                        {track.hasLyrics ? (
                          <button type="button" className="btn btn--sm btn--ghost track-lyrics-toggle"
                            aria-expanded={letra?.id === track.id}
                            onClick={() => { void verLetra(track); }}>
                            {letra?.id === track.id ? "ocultar letra" : "letra"}
                          </button>
                        ) : null}
                      </td>
                      <td role="cell" className="num album-track-duration"><span className="album-track-duration-label">Duración </span>{formatDuration(track.durationSeconds)}</td>
                      <td role="cell" className="num album-track-start">
                        <span className="track-youtube-start">
                          <span className="track-youtube-time">{track.youtubeStartSeconds !== null ? formatDuration(track.youtubeStartSeconds) : "—"}</span>
                          {videoOfDisc.get(track.discNumber) && track.youtubeStartSeconds !== null && track.youtubeStartSeconds >= 0 ? (
                            <button type="button" className="btn btn--sm track-youtube-play"
                              aria-label={`Reproducir «${track.title}» desde ${formatDuration(track.youtubeStartSeconds)}`}
                              title={`Reproducir desde ${formatDuration(track.youtubeStartSeconds)}`}
                              onClick={() => {
                                const video = videoOfDisc.get(track.discNumber);
                                if (video && track.youtubeStartSeconds !== null) playDisc(video, track.youtubeStartSeconds);
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
                          {isAdmin?<EntityVerification kind="track" id={track.id} revision={album} onChanged={reload}/>:null}
                        </td>
                      </tr>
                    ) : null}
                    {letra?.id === track.id ? (
                      <tr role="row" className="album-track-lyrics">
                        <td role="cell" colSpan={5} style={{ background: "var(--surface-2)" }}>
                          {letra.cargando ? <p style={{ color: "var(--text-faint)", fontSize: 13.5 }}>Cargando letra…</p>
                            : letra.texto
                              ? <div className="track-lyrics-text">{letra.texto}</div>
                              : <p style={{ color: "var(--text-faint)", fontSize: 13.5 }}>Sin letra registrada.</p>}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                  );
                })}
              </tbody>
              ))}
            </table>
          </div>
        )}
      </section>

      </div>
      </div>

      {viewingCover && album.coverUrl ? <ImageViewer key={album.id} src={album.coverUrl} title={`Portada de ${album.title}`} onClose={() => setViewingCover(false)} /> : null}

      {isAdmin ? <CompleteRecord kind="album" id={album.id} name={album.title}><EntityVerification kind="album" id={album.id} revision={album} /></CompleteRecord> : null}

      {isAdmin || album.aliases.some((alias) => !alias.publicHidden) ? (
        <div className="section">
          <h2>Alias</h2>
          <AliasEditor path="albums" entityId={album.id} aliases={album.aliases} onChanged={reload} />
        </div>
      ) : null}

      {album.releaseDateValue || album.releaseDateText || album.catalogId || knownFormat(album.mediaFormat) ? (
        <section className="section">
          <h2>Detalles de la edición</h2>
          {album.releaseDateValue || album.releaseDateText || album.catalogId || knownFormat(album.mediaFormat) ? <dl className="album-edition-details">
            {album.releaseDateValue ? <div><dt>Fecha de publicación</dt><dd>{album.releaseYear !== null ? <CatalogYear year={album.releaseYear}>{formatDate(album.releaseDateValue)}</CatalogYear> : formatDate(album.releaseDateValue)}</dd></div> : null}
            {album.releaseDateText ? <div><dt>Fecha literal de la fuente</dt><dd>{album.releaseDateText}</dd></div> : null}
            {album.catalogId ? <div><dt>Número de catálogo</dt><dd>{album.catalogId}</dd></div> : null}
            {knownFormat(album.mediaFormat) ? <div><dt>Formato de la edición</dt><dd>{knownFormat(album.mediaFormat)}</dd></div> : null}
          </dl> : null}
        </section>
      ) : null}

      {isAdmin || album.series?.length ? (
        <section className="section">
          <h2>En esta serie</h2>
          {album.series?.length ? <SeriesLines series={album.series} /> : null}
          {isAdmin ? <AlbumSeriesEditor album={{ id: album.id, name: album.title }} onChanged={reload} /> : null}
        </section>
      ) : null}

      <div className="section">
        <h2>Créditos</h2>
        {isAdmin ? <>
          <div className="credit-groups">
            {CREDIT_SECTIONS.map((section) => (
              <div className="credit-group" key={section.title}>
                <h3>{section.title}</h3>
                <CreditManager target={{ kind: "album", albumId: album.id }} credits={section.types.flatMap((type) => album.creditsByType[type] ?? [])}
                  scoped={section.types.flatMap((type) => album.scopedCreditsByType[type] ?? [])} onChanged={reload} provenance={creditProvenance} />
              </div>
            ))}
          </div>
          <CreditStatements statements={album.creditStatements ?? []} />
        </> : <PublicCredits creditsByType={album.creditsByType} scopedByType={album.scopedCreditsByType} statements={album.creditStatements ?? []} />}
      </div>

      {(album.versions?.length ?? 0) > 0 ? (
        <div className="section">
          <h2>Versiones <span className="mono" style={{ color: "var(--text-faint)", fontWeight: 400 }}>({album.versions!.length})</span></h2>
          <AlbumVersions versions={album.versions!} coverUrl={album.coverUrl} />
        </div>
      ) : null}

      {/* «Unknown» no es un formato ni un estado de archivo que el público deba ver (plan v2, punto 10). */}
      {isAdmin || shownFormats.length ? <div className="section">
        <h2>
          Formatos
          {isAdmin ? <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAddingFormat(true)}>+ Añadir formato</button> : null}
        </h2>
        {shownFormats.length === 0 ? <p style={{ color: "var(--text-faint)", fontSize: 13.5 }}>Sin formatos registrados.</p> : (
          <ul style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {shownFormats.map((format) => (
              <li key={format.id} className="chip">
                <span>{format.format}</span>
                {format.quality ? <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{format.quality}</span> : null}
                {format.archiveStatus !== "unknown" ? <span className="badge" style={{ fontSize: 10 }}>{format.archiveStatus}</span> : null}
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
      </div> : null}

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

      <GenrePeriods kind="album" id={album.id}/>
      <EntityProvenance entity="album" id={album.id} revision={album} />
      <EntityHistory entity="album" id={album.id} />

      {isAdmin && editing ? (
        <EntityFormModal
          title={`Editar «${album.title}»`}
          fields={ALBUM_FIELDS}
          panels={[
            { key: "publishing", label: "Versiones y publicación", content: <AlbumPublishingEditor id={album.id} onChanged={reload}/> },
            { key: "model", label: "Obra y soportes", content: <CatalogModelPanel kind="album" id={album.id} onChanged={reload} artistId={album.artist.id} tracks={album.tracklist} /> },
            { key: "videos", label: "Videos de YouTube", content: <AlbumVideoEditor albumId={album.id} links={album.youtubeLinks} onChanged={reload} /> },
            { key: "genres", label: "Géneros", content: <GenreEditor kind="album" id={album.id} genres={album.genres ?? []} primaryGenre={album.primaryGenre ?? null} onChanged={reload} /> },
            { key: "streaming", label: "Escuchar en", content: <PlatformLinkEditor kind="album" id={album.id} category="streaming" onChanged={reload} /> },
          ]}
          wide
          entity={{kind:"album",id:album.id}}
          initialValues={entityFormValues(ALBUM_FIELDS, album)}
          extraChanges={artistId !== null && artistId !== album.artist.id ? [{ label: "Artista", before: album.artist.name, after: artistLabel ?? `#${artistId}` }] : []}
          extraFields={
            <>
              <EntityPicker kind="artist" label="Artista (atribución del disco)" value={artistId} valueLabel={artistLabel}
                onSelect={(pickedId, label) => { setArtistId(pickedId); setArtistLabel(label); }} />

            </>
          }
          onSubmit={(values, note) => albumWrites.update(album.id, {
            ...values,
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
          entity={{kind:"track",id:editingTrack.id}}
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

/** Pistas agrupadas por disco, con el nombre de `album_discs` o «Disco N» y sus enlaces propios. */
function groupTracksByDisc<T extends { discNumber: number; durationSeconds: number | null }>(
  tracks: readonly T[], discs: ReadonlyArray<{ discNumber: number; title: string | null; platforms?: PlatformLink[] }>,
): Array<{ discNumber: number; title: string; platforms: PlatformLink[]; tracks: T[]; totalSeconds: number }> {
  // Un disco con nombre y sin pistas también se muestra: la página dice que existe.
  const groups = new Map<number, T[]>(discs.map((disc) => [disc.discNumber, []]));
  for (const track of tracks) {
    const list = groups.get(track.discNumber);
    if (list) list.push(track); else groups.set(track.discNumber, [track]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([discNumber, list]) => {
    const disc = discs.find((item) => item.discNumber === discNumber);
    return {
      discNumber,
      title: disc?.title ?? `Disco ${discNumber}`,
      platforms: disc?.platforms ?? [],
      tracks: list,
      totalSeconds: list.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0),
    };
  });
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
