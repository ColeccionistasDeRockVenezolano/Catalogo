// CRV · Curaduría › Ajustes del proyecto.
//
// Paridad con la configuración general de Herra: nombre, visibilidad del
// roadmap, idioma por defecto, candidaturas, acceso y contador de visitas.
// La escritura la valida también la API y exige administración total.
import { useState, type FormEvent } from "react";
import { projectApi, type ProjectConfig, type ProjectLang, type ProjectVisibility } from "../lib/project";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { useOperator } from "../lib/OperatorContext";
import { ErrorState, LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";

const VISIBILITY_LABEL: Record<ProjectVisibility, string> = {
  hidden: "Oculto: el roadmap responde 404.",
  progress: "Solo progreso: sin etapas ni actividades.",
  completed: "Completadas: solo actividades completadas.",
  full: "Completo: todas las etapas y actividades.",
};

export function CurationProjectPage() {
  const { notify } = useToast();
  const { isAdmin } = useOperator();
  const project = useAsync<ProjectConfig>(() => projectApi.get(), []);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!isAdmin) {
      notify("error", "Solo una cuenta de administración total puede guardar estos ajustes.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await projectApi.update({
        name: String(form.get("name") ?? "").trim(),
        visibility: String(form.get("visibility") ?? "completed") as ProjectVisibility,
        defaultLang: String(form.get("defaultLang") ?? "es") as ProjectLang,
        acceptsApplications: form.get("acceptsApplications") === "on",
        showLogin: form.get("showLogin") === "on",
        visitorCounter: form.get("visitorCounter") === "on",
      });
      notify("success", "Ajustes guardados.");
      project.reload();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudieron guardar los ajustes.");
    } finally {
      setBusy(false);
    }
  }

  if (project.loading) return <div className="community-page"><LoadingState label="Cargando los ajustes…" /></div>;
  if (project.error) return <div className="community-page"><ErrorState message={project.error} onRetry={() => void project.reload()} /></div>;
  const data = project.data;
  if (!data) return null;

  return (
    <div className="community-page">
      <div className="page-header">
        <div>
          <h1>Ajustes del proyecto</h1>
          <p className="hint">Gobiernan el roadmap y el sitio público. El cambio se aplica en la siguiente carga.</p>
        </div>
      </div>

      {!isAdmin ? (
        <div className="community-card community-notice" role="status">
          Estás viendo los ajustes en modo lectura. Solo administración total puede guardarlos.
        </div>
      ) : null}

      <form className="community-card community-form" onSubmit={(event) => void save(event)}>
        <div className="field span-2">
          <label htmlFor="project-name">Nombre del proyecto *</label>
          <input id="project-name" name="name" defaultValue={data.name} required maxLength={120} disabled={!isAdmin} />
          <span className="community-muted">Se usa en el panel y en los metadatos públicos.</span>
        </div>

        <div className="field span-2">
          <label htmlFor="project-visibility">Visibilidad del roadmap</label>
          <select id="project-visibility" name="visibility" defaultValue={data.visibility} disabled={!isAdmin}>
            {Object.entries(VISIBILITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span className="community-muted">El roadmap público aplica esta regla al leer la API.</span>
        </div>

        <div className="field">
          <label htmlFor="project-lang">Idioma por defecto</label>
          <select id="project-lang" name="defaultLang" defaultValue={data.defaultLang} disabled={!isAdmin}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="project-updated">Última modificación</label>
          <input id="project-updated" value={data.updatedAt ?? "—"} readOnly disabled />
        </div>

        <div className="field span-2">
          <label className="community-check">
            <input type="checkbox" name="acceptsApplications" defaultChecked={data.acceptsApplications} disabled={!isAdmin} />
            <span>Aceptar candidaturas desde <code>/colaborar</code></span>
          </label>
          <span className="community-muted">Si se desactiva, la API rechaza nuevos envíos con «Las candidaturas están cerradas».</span>
        </div>

        <div className="field span-2">
          <label className="community-check">
            <input type="checkbox" name="showLogin" defaultChecked={data.showLogin} disabled={!isAdmin} />
            <span>Mostrar «Entrar» en el roadmap</span>
          </label>
          <span className="community-muted">Solo controla el enlace público; no cambia las cuentas ni sus permisos.</span>
        </div>

        <div className="field span-2">
          <label className="community-check">
            <input type="checkbox" name="visitorCounter" defaultChecked={data.visitorCounter} disabled={!isAdmin} />
            <span>Mostrar el contador de visitas</span>
          </label>
          <span className="community-muted">Oculta el widget público y deja de latir en las páginas estáticas.</span>
        </div>

        <div className="span-2 community-actions">
          <button type="submit" className="btn btn--primary" disabled={busy || !isAdmin}>
            {busy ? "Guardando…" : "Guardar ajustes"}
          </button>
          <button type="button" className="btn" onClick={() => void project.reload()} disabled={busy}>Descartar cambios</button>
        </div>
      </form>
    </div>
  );
}
