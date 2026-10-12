import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CaretLeft, CaretRight, DiceFive, Play, Pause, ArrowSquareOut, YoutubeLogo, InstagramLogo } from "@phosphor-icons/react";
import { albumsApi, genresApi, homeApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { albumTypeLabel, artistTypeLabel } from "../lib/labels";
import type { DecadeFacets, GenreFacets, HomeAlbum, HomeData } from "../lib/types";
import { EntityCard, initialOf } from "./EntityCard";
import { PlatformLinks } from "./PlatformLinks";
import { VideoSlot, useVideoPlayer } from "./VideoPlayer";
import { CatalogGenres, CatalogYear } from "./CatalogMetadata";
import { Modal } from "./Modal";
import { ErrorState } from "./StateViews";

const numberFormat = new Intl.NumberFormat("es-VE");
const formatNumber = (value: number) => numberFormat.format(value);
const videoDate = new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** Familias de géneros que la portada ofrece como puerta de entrada. */
const GENRE_LIMIT = 12;
/** Portadas del muro del hero: bastan para cubrirlo sin cargar de más. */
const WALL_COVERS = 28;
/** Un video publicado hace menos de esto lleva la marca «Nuevo». */
const NEW_VIDEO_DAYS = 14;

/** Color de cada familia en el mosaico de géneros; las que no están rotan la paleta. */
const GENRE_HUES: Record<string, string> = {
  rock: "#e50914", folk: "#e8a33d", metal: "#8fa3b8", pop: "#f0629b", "fusion-latina": "#ff7a2f",
  electronica: "#2ec4d6", jazz: "#5b7cfa", punk: "#b6e03a", "hip-hop": "#b185e3",
  "musica-clasica": "#d9b56b", "urbano-latino": "#e04fd0", "funk-y-soul": "#f2913d",
};
const GENRE_FALLBACK_HUES = ["#2ec4b6", "#ffb02e", "#e86a5c", "#7fb069", "#c792ea", "#4fb3e0"];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Marca el elemento al entrar en pantalla (una sola vez): las secciones aparecen escalonadas. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || shown) return;
    if (!globalThis.IntersectionObserver) { setShown(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setShown(true); observer.disconnect(); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);
  return { ref, shown };
}

/** Cifra que sube desde cero al aparecer; sin animación si el sistema pide menos movimiento. */
function useCountUp(target: number, run: boolean, duration = 1400) {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) { setValue(target); return; }
    if (!run) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 4))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, run, reduced, duration]);
  return value;
}

