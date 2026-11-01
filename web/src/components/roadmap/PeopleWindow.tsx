// CRV · Ventana 3.4 «Personas y colaboradores» (B7 · C5).
//
// Lista de colaboradores con búsqueda y filtro por estado, alta rápida con
// código de acceso, generación del enlace de activación y revocación. Todo
// pasa por la API de comunidad, que ya aplica los permisos por rol.
import { useEffect, useState } from "react";
import { ArrowSquareOut, Key, LinkSimple, MagnifyingGlass, NotePencil, Plus, Prohibit, Trash, UserPlus } from "@phosphor-icons/react";
import { communityApi, type ActivationCreated, type Collaborator, type CollaboratorStatus, type PersonProfile } from "../../lib/community";
import { useToast } from "../../lib/ToastContext";
import { Modal } from "../Modal";
import { ConfirmDialog } from "../ConfirmDialog";

type Filtro = "todos" | CollaboratorStatus;

const ESTADOS: Record<CollaboratorStatus, string> = {
  approved: "Con acceso",
  pending: "Pendiente",
  rejected: "Sin acceso",
};

export function PeopleWindow({ title, kicker, onClose, onChanged, mode = "all" }: {
  title: string;
  kicker: string;
  onClose: () => void;
  onChanged: () => void;
  /** "pending": bandeja de solicitudes con aprobar/rechazar (3.5). */
  mode?: "all" | "pending";
}) {
  const { notify } = useToast();
  const [filtro, setFiltro] = useState<Filtro>(mode === "pending" ? "pending" : "todos");
  const [busqueda, setBusqueda] = useState("");
  const [personas, setPersonas] = useState<Collaborator[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [alta, setAlta] = useState(false);
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [activacion, setActivacion] = useState<ActivationCreated | null>(null);
  const [revocar, setRevocar] = useState<Collaborator | null>(null);
  const [perfil, setPerfil] = useState<{ persona: Collaborator; datos: PersonProfile } | null>(null);
  const [usuario, setUsuario] = useState<{ persona: Collaborator; nombre: string } | null>(null);
  const [quitar, setQuitar] = useState<Collaborator | null>(null);
  const [codigoPara, setCodigoPara] = useState<number | null>(null);
  const [codigoNuevo, setCodigoNuevo] = useState("");

  async function cargar(): Promise<void> {
    setBusy(true);
    try {
      const query = { ...(filtro === "todos" ? {} : { status: filtro }), ...(busqueda.trim() ? { search: busqueda.trim() } : {}) };
      const data = await communityApi.collaborators(query);
      setPersonas(data.data);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo cargar la lista.");
      setPersonas([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void cargar(); }, [filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  async function crear(): Promise<void> {
    if (!nombre.trim() || codigo.trim().length < 6) {
      notify("error", "El nombre y un código de acceso de 6 caracteres o más son obligatorios.");
      return;
    }
    setBusy(true);
    try {
      await communityApi.createCollaborator({ name: nombre.trim(), firstName: nombre.trim().split(" ")[0] ?? nombre.trim(), accessCode: codigo.trim() });
      notify("success", "Colaborador creado.");
      setAlta(false);
      setNombre("");
      setCodigo("");
      await cargar();
      onChanged();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo crear.");
    } finally {
      setBusy(false);
    }
  }

  async function guardarCodigo(persona: Collaborator): Promise<void> {
    if (codigoNuevo.trim().length < 6) {
      notify("error", "El código necesita 6 caracteres o más.");
      return;
    }
    setBusy(true);
    try {
      await communityApi.setAccessCode(persona.id, codigoNuevo.trim());
      notify("success", `Código actualizado para ${persona.name}.`);
      setCodigoPara(null);
      setCodigoNuevo("");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo cambiar el código.");
    } finally {
      setBusy(false);
    }
  }

  async function generarActivacion(persona: Collaborator): Promise<void> {
    setBusy(true);
    try {
      const created = await communityApi.createActivation(persona.id);
      setActivacion(created);
      onChanged();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo crear el enlace.");
    } finally {
      setBusy(false);
    }
  }

  async function decidir(persona: Collaborator, status: "approved" | "rejected"): Promise<void> {
    setBusy(true);
    try {
      await communityApi.updateCollaborator(persona.id, { status });
      notify("success", status === "approved" ? `${persona.name} tiene acceso.` : `${persona.name} queda sin acceso.`);
      await cargar();
      onChanged();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar la decisión.");
    } finally {
      setBusy(false);
    }
  }

  async function abrirPerfil(persona: Collaborator): Promise<void> {
    setBusy(true);
    try {
      const datos = await communityApi.collaboratorPerson(persona.id);
      setPerfil({ persona, datos });
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo abrir el perfil.");
    } finally {
      setBusy(false);
    }
  }

  async function guardarPerfil(fields: {
    firstName: string; lastName: string; birthDate: string; whatsappPhone: string; email: string;
    city: string; country: string; experience: string; availability: string;
  }): Promise<void> {
    if (!perfil) return;
    setBusy(true);
    try {
      const datos = await communityApi.updateCollaboratorPerson(perfil.persona.id, {
        firstName: fields.firstName.trim(),
        ...(fields.lastName.trim() ? { lastName: fields.lastName.trim() } : {}),
        ...(fields.birthDate ? { birthDate: fields.birthDate } : {}),
        ...(fields.whatsappPhone.trim() ? { whatsappPhone: fields.whatsappPhone.trim() } : {}),
        ...(fields.email.trim() ? { email: fields.email.trim() } : {}),
        ...(fields.city.trim() ? { city: fields.city.trim() } : {}),
        ...(fields.country.trim() ? { country: fields.country.trim() } : {}),
        ...(fields.experience.trim() ? { experience: fields.experience.trim() } : {}),
        ...(fields.availability.trim() ? { availability: fields.availability.trim() } : {}),
      });
      setPerfil({ persona: perfil.persona, datos });
      notify("success", "Perfil guardado. Es global: se ve en todos los proyectos.");
      await cargar();
      onChanged();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar el perfil.");
    } finally {
      setBusy(false);
    }
  }

  async function guardarUsuario(): Promise<void> {
    if (!usuario) return;
    setBusy(true);
    try {
      await communityApi.setCollaboratorUsername(usuario.persona.id, usuario.nombre.trim());
      notify("success", `Ahora inicia sesión como ${usuario.nombre.trim()}. Sus sesiones abiertas se cerraron.`);
      setUsuario(null);
      await cargar();
      onChanged();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo cambiar el usuario.");
    } finally {
      setBusy(false);
    }
  }

  async function eliminar(): Promise<void> {
    if (!quitar) return;
    const persona = quitar;
    setQuitar(null);
    setBusy(true);
    try {
      await communityApi.deleteCollaborator(persona.id);
      notify("success", `Cuenta de ${persona.name} borrada. Su perfil global se conserva.`);
      await cargar();
      onChanged();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo borrar la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  async function quitarAcceso(): Promise<void> {
    if (!revocar) return;
    const persona = revocar;
    setRevocar(null);
    setBusy(true);
    try {
      await communityApi.revokeCollaborator(persona.id);
      notify("success", `Acceso retirado a ${persona.name}.`);
      await cargar();
      onChanged();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo revocar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} kicker={kicker} onClose={onClose} wide>
      <div className="rw-window">
        <div className="rw-window__bar">
          <label className="rw-search">
            <MagnifyingGlass size={15} aria-hidden="true" />
            <input
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void cargar(); }}
              placeholder="Buscar por nombre o usuario…"
              aria-label="Buscar colaboradores"
            />
          </label>
          <select value={filtro} onChange={(event) => setFiltro(event.target.value as Filtro)} aria-label="Filtrar por estado">
            <option value="todos">Todos</option>
            <option value="approved">Con acceso</option>
            <option value="pending">Pendiente</option>
            <option value="rejected">Sin acceso</option>
          </select>
          {mode === "pending" ? null : (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setAlta((value) => !value)}>
              <UserPlus size={15} aria-hidden="true" /> Añadir colaborador
            </button>
          )}
        </div>

        {alta ? (
          <div className="rw-form">
            <div className="field"><label htmlFor="pw-nombre">Nombre</label><input id="pw-nombre" value={nombre} onChange={(event) => setNombre(event.target.value)} /></div>
            <div className="field"><label htmlFor="pw-codigo">Código de acceso (6+)</label><input id="pw-codigo" value={codigo} onChange={(event) => setCodigo(event.target.value)} /></div>
            <button type="button" className="btn btn--primary" onClick={() => void crear()} disabled={busy}><Plus size={15} aria-hidden="true" /> Crear</button>
          </div>
        ) : null}

        {activacion ? (
          <p className="rw-note">
            <LinkSimple size={15} aria-hidden="true" />
            Enlace de activación: <code>{activacion.activationPath}</code> (caduca {new Date(activacion.expiresAt).toLocaleString("es-VE")})
          </p>
        ) : null}

        {personas === null ? <p className="community-muted">Cargando…</p> : null}
        {personas && personas.length === 0 ? <p className="community-muted">No hay personas con ese filtro.</p> : null}

        <ul className="rw-list">
          {(personas ?? []).map((persona) => (
            <li key={persona.id} className="rw-row">
              <span className="rw-row__name">
                {persona.name}
                <em>{ESTADOS[persona.status]}</em>
              </span>
              {mode === "pending" ? (
                <span className="rw-actions">
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => void decidir(persona, "approved")} disabled={busy}>Aprobar</button>
                  <button type="button" className="btn btn--sm" onClick={() => void decidir(persona, "rejected")} disabled={busy}>Rechazar</button>
                </span>
              ) : codigoPara === persona.id ? (
                <span className="rw-inline">
                  <input value={codigoNuevo} onChange={(event) => setCodigoNuevo(event.target.value)} placeholder="Código nuevo" aria-label={`Código nuevo para ${persona.name}`} />
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => void guardarCodigo(persona)} disabled={busy}>Guardar</button>
                  <button type="button" className="btn btn--sm" onClick={() => { setCodigoPara(null); setCodigoNuevo(""); }}>Cancelar</button>
                </span>
              ) : (
                <span className="rw-actions">
                  <button type="button" className="btn btn--sm" onClick={() => void abrirPerfil(persona)} disabled={busy} title="Editar el perfil global de la persona">
                    <NotePencil size={14} aria-hidden="true" /> Perfil
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => setUsuario({ persona, nombre: persona.name })} disabled={busy} title="Cambiar el nombre de usuario">
                    <UserPlus size={14} aria-hidden="true" /> Usuario
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => { setCodigoPara(persona.id); setCodigoNuevo(""); }} title="Cambiar el código de acceso">
                    <Key size={14} aria-hidden="true" /> Código
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => void generarActivacion(persona)} disabled={busy} title="Generar enlace de activación">
                    <LinkSimple size={14} aria-hidden="true" /> Activación
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => setRevocar(persona)} disabled={busy || persona.status === "rejected"} title="Retirar el acceso">
                    <Prohibit size={14} aria-hidden="true" /> Revocar
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => setQuitar(persona)} disabled={busy} title="Borrar la cuenta del proyecto">
                    <Trash size={14} aria-hidden="true" /> Quitar
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className="rw-note">
          <ArrowSquareOut size={14} aria-hidden="true" /> Las altas y los enlaces de activación se ven en la portada de colaboración y en el registro.
        </p>
      </div>

      {revocar ? (
        <ConfirmDialog
          title="Retirar el acceso"
          description={`${revocar.name} dejará de poder entrar con su código y se cerrarán sus sesiones.`}
          confirmLabel="Revocar acceso"
          danger
          requireNote={false}
          onClose={() => setRevocar(null)}
          onConfirm={() => void quitarAcceso()}
        />
      ) : null}
      {perfil ? (
        <PersonEditor
          persona={perfil.persona}
          datos={perfil.datos}
          busy={busy}
          onClose={() => setPerfil(null)}
          onSave={(fields) => void guardarPerfil(fields)}
        />
      ) : null}

      {usuario ? (
        <Modal title={`Cambiar usuario de ${usuario.persona.name}`} kicker="PERSONAS Y COLABORADORES" onClose={() => setUsuario(null)}>
          <div className="rw-window">
            <p className="rw-note">El usuario es con el que inicia sesión. Al cambiarlo se cierran sus sesiones abiertas.</p>
            <div className="rw-form">
              <div className="field">
                <label htmlFor="pw-usuario">Nombre de usuario</label>
                <input id="pw-usuario" value={usuario.nombre} maxLength={80}
                  onChange={(event) => setUsuario({ ...usuario, nombre: event.target.value })} />
              </div>
              <button type="button" className="btn btn--primary" disabled={busy || usuario.nombre.trim().length < 2}
                onClick={() => void guardarUsuario()}>Guardar usuario</button>
              <button type="button" className="btn" onClick={() => setUsuario(null)}>Cancelar</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {quitar ? (
        <ConfirmDialog
          title="Borrar la cuenta"
          description={`${quitar.name} dejará de existir como cuenta de este proyecto y se cerrarán sus sesiones. Su perfil global (persona) se conserva.`}
          confirmLabel="Borrar cuenta"
          danger
          requireNote={false}
          onClose={() => setQuitar(null)}
          onConfirm={() => void eliminar()}
        />
      ) : null}
    </Modal>
  );
}

/** «Perfil de la persona»: los datos globales, los mismos en todos los proyectos. */
function PersonEditor({ persona, datos, busy, onClose, onSave }: {
  persona: Collaborator;
  datos: PersonProfile;
  busy: boolean;
  onClose: () => void;
  onSave: (fields: {
    firstName: string; lastName: string; birthDate: string; whatsappPhone: string; email: string;
    city: string; country: string; experience: string; availability: string;
  }) => void;
}) {
  const [fields, setFields] = useState({
    firstName: datos.first_name,
    lastName: datos.last_name,
    birthDate: datos.birth_date ?? "",
    whatsappPhone: datos.whatsapp_phone ?? "",
    email: datos.email ?? "",
    city: datos.city ?? "",
    country: datos.country ?? "",
    experience: datos.experience ?? "",
    availability: datos.availability ?? "",
  });
  const set = (key: keyof typeof fields, value: string) => setFields((previous) => ({ ...previous, [key]: value }));
  return (
    <Modal title={`Perfil de ${persona.name}`} kicker="PERFIL DE LA PERSONA" onClose={onClose} wide>
      <div className="rw-window">
        <p className="rw-note">Este perfil es global: los cambios se ven en todos los proyectos en los que colabore.</p>
        <div className="rw-textgrid">
          <label className="rw-field"><span>Nombre</span>
            <input value={fields.firstName} maxLength={80} onChange={(event) => set("firstName", event.target.value)} /></label>
          <label className="rw-field"><span>Apellido</span>
            <input value={fields.lastName} maxLength={80} onChange={(event) => set("lastName", event.target.value)} /></label>
          <label className="rw-field"><span>Fecha de nacimiento</span>
            <input type="date" value={fields.birthDate} onChange={(event) => set("birthDate", event.target.value)} /></label>
          <label className="rw-field"><span>WhatsApp</span>
            <input value={fields.whatsappPhone} maxLength={120} onChange={(event) => set("whatsappPhone", event.target.value)} /></label>
          <label className="rw-field"><span>Correo</span>
            <input type="email" value={fields.email} maxLength={120} onChange={(event) => set("email", event.target.value)} /></label>
          <label className="rw-field"><span>Ciudad</span>
            <input value={fields.city} maxLength={200} onChange={(event) => set("city", event.target.value)} /></label>
          <label className="rw-field"><span>País</span>
            <input value={fields.country} maxLength={200} onChange={(event) => set("country", event.target.value)} /></label>
          <label className="rw-field"><span>Disponibilidad</span>
            <input value={fields.availability} maxLength={200} onChange={(event) => set("availability", event.target.value)} /></label>
          <label className="rw-field rw-field--wide"><span>Experiencia</span>
            <textarea rows={4} value={fields.experience} maxLength={4000} onChange={(event) => set("experience", event.target.value)} /></label>
        </div>
        <div className="rw-foot">
          <button type="button" className="btn btn--primary" disabled={busy || !fields.firstName.trim()}
            onClick={() => onSave(fields)}>Guardar perfil</button>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}
