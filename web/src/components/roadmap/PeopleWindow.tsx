// CRV · Ventana 3.4 «Personas y colaboradores» (B7 · C5).
//
// Lista de colaboradores con búsqueda y filtro por estado, alta rápida con
// código de acceso, generación del enlace de activación y revocación. Todo
// pasa por la API de comunidad, que ya aplica los permisos por rol.
import { useEffect, useState } from "react";
import { ArrowSquareOut, Key, LinkSimple, MagnifyingGlass, Plus, Prohibit, UserPlus } from "@phosphor-icons/react";
import { communityApi, type ActivationCreated, type Collaborator, type CollaboratorStatus } from "../../lib/community";
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

  async function quitar(): Promise<void> {
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
                  <button type="button" className="btn btn--sm" onClick={() => { setCodigoPara(persona.id); setCodigoNuevo(""); }} title="Cambiar el código de acceso">
                    <Key size={14} aria-hidden="true" /> Código
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => void generarActivacion(persona)} disabled={busy} title="Generar enlace de activación">
                    <LinkSimple size={14} aria-hidden="true" /> Activación
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => setRevocar(persona)} disabled={busy || persona.status === "rejected"} title="Retirar el acceso">
                    <Prohibit size={14} aria-hidden="true" /> Revocar
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
          onConfirm={() => void quitar()}
        />
      ) : null}
    </Modal>
  );
}
