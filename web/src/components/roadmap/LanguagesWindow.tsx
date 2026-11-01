// CRV · Ventana 3.11 «Idiomas del proyecto» (B9 · C11).
//
// La interfaz ya está traducida; aquí se traducen los textos del proyecto, los
// del formulario de colaboración y los títulos del roadmap. Lo que se deje
// vacío se publica en español. Se guarda en `auth.projects.i18n_json.en`
// (claves `collab.*` incluidas) y en `i18n_json` de cada etapa y actividad.
import { useEffect, useMemo, useState } from "react";
import { FloppyDisk, Trash } from "@phosphor-icons/react";
import { identityApi, str, type IdentityData } from "../../lib/identity";
import { communityApi, type CollaborateForm } from "../../lib/community";
import { roadmapApi, type AdminRoadmap } from "../../lib/roadmap";
import { useToast } from "../../lib/ToastContext";
import { Modal } from "../Modal";
import { ConfirmDialog } from "../ConfirmDialog";

type Tab = "proyecto" | "formulario" | "roadmap";

const PROJECT_KEYS: Array<[string, string]> = [
  ["metaTitle", "Título de la página"],
  ["metaDescription", "Descripción de la página"],
  ["keywords", "Palabras clave"],
  ["ogTitle", "Titular al compartir"],
  ["ogDescription", "Descripción al compartir"],
  ["imageAlt", "Texto alternativo de la imagen"],
  ["aboutTitle", "Título de presentación"],
  ["aboutDescription", "Descripción del proyecto"],
  ["aboutStatus", "Estado actual"],
  ["aboutScope", "Alcance"],
  ["aboutSourceLabel", "Texto de la fuente"],
  ["faqTitle", "Título de preguntas frecuentes"],
  ["faq1Question", "Pregunta 1"], ["faq1Answer", "Respuesta 1"],
  ["faq2Question", "Pregunta 2"], ["faq2Answer", "Respuesta 2"],
  ["faq3Question", "Pregunta 3"], ["faq3Answer", "Respuesta 3"],
  ["faq4Question", "Pregunta 4"], ["faq4Answer", "Respuesta 4"],
  ["supportKicker", "Antetítulo de redes"],
  ["supportTitle", "Título de redes"],
  ["supportSub", "Texto de redes"],
  ["donationLabel", "Texto del botón de donación"],
  ["donationNote", "Nota de la donación"],
  ["heroTitleHtml", "Titular de portada"],
  ["heroSubPublic", "Entrada de portada"],
  ["landingHeadline", "Título de la sección"],
  ["footerNote", "Nota del pie"],
  ["name", "Nombre del proyecto"],
];

const FORM_STEPS: Array<[string, string]> = [
  ["about", "Sobre ti"], ["skills", "Qué sabes hacer"], ["contribution", "Cómo quieres aportar"],
  ["ideas", "Propón algo"], ["review", "Revisión y envío"],
];

