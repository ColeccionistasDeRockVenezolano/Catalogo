// Arnés visual del panel «De dónde vienen · campañas» con datos inventados (no toca la API).
import { createRoot } from "react-dom/client";
import { AcquisitionReportPanel } from "../../src/components/AcquisitionReportPanel";
import type { AcquisitionDimensions, AcquisitionReport } from "../../src/lib/community";
import "../../src/styles/global.css";
import "../../src/styles/community-ui.css";

const d = (over: Partial<AcquisitionDimensions>): AcquisitionDimensions => ({
  source: "direct", medium: "", campaign: "", content: "", ref: "", referrer: "", method: "direct",
  country: "ve", landing: "roadmap", category: "human", ...over,
});
const row = (dimensions: AcquisitionDimensions, visitors: number, applications = 0) => ({
  dimensions, visitors, js_visitors: Math.round(visitors * 0.8), requests: dimensions.landing === "catalog" ? 0 : visitors, pages: visitors * 2,
  collaborate: Math.round(visitors / 5), radio: Math.round(visitors / 4), applications,
});
const report: AcquisitionReport = {
  from: "2026-10-16", to: "2026-11-14", since: "2026-11-04", links: [
    { id: 1, code: "grupo-rock", label: "Grupo de WhatsApp", source: "whatsapp", medium: "grupo", campaign: "presentacion", content: "", destination: "/", archived: false },
  ],
  rows: [
    row(d({ source: "instagram", medium: "social", campaign: "lanzamiento-catalogo", content: "historia-1", method: "utm", landing: "catalog" }), 48, 2),
    row(d({ source: "instagram", medium: "social", campaign: "lanzamiento-catalogo", content: "post", method: "utm", landing: "catalog", country: "co" }), 12),
    row(d({ source: "whatsapp", medium: "grupo", campaign: "presentacion", ref: "grupo-rock", method: "link" }), 31, 3),
    row(d({ source: "facebook", medium: "social", referrer: "l.facebook.com", method: "referrer", landing: "catalog" }), 9),
    row(d({ source: "google", medium: "organic", referrer: "google.com", method: "referrer" }), 22),
    row(d({}), 40, 1),
    row(d({ source: "gptbot", category: "ai" }), 15),
  ],
};
createRoot(document.getElementById("root")!).render(<div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}><AcquisitionReportPanel report={report} /></div>);
