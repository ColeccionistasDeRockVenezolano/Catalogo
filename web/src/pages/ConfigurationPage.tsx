import { useEffect, useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import { Check, House, LockSimple, Palette, SignIn } from "@phosphor-icons/react";
import { useOperator } from "../lib/OperatorContext";
import { useSiteAppearance } from "../lib/SiteAppearanceContext";
import { useToast } from "../lib/ToastContext";
import { OperatorDialog } from "../components/OperatorSettings";
import type { CatalogTheme } from "../../../src/shared/site-appearance";

const THEMES: { id: CatalogTheme; name: string; description: string }[] = [
  { id: "current", name: "Actual", description: "El diseño original del catálogo: negro uniforme, superficies planas y acentos rojos." },
  { id: "charcoal", name: "Carbón", description: "Negro mate, luz tenue y carmesí. Paneles definidos y una lectura más clara para explorar y escuchar." },
  { id: "studio", name: "Estudio", description: "Grafito cálido y acentos champán. Portadas protagonistas, líneas finas y un acabado editorial más sereno." },
];

export function ConfigurationPage() {
  const { isAdmin, isChecking } = useOperator();
  const { appearance, loading, saving, error, refresh, save } = useSiteAppearance();
  const { notify } = useToast();
  const [draft, setDraft] = useState<CatalogTheme | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selected = draft ?? appearance?.catalogTheme ?? "current";
  const dirty = Boolean(appearance && selected !== appearance.catalogTheme);
  useEffect(() => { if (!isAdmin) { setDraft(null); setSaveError(null); } }, [isAdmin]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaveError(null);
    try { await save(selected); setDraft(null); notify("success", "Tema aplicado al catálogo para todos los visitantes."); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : "No se pudo guardar el tema. Inténtalo de nuevo."); }
  }

  if (isChecking) return <p role="status">Comprobando acceso…</p>;
  if (!isAdmin) return <div className="state-block access-block">
    <LockSimple size={32} aria-hidden="true" /><h1>Configuración</h1>
    <p>Esta sección requiere una cuenta administradora.</p>
    <button type="button" className="btn" onClick={() => setSigningIn(true)}><SignIn size={18} />Iniciar sesión</button>
    {signingIn ? <OperatorDialog onClose={() => setSigningIn(false)} /> : null}
  </div>;

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar" aria-label="Configuración">
        <h1>Configuración</h1>
        <nav aria-label="Secciones de configuración"><NavLink to="/configuracion/temas"><Palette size={20} aria-hidden="true" />Temas</NavLink></nav>
      </aside>
      <section className="settings-content" aria-labelledby="settings-themes-title">
        <h2 id="settings-themes-title">Temas del catálogo</h2>
        <p className="settings-intro">Elige la apariencia de las fichas, listas y secciones del catálogo. Se aplicará a todos los visitantes.</p>
        <div className="settings-home-note"><House size={22} aria-hidden="true" /><div><strong>Home conserva su diseño</strong><p>Su fondo, colores, cajas y composición permanecen iguales con cualquier tema.</p></div></div>
        {error ? <div className="form-error" role="alert">No se pudo actualizar la configuración. {error}<button type="button" className="btn btn--sm" onClick={() => void refresh()}>Reintentar</button></div> : null}
        {loading ? <p role="status">Cargando tema del sitio…</p> : null}
        <form onSubmit={(event) => void submit(event)}>
          <fieldset className="theme-options" disabled={loading || saving || !appearance}>
            <legend className="visually-hidden">Tema para todos los visitantes</legend>
            {THEMES.map((theme) => <label key={theme.id} className={`theme-option${selected === theme.id ? " is-selected" : ""}`}>
              <input type="radio" name="catalog-theme" value={theme.id} checked={selected === theme.id} onChange={() => { setDraft(theme.id); setSaveError(null); }} />
              <span className={`theme-preview theme-preview--${theme.id}`} aria-hidden="true"><span className="theme-preview__cover"><span className="theme-preview__disc" /></span><span className="theme-preview__content"><span /><span /><span /></span></span>
              <span className="theme-option__heading"><strong>{theme.name}</strong>{appearance?.catalogTheme === theme.id ? <span className="theme-active"><Check size={14} aria-hidden="true" />En uso</span> : null}</span>
              <span className="theme-option__description">{theme.description}</span>
            </label>)}
          </fieldset>
          {saveError ? <p className="form-error" role="alert">{saveError}</p> : null}
          <div className="theme-save"><button type="submit" className="btn btn--primary" disabled={!dirty || saving || !appearance}>{saving ? "Aplicando tema…" : "Aplicar tema al catálogo"}</button><p role="status">{dirty ? "Tienes un cambio pendiente de aplicar." : appearance ? `Tema ${THEMES.find((theme) => theme.id === appearance.catalogTheme)?.name} aplicado.` : ""}</p></div>
        </form>
      </section>
    </div>
  );
}