export function LanguagesWindow({ title, kicker, onClose, onSaved }: {
  title: string; kicker: string; onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>("proyecto");
  const [identity, setIdentity] = useState<IdentityData | null>(null);
  const [form, setForm] = useState<CollaborateForm | null>(null);
  const [roadmap, setRoadmap] = useState<AdminRoadmap | null>(null);
  const [en, setEn] = useState<Record<string, string>>({});
  const [categoryEn, setCategoryEn] = useState<Record<string, string>>({});
  const [taskEn, setTaskEn] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [vaciar, setVaciar] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([identityApi.get(), communityApi.collaborateForm(), roadmapApi.admin()]).then(([ident, config, admin]) => {
      if (!active) return;
      setIdentity(ident);
      setForm(config.form);
      setRoadmap(admin);
      const translations = (ident.i18n["en"] ?? {}) as Record<string, string>;
      setEn(translations);
      setCategoryEn(Object.fromEntries(admin.categories.map((category) => [String(category.id), category.i18n.en ?? ""])));
      const tasks: Record<string, string> = {};
      for (const category of admin.categories) for (const task of category.tasks) tasks[String(task.id)] = task.i18n.en ?? "";
      setTaskEn(tasks);
    }).catch((error: unknown) => {
      notify("error", error instanceof Error ? error.message : "No se pudieron cargar los idiomas.");
    });
    return () => { active = false; };
  }, [notify]);

  const originals = useMemo(() => {
    if (!identity) return {} as Record<string, string>;
    const theme = identity.theme;
    const branding = identity.branding;
    const pick = (source: Record<string, unknown>, key: string) => str(source, key, str(identity.themeDefaults, key, str(identity.brandingDefaults, key)));
    return {
      metaTitle: pick(branding, "metaTitle"), metaDescription: pick(branding, "metaDescription"), keywords: pick(branding, "keywords"),
      ogTitle: pick(branding, "ogTitle"), ogDescription: pick(branding, "ogDescription"), imageAlt: pick(branding, "imageAlt"),
      aboutTitle: pick(branding, "aboutTitle"), aboutDescription: pick(branding, "aboutDescription"),
      aboutStatus: pick(branding, "aboutStatus"), aboutScope: pick(branding, "aboutScope"),
      aboutSourceLabel: pick(branding, "aboutSourceLabel"), faqTitle: pick(branding, "faqTitle"),
      faq1Question: pick(branding, "faq1Question"), faq1Answer: pick(branding, "faq1Answer"),
      faq2Question: pick(branding, "faq2Question"), faq2Answer: pick(branding, "faq2Answer"),
      faq3Question: pick(branding, "faq3Question"), faq3Answer: pick(branding, "faq3Answer"),
      faq4Question: pick(branding, "faq4Question"), faq4Answer: pick(branding, "faq4Answer"),
      supportKicker: pick(branding, "supportKicker"), supportTitle: pick(branding, "supportTitle"),
      supportSub: pick(branding, "supportSub"),
      donationLabel: str((branding["donation"] ?? {}) as Record<string, unknown>, "label", "Apoya el proyecto"),
      donationNote: str((branding["donation"] ?? {}) as Record<string, unknown>, "note"),
      heroTitleHtml: pick(theme, "heroTitleHtml"), heroSubPublic: pick(theme, "heroSubPublic"),
      landingHeadline: pick(theme, "landingHeadline"), footerNote: pick(theme, "footerNote"),
      name: "",
    } as Record<string, string>;
  }, [identity]);

  const formTexts = useMemo(() => {
    if (!form) return [] as Array<[string, string, string]>;
    const rows: Array<[string, string, string]> = [
      ["collab.submitLabel", "Botón de envío", form.submitLabel],
      ["collab.sentTitle", "Título al enviar", form.sentTitle],
      ["collab.sentBody", "Texto al enviar", form.sentBody],
      ["collab.nextStepsTitle", "Título de qué pasa después", form.nextStepsTitle],
      ["collab.heroBadge", "Antetítulo de portada", form.heroBadge],
      ["collab.heroSub", "Entrada de portada", form.heroSub],
    ];
    for (const [key, label] of FORM_STEPS) rows.push([`collab.steps.${key}`, `Paso: ${label}`, form.steps[key] ?? ""]);
    for (const [key, label] of [["firstName", "Nombre"], ["lastName", "Apellido"], ["birthDate", "Fecha de nacimiento"], ["whatsappPhone", "WhatsApp"], ["email", "Correo"], ["contactPreference", "Preferencia de contacto"], ["city", "Ciudad"], ["country", "País"], ["skills", "Habilidades"], ["experience", "Experiencia"], ["links", "Enlaces"], ["areas", "Áreas de aporte"], ["contributionText", "Qué quieres aportar"], ["availability", "Disponibilidad"], ["idea", "Idea"], ["ideaReason", "Por qué"], ["wantsToImplement", "Participar"]] as Array<[string, string]>) {
      rows.push([`collab.labels.${key}`, `Etiqueta: ${label}`, form.labels[key] ?? ""]);
    }
    for (const [key, label] of [["birthDate", "Aviso de fecha"], ["contact", "Aviso de contacto"], ["links", "Aviso de enlaces"], ["ideas", "Aviso de ideas"]] as Array<[string, string]>) {
      rows.push([`collab.helps.${key}`, label, form.helps[key] ?? ""]);
    }
    for (const [key, label] of [["whatsappPhone", "Ejemplo de WhatsApp"], ["experience", "Ejemplo de experiencia"], ["contributionText", "Ejemplo de aporte"], ["availability", "Ejemplo de disponibilidad"]] as Array<[string, string]>) {
      rows.push([`collab.placeholders.${key}`, label, form.placeholders[key] ?? ""]);
    }
    rows.push(["collab.pillars", "Pilares (separados por comas)", form.pillars.join(", ")]);
    rows.push(["collab.nextSteps", "Qué pasa después (una línea por paso)", form.nextSteps.join("\n")]);
    return rows;
  }, [form]);

  async function guardarProyecto(): Promise<void> {
    if (!identity) return;
    setBusy(true);
    try {
      const cleaned = Object.fromEntries(Object.entries(en).filter(([, value]) => value.trim() !== ""));
      const updated = await identityApi.saveI18n({ ...identity.i18n, en: cleaned });
      setIdentity(updated);
      setEn((updated.i18n["en"] ?? {}) as Record<string, string>);
      notify("success", "Traducciones guardadas. La portada en inglés las aplica en menos de un minuto.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudieron guardar las traducciones.");
    } finally {
      setBusy(false);
    }
  }

  async function guardarRoadmap(): Promise<void> {
    setBusy(true);
    try {
      const categories: Record<string, { en: string }> = {};
      for (const [id, value] of Object.entries(categoryEn)) categories[id] = { en: value.trim() };
      const tasks: Record<string, { en: string }> = {};
      for (const [id, value] of Object.entries(taskEn)) tasks[id] = { en: value.trim() };
      const result = await roadmapApi.saveTranslations({ categories, tasks });
      setRoadmap(result.roadmap);
      notify("success", `Etapas traducidas: ${result.categories} · actividades: ${result.tasks}.`);
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudieron guardar los títulos.");
    } finally {
      setBusy(false);
    }
  }

  async function vaciarTodo(): Promise<void> {
    setVaciar(false);
    if (!identity) return;
    setBusy(true);
    try {
      const updated = await identityApi.saveI18n({ ...identity.i18n, en: {} });
      setIdentity(updated);
      setEn({});
      notify("success", "Traducciones del proyecto vaciadas: la portada en inglés vuelve al español.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo vaciar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} kicker={kicker} onClose={onClose} wide panelClassName="roadmap-admin__window">
      <div className="rw-window">
        <p className="rw-note">
          El visitante elige ES o EN en la barra superior; si no ha elegido nada se usa el idioma de su navegador.
          La interfaz ya está traducida: aquí se traducen los textos de este proyecto. Lo que dejes vacío se publica en español.
        </p>

        <div className="rw-tabs" role="tablist" aria-label="Idiomas">
          {([["proyecto", "Proyecto"], ["formulario", "Formulario"], ["roadmap", "Roadmap"]] as Array<[Tab, string]>).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === "proyecto" ? (
          <section className="rw-block" aria-label="TEXTOS DEL PROYECTO">
            <h3>TEXTOS DEL PROYECTO</h3>
            <div className="rw-textgrid">
              {PROJECT_KEYS.map(([key, label]) => (
                <label className="rw-field rw-field--wide" key={key}>
                  <span>{label}</span>
                  <input value={en[key] ?? ""} maxLength={1000} placeholder={originals[key] ?? ""}
                    onChange={(event) => setEn({ ...en, [key]: event.target.value })} />
                  <small className="rw-original">Español: {(originals[key] ?? "").slice(0, 160) || "—"}</small>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {tab === "formulario" ? (
          <section className="rw-block" aria-label="FORMULARIO DE COLABORACIÓN">
            <h3>FORMULARIO DE COLABORACIÓN</h3>
            <div className="rw-textgrid">
              {formTexts.map(([key, label, original]) => (
                <label className="rw-field rw-field--wide" key={key}>
                  <span>{label}</span>
                  <input value={en[key] ?? ""} maxLength={1000} placeholder={original}
                    onChange={(event) => setEn({ ...en, [key]: event.target.value })} />
                  <small className="rw-original">Español: {original.slice(0, 160) || "—"}</small>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {tab === "roadmap" ? (
          <>
            <section className="rw-block" aria-label="ETAPAS">
              <h3>ETAPAS</h3>
              <div className="rw-textgrid">
                {(roadmap?.categories ?? []).map((category) => (
                  <label className="rw-field rw-field--wide" key={`cat-${category.id}`}>
                    <span>{category.title}</span>
                    <input value={categoryEn[String(category.id)] ?? ""} maxLength={300}
                      onChange={(event) => setCategoryEn({ ...categoryEn, [String(category.id)]: event.target.value })} />
                  </label>
                ))}
              </div>
            </section>
            <section className="rw-block" aria-label="ACTIVIDADES">
              <h3>ACTIVIDADES</h3>
              <div className="rw-textgrid">
                {(roadmap?.categories ?? []).flatMap((category) => category.tasks.map((task) => (
                  <label className="rw-field rw-field--wide" key={`task-${task.id}`}>
                    <span>{task.title} <em className="rw-count">{category.title}</em></span>
                    <input value={taskEn[String(task.id)] ?? ""} maxLength={300}
                      onChange={(event) => setTaskEn({ ...taskEn, [String(task.id)]: event.target.value })} />
                  </label>
                )))}
              </div>
            </section>
          </>
        ) : null}

        <div className="rw-foot">
          {tab === "roadmap" ? (
            <button type="button" className="btn btn--primary" onClick={() => void guardarRoadmap()} disabled={busy || !roadmap}>
              <FloppyDisk size={15} aria-hidden="true" /> {busy ? "Guardando…" : "Guardar títulos"}
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => void guardarProyecto()} disabled={busy || !identity}>
              <FloppyDisk size={15} aria-hidden="true" /> {busy ? "Guardando…" : "Guardar traducciones"}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setVaciar(true)} disabled={busy || !identity}>
            <Trash size={14} aria-hidden="true" /> Vaciar y volver al español
          </button>
        </div>
      </div>

      {vaciar ? (
        <ConfirmDialog
          title="Vaciar las traducciones"
          description="La versión en inglés del proyecto vuelve a publicar los textos en español. Los títulos del roadmap se vacían aparte, en su pestaña."
          confirmLabel="Vaciar traducciones"
          danger
          requireNote={false}
          onClose={() => setVaciar(false)}
          onConfirm={() => void vaciarTodo()}
        />
      ) : null}
    </Modal>
  );
}
