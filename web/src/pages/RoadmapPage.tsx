// CRV · /roadmap — reproducción de la landing pública del roadmap.
//
// Mismos elementos que la portada: hero con radio, resumen general, etapas con
// paginación, proyecto, preguntas, apoyo, cierre y contador de visitas. Los
// datos salen del catálogo; la copia ES/EN replica la landing.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, ArrowSquareOut, Broadcast, CaretDown, CheckCircle, Circle,
  Clock, Coffee, HandHeart, Plus,
} from "@phosphor-icons/react";
import { RadioMiniPlayer, type RadioMiniCopy } from "../components/RadioMiniPlayer";
import { useI18n } from "../lib/i18n";
import { roadmapApi, type PublicCategory, type PublicRoadmap, type VisitStats } from "../lib/roadmap";
import { useAsync } from "../lib/useAsync";
import { ErrorState, LoadingState } from "../components/StateViews";
import "../styles/roadmap.css";

type Lang = "es" | "en";
type PageSize = number | "all";

interface Copy {
  badge: string; title1: string; title2: string; subtitle: string; collaborate: string; collaborateSub: string;
  radio: RadioMiniCopy;
  mapTitle: string; mapIntro: string; stagesActive: string; activities: string; collaborators: string;
  overall: string; upToDate: string; complete: string; completed: string; remaining: string;
  total: string; completedLabel: string; remainingLabel: string; stages: string; stagesRange: (a: number, b: number, n: number) => string;
  stagesPerPage: string; all: string; page: (n: number) => string; phase: string;
  completedWord: string; remainingWord: string; perPage: (n: number) => string; seeAll: string; noTasks: string;
  lastUpdated: string;
  projectTitle: string; projectText: string; projectLink: string; statusTitle: string; statusText: string;
  scopeTitle: string; scopeText: string;
  faqTitle: string; faqIntro: string; faqs: Array<{ q: string; a: string }>;
  supportKicker: string; supportTitle: string; supportText: string; coffee: string; coffeeText: string; findUs: string;
  closingKicker: string; closingTitle: string; closingText: string; collaborateCta: string;
  visits: { head: string; today: string; total: string; online: string; todayTitle: string; onlineTitle: string; totalTitle: string; empty: string };
}