/** Carruseles paginados: pausa al interactuar, salir de pantalla u ocultar la pestaña. */
function useRail({ onCycle, resetKey, enabled = true }: { onCycle?: () => void; resetKey?: string | number; enabled?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onCycle);
  callback.current = onCycle;
  const reduced = usePrefersReducedMotion();
  const [edges, setEdges] = useState({ start: true, end: true });
  const [interacting, setInteracting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [paused, setPaused] = useState(false);
  const measure = useCallback(() => {
    const node = ref.current;
    if (node) setEdges({ start: node.scrollLeft <= 4, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const node = ref.current;
    const section = node?.closest("section");
    if (!node || !section) return;
    let focused = false, touched = false;
    const update = () => setInteracting(focused || touched);
    const focus = (event: Event) => { focused = event.target instanceof HTMLElement && event.target.matches(":focus-visible"); update(); };
    const blur = (event: FocusEvent) => { if (!section.contains(event.relatedTarget as Node | null)) { focused = false; update(); } };
    const down = () => { touched = true; update(); };
    const up = () => { touched = false; update(); };
    const visibility = () => setPageVisible(!document.hidden);

    section.addEventListener("focusin", focus);
    section.addEventListener("focusout", blur);
    section.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    document.addEventListener("visibilitychange", visibility);
    node.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { threshold: .2 });
    observer.observe(section);
    measure();
    return () => {

      section.removeEventListener("focusin", focus); section.removeEventListener("focusout", blur);
      section.removeEventListener("pointerdown", down); window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up); document.removeEventListener("visibilitychange", visibility);
      node.removeEventListener("scroll", measure); resize.disconnect(); observer.disconnect();
    };
  }, [measure]);
  useEffect(() => { ref.current?.scrollTo({ left: 0, behavior: "instant" }); measure(); }, [resetKey, measure]);
  const scroll = (direction: 1 | -1) => {
    const node = ref.current;
    if (!node) return;
    const items = [...node.children] as HTMLElement[];
    const step = items.length > 1 ? items[1].offsetLeft - items[0].offsetLeft : node.clientWidth;
    const perPage = Math.max(1, Math.floor((node.clientWidth + 1) / step));
    const target = node.scrollLeft + direction * step * perPage;
    node.scrollTo({ left: Math.max(0, Math.min(node.scrollWidth - node.clientWidth, target)), behavior: reduced ? "instant" : "smooth" });
  };
  const advance = useRef(() => {});
  advance.current = () => {
    const node = ref.current;
    if (!node) return;
    if (node.scrollLeft + node.clientWidth >= node.scrollWidth - 4) {
      node.scrollTo({ left: 0, behavior: reduced ? "instant" : "smooth" });
      callback.current?.();
    } else scroll(1);
  };
  useEffect(() => {
    if (!enabled || reduced || paused || interacting || !visible || !pageVisible) return;
    const timer = window.setInterval(() => advance.current(), 7000);
    return () => window.clearInterval(timer);
  }, [enabled, reduced, paused, interacting, visible, pageVisible, resetKey]);
  return { ref, edges, measure, scroll, paused, togglePause: () => setPaused(value => !value), reduced };
}

function RailArrows({ rail, label }: { rail: ReturnType<typeof useRail>; label: string }) {
  return (
    <div className="home-arrows" role="group" aria-label={`Desplazar ${label}`}>
      {!rail.reduced ? <button type="button" className="home-arrow home-arrow--pause" onClick={rail.togglePause}
        aria-pressed={rail.paused} aria-label={`${rail.paused ? "Reanudar" : "Pausar"} avance automático de ${label}`}>
        {rail.paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
      </button> : null}
      {!(rail.edges.start && rail.edges.end) ? <>
        <button type="button" className="home-arrow" onClick={() => rail.scroll(-1)} disabled={rail.edges.start} aria-label="Página anterior">
          <CaretLeft size={18} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" className="home-arrow" onClick={() => rail.scroll(1)} disabled={rail.edges.end} aria-label="Página siguiente">
          <CaretRight size={18} weight="bold" aria-hidden="true" />
        </button>
      </> : null}
    </div>
  );
}

function railClass(rail: ReturnType<typeof useRail>, extra = "") {
  return `home-rail${extra}${rail.edges.start ? "" : " home-rail--fade-start"}${rail.edges.end ? "" : " home-rail--fade-end"}`;
}

/** Todas las portadas que la portada ya trae, sin repetir: alimentan el muro y el «Disco al azar». */
function homeAlbums(data: HomeData | undefined): HomeAlbum[] {
  if (!data) return [];
  const seen = new Set<number>();
  const albums: HomeAlbum[] = [];
  const add = (album: HomeAlbum | null | undefined) => {
    if (album && !seen.has(album.id)) { seen.add(album.id); albums.push(album); }
  };
  data.listen.forEach(add);
  add(data.featuredArtist?.album);
  // Intercalar los aniversarios para que el muro mezcle décadas.
  const longest = Math.max(0, ...data.anniversaries.map((group) => group.albums.length));
  for (let index = 0; index < longest; index++) data.anniversaries.forEach((group) => add(group.albums[index]));
  return albums;
}

/** Muro de portadas reales detrás del buscador, a sangre y en deriva lenta. */
function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function WallCover({ album }: { album: HomeAlbum }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => setPrevious(loaded), 250);
    return () => window.clearTimeout(timer);
  }, [loaded]);
  return <span className="home-wall__cover is-loaded">
    {previous ? <img className="home-wall__previous" src={previous} alt="" /> : null}
    <img key={album.coverUrl} className={`home-wall__current${loaded === album.coverUrl ? " is-loaded" : ""}`}
      src={album.coverUrl!} alt="" decoding="async" onLoad={() => { setLoaded(album.coverUrl); }} />
  </span>;
}

