import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EntityFormModal } from "../../src/components/EntityFormModal";
import { ARTIST_FIELDS } from "../../src/lib/entityFields";
import "../../src/styles/global.css";
import "../../src/styles/feedback.css";
import "../../src/styles/entity-editor.css";

// Formulario real con actualizaciones del padre, como las de un reproductor en marcha.
function Fixture() {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const block = () => setBlocked(value => !value);
    window.addEventListener("qa:refresh", refresh);
    window.addEventListener("qa:block", block);
    return () => {
      window.removeEventListener("qa:refresh", refresh);
      window.removeEventListener("qa:block", block);
    };
  }, []);
  return <main style={{ padding: 24, minHeight: 2200 }}>
    <div style={{ height: 500 }} />
    <button type="button" className="btn" onClick={() => setOpen(true)}>Editar ficha de prueba</button>
    <output data-testid="revision">{revision}</output>
    <output data-testid="blocked">{String(blocked)}</output>
    {open ? <EntityFormModal title="Editar ficha de prueba" fields={ARTIST_FIELDS}
      initialValues={{ name: "Artista de prueba", artistType: "band", biography: "Biografía de prueba" }}
      onClose={() => { if (!blocked) setOpen(false); }}
      onSubmit={async () => { throw new Error("Esta prueba no guarda datos"); }}
      onSuccess={() => { throw new Error("Esta prueba no guarda datos"); }} /> : null}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
