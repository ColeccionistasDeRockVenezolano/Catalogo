// CRV · Ventana 3.6 «Candidaturas» (B7 · C4).
//
// Bandeja de solicitudes de colaboración: filtro por estado y búsqueda, detalle
// con enlaces y texto de la persona, cambio de estado y aceptación (que crea la
// cuenta de colaborador y devuelve su enlace de activación).
import { useEffect, useState } from "react";
import { CheckCircle, MagnifyingGlass, XCircle } from "@phosphor-icons/react";
import {
  communityApi,
  type ActivationCreated,
  type ApplicationDetail,
  type ApplicationStatus,
  type ApplicationSummary,
} from "../../lib/community";
import { useToast } from "../../lib/ToastContext";
import { Modal } from "../Modal";

const ESTADOS: ApplicationStatus[] = ["new", "reviewing", "contact", "accepted", "rejected", "archived"];
const ETIQUETA: Record<ApplicationStatus, string> = {
  new: "Nueva",
  reviewing: "En revisión",
  contact: "Contactada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  archived: "Archivada",
};

export function ApplicationsWindow({ title, kicker, onClose, onChanged }: {
  title: string;
  kicker: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { notify } = useToast();
  const [filtro, setFiltro] = useState<ApplicationStatus | "todas">("new");
  const [busqueda, setBusqueda] = useState("");
  const [solicitudes, setSolicitudes] = useState<ApplicationSummary[] | null>(null);
  const [detalle, setDetalle] = useState<ApplicationDetail | null>(null);
  const [activacion, setActivacion] = useState<ActivationCreated | null>(null);
  const [busy, setBusy] = useState(false);

  async function cargar(): Promise<void> {
    setBusy(true);
    try {
      const query = { ...(filtro === "todas" ? {} : { status: filtro }), ...(busqueda.trim() ? { search: busqueda.trim() } : {}) };
      const data = await communityApi.applications(query);
      setSolicitudes(data.data);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudieron cargar las candidaturas.");
      setSolicitudes([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void cargar(); }, [filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  async function abrir(id: number): Promise<void> {
    try {
      setDetalle(await communityApi.application(id));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo abrir la candidatura.");
    }
  }

  async function cambiarEstado(id: number, status: Exclude<ApplicationStatus, "accepted">): Promise<void> {
    setBusy(true);
    try {
      await communityApi.setApplicationStatus(id, status);
      notify("success", "Estado actualizado.");
      setDetalle(null);
      await cargar();
      onChanged();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo cambiar el estado.");
    } finally {
      setBusy(false);
    }
  }

  async function aceptar(id: number): Promise<void> {
    setBusy(true);
    try {
      const result = await communityApi.acceptApplication(id);
      setActivacion({ token: result.activationToken, expiresAt: result.activationExpiresAt, activationPath: result.activationPath });
      notify("success", "Candidatura aceptada; la cuenta de colaborador ya existe.");
      setDetalle(null);
      await cargar();
      onChanged();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo aceptar la candidatura.");
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
              placeholder="Buscar por nombre, correo o ciudad…"
              aria-label="Buscar candidaturas"
            />
          </label>
          <select value={filtro} onChange={(event) => setFiltro(event.target.value as ApplicationStatus | "todas")} aria-label="Filtrar por estado">
            <option value="todas">Todas</option>
            {ESTADOS.map((estado) => <option key={estado} value={estado}>{ETIQUETA[estado]}</option>)}
          </select>
        </div>

        {activacion ? (
          <p className="rw-note">
            Enlace de activación: <code>{activacion.activationPath}</code>{" "}
            (caduca {new Date(activacion.expiresAt).toLocaleString("es-VE")})
          </p>
        ) : null}

        {solicitudes === null ? <p className="community-muted">Cargando…</p> : null}
        {solicitudes && solicitudes.length === 0 ? <p className="community-muted">No hay candidaturas con ese filtro.</p> : null}

        <ul className="rw-list">
          {(solicitudes ?? []).map((solicitud) => (
            <li key={solicitud.id} className="rw-row">
              <span className="rw-row__name">
                {solicitud.first_name} {solicitud.last_name ?? ""}
                <em>{ETIQUETA[solicitud.status]} · {solicitud.link_count} enlaces · {new Date(solicitud.created_at).toLocaleDateString("es-VE")}</em>
              </span>
              <span className="rw-actions">
                <button type="button" className="btn btn--sm" onClick={() => void abrir(solicitud.id)} disabled={busy}>Ver</button>
                {solicitud.status !== "accepted" ? (
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => void aceptar(solicitud.id)} disabled={busy}>
                    <CheckCircle size={14} aria-hidden="true" /> Aceptar
                  </button>
                ) : null}
                {solicitud.status !== "rejected" && solicitud.status !== "accepted" ? (
                  <button type="button" className="btn btn--sm" onClick={() => void cambiarEstado(solicitud.id, "rejected")} disabled={busy}>
                    <XCircle size={14} aria-hidden="true" /> Rechazar
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        {detalle ? (
          <div className="rw-detail">
            <h3>{detalle.first_name} {detalle.last_name ?? ""}</h3>
            <dl>
              <div><dt>Correo</dt><dd>{detalle.email ?? "—"}</dd></div>
              <div><dt>WhatsApp</dt><dd>{detalle.whatsapp_phone ?? "—"}</dd></div>
              <div><dt>Ciudad</dt><dd>{[detalle.city, detalle.country].filter(Boolean).join(", ") || "—"}</dd></div>
              <div><dt>Preferencia</dt><dd>{detalle.contact_preference}</dd></div>
              <div><dt>Experiencia</dt><dd>{detalle.experience ?? "—"}</dd></div>
            </dl>
            {detalle.contribution_text ? <p>{detalle.contribution_text}</p> : null}
            {detalle.links.length ? (
              <ul className="rw-links">
                {detalle.links.map((enlace) => (
                  <li key={enlace.id}><a href={enlace.url} target="_blank" rel="noreferrer">{enlace.label ?? enlace.type}</a></li>
                ))}
              </ul>
            ) : null}
            <div className="rw-actions">
              {ESTADOS.filter((estado): estado is Exclude<ApplicationStatus, "accepted"> => estado !== "accepted" && estado !== detalle.status).map((estado) => (
                <button key={estado} type="button" className="btn btn--sm" onClick={() => void cambiarEstado(detalle.id, estado)} disabled={busy}>
                  Marcar {ETIQUETA[estado].toLowerCase()}
                </button>
              ))}
              <button type="button" className="btn btn--sm" onClick={() => setDetalle(null)}>Cerrar detalle</button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
