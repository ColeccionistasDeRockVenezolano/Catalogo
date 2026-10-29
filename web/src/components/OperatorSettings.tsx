import { useState, type FormEvent } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Popover } from "@base-ui/react/popover";
import { CaretDown, ClockCounterClockwise, GearSix, SignIn, SignOut, SlidersHorizontal, Stack, type Icon } from "@phosphor-icons/react";
import { Modal } from "./Modal";
import { SessionChangesList, useSessionChangesContext, type SessionChanges } from "./ChangeFeedback";
import { ApiError } from "../lib/api";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";

export function OperatorPill() {
  const { user, isAdmin } = useOperator();
  if (isAdmin && user) return <AdminAccountMenu name={user.name} username={user.username} />;
  return <OperatorButton />;
}

/** Sin sesión o con cuenta de solo lectura: la píldora abre el diálogo de acceso. */
function OperatorButton() {
  const { user, isChecking } = useOperator();
  const isSignedIn = user !== null;
  const [open, setOpen] = useState(false);
  const initial = user?.name.trim().charAt(0).toUpperCase() || "?";
  const label = isChecking ? "Comprobando acceso" : user?.name ?? "Solo lectura";

  return (
    <>
      <button
        type="button"
        className={`operator-pill ${isSignedIn ? "is-active" : ""}`}
        onClick={() => setOpen(true)}
        aria-busy={isChecking}
        aria-label={isSignedIn ? `Sesión de ${label}` : "Iniciar sesión como colaborador"}
        title={isSignedIn ? `Sesión de ${label}` : "Iniciar sesión como colaborador"}
      >
        <span className="dot" aria-hidden="true" />
        {isSignedIn ? <span className="chip" aria-hidden="true">{initial}</span> : <SignIn className="operator-icon" aria-hidden="true" weight="bold" />}
        <span className="operator-label">{label}</span>
      </button>
      {open ? <OperatorDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export const ADMIN_LINKS: ReadonlyArray<{ to: string; label: string; hint: string; icon: Icon }> = [
  { to: "/administrar/buscador", label: "Buscador y descubrimiento", hint: "Consultas, fuentes y decisiones", icon: SlidersHorizontal },
  { to: "/curaduria", label: "Curaduría", hint: "Revisar y cuidar el catálogo", icon: Stack },
  { to: "/configuracion/temas", label: "Configuración", hint: "Temas del catálogo", icon: GearSix },
];

export const ADMIN_AREA = /^\/(historial|curaduria|configuracion|administrar)(\/|$)/u;

/** Cierra la sesión con su aviso; lo comparten el menú, el diálogo y la página «Cuenta». */
export function useSignOut() {
  const { logout } = useOperator();
  const { notify } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  async function signOut(): Promise<boolean> {
    setSigningOut(true);
    try {
      await logout();
      notify("success", "Sesión cerrada. El catálogo queda en solo lectura.");
      return true;
    } catch (reason: unknown) {
      notify("error", reason instanceof ApiError ? reason.message : "No se pudo cerrar la sesión.");
      return false;
    } finally {
      setSigningOut(false);
    }
  }
  return { signingOut, signOut };
}

/**
 * Cuenta administradora: la píldora abre (al pasar el puntero o con clic) el
 * menú de la cuenta con los cambios de esta sesión, el Historial y Administrar.
 * Aquí vive también el deshacer de la sesión (avisos y Ctrl/⌘+Z).
 */
function AdminAccountMenu({ name, username }: { name: string; username: string }) {
  const { pathname } = useLocation();
  const changes = useSessionChangesContext() ?? NO_CHANGES;
  const [open, setOpen] = useState(false);
  const { signingOut, signOut } = useSignOut();
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const close = () => setOpen(false);

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          openOnHover
          delay={120}
          closeDelay={240}
          className={`operator-pill is-active is-admin${ADMIN_AREA.test(pathname) ? " is-current" : ""}`}
          aria-label={`Cuenta de ${name}: cambios de esta sesión, Historial y Administrar${changes.pending ? ` (${changes.pending} cambios sin deshacer)` : ""}`}
        >
          <span className="chip" aria-hidden="true">{initial}</span>
          <span className="operator-label">{name}</span>
          {changes.pending > 0 ? <span className="operator-pill__count" aria-hidden="true">{changes.pending > 9 ? "9+" : changes.pending}</span> : null}
          <CaretDown className="operator-pill__caret" size={12} weight="bold" aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} align="end" collisionPadding={12} className="operator-menu__positioner">
            <Popover.Popup className="operator-menu">
              <div className="operator-menu__identity">
                <span className="account-avatar" aria-hidden="true">{initial}</span>
                <div>
                  <Popover.Title className="operator-menu__name">{name}</Popover.Title>
                  <span>@{username} · Administrador</span>
                </div>
              </div>

              <section className="operator-menu__changes" aria-labelledby="operator-menu-changes">
                <div className="operator-menu__head">
                  <h2 id="operator-menu-changes">Cambios de esta sesión</h2>
                  <span className="recent-changes__keys"><kbd>Ctrl</kbd>+<kbd>Z</kbd> deshace el último</span>
                </div>
                <SessionChangesList entries={changes.entries} onNavigate={close} onUndo={(runId) => { close(); changes.openUndo(runId); }} />
                {changes.entries.length ? (
                  <button type="button" className="operator-menu__clear" onClick={changes.clear}>Vaciar lista</button>
                ) : null}
              </section>

              <nav className="operator-menu__nav" aria-label="Administración">
                <NavLink to="/historial" className="operator-menu__link" onClick={close}>
                  <ClockCounterClockwise size={20} aria-hidden="true" />
                  <span>Historial<small>Todo cambio del catálogo, con su deshacer</small></span>
                </NavLink>
                <p className="operator-menu__label">Administrar</p>
                {ADMIN_LINKS.map((link) => (
                  <NavLink key={link.to} to={link.to} className="operator-menu__link" onClick={close}>
                    <link.icon size={20} aria-hidden="true" />
                    <span>{link.label}<small>{link.hint}</small></span>
                  </NavLink>
                ))}
              </nav>

              <div className="operator-menu__foot">
                <button type="button" className="operator-menu__signout" onClick={() => void signOut()} disabled={signingOut}>
                  <SignOut size={18} weight="bold" aria-hidden="true" />
                  {signingOut ? "Cerrando…" : "Cerrar sesión"}
                </button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

const NO_CHANGES: SessionChanges = { entries: [], pending: 0, clear: () => {}, openUndo: () => {}, dialog: null };

export function OperatorDialog({ onClose }: { onClose: () => void }) {
  const { user } = useOperator();
  const { signingOut, signOut } = useSignOut();

  if (user) {
    return (
      <Modal title="Cuenta de colaborador" onClose={onClose}>
        <AccountSummary />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Volver</button>
          <button type="button" className="btn btn--danger" onClick={() => void signOut().then((done) => { if (done) onClose(); })} disabled={signingOut}>
            <SignOut aria-hidden="true" weight="bold" />
            {signingOut ? "Cerrando…" : "Cerrar sesión"}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Acceso de colaboradores" onClose={onClose}>
      <p className="operator-help">
        Inicia sesión con una cuenta administradora para editar, fusionar y usar Curaduría. Consultar el catálogo no requiere cuenta.
      </p>
      <OperatorLoginForm onSignedIn={onClose} onCancel={onClose} />
    </Modal>
  );
}

/** Quién tiene la sesión abierta, su rol y qué puede hacer con él. */
export function AccountSummary() {
  const { user } = useOperator();
  if (!user) return null;
  return (
    <>
      <div className="account-summary">
        <span className="account-avatar" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
        <div>
          <strong>{user.name}</strong>
          <span>@{user.username}</span>
        </div>
        <span className={`badge account-role ${user.role === "admin" ? "badge--teal" : "badge--outline"}`}>
          {user.role === "admin" ? "Administrador" : "Solo lectura"}
        </span>
      </div>
      <p className="operator-help">
        {user.role === "admin"
          ? "Cuenta administradora: puedes editar, fusionar y usar Curaduría. Tus cambios quedan firmados con esta cuenta en el historial del catálogo."
          : "Cuenta de solo lectura: puedes consultar el catálogo, pero editar, fusionar y usar Curaduría requiere una cuenta administradora."}
      </p>
    </>
  );
}

/** Usuario y contraseña; lo usan el diálogo de acceso y la página «Cuenta» del móvil. */
export function OperatorLoginForm({ onSignedIn, onCancel }: { onSignedIn?: () => void; onCancel?: () => void }) {
  const { login } = useOperator();
  const { notify } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      setPassword("");
      notify("success", `Sesión iniciada como ${username.trim()}.`);
      onSignedIn?.();
    } catch (reason: unknown) {
      setError(reason instanceof ApiError ? reason.message : "No se pudo iniciar sesión. Inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleLogin(event)}>
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="op-username">Usuario</label>
          <input
            id="op-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="tu.usuario"
            required
            minLength={3}
            maxLength={80}
          />
        </div>
        <div className="field span-2">
          <label htmlFor="op-password">Contraseña</label>
          <input
            id="op-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            maxLength={200}
          />
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="form-actions">
        {onCancel ? <button type="button" className="btn" onClick={onCancel}>Cancelar</button> : null}
        <button type="submit" className="btn btn--primary" disabled={submitting || username.trim().length < 3 || !password}>
          {submitting ? "Verificando…" : "Iniciar sesión"}
        </button>
      </div>
    </form>
  );
}
