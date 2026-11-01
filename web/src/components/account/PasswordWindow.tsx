// CRV · Ventana 3.13 «Mi contraseña» (C12, B10).
//
// «MI CUENTA» / «Cambiar mi contraseña ({usuario})»: contraseña actual y nueva.
// La API (/account/password) exige la confirmación de la nueva; aquí se envía
// dos veces el mismo valor, como hace Herra con su ventana de dos campos.
// Regla de sesiones de Herra: la sesión en curso se reestampa y las demás
// quedan fuera (lo hace el servidor al subir `session_version`).
import { useState, type FormEvent } from "react";
import { Key } from "@phosphor-icons/react";
import { accountApi } from "../../lib/account";
import { useToast } from "../../lib/ToastContext";
import { Modal } from "../Modal";

export function PasswordWindow({ title, kicker, username, onClose }: {
  title: string;
  kicker: string;
  username: string;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (nueva.length < 12) {
      setError("La clave nueva necesita al menos 12 caracteres.");
      return;
    }
    setGuardando(true);
    try {
      await accountApi.password({ currentAccessCode: actual, newAccessCode: nueva, newAccessCodeConfirm: nueva });
      notify("success", "Contraseña cambiada: las demás sesiones quedaron fuera.");
      onClose();
    } catch (caught) {
      const mensaje = caught instanceof Error ? caught.message : "No se pudo cambiar la contraseña.";
      setError(mensaje);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title={title}
      kicker={kicker}
      onClose={onClose}
      sheet
      closeOnOverlay={false}
      panelClassName="roadmap-admin__window password-window"
    >
      <form className="rw-form password-window__form" onSubmit={(event) => void guardar(event)}>
        <p className="rw-form__hint">
          <Key size={16} aria-hidden="true" /> Cambiar mi contraseña ({username}). La clave anterior dejará de
          funcionar y las demás sesiones abiertas se cerrarán.
        </p>
        <label className="rw-field">
          <span>Contraseña actual</span>
          <input
            id="pw-actual"
            type={ver ? "text" : "password"}
            autoComplete="current-password"
            value={actual}
            onChange={(event) => setActual(event.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="rw-field">
          <span>Nueva contraseña</span>
          <input
            id="pw-nueva"
            type={ver ? "text" : "password"}
            autoComplete="new-password"
            value={nueva}
            onChange={(event) => setNueva(event.target.value)}
            required
          />
          <small className="rw-field__help">Mínimo 12 caracteres. Se envía dos veces: no hay campo de repetición.</small>
        </label>
        <label className="rw-check">
          <input type="checkbox" checked={ver} onChange={(event) => setVer(event.target.checked)} />
          <span>Mostrar las claves</span>
        </label>
        {error ? <p className="rw-form__error" role="alert">{error}</p> : null}
        <footer className="rw-form__foot">
          <button type="submit" className="rw-button rw-button--primary" disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" className="rw-button" onClick={onClose} disabled={guardando}>Cancelar</button>
        </footer>
      </form>
    </Modal>
  );
}