const COPY: Record<Lang, Copy> = {
  es: {
    badge: "Archivo sonoro en vivo",
    title1: "CONSTRUYENDO EL",
    title2: "ARCHIVO DEL ROCK VENEZOLANO",
    subtitle: "Sigue en público cómo investigamos, digitalizamos y organizamos la memoria gráfica, sonora y audiovisual de la música venezolana, etapa por etapa.",
    collaborate: "Quiero colaborar",
    collaborateSub: "Presenta tu candidatura",
    radio: {
      live: "La emisión sigue activa", nowPlaying: "Ahora suena", upNext: "A continuación",
      join: "Entrar al aire", press: "El vivo sigue en marcha: pulsa para entrar.", paused: "En pausa",
      onAir: "En vivo", listening: (n) => `${n} escuchando`, cinema: "Modo cine", exitCinema: "Salir del modo cine",
      unavailable: "La radio no está disponible en este navegador.", loading: "Buscando la emisión…",
    },
    mapTitle: "MAPA DE TRABAJO",
    mapIntro: "Este mapa organiza el trabajo completo para convertir el archivo de CRV en una biblioteca digital abierta: investigación, catalogación, preservación, desarrollo de la plataforma y publicación de la memoria musical venezolana.",
    stagesActive: "Etapas activas", activities: "Actividades", collaborators: "Colaboradores",
    overall: "Resumen general", upToDate: "Al día", complete: "completado",
    completed: "completadas", remaining: "faltantes", total: "Total", completedLabel: "Completadas", remainingLabel: "Por completar",
    stages: "Etapas del roadmap", stagesRange: (a, b, n) => `${a}–${b} de ${n} etapas`,
    stagesPerPage: "Etapas por página", all: "Todas", page: (n) => `Página ${n}`, phase: "Fase",
    completedWord: "completadas", remainingWord: "por completar", perPage: (n) => `${n} por página`, seeAll: "Ver todas",
    noTasks: "Todavía no hay actividades en esta etapa.",
    lastUpdated: "Última actualización:",
    projectTitle: "Un archivo colaborativo para la memoria musical venezolana",
    projectText: "Coleccionistas De Rock Venezolano es una iniciativa independiente y sin fines de lucro dedicada a investigar, digitalizar, organizar y difundir la memoria gráfica, sonora y audiovisual de la música hecha en Venezuela. Nació de una colección personal iniciada en 2007 y se consolidó públicamente en 2015 con su canal de YouTube, impulsada por José Ignacio Morales y José Gregorio Albornoz.",
    projectLink: "Conoce la historia y el alcance del proyecto",
    statusTitle: "Estado actual",
    statusText: "La biblioteca digital todavía no está publicada. Esta página muestra el roadmap real del equipo: lo que ya se completó, lo que está en marcha y las próximas etapas de construcción.",
    scopeTitle: "Alcance del proyecto",
    scopeText: "El trabajo abarca rock y otros géneros de la escena venezolana, principalmente desde los años sesenta hasta 2010, con atención a materiales históricos, difíciles de encontrar o ausentes de las plataformas actuales.",
    faqTitle: "Preguntas sobre Coleccionistas De Rock Venezolano",
    faqIntro: "Respuestas claras sobre la iniciativa, su estado actual y cómo participar.",
    faqs: [
      { q: "¿Qué es Coleccionistas De Rock Venezolano?", a: "Es un proyecto independiente y colaborativo de preservación musical. Investiga, digitaliza, restaura, organiza y difunde materiales vinculados con el rock y otros géneros de la música venezolana." },
      { q: "¿La biblioteca digital ya está disponible?", a: "No. La plataforma definitiva todavía está en construcción. Por ahora, esta página permite seguir públicamente el avance del proyecto mediante su roadmap, con tareas terminadas, trabajo en curso y próximos pasos." },
      { q: "¿Qué materiales busca preservar el proyecto?", a: "Discos, grabaciones, portadas, artes internos, conciertos, videos musicales, entrevistas, documentales, afiches, material promocional y otras piezas que ayudan a documentar la historia musical de Venezuela." },
      { q: "¿Cómo puedo colaborar con el archivo?", a: "Puedes aportar conocimiento, material físico o digital, investigación, catalogación, redacción, restauración, diseño, desarrollo técnico o nuevas ideas. La candidatura se presenta desde el botón Quiero colaborar de esta misma página." },
    ],
    supportKicker: "CONECTA Y APOYA",
    supportTitle: "La memoria del rock venezolano se construye en comunidad",
    supportText: "Síguenos para descubrir hallazgos, historias y avances; o apoya directamente la conservación de este archivo.",
    coffee: "Cómpranos un café",
    coffeeText: "Tu aporte ayuda a conservar, investigar y compartir la memoria del rock venezolano.",
    findUs: "Encuéntranos en",
    closingKicker: "PARTICIPAR",
    closingTitle: "Esto se construye entre varias manos.",
    closingText: "Cada etapa de este roadmap salió de alguien que sabía algo: dónde estaba un disco, cómo se escribe un dato, qué falta por preguntar. No hace falta ser programador para que tu aporte cuente — hace falta conocimiento, archivo, oficio o una buena idea.",
    collaborateCta: "Quiero colaborar",
    visits: { head: "Visitas ONLINE", today: "Hoy", total: "Total", online: "En línea", todayTitle: "Visitantes de hoy", onlineTitle: "En línea ahora", totalTitle: "Visitantes históricos", empty: "Sin visitas registradas." },
  },
  en: {
    badge: "Live sound archive",
    title1: "BUILDING THE",
    title2: "VENEZUELAN ROCK ARCHIVE",
    subtitle: "Follow how we research, digitize and organize the graphic, sound and audiovisual memory of Venezuelan music, one stage at a time.",
    collaborate: "I want to help",
    collaborateSub: "Send your application",
    radio: {
      live: "The broadcast is still live", nowPlaying: "Now playing", upNext: "Up next",
      join: "Join live", press: "The broadcast is still on: press to join.", paused: "Paused",
      onAir: "On air", listening: (n) => `${n} listening`, cinema: "Cinema mode", exitCinema: "Exit cinema mode",
      unavailable: "Radio is not available in this browser.", loading: "Finding the broadcast…",
    },
    mapTitle: "WORK MAP",
    mapIntro: "This map organizes the complete work required to turn the CRV archive into an open digital library: research, cataloguing, preservation, platform development and publication of Venezuela’s musical memory.",
    stagesActive: "Active stages", activities: "Activities", collaborators: "Collaborators",
    overall: "Overall summary", upToDate: "Up to date", complete: "complete",
    completed: "completed", remaining: "remaining", total: "Total", completedLabel: "Completed", remainingLabel: "Remaining",
    stages: "Roadmap stages", stagesRange: (a, b, n) => `${a}–${b} of ${n} stages`,
    stagesPerPage: "Stages per page", all: "All", page: (n) => `Page ${n}`, phase: "Phase",
    completedWord: "completed", remainingWord: "remaining", perPage: (n) => `${n} per page`, seeAll: "See all",
    noTasks: "No activities in this stage yet.",
    lastUpdated: "Last updated:",
    projectTitle: "A collaborative archive for Venezuelan music memory",
    projectText: "Coleccionistas De Rock Venezolano is an independent, non-profit initiative devoted to researching, digitizing, organizing and sharing the graphic, sound and audiovisual memory of music made in Venezuela. It grew from a personal collection begun in 2007 and became a public project through its YouTube channel in 2015, led by José Ignacio Morales and José Gregorio Albornoz.",
    projectLink: "Read about the project’s history and scope",
    statusTitle: "Current status",
    statusText: "The digital library has not been published yet. This page shows the team’s real roadmap: what is complete, what is under way and the next stages of construction.",
    scopeTitle: "Project scope",
    scopeText: "The work covers rock and other genres from the Venezuelan scene, mainly from the 1960s through 2010, with particular attention to historical material that is hard to find or absent from current platforms.",
    faqTitle: "Questions about Coleccionistas De Rock Venezolano",
    faqIntro: "Clear answers about the initiative, its current status and how to take part.",
    faqs: [
      { q: "What is Coleccionistas De Rock Venezolano?", a: "It is an independent, collaborative music preservation project. It researches, digitizes, restores, organizes and shares material connected with rock and other genres of Venezuelan music." },
      { q: "Is the digital library available yet?", a: "No. The complete platform is still being built. For now, this page lets anyone follow the project through its public roadmap, including completed tasks, work in progress and next steps." },
      { q: "What material does the project seek to preserve?", a: "Records, recordings, cover art, booklets, concerts, music videos, interviews, documentaries, posters, promotional material and other pieces that help document the musical history of Venezuela." },
      { q: "How can I contribute to the archive?", a: "You can contribute knowledge, physical or digital material, research, cataloguing, writing, restoration, design, technical development or new ideas. Apply through the I want to help button on this page." },
    ],
    supportKicker: "CONNECT AND SUPPORT",
    supportTitle: "The memory of Venezuelan rock is built together",
    supportText: "Follow us for finds, stories and progress; or support the preservation of this archive directly.",
    coffee: "Buy us a coffee",
    coffeeText: "Your contribution helps preserve, research and share the memory of Venezuelan rock.",
    findUs: "Find us at",
    closingKicker: "GET INVOLVED",
    closingTitle: "This is built by many hands.",
    closingText: "Every stage of this roadmap came from someone who knew something: where a record was kept, how a detail is spelled, what still needs asking. You do not need to be a programmer for your contribution to count — you need knowledge, archives, craft or a good idea.",
    collaborateCta: "I want to help",
    visits: { head: "Visits ONLINE", today: "Today", total: "Total", online: "Online", todayTitle: "Visitors today", onlineTitle: "Online now", totalTitle: "Historic visitors", empty: "No visits recorded." },
  },
};

