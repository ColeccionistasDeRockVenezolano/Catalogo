import type { Icon } from "@phosphor-icons/react";
import { Radio } from "@phosphor-icons/react";
import { Link } from "react-router-dom";

// Secciones anunciadas en la navegación que todavía no tienen contenido.
function UpcomingPage({ title, lead, icon: PageIcon }: { title: string; lead: string; icon: Icon }) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="hint" style={{ maxWidth: 640 }}>{lead}</p>
        </div>
      </div>
      <div className="state-block">
        <PageIcon className="icon" aria-hidden="true" />
        <h3>Muy pronto</h3>
        <p>Esta sección está en preparación.</p>
        <div style={{ marginTop: 14 }}><Link to="/artistas" className="btn">Explorar el catálogo</Link></div>
      </div>
    </>
  );
}

export { EphemeridesPage } from "./EphemeridesPage";

export function RadioPage() {
  return <UpcomingPage title="Radio" icon={Radio}
    lead="Una programación continua con la música del catálogo." />;
}
