import { Link } from "react-router-dom";
import { ArrowSquareOut, InstagramLogo, YoutubeLogo } from "@phosphor-icons/react";
import { COMMUNITY_PAGES, CRV_CONTACT_URL } from "../lib/communityPages";
import { useI18n } from "../lib/i18n";
import { LanguageSwitch } from "./LanguageSwitch";
import "../styles/community.css";

export function SiteFooter() {
  const { t, lang } = useI18n();
  return <footer className="site-footer">
    <div className="container">
      <div className="site-footer__columns">
        <div className="site-footer__about">
          <Link to="/" className="site-footer__brand">{t("footer.aboutTitle")}</Link>
          <p>{t("footer.aboutText")}</p>
          <div className="site-footer__actions">
            <a href={`${import.meta.env.BASE_URL}colaborar`} className="site-footer__collaborate">{t("nav.collaborate")}</a>
            <a href={`${import.meta.env.BASE_URL}roadmap`} className="site-footer__collaborate">{t("nav.roadmap")}</a>
          </div>
        </div>
        <nav aria-label={t("footer.help")}>
          <h2>{t("footer.help")}</h2>
          {COMMUNITY_PAGES.map(page => <Link key={page.id} to={page.path}>{page.label}</Link>)}
        </nav>
        <nav aria-label={t("footer.connect")}>
          <h2>{t("footer.connect")}</h2>
          <a href={CRV_CONTACT_URL} target="_blank" rel="noreferrer"><InstagramLogo size={18} aria-hidden="true" /> {t("footer.contact")}</a>
          <a href="https://www.youtube.com/channel/UCtYlrz6GyvRahlhHjocWQYQ" target="_blank" rel="noreferrer"><YoutubeLogo size={18} aria-hidden="true" /> {t("footer.channel")}</a>
          <a href="https://coleccionistasderockvenezolano.wordpress.com/" target="_blank" rel="noreferrer">{t("footer.stories")} <ArrowSquareOut size={14} aria-hidden="true" /></a>
        </nav>
      </div>
      <p className="site-footer__notice">{t("footer.notice")} <Link to="/terminos#menores">{lang === "en" ? "Read the content notice and supervision." : "Lee el aviso de contenido y supervisión."}</Link></p>
      <p className="site-footer__rights">{t("footer.rights")}</p>
      <LanguageSwitch />
    </div>
  </footer>;
}
