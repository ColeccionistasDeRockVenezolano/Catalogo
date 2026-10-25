import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { CurationImagesPage } from "../../src/pages/CurationImagesPage";
import { ImageCurationProgress } from "../../src/components/ImageCurationProgress";
import { ToastProvider } from "../../src/lib/ToastContext";
import { authApi } from "../../src/lib/api";
import { startImageQueue } from "../../src/lib/imageCurationQueue";
import { setSessionCsrf } from "../../src/lib/operator";
import "../../src/styles/global.css";
import "../../src/styles/feedback.css";

if (new URLSearchParams(location.search).has("real")) await authApi.me();
else setSessionCsrf("image-curation-qa-csrf");
function QueueSync() { useEffect(() => startImageQueue(), []); return null; }
createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><ToastProvider>
  <QueueSync /><main className="container" style={{ paddingTop: 24 }}>
    <nav className="page-actions"><Link to="/curaduria/imagenes">Portadas y fotos</Link><Link to="/otra">Otra página</Link></nav>
    <h1>Portadas y fotos</h1>
    <ImageCurationProgress compact />
    <Routes><Route path="/curaduria/imagenes" element={<CurationImagesPage />} /><Route path="*" element={<p>Otra tarea de curaduría</p>} /></Routes>
  </main>
</ToastProvider></BrowserRouter></StrictMode>);