const SOCIALS = [
  ["YouTube", "https://youtube.com/@coleccionistasderockvenezolano"],
  ["Instagram", "https://www.instagram.com/coleccionistasderockvenezolano"],
  ["WordPress", "http://coleccionistasderockvenezolano.wordpress.com/"],
  ["Facebook", "https://www.facebook.com/coleccionistasderockvenezolano"],
  ["Threads", "https://www.threads.com/@coleccionistasderockvenezolano"],
  ["X", "https://x.com/rockvenezolano"],
  ["Correo", "mailto:coleccionistasderockvenezolano@outlook.com"],
] as const;

function stagePages(total: number, size: PageSize): number {
  return size === "all" ? 1 : Math.max(1, Math.ceil(total / size));
}

function rangeText(start: number, end: number, total: number, lang: Lang): string {
  return lang === "en" ? `${start}–${end} of ${total}` : `${start}–${end} de ${total}`;
}

function LandingStage({ category, index, copy, lang }: { category: PublicCategory; index: number; copy: Copy; lang: Lang }) {
  const [size, setSize] = useState<PageSize>(5);
  const [page, setPage] = useState(1);
  const tasks = category.tasks;
  const effective = size === "all" ? Math.max(1, tasks.length) : size;
  const pages = stagePages(tasks.length, size);
  const currentPage = Math.min(page, pages);
  const start = tasks.length === 0 ? 0 : (currentPage - 1) * effective;
  const visible = tasks.slice(start, start + effective);
  const completed = category.progress.completed;
  const remaining = Math.max(0, category.progress.total - completed);
  const pct = Math.round(category.progress.percentage);

  return (
    <article className={`landing-stage landing-stage--${category.colorKey}`} data-stage={category.slug}>
      <header className="landing-stage__head">
        <div>
          <span className={`landing-kicker landing-kicker--${category.colorKey}`}>{copy.phase} {String(index).padStart(2, "0")}</span>
          <h2>{category.title}</h2>
        </div>
        <div className="landing-stage__score"><strong>{pct}%</strong><span>{copy.complete}</span></div>
      </header>
      <div className="landing-stage__meta"><span>{completed} {lang === "en" ? `of ${category.progress.total} ${copy.completedWord}` : `de ${category.progress.total} ${copy.completedWord}`}</span><span>{remaining} {copy.remainingWord}</span></div>
      <div className="landing-bar"><i style={{ width: `${pct}%` }} /></div>
      <ul className="landing-task-list">
        {visible.map((task) => (
          <li key={task.id} className={`landing-task landing-task--${task.status}`}>
            {task.status === "completed" ? <CheckCircle size={17} weight="fill" /> : task.status === "in_progress" ? <Clock size={17} /> : <Circle size={17} />}
            <span>{task.title}</span>
            <em>{lang === "en" ? (task.status === "completed" ? "Completed" : task.status === "in_progress" ? "In progress" : "Pending") : (task.status === "completed" ? "Completada" : task.status === "in_progress" ? "En curso" : "Pendiente")}</em>
          </li>
        ))}
        {tasks.length === 0 ? <li className="landing-task landing-task--empty">{copy.noTasks}</li> : null}
      </ul>
      {tasks.length > 0 ? (
        <nav className="landing-task-pager" aria-label={`${copy.perPage(5)} ${category.title}`}>
          <select value={String(size)} onChange={(event) => { const value = event.target.value; setSize(value === "all" ? "all" : Number(value)); setPage(1); }} aria-label={copy.perPage(5)}>
            {[5, 10, 15, 20, 25].map((value) => <option key={value} value={value}>{copy.perPage(value)}</option>)}
            <option value="all">{copy.seeAll}</option>
          </select>
          <div>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1} aria-label="Anterior"><ArrowLeft size={14} /></button>
            <span>{rangeText(tasks.length === 0 ? 0 : start + 1, Math.min(start + effective, tasks.length), tasks.length, lang)}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={currentPage >= pages} aria-label="Siguiente"><ArrowRight size={14} /></button>
          </div>
        </nav>
      ) : null}
    </article>
  );
}

