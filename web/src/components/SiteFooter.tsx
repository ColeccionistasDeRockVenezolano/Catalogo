import { Link } from "react-router-dom";
import { ArrowSquareOut, InstagramLogo, YoutubeLogo } from "@phosphor-icons/react";
import { COMMUNITY_PAGES, CRV_CONTACT_URL } from "../lib/communityPages";
import "../styles/community.css";

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="container">
      <div className="site-footer__columns">
        <div className="site-footer__about">
          <Link to="/" className="site-footer__brand">Coleccionistas de Rock Venezolano</Link>
          <p>Preservamos la música y su historia para que el talento venezolano se conozca en todo el mundo.</p>
        </div>
        <nav aria-label="Ayuda y condiciones">
          <h2>Ayuda y condiciones</h2>
          {COMMUNITY_PAGES.map(page => <Link key={page.id} to={page.path}>{page.label}</Link>)}
        </nav>
        <nav aria-label="CRV en internet">
          <h2>Conecta con CRV</h2>
          <a href={CRV_CONTACT_URL} target="_blank" rel="noreferrer"><InstagramLogo size={18} aria-hidden="true" /> Contacto y aportes</a>
          <a href="https://www.youtube.com/channel/UCtYlrz6GyvRahlhHjocWQYQ" target="_blank" rel="noreferrer"><YoutubeLogo size={18} aria-hidden="true" /> Nuestro canal</a>
          <a href="https://coleccionistasderockvenezolano.wordpress.com/" target="_blank" rel="noreferrer">Historias del archivo <ArrowSquareOut size={14} aria-hidden="true" /></a>
        </nav>
      </div>
      <p className="site-footer__notice">Algunas portadas y contenidos pueden no ser aptos para menores de edad. <Link to="/terminos#menores">Lee el aviso de contenido y supervisión.</Link></p>
      <p className="site-footer__rights">Proyecto cultural sin fines de lucro. Las obras, imágenes y grabaciones pertenecen a sus respectivos titulares.</p>
    </div>
  </footer>;
}
