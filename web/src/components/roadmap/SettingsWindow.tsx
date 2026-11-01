// CRV · Ventana 3.12 «Configuración del proyecto» (B9 · C10).
//
// Configuración general (nombre, visibilidad, idioma por defecto y los tres
// interruptores) y tema del proyecto (textos, fuentes y los 14 colores).
// Solo administración total: el servidor lo exige igual (requireAdmin).
import { useEffect, useState } from "react";
import { FloppyDisk } from "@phosphor-icons/react";
import { projectApi, type ProjectConfig, type ProjectLang, type ProjectVisibility } from "../../lib/project";
import { identityApi, str, type IdentityData } from "../../lib/identity";
import { useToast } from "../../lib/ToastContext";
import { Modal } from "../Modal";

type Tab = "general" | "tema";

const VISIBILITY_OPTIONS: Array<{ value: ProjectVisibility; label: string; help: string }> = [
  { value: "hidden", label: "Ocultar la página (404)", help: "La página pública no existe para nadie." },
  { value: "progress", label: "Mostrar solo el progreso general", help: "Sin etapas ni actividades, solo el porcentaje." },
  { value: "completed", label: "Mostrar solo etapas y actividades finalizadas", help: "Lo que ya está hecho; las abiertas no se listan." },
  { value: "full", label: "Mostrar todas las etapas y su progreso", help: "El roadmap completo, con lo pendiente incluido." },
];

const THEME_TEXT_FIELDS: Array<[string, string, string]> = [
  ["heroTitleHtml", "Título principal (admite <br>)", "text"],
  ["heroSubPublic", "Subtítulo de portada", "textarea"],
  ["landingHeadline", "Título de la sección", "text"],
  ["footerNote", "Nota del pie", "text"],
  ["brandBadgeLetter", "Letra del logo", "text"],
  ["mainSiteUrl", "URL del sitio principal", "url"],
  ["mainSiteLabel", "Texto del sitio principal", "text"],
  ["youtubeUrl", "URL del canal de YouTube", "url"],
  ["youtubeLabel", "Texto del canal", "text"],
  ["googleFontsUrl", "URL de Google Fonts", "url"],
  ["fontTitle", "Fuente de títulos", "text"],
  ["fontBody", "Fuente de texto", "text"],
];

const COLOR_LABELS: Array<[string, string]> = [
  ["bg", "Fondo"], ["surface", "Superficie"], ["surface2", "Superficie 2"],
  ["red", "Rojo principal"], ["redDark", "Rojo oscuro"], ["white", "Blanco"], ["gray", "Gris"],
  ["border", "Borde"], ["accentRed", "Acento rojo"], ["accentAmber", "Acento ámbar"],
  ["accentViolet", "Acento violeta"], ["accentTeal", "Acento turquesa"],
];