function VisitsWidget({ lang, copy }: { lang: Lang; copy: Copy }) {
  const visits = useAsync<VisitStats>(() => roadmapApi.visits(lang), [lang]);
  const stats = visits.data;
  const [tab, setTab] = useState<"today" | "online" | "total">("today");
  const [open, setOpen] = useState(false);
  const reloadVisits = visits.reload;
  useEffect(() => {
    const timer = window.setInterval(() => reloadVisits(), 30_000);
    return () => clearInterval(timer);
  }, [reloadVisits]);
  const flag = (code: string): string => {
    if (!/^[a-z]{2}$/u.test(code) || code === "zz") return "🌐";
    return String.fromCodePoint(...code.toUpperCase().split("").map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
  };

  const countries = tab === "today" ? stats?.todayCountries ?? [] : stats?.totalCountries ?? [];
  return (
    <aside className={`visits-widget${open ? "" : " is-collapsed"}`} aria-label="Contador de visitas del proyecto">
      <header>
        <span>{copy.visits.head} ({stats?.online ?? 0})</span>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? "Contraer visitas" : "Mostrar el contador de visitas"}><CaretDown size={15} /></button>
      </header>
      {open ? (
        <div className="visits-widget__body">
          <div className="visits-widget__totals">
            <div><span>{copy.visits.today}</span><strong>{stats?.today ?? 0}</strong></div>
            <div><span>{copy.visits.total}</span><strong>{stats?.total ?? 0}</strong></div>
          </div>
          <div className="visits-widget__online"><i aria-hidden="true" /><span>{copy.visits.online}</span><strong>{stats?.online ?? 0}</strong></div>
          <p className="visits-widget__title">{tab === "today" ? copy.visits.todayTitle : tab === "online" ? copy.visits.onlineTitle : copy.visits.totalTitle}</p>
          {tab === "online" ? <div className="visits-widget__empty">{stats?.online ? `${stats.online} ${copy.visits.online.toLowerCase()}` : copy.visits.empty}</div> : (
            <ul className="visits-widget__list">
              {countries.length === 0 ? <li className="visits-widget__empty">{copy.visits.empty}</li> : countries.map((country) => (
                <li key={country.code}><span>{flag(country.code)}</span><span>{country.name}</span><strong>{country.count}</strong></li>
              ))}
            </ul>
          )}
          <div className="visits-widget__tabs">
            {(["today", "online", "total"] as const).map((value) => (
              <button key={value} type="button" className={tab === value ? "is-active" : ""} onClick={() => setTab(value)} aria-label={value === "today" ? copy.visits.todayTitle : value === "online" ? copy.visits.onlineTitle : copy.visits.totalTitle}><i /></button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function RoadmapPage() {
  const { lang } = useI18n();
  const language: Lang = lang === "en" ? "en" : "es";
  const copy = COPY[language];
  const roadmap = useAsync<PublicRoadmap>(() => roadmapApi.public(language), [language]);
  const [stageSize, setStageSize] = useState<PageSize>(5);
  const [stagePage, setStagePage] = useState(1);

  if (roadmap.loading) return <div className="landing-roadmap"><LoadingState label="Cargando el roadmap…" /></div>;
  if (roadmap.error) return <div className="landing-roadmap"><ErrorState message={roadmap.error} onRetry={() => void roadmap.reload()} /></div>;
  const view = roadmap.data;
  if (!view) return null;

  const total = view.overall.total;
  const completed = view.overall.completed;
  const remaining = Math.max(0, total - completed);
  const pct = Math.round(view.overall.percentage);
  const pages = stagePages(view.categories.length, stageSize);
  const currentPage = Math.min(stagePage, pages);
  const effectiveStages = stageSize === "all" ? Math.max(1, view.categories.length) : stageSize;
  const stageStart = (currentPage - 1) * effectiveStages;
  const visibleStages = view.categories.slice(stageStart, stageStart + effectiveStages);
  const updated = view.lastUpdated ? new Date(`${view.lastUpdated.replace(" ", "T")}Z`) : null;
  const updatedText = updated ? new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-VE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Caracas" }).format(updated) : null;

  return (
    <div className="landing-roadmap">
      <section className="landing-hero" id="inicio">
        <div className="landing-hero__glow" aria-hidden="true" />
        <div className="landing-hero__inner">
          <div className="landing-hero__copy">
            <span className="landing-badge"><Broadcast size={15} /> {copy.badge}</span>
            <h1>{copy.title1}<br />{copy.title2}<span>.</span></h1>
            <p>{copy.subtitle}</p>
            <Link to="/colaborar" className="landing-collab"><span><HandHeart size={20} /></span><div><strong>{copy.collaborate}</strong><small>{copy.collaborateSub}</small></div><ArrowSquareOut size={16} /></Link>
          </div>
          <RadioMiniPlayer copy={copy.radio} />
        </div>
      </section>

      <section className="landing-section" id="roadmap">
        <header className="landing-map-head">
          <div><h2>{copy.mapTitle}</h2><p>{copy.mapIntro}</p></div>
          <dl>
            <div><dt>{copy.stagesActive}</dt><dd>{view.categories.length}</dd></div>
            <div><dt>{copy.activities}</dt><dd>{total}</dd></div>
            <div><dt>{copy.collaborators}</dt><dd>{view.collaborators}</dd></div>
          </dl>
        </header>

        <aside className="landing-overall" aria-label={copy.overall}>
          <div className="landing-overall__head"><span>{copy.overall}</span><span className="landing-live"><i aria-hidden="true" />{copy.upToDate}</span></div>
          <div className="landing-overall__num"><strong>{pct}%</strong><span>{copy.complete}</span></div>
          <div className="landing-overall__meta"><p>{completed} {copy.completed} · {remaining} {copy.remaining}</p><div className="landing-bar"><i style={{ width: `${pct}%` }} /></div></div>
          <dl><div><dt>{copy.total}</dt><dd>{total}</dd></div><div><dt>{copy.completedLabel}</dt><dd>{completed}</dd></div><div><dt>{copy.remainingLabel}</dt><dd>{remaining}</dd></div></dl>
        </aside>

        <nav className="landing-stages-pager" aria-label={copy.stages}>
          <div><strong>{copy.stages}</strong><span>{copy.stagesRange(view.categories.length === 0 ? 0 : stageStart + 1, Math.min(stageStart + effectiveStages, view.categories.length), view.categories.length)}</span></div>
          <div>
            <label>{copy.stagesPerPage}</label>
            <select value={String(stageSize)} onChange={(event) => { const value = event.target.value; setStageSize(value === "all" ? "all" : Number(value)); setStagePage(1); }}>
              {[5, 10, 15, 20].map((value) => <option key={value} value={value}>{value}</option>)}
              <option value="all">{copy.all}</option>
            </select>
            <button type="button" onClick={() => setStagePage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1} aria-label="Anterior"><ArrowLeft size={14} /></button>
            <span>{copy.page(currentPage)}</span>
            <button type="button" onClick={() => setStagePage((value) => Math.min(pages, value + 1))} disabled={currentPage >= pages} aria-label="Siguiente"><ArrowRight size={14} /></button>
          </div>
        </nav>

        <div className="landing-stages">
          {visibleStages.map((category, index) => <LandingStage key={category.id} category={category} index={stageStart + index} copy={copy} lang={language} />)}
        </div>
        {updatedText ? <p className="landing-updated">{copy.lastUpdated} {updatedText}</p> : null}
      </section>

      <section className="landing-section landing-project" id="proyecto">
        <div className="landing-project__lead">
          <h2>{copy.projectTitle}</h2>
          <p>{copy.projectText}</p>
          <a href="https://lapatilla.com/2026/08/24/venezolanos-crean-la-primera-biblioteca-independiente-digital-de-musica-nacional/" target="_blank" rel="noreferrer">{copy.projectLink} <ArrowSquareOut size={14} /></a>
        </div>
        <dl className="landing-project__notes">
          <div><dt>{copy.statusTitle}</dt><dd>{copy.statusText}</dd></div>
          <div><dt>{copy.scopeTitle}</dt><dd>{copy.scopeText}</dd></div>
        </dl>
      </section>

      <section className="landing-section landing-faq" id="preguntas">
        <div className="landing-faq__head"><h2>{copy.faqTitle}</h2><p>{copy.faqIntro}</p></div>
        <div className="landing-faq__list">
          {copy.faqs.map((item, index) => <details key={item.q} open={index === 0}><summary>{item.q}<Plus size={18} /></summary><p>{item.a}</p></details>)}
        </div>
      </section>

      <section className="landing-section landing-support" id="apoyo">
        <div className="landing-support__head"><span className="landing-kicker">{copy.supportKicker}</span><h2>{copy.supportTitle}</h2><p>{copy.supportText}</p></div>
        <div className="landing-support__donate"><a href="https://buymeacoffee.com/rockvenezolano" target="_blank" rel="noreferrer"><Coffee size={18} /> {copy.coffee}</a><p>{copy.coffeeText}</p></div>
        <div className="landing-support__social"><h3>{copy.findUs}</h3><ul>{SOCIALS.map(([label, href]) => <li key={label}><a href={href} target="_blank" rel="noreferrer">{label}</a></li>)}</ul></div>
      </section>

      <section className="landing-closing">
        <span className="landing-kicker">{copy.closingKicker}</span>
        <h2>{copy.closingTitle}</h2>
        <p>{copy.closingText}</p>
        <Link to="/colaborar" className="landing-button">{copy.collaborateCta} <ArrowRight size={16} /></Link>
      </section>

      <VisitsWidget lang={language} copy={copy} />
    </div>
  );
}
