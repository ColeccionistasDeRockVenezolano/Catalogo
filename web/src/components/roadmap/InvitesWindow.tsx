// CRV · Ventana 3.9 «Enlaces de registro» (B8 · C6).
//
// Cada enlace vence a los 30 minutos (Herra 1.1.34) y sirve para registrar a
// varias personas mientras esté vigente. Solo se muestra una vez al crearlo:
// se copia al portapapeles y además queda en pantalla con su botón «Copiar»
// por si el portapapeles falla.
import { useEffect, useState } from "react";
import { Copy, LinkSimple, Prohibit, Plus } from "@phosphor-icons/react";
import { communityApi, type Invite, type InviteCreated } from "../../lib/community";
import { useToast } from "../../lib/ToastContext";
import { Modal } from "../Modal";
import { ConfirmDialog } from "../ConfirmDialog";

function fullUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(path.replace(/^\//u, ""), `${window.location.origin}${base}`).toString();
}

function fecha(value: string): string {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString("es-VE", {
    dateStyle: "short", timeStyle: "short",
  });
}

export function InvitesWindow({ title, kicker, onClose }: {
  title: string;
  kicker: string;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [creado, setCreado] = useState<InviteCreated | null>(null);
  const [busy, setBusy] = useState(false);
  const [revocar, setRevocar] = useState<Invite | null>(null);

  async function cargar(): Promise<void> {
    try {
      const data = await communityApi.invites();
      setInvites(data.data);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudieron cargar los enlaces.");
      setInvites([]);
    }
  }

  useEffect(() => { void cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function copiar(texto: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      return false;
    }
  }

  async function generar(): Promise<void> {
    setBusy(true);
    try {
      const invite = await communityApi.createInvite();
      setCreado(invite);
      const copiado = await copiar(fullUrl(invite.invitePath));
      notify(copiado ? "success" : "info", copiado
        ? "Enlace creado y copiado al portapapeles. Vence en 30 minutos."
        : "Enlace creado. Cópialo con el botón: el portapapeles no respondió.");
      await cargar();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo crear el enlace.");
    } finally {
      setBusy(false);
    }
  }

  async function quitar(): Promise<void> {
    if (!revocar) return;
    const invite = revocar;
    setRevocar(null);
    setBusy(true);
    try {
      await communityApi.revokeInvite(invite.id);
      notify("success", "Enlace revocado. Ya no sirve para registrarse.");
      await cargar();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo revocar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} kicker={kicker} onClose={onClose} wide panelClassName="roadmap-admin__window">
      <div className="rw-window">
        <p className="rw-note">
          Cada enlace vence <strong>30 minutos</strong> después de crearse y sirve para registrar a varias personas
          mientras esté vigente. El enlace solo se muestra una vez: al generarlo se copia solo al portapapeles.
        </p>

        <div className="rw-window__bar">
          <button type="button" className="btn btn--primary" onClick={() => void generar()} disabled={busy}>
            <Plus size={15} aria-hidden="true" /> Generar enlace
          </button>
          <span className="community-muted">{invites === null ? "Cargando…" : `${invites.length} ${invites.length === 1 ? "activo" : "activos"}`}</span>
        </div>

        {creado ? (
          <div className="rw-copybox">
            <LinkSimple size={16} aria-hidden="true" />
            <code>{fullUrl(creado.invitePath)}</code>
            <button type="button" className="btn btn--sm"
              onClick={() => void copiar(fullUrl(creado.invitePath)).then((ok) => notify(ok ? "success" : "error", ok ? "Enlace copiado." : "No se pudo copiar; selecciónalo a mano."))}>
              <Copy size={14} aria-hidden="true" /> Copiar
            </button>
            <span className="community-muted">Vence {fecha(creado.expiresAt)}</span>
          </div>
        ) : null}

        {invites && invites.length === 0 ? <p className="community-empty">No hay enlaces de registro activos.</p> : null}

        <ul className="rw-list">
          {(invites ?? []).map((invite) => (
            <li key={invite.id} className="rw-row">
              <span className="rw-row__name">
                Enlace #{invite.id}
                <em>Creado por {invite.created_by || "administración"} · {invite.use_count} {invite.use_count === 1 ? "registro" : "registros"}</em>
              </span>
              <span className="rw-actions">
                <span className="community-muted">Vence {fecha(invite.expires_at)}</span>
                <button type="button" className="btn btn--sm" onClick={() => setRevocar(invite)} disabled={busy}>
                  <Prohibit size={14} aria-hidden="true" /> Revocar
                </button>
              </span>
            </li>
          ))}
        </ul>

        <p className="rw-note">
          Los enlaces no se pueden volver a mostrar: si se pierde uno, revócalo y genera otro. Cada persona elige su
          usuario y su clave al registrarse, y la cuenta queda pendiente de aprobación.
        </p>
      </div>

      {revocar ? (
        <ConfirmDialog
          title="Revocar el enlace"
          description={`El enlace #${revocar.id} dejará de servir para registrarse de inmediato. Las cuentas ya creadas no se tocan.`}
          confirmLabel="Revocar enlace"
          danger
          requireNote={false}
          onClose={() => setRevocar(null)}
          onConfirm={() => void quitar()}
        />
      ) : null}
    </Modal>
  );
}