export function HomeBackdrop({ home, hidden }: { home: ReturnType<typeof useHomeData>; hidden: boolean }) {
  const pool = useMemo(() => (home.data?.wall ?? homeAlbums(home.data)).filter(album => album.coverUrl), [home.data]);
  const reduced = usePrefersReducedMotion();
  const [covers, setCovers] = useState<HomeAlbum[]>([]);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    setCovers(current => current.length && current.every(album => pool.some(item => item.id === album.id)) ? current : shuffled(pool).slice(0, WALL_COVERS));
  }, [pool]);
  useEffect(() => {
    if (hidden || !visible || reduced || pool.length <= covers.length) return;
    const timer = window.setInterval(() => setCovers(current => {
      const incoming = shuffled(pool.filter(album => !current.some(item => item.id === album.id)));
      const amount = Math.min([3, 4, 6][Math.floor(Math.random() * 3)], incoming.length, current.length);
      const positions = shuffled(current.map((_, index) => index)).slice(0, amount);
      const next = [...current];
      positions.forEach((position, index) => { next[position] = incoming[index]; });
      return next;
    }), 6500);
    return () => window.clearInterval(timer);
  }, [hidden, visible, reduced, pool, covers.length]);
  return <div className={`home-hero__backdrop${hidden ? " is-hidden" : ""}`} aria-hidden="true">
    <div className="home-wall">{covers.map((album, index) => <WallCover key={index} album={album} />)}</div>
    <span className="home-hero__glow" /><span className="home-hero__vignette" />
  </div>;
}

