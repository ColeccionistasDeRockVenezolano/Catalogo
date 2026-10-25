import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ToastProvider, registerChangeToast, toastManager, useToast } from "../../src/lib/ToastContext";
import "../../src/styles/global.css";
import "../../src/styles/feedback.css";

function Fixture() {
  const { notify } = useToast();
  const [actions, setActions] = useState(0);
  return <main className="container" style={{ paddingTop: 32 }}>
    <h1>Avisos del catálogo</h1>
    <div className="page-actions">
      <button className="btn" onClick={() => notify("info", "Imagen en proceso", { durationMs: 0 })}>Mostrar aviso</button>
      <button className="btn" onClick={() => notify("error", "La fuente no responde. Revisa la ficha y vuelve a intentarlo.", { durationMs: 0 })}>Mostrar error</button>
      <button className="btn" onClick={() => notify("success", "Imagen guardada", { action: { label: "Deshacer", onAction: () => setActions(value => value + 1) }, durationMs: 0 })}>Aviso con acción</button>
      <button className="btn" onClick={() => { for (let i = 1; i <= 5; i++) notify("info", `Aviso ${i}`, { durationMs: 0 }); }}>Mostrar cinco</button>
      <button className="btn" onClick={() => { const id = toastManager.add({ title: "Cambio guardado", type: "success", timeout: 0 }); registerChangeToast(id); }}>Aviso de cambio</button>
      <button className="btn" onClick={() => notify("success", "Otra operación completada")}>Nuevo éxito</button>
      <button className="btn" onClick={() => notify("info", "Aviso temporal", { durationMs: 1000 })}>Aviso temporal</button>
    </div>
    <p>Acciones realizadas: {actions}</p>
    <div style={{ height: 1200 }}>Contenido desplazable</div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ToastProvider><Fixture /></ToastProvider>);
