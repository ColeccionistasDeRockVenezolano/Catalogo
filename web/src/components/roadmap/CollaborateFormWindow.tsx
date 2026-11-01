// CRV · Ventana 3.8 «Formulario de colaboración» (B8 · C8).
//
// Tres pestañas como el admin de Herra 1.1.34: campos que se piden (no pedir /
// opcional / obligatorio), textos del formulario y catálogo de categorías de
// perfil. Guarda en `auth.projects.collaborate_json`; el efecto se ve en
// /colaborar, que pinta la plantilla de la portada con esos ajustes.
import { useEffect, useMemo, useState } from "react";
import { ArrowSquareOut, FloppyDisk, Plus, Trash } from "@phosphor-icons/react";
import {
  communityApi, type CollaborateConfig, type CollaborateForm, type FieldMode, type ProfileTerm, type ProfileTermType,
} from "../../lib/community";
import { useToast } from "../../lib/ToastContext";
import { Modal } from "../Modal";
import { ConfirmDialog } from "../ConfirmDialog";

type Tab = "campos" | "textos" | "categorias";
type Section = "labels" | "helps" | "placeholders";

const MODES: Array<{ value: FieldMode; label: string }> = [
  { value: "off", label: "No pedir" },
  { value: "optional", label: "Opcional" },
  { value: "required", label: "Obligatorio" },
];

const FIELD_GROUPS: Array<{ title: string; fields: Array<[string, string]> }> = [
  {
    title: "SOBRE TI",
    fields: [
      ["lastName", "Apellido"], ["birthDate", "Fecha de nacimiento"], ["whatsappPhone", "Teléfono con WhatsApp"],
      ["email", "Correo"], ["contactPreference", "Preferencia de contacto"], ["city", "Ciudad"], ["country", "País"],
    ],
  },
  {
    title: "QUÉ SABES HACER",
    fields: [["skills", "Habilidades (catálogo)"], ["experience", "Experiencia y material"], ["links", "Enlaces"]],
  },
  {
    title: "CÓMO QUIERES APORTAR",
    fields: [["areas", "Áreas de aporte (catálogo)"], ["contributionText", "Qué quieres aportar"], ["availability", "Disponibilidad"]],
  },
  { title: "PROPÓN ALGO", fields: [["ideas", "Paso «Propón algo» completo"]] },
];

const STEP_KEYS: Array<[string, string]> = [
  ["about", "Sobre ti"], ["skills", "Qué sabes hacer"], ["contribution", "Cómo quieres aportar"],
  ["ideas", "Propón algo"], ["review", "Revisión y envío"],
];

const LABEL_KEYS: Array<[string, string]> = [
  ["firstName", "Nombre"], ["lastName", "Apellido"], ["birthDate", "Fecha de nacimiento"],
  ["whatsappPhone", "Teléfono con WhatsApp"], ["email", "Correo"], ["contactPreference", "Preferencia de contacto"],
  ["city", "Ciudad"], ["country", "País"], ["skills", "Habilidades"], ["experience", "Experiencia"],
  ["links", "Enlaces"], ["areas", "Áreas de aporte"], ["contributionText", "Qué quieres aportar"],
  ["availability", "Disponibilidad"], ["idea", "Idea o propuesta"], ["ideaReason", "Por qué sería útil"],
  ["wantsToImplement", "Participar en implementarla"],
];

const HELP_KEYS: Array<[string, string]> = [
  ["birthDate", "Aviso de la fecha de nacimiento"], ["contact", "Aviso de contacto"],
  ["links", "Aviso de enlaces"], ["ideas", "Aviso de propón algo"],
];

const PLACEHOLDER_KEYS: Array<[string, string]> = [
  ["whatsappPhone", "Ejemplo de WhatsApp"], ["experience", "Ejemplo de experiencia"],
  ["contributionText", "Ejemplo de qué quieres aportar"], ["availability", "Ejemplo de disponibilidad"],
];

const TERM_TYPES: Array<{ value: ProfileTermType; label: string; hint: string }> = [
  { value: "skill", label: "Habilidad", hint: "HABILIDADES" },
  { value: "contribution_area", label: "Área de aporte", hint: "ÁREAS DE APORTE" },
  { value: "link_type", label: "Tipo de enlace", hint: "TIPOS DE ENLACE" },
];

