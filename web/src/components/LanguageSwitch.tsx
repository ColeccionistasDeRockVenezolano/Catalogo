import { useI18n, type Lang } from "../lib/i18n";
import "../styles/language-switch.css";

const LANGS: readonly Lang[] = ["es", "en"];

/**
 * Conmutador de idioma, el mismo de Herra: toda la pastilla lleva al otro
 * idioma, se pulse donde se pulse. Las dos etiquetas solo dibujan en cuál se
 * está y a cuál se va.
 */
export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  const action = t("lang.switchTo");
  return (
    <button
      type="button"
      className="lang-switch"
      title={action}
      aria-label={`ES EN — ${action}`}
      onClick={() => setLang(lang === "es" ? "en" : "es")}
    >
      {LANGS.map((code) => (
        <span key={code} className={`lang-switch__opt${code === lang ? " is-active" : ""}`} lang={code} aria-hidden="true">
          {code.toUpperCase()}
        </span>
      ))}
    </button>
  );
}