export function SettingsWindow({ title, kicker, onClose, onSaved }: {
  title: string; kicker: string; onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>("general");
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [general, setGeneral] = useState({
    name: "", visibility: "completed" as ProjectVisibility, defaultLang: "es" as ProjectLang,
    acceptsApplications: true, showLogin: true, visitorCounter: true,
  });
  const [identity, setIdentity] = useState<IdentityData | null>(null);
  const [theme, setTheme] = useState<Record<string, string>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const [json, setJson] = useState("");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([projectApi.get(), identityApi.get()]).then(([project, ident]) => {
      if (!active) return;
      setConfig(project);
      setGeneral({
        name: project.name, visibility: project.visibility, defaultLang: project.defaultLang,
        acceptsApplications: project.acceptsApplications, showLogin: project.showLogin, visitorCounter: project.visitorCounter,
      });
      setIdentity(ident);
      const values: Record<string, string> = {};
      for (const [key] of THEME_TEXT_FIELDS) values[key] = str(ident.theme, key, str(ident.themeDefaults, key));
      setTheme(values);
      const palette = { ...(ident.themeDefaults["colors"] as Record<string, string> ?? {}) };
      const stored = ident.theme["colors"];
      if (stored && typeof stored === "object") {
        for (const [key, value] of Object.entries(stored as Record<string, string>)) palette[key] = value;
      }
      setColors(palette);
      setJson(JSON.stringify(ident.theme, null, 2));
    }).catch((error: unknown) => {
      notify("error", error instanceof Error ? error.message : "No se pudo cargar la configuración.");
    });
    return () => { active = false; };
  }, [notify]);

  async function guardarGeneral(): Promise<void> {
    setBusy(true);
    try {
      const updated = await projectApi.update(general);
      setConfig(updated);
      notify("success", "Configuración general guardada.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar la configuración.");
    } finally {
      setBusy(false);
    }
  }

  async function guardarTema(): Promise<void> {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { colors };
      for (const [key] of THEME_TEXT_FIELDS) {
        if (custom[key] || theme[key] !== str(identity?.themeDefaults ?? {}, key)) payload[key] = theme[key] ?? "";
      }
      const updated = await identityApi.saveTheme(payload);
      setIdentity(updated);
      setJson(JSON.stringify(updated.theme, null, 2));
      notify("success", "Tema guardado. La portada lo aplica en menos de un minuto.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar el tema.");
    } finally {
      setBusy(false);
    }
  }

  async function guardarJson(): Promise<void> {
    setBusy(true);
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(json); } catch { throw new Error("El JSON no es válido."); }
      const updated = await identityApi.saveTheme(parsed as Record<string, unknown>);
      setIdentity(updated);
      notify("success", "Tema guardado desde el JSON.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar el JSON.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} kicker={kicker} onClose={onClose} wide panelClassName="roadmap-admin__window">
      <div className="rw-window">
        <div className="rw-tabs" role="tablist" aria-label="Configuración">
          {([["general", "General"], ["tema", "Tema del proyecto"]] as Array<[Tab, string]>).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === "general" ? (
          <section className="rw-block" aria-label="CONFIGURACIÓN GENERAL">
            <h3>CONFIGURACIÓN GENERAL</h3>
            <div className="rw-textgrid">
              <label className="rw-field rw-field--wide"><span>Nombre del proyecto</span>
                <input value={general.name} maxLength={120} onChange={(event) => setGeneral({ ...general, name: event.target.value })} /></label>
              <label className="rw-field rw-field--wide"><span>Página pública del proyecto</span>
                <select value={general.visibility} onChange={(event) => setGeneral({ ...general, visibility: event.target.value as ProjectVisibility })}>
                  {VISIBILITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <small className="rw-original">{VISIBILITY_OPTIONS.find((option) => option.value === general.visibility)?.help}</small></label>
              <label className="rw-field"><span>Idioma por defecto</span>
                <select value={general.defaultLang} onChange={(event) => setGeneral({ ...general, defaultLang: event.target.value as ProjectLang })}>
                  <option value="es">Español</option>
                  <option value="en">Inglés</option>
                </select></label>
            </div>
            <div className="rw-checkcol">
              <label className="rw-check rw-check--line">
                <input type="checkbox" checked={general.acceptsApplications}
                  onChange={(event) => setGeneral({ ...general, acceptsApplications: event.target.checked })} />
                <span>Recibir candidaturas en /colaborar</span>
              </label>
              <label className="rw-check rw-check--line">
                <input type="checkbox" checked={general.showLogin}
                  onChange={(event) => setGeneral({ ...general, showLogin: event.target.checked })} />
                <span>Mostrar los botones «Entrar» a los visitantes</span>
              </label>
              <label className="rw-check rw-check--line">
                <input type="checkbox" checked={general.visitorCounter}
                  onChange={(event) => setGeneral({ ...general, visitorCounter: event.target.checked })} />
                <span>Mostrar el contador de visitas por país</span>
              </label>
            </div>
            <div className="rw-foot">
              <button type="button" className="btn btn--primary" onClick={() => void guardarGeneral()} disabled={busy || !config}>
                <FloppyDisk size={15} aria-hidden="true" /> {busy ? "Guardando…" : "Guardar configuración general"}
              </button>
            </div>
          </section>
        ) : null}

        {tab === "tema" ? (
          <>
            <section className="rw-block" aria-label="TEMA DEL PROYECTO">
              <h3>TEMA DEL PROYECTO</h3>
              <p className="rw-note">Marca «personalizar» para separar un campo de su valor de fábrica.</p>
              <div className="rw-textgrid">
                {THEME_TEXT_FIELDS.map(([key, label, kind]) => {
                  const isCustom = custom[key] === true || (identity !== null && theme[key] !== str(identity.themeDefaults, key));
                  return (
                    <div className={`rw-field${kind === "textarea" ? " rw-field--wide" : ""}`} key={key}>
                      <label className="rw-check"><input type="checkbox" checked={isCustom}
                        onChange={(event) => setCustom((previous) => ({ ...previous, [key]: event.target.checked }))} />
                        <span>personalizar</span></label>
                      {kind === "textarea" ? (
                        <textarea rows={2} value={theme[key] ?? ""} maxLength={1000} disabled={!isCustom}
                          aria-label={label} onChange={(event) => setTheme({ ...theme, [key]: event.target.value })} />
                      ) : (
                        <input value={theme[key] ?? ""} maxLength={1000} disabled={!isCustom} aria-label={label}
                          onChange={(event) => setTheme({ ...theme, [key]: event.target.value })} />
                      )}
                      <small className="rw-original">{label}</small>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rw-block" aria-label="COLORES">
              <h3>COLORES</h3>
              <div className="rw-colors">
                {COLOR_LABELS.map(([key, label]) => (
                  <label className="rw-color" key={key}>
                    <input type="color" value={/^#[0-9a-f]{6}$/iu.test(colors[key] ?? "") ? colors[key]! : "#000000"}
                      aria-label={label} onChange={(event) => setColors({ ...colors, [key]: event.target.value })} />
                    <span>{label}</span>
                    <input value={colors[key] ?? ""} maxLength={9}
                      onChange={(event) => setColors({ ...colors, [key]: event.target.value })} />
                  </label>
                ))}
              </div>
            </section>

            <section className="rw-block" aria-label="JSON AVANZADO">
              <button type="button" className="btn btn--sm" onClick={() => setJsonOpen(!jsonOpen)}>
                {jsonOpen ? "Ocultar JSON avanzado" : "Editar JSON avanzado"}
              </button>
              {jsonOpen ? (
                <>
                  <textarea className="rw-json" rows={10} value={json} onChange={(event) => setJson(event.target.value)}
                    aria-label="Tema en JSON" />
                  <button type="button" className="btn btn--sm" onClick={() => void guardarJson()} disabled={busy}>Guardar desde JSON</button>
                </>
              ) : null}
            </section>

            <div className="rw-foot">
              <button type="button" className="btn btn--primary" onClick={() => void guardarTema()} disabled={busy || !identity}>
                <FloppyDisk size={15} aria-hidden="true" /> {busy ? "Guardando…" : "Guardar tema"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