function splitList(value: string, separator: "," | "\n"): string[] {
  return value.split(separator).map((part) => part.trim()).filter(Boolean).slice(0, 10);
}

export function CollaborateFormWindow({ title, kicker, onClose, onSaved }: {
  title: string;
  kicker: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>("campos");
  const [config, setConfig] = useState<CollaborateConfig | null>(null);
  const [form, setForm] = useState<CollaborateForm | null>(null);
  const [custom, setCustom] = useState<Record<Section, Record<string, boolean>>>({ labels: {}, helps: {}, placeholders: {} });
  const [terms, setTerms] = useState<{ skills: ProfileTerm[]; areas: ProfileTerm[]; linkTypes: ProfileTerm[] } | null>(null);
  const [nuevoTipo, setNuevoTipo] = useState<ProfileTermType>("skill");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [renombrar, setRenombrar] = useState<{ id: number; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);

  useEffect(() => {
    let active = true;
    void communityApi.collaborateForm().then((data) => {
      if (!active) return;
      setConfig(data);
      setForm(data.form);
      setTerms(data.catalog);
      const overrides = data.overrides as Record<string, unknown>;
      const picked = (section: Section): Record<string, boolean> => {
        const source = overrides[section];
        if (!source || typeof source !== "object") return {};
        return Object.fromEntries(Object.keys(source as Record<string, unknown>).map((key) => [key, true]));
      };
      setCustom({ labels: picked("labels"), helps: picked("helps"), placeholders: picked("placeholders") });
    }).catch((error: unknown) => {
      notify("error", error instanceof Error ? error.message : "No se pudo cargar el formulario.");
    });
    return () => { active = false; };
  }, [notify]);

  const counts = useMemo(() => ({
    skills: terms?.skills.filter((term) => !term.archived).length ?? 0,
    areas: terms?.areas.filter((term) => !term.archived).length ?? 0,
    linkTypes: terms?.linkTypes.filter((term) => !term.archived).length ?? 0,
  }), [terms]);

  const set = <K extends keyof CollaborateForm>(key: K, value: CollaborateForm[K]) => {
    setForm((previous) => (previous ? { ...previous, [key]: value } : previous));
  };

  function setMode(field: string, mode: FieldMode): void {
    if (!form) return;
    set("fields", { ...form.fields, [field]: mode });
  }

  function setSection(section: Section | "steps", key: string, value: string): void {
    if (!form) return;
    set(section, { ...form[section], [key]: value });
  }

  async function guardar(): Promise<void> {
    if (!form) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        heroBadge: form.heroBadge,
        heroTitleHtml: form.heroTitleHtml,
        heroSub: form.heroSub,
        introNote: form.introNote,
        submitLabel: form.submitLabel,
        nextStepsTitle: form.nextStepsTitle,
        sentTitle: form.sentTitle,
        sentBody: form.sentBody,
        pillars: form.pillars,
        nextSteps: form.nextSteps,
        steps: form.steps,
        fields: form.fields,
        maxLinks: form.maxLinks,
      };
      for (const section of ["labels", "helps", "placeholders"] as const) {
        const picked: Record<string, string> = {};
        for (const [key, enabled] of Object.entries(custom[section])) {
          if (enabled && form[section][key] !== undefined) picked[key] = form[section][key]!;
        }
        payload[section] = picked;
      }
      const updated = await communityApi.saveCollaborateForm(payload);
      setConfig(updated);
      setForm(updated.form);
      notify("success", "Formulario guardado. /colaborar lo muestra en menos de un minuto.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar el formulario.");
    } finally {
      setBusy(false);
    }
  }

  async function restablecer(): Promise<void> {
    setReset(false);
    setBusy(true);
    try {
      const updated = await communityApi.saveCollaborateForm({});
      setConfig(updated);
      setForm(updated.form);
      setCustom({ labels: {}, helps: {}, placeholders: {} });
      notify("success", "Formulario restablecido a los valores de fábrica.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo restablecer.");
    } finally {
      setBusy(false);
    }
  }

  async function agregarCategoria(): Promise<void> {
    if (!nuevoNombre.trim()) {
      notify("error", "La categoría necesita un nombre.");
      return;
    }
    setBusy(true);
    try {
      await communityApi.createProfileTerm(nuevoTipo, nuevoNombre.trim());
      const data = await communityApi.profileTerms();
      setTerms({ skills: data.skills, areas: data.areas, linkTypes: data.linkTypes });
      setNuevoNombre("");
      notify("success", "Categoría añadida al catálogo del proyecto.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo añadir.");
    } finally {
      setBusy(false);
    }
  }

  async function actualizarCategoria(id: number, patch: { label?: string; archived?: boolean }): Promise<void> {
    setBusy(true);
    try {
      await communityApi.updateProfileTerm(id, patch);
      const data = await communityApi.profileTerms();
      setTerms({ skills: data.skills, areas: data.areas, linkTypes: data.linkTypes });
      setRenombrar(null);
      notify("success", patch.archived === true ? "Categoría archivada." : patch.archived === false ? "Categoría restaurada." : "Categoría renombrada.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo cambiar la categoría.");
    } finally {
      setBusy(false);
    }
  }

  const termColumns: Array<{ hint: string; rows: ProfileTerm[] }> = [
    { hint: "HABILIDADES", rows: terms?.skills ?? [] },
    { hint: "ÁREAS DE APORTE", rows: terms?.areas ?? [] },
    { hint: "TIPOS DE ENLACE", rows: terms?.linkTypes ?? [] },
  ];

  return (
    <Modal title={title} kicker={kicker} onClose={onClose} wide panelClassName="roadmap-admin__window">
      <div className="rw-window">
        <div className="rw-window__bar">
          <div className="rw-tabs" role="tablist" aria-label="Secciones del formulario">
            {([["campos", "Campos"], ["textos", "Textos"], ["categorias", "Categorías de perfil"]] as Array<[Tab, string]>).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          <a className="btn btn--sm" href="/colaborar" target="_blank" rel="noreferrer">
            <ArrowSquareOut size={14} aria-hidden="true" /> Ver el formulario
          </a>
        </div>

        {form === null ? <p className="community-muted">Cargando…</p> : null}

        {form && tab === "campos" ? (
          <>
            <p className="rw-note">Qué se le pide a quien se postula. Lo que quede en «No pedir» no aparece en la portada.</p>
            {FIELD_GROUPS.map((group) => (
              <section className="rw-block" key={group.title} aria-label={group.title}>
                <h3>{group.title}</h3>
                <div className="rw-segrows">
                  {group.fields.map(([field, label]) => (
                    <div className="rw-segrow" key={field}>
                      <span>{label}</span>
                      <div className="rw-seg" role="group" aria-label={label}>
                        {MODES.map((mode) => (
                          <button key={mode.value} type="button" disabled={busy}
                            aria-pressed={(form.fields[field] ?? "optional") === mode.value}
                            className={(form.fields[field] ?? "optional") === mode.value ? "is-active" : ""}
                            onClick={() => setMode(field, mode.value)}>{mode.label}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            <section className="rw-block" aria-label="ENLACES">
              <h3>ENLACES</h3>
              <div className="rw-segrow">
                <span>Cuántas filas de enlace se ofrecen (0–10)</span>
                <input className="rw-number" type="number" min={0} max={10} value={form.maxLinks}
                  aria-label="Filas de enlace ofrecidas"
                  onChange={(event) => set("maxLinks", Math.max(0, Math.min(10, Number(event.target.value) || 0)))} />
              </div>
            </section>
            <p className="rw-notice">
              Dos mínimos que el servidor también exige: <strong>una vía de contacto</strong> (WhatsApp o correo) y
              <strong> experiencia o qué quieres aportar</strong>. Si ambos quedan en «No pedir», la candidatura no se puede enviar.
            </p>
          </>
        ) : null}

        {form && tab === "textos" ? (
          <>
            <section className="rw-block" aria-label="PORTADA Y CONFIRMACIÓN">
              <h3>PORTADA Y CONFIRMACIÓN</h3>
              <div className="rw-textgrid">
                <label className="rw-field"><span>Antetítulo</span>
                  <input value={form.heroBadge} maxLength={200} onChange={(event) => set("heroBadge", event.target.value)} /></label>
                <label className="rw-field rw-field--wide"><span>Titular (admite &lt;br&gt;)</span>
                  <textarea rows={2} value={form.heroTitleHtml} maxLength={1000} onChange={(event) => set("heroTitleHtml", event.target.value)} /></label>
                <label className="rw-field rw-field--wide"><span>Entrada</span>
                  <textarea rows={3} value={form.heroSub} maxLength={1000} onChange={(event) => set("heroSub", event.target.value)} /></label>
                <label className="rw-field rw-field--wide"><span>Pilares (separados por comas)</span>
                  <input value={form.pillars.join(", ")} onChange={(event) => set("pillars", splitList(event.target.value, ","))} /></label>
                <label className="rw-field rw-field--wide"><span>Nota de entrada (opcional)</span>
                  <input value={form.introNote} maxLength={1000} onChange={(event) => set("introNote", event.target.value)} /></label>
                <label className="rw-field"><span>Botón de envío</span>
                  <input value={form.submitLabel} maxLength={120} onChange={(event) => set("submitLabel", event.target.value)} /></label>
                <label className="rw-field"><span>Título de «Qué pasa después»</span>
                  <input value={form.nextStepsTitle} maxLength={200} onChange={(event) => set("nextStepsTitle", event.target.value)} /></label>
                <label className="rw-field rw-field--wide"><span>Qué pasa después (una línea por paso)</span>
                  <textarea rows={3} value={form.nextSteps.join("\n")} onChange={(event) => set("nextSteps", splitList(event.target.value, "\n"))} /></label>
                <label className="rw-field"><span>Título al enviar</span>
                  <input value={form.sentTitle} maxLength={200} onChange={(event) => set("sentTitle", event.target.value)} /></label>
                <label className="rw-field"><span>Texto al enviar</span>
                  <input value={form.sentBody} maxLength={1000} onChange={(event) => set("sentBody", event.target.value)} /></label>
              </div>
            </section>

            <section className="rw-block" aria-label="NOMBRES DE LOS PASOS">
              <h3>NOMBRES DE LOS PASOS</h3>
              <div className="rw-textgrid">
                {STEP_KEYS.map(([key, label]) => (
                  <label className="rw-field" key={key}><span>{label}</span>
                    <input value={form.steps[key] ?? ""} maxLength={120}
                      onChange={(event) => setSection("steps", key, event.target.value)} /></label>
                ))}
              </div>
            </section>

            <section className="rw-block" aria-label="ETIQUETAS DE LOS CAMPOS">
              <h3>ETIQUETAS DE LOS CAMPOS</h3>
              <p className="rw-note">Marca «personalizar» para cambiar una etiqueta; sin marcar se usa la de fábrica.</p>
              <div className="rw-textgrid rw-textgrid--four">
                {LABEL_KEYS.map(([key, label]) => {
                  const on = custom.labels[key] === true;
                  return (
                    <div className="rw-field" key={key}>
                      <label className="rw-check"><input type="checkbox" checked={on}
                        onChange={(event) => setCustom((previous) => ({ ...previous, labels: { ...previous.labels, [key]: event.target.checked } }))} />
                        <span>personalizar</span></label>
                      <input value={form.labels[key] ?? ""} maxLength={200} disabled={!on}
                        aria-label={label} onChange={(event) => setSection("labels", key, event.target.value)} />
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rw-block" aria-label="AVISOS Y EJEMPLOS">
              <h3>AVISOS Y EJEMPLOS</h3>
              <div className="rw-textgrid">
                {HELP_KEYS.map(([key, label]) => {
                  const on = custom.helps[key] === true;
                  return (
                    <div className="rw-field" key={`help-${key}`}>
                      <label className="rw-check"><input type="checkbox" checked={on}
                        onChange={(event) => setCustom((previous) => ({ ...previous, helps: { ...previous.helps, [key]: event.target.checked } }))} />
                        <span>{label}</span></label>
                      <input value={form.helps[key] ?? ""} maxLength={1000} disabled={!on}
                        onChange={(event) => setSection("helps", key, event.target.value)} />
                    </div>
                  );
                })}
                {PLACEHOLDER_KEYS.map(([key, label]) => {
                  const on = custom.placeholders[key] === true;
                  return (
                    <div className="rw-field" key={`ph-${key}`}>
                      <label className="rw-check"><input type="checkbox" checked={on}
                        onChange={(event) => setCustom((previous) => ({ ...previous, placeholders: { ...previous.placeholders, [key]: event.target.checked } }))} />
                        <span>{label}</span></label>
                      <input value={form.placeholders[key] ?? ""} maxLength={1000} disabled={!on}
                        onChange={(event) => setSection("placeholders", key, event.target.value)} />
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}

        {form && tab === "categorias" ? (
          <>
            <p className="rw-note">
              Las categorías del proyecto: habilidades, áreas de aporte y tipos de enlace que se ofrecen en /colaborar y en «Mi perfil».
            </p>
            <p className="rw-notice rw-notice--amber">
              Este catálogo es del proyecto de CRV. Archivar una categoría la retira del formulario pero conserva las
              personas que ya la tenían; renombrar cambia la etiqueta sin romper los enlaces guardados.
            </p>
            <div className="rw-form">
              <div className="field">
                <label htmlFor="cw-tipo">Tipo</label>
                <select id="cw-tipo" value={nuevoTipo} onChange={(event) => setNuevoTipo(event.target.value as ProfileTermType)}>
                  {TERM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="cw-nombre">Nombre</label>
                <input id="cw-nombre" value={nuevoNombre} maxLength={80}
                  onChange={(event) => setNuevoNombre(event.target.value)} />
              </div>
              <button type="button" className="btn btn--primary" onClick={() => void agregarCategoria()} disabled={busy}>
                <Plus size={14} aria-hidden="true" /> Añadir al catálogo
              </button>
            </div>

            <div className="rw-terms">
              {termColumns.map((column) => (
                <section key={column.hint} className="rw-termcol" aria-label={column.hint}>
                  <h3>{column.hint} <em>{column.rows.filter((term) => !term.archived).length}</em></h3>
                  <ul>
                    {column.rows.map((term) => (
                      <li key={term.id} className={term.archived ? "is-archived" : ""}>
                        {renombrar?.id === term.id ? (
                          <span className="rw-inline">
                            <input value={renombrar.label} maxLength={80} aria-label={`Nuevo nombre para ${term.label}`}
                              onChange={(event) => setRenombrar({ id: term.id, label: event.target.value })} />
                            <button type="button" className="btn btn--sm btn--primary" disabled={busy}
                              onClick={() => void actualizarCategoria(term.id, { label: renombrar.label })}>Guardar</button>
                            <button type="button" className="btn btn--sm" onClick={() => setRenombrar(null)}>Cancelar</button>
                          </span>
                        ) : (
                          <span className="rw-term">
                            <span className="rw-term__label">{term.label}{term.persons > 0 ? <em>{term.persons}</em> : null}</span>
                            <span className="rw-term__actions">
                              <button type="button" className="btn btn--sm" disabled={busy}
                                onClick={() => setRenombrar({ id: term.id, label: term.label })}>Renombrar</button>
                              <button type="button" className="btn btn--sm" disabled={busy}
                                onClick={() => void actualizarCategoria(term.id, { archived: !term.archived })}>
                                {term.archived ? "Restaurar" : "Archivar"}
                              </button>
                            </span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        ) : null}

        <div className="rw-foot">
          <button type="button" className="btn btn--primary" onClick={() => void guardar()} disabled={busy || !form}>
            <FloppyDisk size={15} aria-hidden="true" /> {busy ? "Guardando…" : "Guardar formulario"}
          </button>
          <button type="button" className="btn" onClick={() => setReset(true)} disabled={busy || !form}>
            <Trash size={14} aria-hidden="true" /> Restablecer todo
          </button>
          <a className="btn" href="/colaborar" target="_blank" rel="noreferrer">
            <ArrowSquareOut size={14} aria-hidden="true" /> Previsualizar
          </a>
          <span className="community-muted">
            {config ? `${counts.skills} habilidades · ${counts.areas} áreas · ${counts.linkTypes} tipos de enlace` : ""}
          </span>
        </div>
      </div>

      {reset ? (
        <ConfirmDialog
          title="Restablecer el formulario"
          description="Se borran los ajustes guardados y /colaborar vuelve a los textos y campos de fábrica. Las categorías del catálogo no se tocan."
          confirmLabel="Restablecer"
          danger
          requireNote={false}
          onClose={() => setReset(false)}
          onConfirm={() => void restablecer()}
        />
      ) : null}
    </Modal>
  );
}
