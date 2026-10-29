import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowSquareOut, BookOpen, CaretRight, ClockCounterClockwise, FileText, InstagramLogo, Lifebuoy,
  ShieldCheck, SignOut, YoutubeLogo, type Icon,
} from "@phosphor-icons/react";
import { SessionChangesList, useSessionChangesContext } from "../components/ChangeFeedback";
import { ADMIN_LINKS, AccountSummary, OperatorLoginForm, useSignOut } from "../components/OperatorSettings";
import { RowsSkeleton } from "../components/Skeletons";
import { CRV_CONTACT_URL } from "../lib/communityPages";
import { useOperator } from "../lib/OperatorContext";
import "../styles/account.css";

const HELP_ICONS: Record<string, Icon> = { "/ayuda": Lifebuoy, "/terminos": FileText, "/privacidad": ShieldCheck };
const HELP_LINKS = [
  { to: "/ayuda", label: "Ayuda y comunidad", hint: "Preguntas frecuentes y cómo aportar" },
  { to: "/terminos", label: "Términos de uso", hint: "Derechos, reclamos y aviso de contenido" },
  { to: "/privacidad", label: "Política de privacidad", hint: "Qué datos guardamos y para qué" },
] as const;
const EXTERNAL_LINKS = [
  { href: CRV_CONTACT_URL, label: "Contacto y aportes", hint: "Escríbenos por Instagram", icon: InstagramLogo },
  { href: "https://www.youtube.com/channel/UCtYlrz6GyvRahlhHjocWQYQ", label: "Nuestro canal", hint: "Discos completos y entrevistas", icon: YoutubeLogo },
  { href: "https://coleccionistasderockvenezolano.wordpress.com/", label: "Historias del archivo", hint: "El blog de la colección", icon: BookOpen },
] as const;

/** Una fila de la página: icono, nombre con su explicación y flecha. */
function AccountRow({ icon: RowIcon, label, hint, trailing }: { icon: Icon; label: string; hint: string; trailing?: ReactNode }) {
  return (
    <>
      <span className="account-row__icon" aria-hidden="true"><RowIcon size={20} /></span>
      <span className="account-row__text">{label}<small>{hint}</small></span>
      {trailing ?? <CaretRight className="account-row__caret" size={16} weight="bold" aria-hidden="true" />}
    </>
  );
}

/**
 * Cuenta en el móvil: la pestaña «Cuenta» de la barra inferior abre esta
 * página en lugar del menú flotante de escritorio. Reúne el acceso, los
 * cambios de la sesión, la administración y la ayuda, cada cosa en su bloque.
 */
export function AccountPage() {
  const { user, isAdmin, isChecking } = useOperator();
  const changes = useSessionChangesContext();
  const { signingOut, signOut } = useSignOut();

  return (
    <div className="account-page">
      <header className="account-page__head">
        <h1>Cuenta</h1>
        <p>{user ? `Sesión abierta como ${user.name}.` : "Acceso de colaboradores, ayuda y contacto."}</p>
      </header>

      {isChecking && !user ? <RowsSkeleton rows={3} label="Comprobando acceso…" /> : user ? (
        <section className="account-block" aria-label="Tu sesión">
          <AccountSummary />
        </section>
      ) : (
        <section className="account-block" aria-labelledby="account-login-title">
          <h2 id="account-login-title" className="account-block__title">Iniciar sesión</h2>
          <p className="operator-help">
            Solo para colaboradores con cuenta administradora: editar, fusionar y usar Curaduría. Consultar el catálogo no requiere cuenta.
          </p>
          <OperatorLoginForm />
        </section>
      )}

      {isAdmin && changes ? (
        <section className="account-block account-block--flush" aria-labelledby="account-changes-title">
          <div className="account-block__head">
            <h2 id="account-changes-title" className="account-block__label">Cambios de esta sesión</h2>
            {changes.entries.length ? <button type="button" className="account-block__clear" onClick={changes.clear}>Vaciar lista</button> : null}
          </div>
          <SessionChangesList entries={changes.entries} onNavigate={() => {}} onUndo={changes.openUndo} />
        </section>
      ) : null}

      {isAdmin ? (
        <nav className="account-block account-block--flush" aria-labelledby="account-admin-title">
          <h2 id="account-admin-title" className="account-block__label">Administrar</h2>
          <ul className="account-rows">
            <li><Link to="/historial" className="account-row"><AccountRow icon={ClockCounterClockwise} label="Historial" hint="Todo cambio del catálogo, con su deshacer" /></Link></li>
            {ADMIN_LINKS.map((link) => (
              <li key={link.to}><Link to={link.to} className="account-row"><AccountRow icon={link.icon} label={link.label} hint={link.hint} /></Link></li>
            ))}
          </ul>
        </nav>
      ) : null}

      <nav className="account-block account-block--flush" aria-labelledby="account-help-title">
        <h2 id="account-help-title" className="account-block__label">Ayuda y condiciones</h2>
        <ul className="account-rows">
          {HELP_LINKS.map((link) => (
            <li key={link.to}><Link to={link.to} className="account-row"><AccountRow icon={HELP_ICONS[link.to]!} label={link.label} hint={link.hint} /></Link></li>
          ))}
        </ul>
      </nav>

      <nav className="account-block account-block--flush" aria-labelledby="account-connect-title">
        <h2 id="account-connect-title" className="account-block__label">Conecta con CRV</h2>
        <ul className="account-rows">
          {EXTERNAL_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} target="_blank" rel="noreferrer" className="account-row">
                <AccountRow icon={link.icon} label={link.label} hint={link.hint}
                  trailing={<><ArrowSquareOut className="account-row__caret" size={16} aria-hidden="true" /><span className="visually-hidden"> (abre en otra pestaña)</span></>} />
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {user ? (
        <button type="button" className="account-signout" onClick={() => void signOut()} disabled={signingOut}>
          <SignOut size={18} weight="bold" aria-hidden="true" />
          {signingOut ? "Cerrando…" : "Cerrar sesión"}
        </button>
      ) : null}
    </div>
  );
}
