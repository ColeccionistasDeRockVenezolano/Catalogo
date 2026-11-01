import { useI18n } from "../lib/i18n";
import "../styles/language-switch.css";

/** Conmutador ES/EN del shell público y del panel. */
export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t("lang.label")}>
      <button type="button" className={lang === "es" ? "is-active" : ""} aria-pressed={lang === "es"} onClick={() => setLang("es")}>ES</button>
      <span aria-hidden="true">/</span>
      <button type="button" className={lang === "en" ? "is-active" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
    </div>
  );
}