/** Cifras del catálogo bajo el buscador: cada una lleva a su listado, y un disco al azar para empezar. */
export function HomeStats({ stats, home }: { stats: HomeData["stats"] | undefined; home?: ReturnType<typeof useHomeData> }) {
  const navigate = useNavigate();
  const pool = useMemo(() => homeAlbums(home?.data), [home?.data]);
  if (!stats) return <div className="home-stats home-stats--loading" aria-hidden="true" />;
  const items: Array<{ value: number; label: string; to?: string }> = [
    { value: stats.artists, label: "artistas", to: "/artistas" },
    { value: stats.albums, label: "discos", to: "/discos" },
    { value: stats.tracks, label: "canciones" },
    { value: stats.persons, label: "personas", to: "/personas" },
  ];
  function surprise() {
    const album = pool[Math.floor(Math.random() * pool.length)];
    if (album) navigate(`/discos/${album.id}`);
  }
  return (
    <div className="home-stats-wrap">
      <ul className="home-stats">
        {items.map((item, index) => (
          <li key={item.label} className="home-stats__item" style={{ "--i": index } as CSSProperties}>
            {item.to ? <Link to={item.to}><Stat value={item.value} label={item.label} /></Link> : <span><Stat value={item.value} label={item.label} /></span>}
          </li>
        ))}
      </ul>
      <nav className="home-explore" aria-label="Explorar el archivo">
        <a href="#home-genres">Por género <ArrowRight size={14} aria-hidden="true" /></a>
        <a href="#home-decades">Por década <ArrowRight size={14} aria-hidden="true" /></a>
        <a href="#home-daily-routes">Descubre algo hoy <ArrowRight size={14} aria-hidden="true" /></a>
      </nav>
      <div className="home-hero__actions">
        {pool.length ? (
          <button type="button" className="home-surprise" onClick={surprise}>
            <DiceFive size={18} weight="fill" aria-hidden="true" className="home-surprise__icon" /> Disco al azar
          </button>
        ) : null}
        {stats.firstYear && stats.lastYear ? (
          <span className="home-hero__span">{stats.firstYear}–{stats.lastYear} · un siglo de música venezolana</span>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const shown = useCountUp(value, true);
  return (
    <>
      <strong className="home-stats__value" aria-hidden="true">{formatNumber(shown)}</strong>
      <span className="home-stats__label" aria-hidden="true">{label}</span>
      <span className="visually-hidden">{formatNumber(value)} {label}</span>
    </>
  );
}

export function useHomeData() {
  const home = useAsync((signal) => homeApi.get(signal), []);
  const date = useRef(home.data?.date);
  const checked = useRef(Date.now());
  const reload = home.reload;
  date.current = home.data?.date;
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      if (today !== date.current || Date.now() - checked.current >= 300_000) {
        checked.current = Date.now(); reload();
      }
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [reload]);
  return home;
}

/** Todo lo que la portada muestra bajo el buscador cuando no hay búsqueda. */
export function HomeSections({ home }: { home: ReturnType<typeof useHomeData> }) {
  const decades = useAsync(() => albumsApi.facets(), [home.data?.date]);
  const genres = useAsync((signal) => genresApi.facets("album", signal), [home.data?.date]);
  const data = home.data;
  if (home.error) return <div className="home"><ErrorState message={home.error} onRetry={home.reload} /></div>;
  return (
    <div className="home">
      {data && genres.data && decades.data ? <DailyRoutes data={data} genres={genres.data} decades={decades.data} /> : null}
      {data ? <Anniversaries key={`anniversaries-${data.date}`} groups={data.anniversaries} /> : <SectionSkeleton title="Cumplen años" />}
      {data?.featuredArtist ? <FeaturedArtist key={data.featuredArtist.id} artist={data.featuredArtist} /> : null}
      {data && data.listen.length ? <ListenNow key={`listen-${data.date}`} albums={data.listen} /> : null}
      {data ? <ChannelVideos videos={data.videos} today={data.date} channel={data.channel} /> : null}
      {genres.data ? <GenreDoors facets={genres.data} /> : null}
      {decades.data ? <DecadeTimeline facets={decades.data} /> : null}
      {data && data.labels.length ? <Labels labels={data.labels} /> : null}
      <HomeFooter />
    </div>
  );
}

function Section({ id, className = "", children, label }: { id: string; className?: string; children: (shown: boolean) => ReactNode; label?: string }) {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section ref={ref} className={`home-section home-reveal${shown ? " is-in" : ""} ${className}`} id={id} aria-labelledby={label ?? `${id}-title`}>
      {children(shown)}
    </section>
  );
}

function SectionHead({ id, kicker, title, lead, action }: { id?: string; kicker?: string; title: ReactNode; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="home-section__head">
      <div className="home-section__titles">
        {kicker ? <p className="home-kicker">{kicker}</p> : null}
        <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
        {lead ? <p className="home-section__lead">{lead}</p> : null}
      </div>
      {action ? <div className="home-section__action">{action}</div> : null}
    </div>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="home-section" aria-busy="true">
      <SectionHead title={title} />
      <div className="home-rail">
        {Array.from({ length: 6 }, (_, index) => <span key={index} className="home-rail__item home-skeleton skeleton" />)}
      </div>
    </section>
  );
}

/** Portada en su funda: al pasar el puntero el vinilo asoma hacia abajo. */
function AlbumSleeve({ album, index = 0 }: { album: HomeAlbum; index?: number }) {
  return (
    <div className="home-sleeve" style={{ "--i": index } as CSSProperties}>
      <span className="home-sleeve__vinyl" aria-hidden="true" />
      <EntityCard to={`/discos/${album.id}`} title={album.title} imageUrl={album.coverUrl} placeholder={initialOf(album.title)} genres={album.genres}
        albumMetadata={{ artist: album.artistName, artistId: album.artistId, year: album.releaseYear, type: albumTypeLabel(album.albumType), typeValue: album.albumType }} />
    </div>
  );
}

function Anniversaries({ groups }: { groups: HomeData["anniversaries"] }) {
  // Se abre en el aniversario más redondo que tenga discos: 50 antes que 40, etc.
  const preferred = [50, 30, 40, 60, 20, 10].find((years) => groups.some((group) => group.years === years));
  const [selected, setSelected] = useState(preferred ?? groups[0]?.years);
  const group = groups.find((item) => item.years === selected) ?? groups[0];
  const rail = useRail({ resetKey: selected, onCycle: () => {
    const index = groups.findIndex(item => item.years === selected);
    setSelected(groups[(index + 1) % groups.length]?.years);
  } });
  if (!group) return null;
  return (
    <Section id="home-anniversaries" className="home-anniversaries">
      {() => <>
        <div className="home-section__head">
          <div className="home-anniversaries__title">
            <span className="home-anniversaries__years" aria-hidden="true" key={group.years}>{group.years}</span>
            <div>
              <p className="home-kicker">Aniversarios</p>
              <h2 id="home-anniversaries-title">Cumplen {group.years} años</h2>
              <p className="home-section__lead">
                {formatNumber(group.total)} {group.total === 1 ? "disco salió" : "discos salieron"} en <CatalogYear year={group.releaseYear} />.
              </p>
            </div>
          </div>
          <div className="home-section__action">
            <div className="home-segments" role="group" aria-label="Elegir aniversario">
              {groups.map((item) => (
                <button key={item.years} type="button" className="home-segments__option" aria-pressed={item.years === group.years}
                  onClick={() => setSelected(item.years)}>
                  {item.years}<span className="visually-hidden"> años</span>
                </button>
              ))}
            </div>
            <RailArrows rail={rail} label="los discos del aniversario" />
          </div>
        </div>
        <div ref={rail.ref} className={railClass(rail)}>
          {group.albums.map((album, index) => (
            <div key={album.id} className="home-rail__item"><AlbumSleeve album={album} index={index} /></div>
          ))}
        </div>
      </>}
    </Section>
  );
}

function FeaturedArtist({ artist }: { artist: NonNullable<HomeData["featuredArtist"]> }) {
  const [failed, setFailed] = useState(false);
  const hasPicture = Boolean(artist.pictureUrl && !failed);
  return (
    <Section id="home-featured" className="home-featured">
      {() => <>
        {artist.album?.coverUrl ? <img className="home-featured__ambient" src={artist.album.coverUrl} alt="" aria-hidden="true" decoding="async" /> : null}
        <div className="home-featured__inner">
          <Link to={`/artistas/${artist.id}`} className="home-featured__media" aria-label={`Ver a ${artist.name}`}>
            {hasPicture
              ? <img src={artist.pictureUrl!} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
              : <span className="placeholder">{initialOf(artist.name)}</span>}
          </Link>
          <div className="home-featured__body">
            <p className="home-kicker home-kicker--live"><span className="home-kicker__dot" aria-hidden="true" />Artista del día</p>
            <h2 id="home-featured-title" className="home-featured__name"><Link to={`/artistas/${artist.id}`}>{artist.name}</Link></h2>
            <ul className="home-featured__meta">
              <li><Link to={`/artistas?tipo=${artist.artistType}`}>{artistTypeLabel(artist.artistType)}</Link></li>
              {artist.originCity ? <li>{artist.originCity}</li> : null}
              {artist.startYear ? <li>Desde <CatalogYear year={artist.startYear} kind="artist" /></li> : null}
              {artist.primaryGenre ? <li><CatalogGenres genres={[artist.primaryGenre]} kind="artist" /></li> : null}
              <li>{artist.albumCount} {artist.albumCount === 1 ? "disco" : "discos"}</li>
            </ul>
            <p className="home-featured__excerpt">{artist.excerpt}</p>
            <div className="home-featured__cta">
              <Link to={`/artistas/${artist.id}`} className="btn btn--primary home-cta">Conocer a {artist.name} <ArrowRight size={15} weight="bold" aria-hidden="true" /></Link>
            </div>

          </div>
          {artist.album ? (
            <div className="home-featured__album">
              <h3>Para empezar</h3>
              <AlbumSleeve album={artist.album} />
            </div>
          ) : null}
        {artist.similar.length ? (
              <div className="home-featured__similar">
                <h3>Si te gusta, prueba con</h3>
                <ul>
                  {artist.similar.map((item, index) => (
                    <li key={item.id} style={{ "--i": index } as CSSProperties}>
                      <Link to={`/artistas/${item.id}`} className="home-avatar">
                        <Avatar name={item.name} url={item.pictureUrl} />
                        <span>{item.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
        </div>
      </>}
    </Section>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="home-avatar__img" aria-hidden="true">
      {url && !failed ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : initialOf(name)}
    </span>
  );
}

/** Un disco para hoy, en el plato: la funda a la izquierda y el vinilo girando. */
function ListenNow({ albums }: { albums: HomeData["listen"] }) {
  const [index, setIndex] = useState(0);
  const album = albums[index % albums.length]!;
  const [coverFailed, setCoverFailed] = useState<number | null>(null);
  const hasCover = Boolean(album.coverUrl && coverFailed !== album.id);
  return (
    <Section id="home-listen" className="home-listen">
      {() => <>
        {hasCover ? <img key={`ambient-${album.id}`} className="home-listen__ambient" src={album.coverUrl!} alt="" aria-hidden="true" decoding="async" /> : null}
        <div className="home-listen__inner">
          <div className="home-turntable" key={album.id}>
            <span className="home-turntable__record" aria-hidden="true">
              <span className="home-turntable__label">
                {hasCover ? <img src={album.coverUrl!} alt="" decoding="async" /> : null}
              </span>
            </span>
            <Link to={`/discos/${album.id}`} className="home-turntable__sleeve" aria-label={`Ver el disco ${album.title}`}>
              {hasCover ? <img src={album.coverUrl!} alt="" decoding="async" onError={() => setCoverFailed(album.id)} />
                : <span className="placeholder">{initialOf(album.title)}</span>}
            </Link>
          </div>
          <div className="home-listen__body" aria-live="polite">
            <p className="home-kicker home-kicker--live"><Play size={11} weight="fill" aria-hidden="true" /> Escucha ahora</p>
            <h2 id="home-listen-title" className="home-listen__eyebrow">Un disco para hoy</h2>
            <p className="home-listen__title" key={`t-${album.id}`}><Link to={`/discos/${album.id}`}>{album.title}</Link></p>
            <p className="home-listen__artist"><Link to={`/artistas/${album.artistId}`}>{album.artistName}</Link></p>
            <p className="home-listen__meta"><CatalogYear year={album.releaseYear} /> · <Link to={`/discos?tipo=${album.albumType}`}>{albumTypeLabel(album.albumType)}</Link></p>
            {album.genres?.length ? <div className="home-listen__genres"><CatalogGenres genres={album.genres} /></div> : null}
            <PlatformLinks links={album.links} subject={album.title} showLabels />
            <div className="home-listen__controls">
              <Link to={`/discos/${album.id}`} className="btn btn--primary home-cta">Ver el disco <ArrowRight size={15} weight="bold" aria-hidden="true" /></Link>

            </div>
            {albums.length > 1 ? (
              <div className="home-listen__dots" role="group" aria-label="Discos de hoy">
                {albums.map((item, dot) => (
                  <button key={item.id} type="button" className="home-listen__dot" aria-pressed={dot === index % albums.length}
                    aria-label={`${item.title}, de ${item.artistName}`} onClick={() => setIndex(dot)} />
                ))}
              </div>
            ) : null}
          </div>
          {albums.length > 1 ? <button type="button" className="home-listen__next" onClick={() => setIndex(value => value + 1)}
            aria-label="Escuchar el siguiente disco recomendado" title="Siguiente disco">
            <CaretRight size={26} weight="bold" aria-hidden="true" />
          </button> : null}
        </div>
      </>}
    </Section>
  );
}

function ChannelVideos({ videos, today, channel }: { videos: HomeData["videos"]; today: string; channel: HomeData["channel"] }) {
  const player = useVideoPlayer();
  const rail = useRail();
  const checked = channel.checkedAt ? new Intl.DateTimeFormat("es-VE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Caracas" }).format(new Date(channel.checkedAt)) : null;
  return <Section id="home-videos">
    {() => <>
      <SectionHead id="home-videos" kicker="Desde el canal" title="Últimos videos en YouTube"
        lead={channel.stale ? "Mostramos la última información disponible. Estamos intentando actualizar el canal." : `Sincronizado con el canal${checked ? ` · actualizado a las ${checked}` : ""}.`}
        action={<RailArrows rail={rail} label="los videos" />} />
      <div ref={rail.ref} className={railClass(rail, " home-rail--wide")}>
        {!videos.length ? <p role="status">No se pudieron recuperar los videos. Puedes consultar las publicaciones en el canal.</p> : null}
        {videos.map((video, index) => <VideoCard key={video.videoId} video={video} today={today} index={index} onPlay={() => { player.play({ ...video, title: video.title ?? "Video del canal" }, "channel"); window.setTimeout(() => document.getElementById("channel-player")?.scrollIntoView({ block: "center", behavior: "instant" }), 100); }} />)}
      </div>
      <a className="home-more home-channel-link" href={`${channel.url}/videos`} target="_blank" rel="noreferrer">Ver el canal en YouTube <ArrowSquareOut size={16} aria-hidden="true" /></a>
      <div id="channel-player"><VideoSlot owner="channel" /></div>
    </>}
  </Section>;
}

function VideoCard({ video, today, index, onPlay }: { video: HomeData["videos"][number]; today: string; index: number; onPlay: () => void }) {
  const fallback = `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
  const [src, setSrc] = useState(video.thumbnailUrl ?? fallback);
  const date = video.publishedAt ? videoDate.format(new Date(video.publishedAt)) : null;
  const ageDays = video.publishedAt ? (Date.parse(`${today}T12:00:00Z`) - Date.parse(video.publishedAt)) / 86_400_000 : Infinity;
  return <div className="home-rail__item home-video" style={{ "--i": index } as CSSProperties}>
    <button type="button" className="home-video__open" onClick={onPlay} aria-label={`Reproducir ${video.title ?? "video del canal"}`}>
      <span className="home-video__thumb">
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => { if (src !== fallback) setSrc(fallback); }} />
        <span className="home-video__play" aria-hidden="true"><Play size={22} weight="fill" /></span>
        {ageDays >= 0 && ageDays <= NEW_VIDEO_DAYS ? <span className="home-video__new">Nuevo</span> : null}
      </span>
      <span className="home-video__title">{video.title ?? "Video del canal"}</span>
    </button>
    <span className="home-video__meta">{date}</span>
    <a className="home-video__youtube" href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer">Abrir desde YouTube <ArrowSquareOut size={13} aria-hidden="true" /></a>
  </div>;
}

function GenreDoors({ facets }: { facets: GenreFacets }) {
  const families = [...facets.families].filter((family) => family.count > 0)
    .sort((a, b) => b.count - a.count).slice(0, GENRE_LIMIT);
  if (!families.length) return null;
  const max = families[0]!.count;
  return (
    <Section id="home-genres">
      {() => <>
        <SectionHead id="home-genres" kicker="Explora" title="¿Qué quieres escuchar?"
          action={<Link to="/discos" className="home-more">Todos los discos <ArrowRight size={14} aria-hidden="true" /></Link>} />
        <ul className="home-genres">
          {families.map((family, index) => {
            const hue = GENRE_HUES[family.slug] ?? GENRE_FALLBACK_HUES[index % GENRE_FALLBACK_HUES.length]!;
            return (
              <li key={family.slug} className={index === 0 ? "home-genres__lead" : index === 1 ? "home-genres__wide" : undefined}
                style={{ "--hue": hue, "--i": index, "--share": `${Math.max(6, (family.count / max) * 100)}%` } as CSSProperties}>
                <Link to={`/discos?genero=${encodeURIComponent(family.slug)}`} className="home-genre">
                  <span className="home-genre__grooves" aria-hidden="true" />
                  <span className="home-genre__name">{family.name}</span>
                  <span className="home-genre__count">{formatNumber(family.count)} discos</span>
                  <span className="home-genre__share" aria-hidden="true" />
                  <ArrowRight className="home-genre__arrow" size={18} weight="bold" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </>}
    </Section>
  );
}

function DecadeTimeline({ facets }: { facets: DecadeFacets }) {
  const early = facets.decades.filter(item => item.decade < 1950);
  const rows = [
    ...(early.length ? [{ decade: null as number | null, count: early.reduce((sum, item) => sum + item.count, 0) }] : []),
    ...facets.decades.filter(item => item.decade >= 1950),
  ];
  const max = Math.max(...rows.map(row => row.count), 1);
  if (!rows.length) return null;
  return <Section id="home-decades" className="home-decades-section">
    {() => <>
      <SectionHead id="home-decades" kicker="Línea de tiempo" title="Viaja por las décadas" lead="Discos del catálogo por década. Elige una barra para explorar esa época." />
      <ol className="home-decades">
        {rows.map(row => <li key={row.decade ?? "early"}>
          <Link to={`/discos?decada=${row.decade ?? "antes-1950"}`} className="home-decades__item">
            <span className="home-decades__label">{row.decade === null ? "Antes de 1950" : String(row.decade)}</span>
            <span className="home-decades__value">{formatNumber(row.count)} <span>discos</span></span>
            <span className="home-decades__track" aria-hidden="true"><span className="home-decades__bar" style={{ height: `${(row.count / max) * 100}%` }} /></span>
          </Link>
        </li>)}
      </ol>
    </>}
  </Section>;
}

function Labels({ labels }: { labels: HomeData["labels"] }) {
  // La línea de actividad de cada sello se dibuja sobre el mismo eje para poder compararlos.
  const from = Math.min(...labels.map((label) => label.fromYear ?? Infinity));
  const to = Math.max(...labels.map((label) => label.toYear ?? -Infinity));
  const span = Number.isFinite(from) && Number.isFinite(to) && to > from ? to - from : null;
  return (
    <Section id="home-labels">
      {() => <>
        <SectionHead id="home-labels" kicker="Sellos" title="Las casas discográficas" action={<Link to="/organizaciones" className="home-more">Todas las organizaciones <ArrowRight size={14} aria-hidden="true" /></Link>} />
        <ul className="home-labels">
          {labels.map((label, index) => (
            <li key={label.id} style={{ "--i": index } as CSSProperties}>
              <Link to={`/organizaciones/${label.id}`} className="home-label">
                <Avatar name={label.name} url={label.pictureUrl} />
                <span className="home-label__body">
                  <span className="home-label__name">{label.name}</span>
                  <span className="home-label__meta">
                    {formatNumber(label.albumCount)} discos
                    {label.fromYear && label.toYear ? ` · ${label.fromYear}–${label.toYear}` : null}
                  </span>
                  {span && label.fromYear && label.toYear ? (
                    <span className="home-label__span" aria-hidden="true">
                      <span style={{ left: `${((label.fromYear - from) / span) * 100}%`, width: `${Math.max(3, ((label.toYear - label.fromYear) / span) * 100)}%` }} />
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </>}
    </Section>
  );
}


function DailyRoutes({ data, genres, decades }: { data: HomeData; genres: GenreFacets; decades: DecadeFacets }) {
  const day = Math.floor(Date.parse(`${data.date}T00:00:00Z`) / 86_400_000);
  const families = genres.families.filter(item => item.count > 0);
  const eras = decades.decades.filter(item => item.count > 0 && item.decade >= 1950);
  const genre = families[day % families.length], era = eras[day % eras.length], label = data.labels[0];
  return <Section id="home-daily-routes" className="home-daily-routes">
    {() => <>
      <SectionHead id="home-daily-routes" title="Por dónde empezar hoy" lead="Tres caminos para descubrir el archivo. Mañana, nuevas recomendaciones." />
      <div className="home-routes">
        {genre ? <Link to={`/discos?genero=${genre.slug}`}><span>Explora un sonido</span><strong>{genre.name}</strong><p>{formatNumber(genre.count)} discos de este género para descubrir.</p><ArrowRight size={20} aria-hidden="true" /></Link> : null}
        {era ? <Link to={`/discos?decada=${era.decade}`}><span>Vuelve a una época</span><strong>{era.decade}–{era.decade + 9}</strong><p>Recorre {formatNumber(era.count)} discos publicados en estos años.</p><ArrowRight size={20} aria-hidden="true" /></Link> : null}
        {label ? <Link to={`/organizaciones/${label.id}`}><span>Conoce un sello</span><strong>{label.name}</strong><p>Descubre sus {formatNumber(label.albumCount)} discos registrados en el archivo.</p><ArrowRight size={20} aria-hidden="true" /></Link> : null}
      </div>
    </>}
  </Section>;
}

function HomeFooter() {
  const [about, setAbout] = useState(false);
  const close = useCallback(() => setAbout(false), []);
  return <footer className="home-footer">
    <div><strong>Coleccionistas De Rock Venezolano</strong><p>Un archivo para descubrir y conservar la memoria musical de Venezuela.</p></div>
    <nav aria-label="Sobre el proyecto">
      <button type="button" onClick={() => setAbout(true)}>Sobre el archivo y sus fuentes</button>
      <a href="https://coleccionistasderockvenezolano.wordpress.com/" target="_blank" rel="noreferrer">Historias del archivo <ArrowSquareOut size={14} aria-hidden="true" /></a>
      <a href="https://www.instagram.com/coleccionistasderockvenezolano/" target="_blank" rel="noreferrer"><InstagramLogo size={18} aria-hidden="true" /> Contacto y aportes</a>
      <a href="https://www.youtube.com/channel/UCtYlrz6GyvRahlhHjocWQYQ" target="_blank" rel="noreferrer"><YoutubeLogo size={18} aria-hidden="true" /> Nuestro canal</a>
    </nav>
    {about ? <Modal title="Sobre el archivo" onClose={close}>
      <div className="home-about">
        <p>Coleccionistas De Rock Venezolano reúne fichas de artistas, personas, discos y sellos. El catálogo abarca rock y otros géneros de la música venezolana.</p>
        <h3>Cómo se construye</h3><p>La información se reúne y contrasta con fuentes musicales, discografías y publicaciones, entre ellas Sincopa, MusicBrainz, Discogs, nuestro blog y nuestro canal de YouTube. Las fichas pueden ampliarse y corregirse conforme aparece nueva información.</p>
        <h3>Recomendaciones diarias</h3><p>Cada día, según la fecha de Venezuela, cambia la selección de artistas, discos y recorridos. Los aniversarios respetan el año de publicación; los discos para escuchar tienen enlaces verificados. El canal se consulta automáticamente para mostrar sus publicaciones recientes.</p>
        <h3>Ayúdanos a completar el archivo</h3><p>¿Encontraste un dato incorrecto o tienes material para aportar? Escríbenos por Instagram y comparte el enlace de la ficha junto con la fuente que respalda tu aporte.</p>
        <a className="btn" href="https://www.instagram.com/coleccionistasderockvenezolano/" target="_blank" rel="noreferrer">Contactar por Instagram <ArrowSquareOut size={16} aria-hidden="true" /></a>
      </div>
    </Modal> : null}
  </footer>;
}
