import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { CaretDown } from "@phosphor-icons/react";
import { COMMUNITY_PAGES, type CommunityPageId } from "../lib/communityPages";
import { useMediaQuery } from "../lib/useMediaQuery";
import { COMMUNITY_CONTENT as content, type CommunitySection } from "./communityContent";

function entry(group: keyof typeof content, id: string): CommunitySection {
  const section = content[group].sections.find(item => item.id === id);
  if (!section) throw new Error(`Sección de comunidad inexistente: ${group}/${id}`);
  return section;
}

function Disclosure({ section, id }: { section: CommunitySection; id: string }) {
  return <details className="community-question" id={id}>
    <summary>{section.title}<CaretDown size={18} aria-hidden="true" /></summary>
    <div className="community-question__answer">{section.content}</div>
  </details>;
}

const documents: Record<CommunityPageId, { intro: string; sections: CommunitySection[] }> = {
  terms: {
    intro: "Nuestro compromiso con la memoria musical venezolana: uso del sitio, derechos de autor, aportes a la comunidad y contenido sensible.",
    sections: [
      entry("terms", "proyecto"),
      entry("terms", "uso"),
      { ...entry("terms", "obras"), id: "derechos-de-autor", title: "Derechos de autor y obras de terceros" },
      entry("terms", "aportes"),
      entry("copyright", "reclamos"),
      entry("terms", "menores"),
      entry("terms", "disponibilidad"),
      entry("copyright", "reutilizacion"),
      entry("terms", "moderacion"),
      entry("terms", "cambios"),
    ],
  },
  privacy: content.privacy,
  help: {
    intro: "Resuelve una duda, comparte una fuente o ayúdanos a cuidar el archivo. Aquí reunimos las preguntas frecuentes, las reglas y el contacto de CRV.",
    sections: [
      { id: "preguntas-frecuentes", title: "Preguntas frecuentes", content: <div className="community-questions">
        {["cuenta", "falta-artista", "reproduccion", "diario", "autor", "ideas", "menores"].map(id => <Disclosure key={id} section={entry("faq", id)} id={`faq-${id}`} />)}
      </div> },
      entry("help", "aportes"),
      { id: "reglas", title: "Reglas de la comunidad", content: <>
        <p>Documenta los datos con fuentes, comprueba las identidades y respeta a quienes participan. No inventes información, copies obras sin permiso ni publiques datos privados. No se permiten acoso, amenazas, discriminación, suplantación, spam ni contenido ilícito.</p>
        <div className="community-questions">{content.rules.sections.filter(section => section.id !== "alcance").map(section => <Disclosure key={section.id} section={section} id={section.id} />)}</div>
      </> },
      { ...entry("help", "archivo"), content: <>
        {entry("help", "archivo").content}
        <div className="community-questions">{["buscar", "escuchar"].map(id => <Disclosure key={id} section={entry("help", id)} id={id} />)}</div>
      </> },
      { id: "apoyar", title: "Cómo apoyar a CRV y a los músicos", content: <>
        {entry("support", "difundir").content}
        <p>Puedes aportar fuentes, avisar de errores o colaborar investigando, corrigiendo textos, mejorando la accesibilidad o desarrollando. <Link to="/ayuda#contacto">Cuéntanos cómo te gustaría participar</Link>. Una colaboración voluntaria no genera por sí sola salario ni propiedad; los encargos remunerados requieren acuerdo escrito.</p>
        {entry("support", "transparencia").content}
      </> },
      entry("help", "contacto"),
    ],
  },
};

export function CommunityPage({ pageId }: { pageId: CommunityPageId }) {
  const page = COMMUNITY_PAGES.find(item => item.id === pageId)!;
  const document = documents[pageId];
  const { hash } = useLocation();
  const desktop = useMediaQuery("(min-width: 761px)");
  const [indexOpen, setIndexOpen] = useState(false);

  useEffect(() => {
    const previous = window.document.title;
    window.document.title = `${page.label} · CRV`;
    setIndexOpen(false);
    return () => { window.document.title = previous; };
  }, [page.label]);

  useEffect(() => {
    if (!hash) return;
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = window.document.getElementById(id === "obras" ? "derechos-de-autor" : id);
    const disclosure = target?.closest("details");
    if (disclosure) disclosure.open = true;
    // Espera al contenido lazy y al cierre del índice móvil antes del salto.
    const frame = requestAnimationFrame(() => target?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [pageId, hash, indexOpen]);

  return <div className="community-page">
    <nav className="community-nav" aria-label="Páginas de la comunidad">
      {COMMUNITY_PAGES.map(item => <NavLink key={item.id} to={item.path}>{item.navLabel}</NavLink>)}
    </nav>
    <header className="community-page__header">
      <h1>{page.label}</h1>
      <p>{document.intro}</p>
      <p className="community-page__date">Última actualización: <time dateTime="2026-10-20">20 de octubre de 2026</time></p>
    </header>
    <div className="community-page__layout">
      <aside className="community-toc">
        <details className="community-index" open={desktop || indexOpen} onToggle={event => { if (!desktop) setIndexOpen(event.currentTarget.open); }}>
          <summary aria-disabled={desktop || undefined} onClick={event => { if (desktop) event.preventDefault(); }}>En esta página<CaretDown size={16} aria-hidden="true" /></summary>
          <nav aria-label="En esta página">
            <ul>{document.sections.map(section => <li key={section.id}><Link to={`${page.path}#${section.id}`} onClick={() => setIndexOpen(false)}>{section.title}</Link></li>)}</ul>
          </nav>
        </details>
      </aside>
      <article className="community-copy" aria-label={page.label}>
        {document.sections.map(section => <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          {section.content}
        </section>)}
        <p className="community-copy__contact">{pageId === "help" ? <Link to="/terminos">Consulta también los términos de uso</Link> : <Link to="/ayuda#contacto">¿Necesitas aclarar algo? Contacta con el equipo de CRV.</Link>}</p>
      </article>
    </div>
  </div>;
}
