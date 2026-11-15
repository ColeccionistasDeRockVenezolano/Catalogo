// «De dónde vienen»: procedencia y campañas (utm_*, ?ref=) de la portada y del catálogo.
//
// Solo presentación: el informe llega agregado por día y dimensiones desde
// acquisitionReport (src/traffic/acquisition.ts). Visitantes = huella/día/tipo,
// no personas únicas (ver docs/TRAFFIC_ATTRIBUTION.md).
import { useMemo, useState, type ChangeEvent } from "react";
import { Copy, DownloadSimple } from "@phosphor-icons/react";
import type { AcquisitionDimensions, AcquisitionReport, AcquisitionRow } from "../lib/community";

type Entrada = "all" | "landing" | "catalog";
type Tipo = "human" | "automated" | "suspicious" | "all";
type Grupo = "campaign" | "source" | "medium" | "content" | "ref" | "referrer" | "landing" | "country";
const COUNTS = ["visitors", "js_visitors", "pages", "requests", "collaborate", "radio", "applications"] as const;
type Count = typeof COUNTS[number];
type Fila = { key: string; label: string } & Record<Count, number>;

const ENTRADAS: Array<[Entrada, string]> = [["all", "Todas"], ["landing", "Portada y su recorrido"], ["catalog", "Catálogo"]];
const TIPOS: Array<[Tipo, string]> = [["human", "Personas probables"], ["automated", "Bots, IA y buscadores"], ["suspicious", "Sospechosos"], ["all", "Todo el tráfico"]];
const GRUPOS: Array<[Grupo, string]> = [
  ["campaign", "Campañas (utm_campaign)"], ["source", "Fuentes (utm_source)"], ["medium", "Medios (utm_medium)"],
  ["content", "Variantes (utm_content)"], ["ref", "Enlaces registrados (?ref=)"], ["referrer", "Webs referentes"],
  ["landing", "Páginas de entrada"], ["country", "Países"],
];
const PAGINAS: Record<string, string> = {
  roadmap: "Portada", collaborate: "Colaborar", login: "Entrar", register: "Registro", activate: "Activación", catalog: "Catálogo",
};
const COLUMNAS: Array<[Count, string]> = [
  ["visitors", "Visitantes/día"], ["js_visitors", "Con JS"], ["pages", "Páginas JS"], ["requests", "Solicitudes"],
  ["collaborate", "Colaborar"], ["radio", "Radio"], ["applications", "Candidaturas"],
];
const POR_PAGINA = 15;
const nf = new Intl.NumberFormat("es-VE");
const num = (value: number) => nf.format(value);

function regionName(code: string): string {
  if (!code || code === "zz") return "Desconocido";
  try { return new Intl.DisplayNames(["es"], { type: "region" }).of(code.toUpperCase()) ?? code; } catch { return code; }
}

function matchesTipo(d: AcquisitionDimensions, tipo: Tipo): boolean {
  if (tipo === "all") return true;
  if (tipo === "automated") return d.category === "ai" || d.category === "search" || d.category === "bot";
  return d.category === tipo;
}

function matchesEntrada(d: AcquisitionDimensions, entrada: Entrada): boolean {
  if (entrada === "all") return true;
  return entrada === "catalog" ? d.landing === "catalog" : d.landing !== "catalog";
}

function empty(key: string, label: string): Fila {
  return { key, label, visitors: 0, js_visitors: 0, pages: 0, requests: 0, collaborate: 0, radio: 0, applications: 0 };
}

function add(target: Fila, row: AcquisitionRow): void {
  for (const key of COUNTS) target[key] += Number(row[key]) || 0;
}

function csvCell(value: string | number): string {
  let safe = String(value);
  if (/^[=+@\-\t\r]/u.test(safe)) safe = `'${safe}`;
  return `"${safe.replace(/"/gu, '""')}"`;
}

export function AcquisitionReportPanel({ report }: { report: AcquisitionReport }) {
  const [entrada, setEntrada] = useState<Entrada>("all");
  const [tipo, setTipo] = useState<Tipo>("human");
  const [grupo, setGrupo] = useState<Grupo>("campaign");
  const [buscar, setBuscar] = useState("");
  const [pagina, setPagina] = useState(0);

  const enlaces = useMemo(() => new Map(report.links.map((link) => [link.code, link])), [report.links]);

  const etiqueta = (d: AcquisitionDimensions): string => {
    const value = d[grupo];
    switch (grupo) {
      case "source":
        return value === "direct" ? "Directo / desconocido" : value === "unregistered-link" ? "Enlace no registrado" : value;
      case "campaign": return value || "Sin campaña";
      case "medium": return value || "Sin medio";
      case "content": return value || "Sin variante";
      case "ref": { const link = enlaces.get(value); return value ? (link ? `${link.label} · ${value}` : value) : "Sin enlace registrado"; }
      case "referrer": return value || "Sin web referente";
      case "landing": return PAGINAS[value] ?? value;
      case "country": return regionName(value);
    }
  };

  // Filas del tipo y la entrada elegidos: base de los totales y de la tabla.
  const filtradas = useMemo(
    () => report.rows.filter((row) => matchesTipo(row.dimensions, tipo) && matchesEntrada(row.dimensions, entrada)),
    [report.rows, tipo, entrada],
  );

  const resumen = useMemo(() => {
    const total = empty("total", "Total");
    const conCampana = empty("campana", "Con campaña");
    const catalogo = empty("catalogo", "Catálogo");
    for (const row of filtradas) {
      add(total, row);
      if (row.dimensions.method === "utm" || row.dimensions.method === "link") add(conCampana, row);
      if (row.dimensions.landing === "catalog") add(catalogo, row);
    }
    const campanas = new Set(filtradas.filter((row) => row.dimensions.campaign).map((row) => row.dimensions.campaign));
    return { total, conCampana, catalogo, campanas: campanas.size };
  }, [filtradas]);

  const filas = useMemo(() => {
    const term = buscar.trim().toLocaleLowerCase("es");
    const grouped = new Map<string, Fila>();
    for (const row of filtradas) {
      const label = etiqueta(row.dimensions);
      if (term && !`${label} ${Object.values(row.dimensions).join(" ")}`.toLocaleLowerCase("es").includes(term)) continue;
      const key = row.dimensions[grupo] || "";
      const item = grouped.get(key) ?? empty(key, label);
      add(item, row);
      grouped.set(key, item);
    }
    return [...grouped.values()].sort((a, b) => b.visitors - a.visitors || a.label.localeCompare(b.label, "es"));
  }, [filtradas, grupo, buscar]); // eslint-disable-line react-hooks/exhaustive-deps

  const paginas = Math.max(1, Math.ceil(filas.length / POR_PAGINA));
  const actual = Math.min(pagina, paginas - 1);
  const maximo = Math.max(1, ...filas.map((fila) => fila.visitors));

  function descargar(): void {
    const lines = [["Procedencia", ...COLUMNAS.map(([, label]) => label)].map(csvCell).join(",")];
    for (const fila of filas) lines.push([fila.label, ...COLUMNAS.map(([key]) => fila[key])].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `crv-procedencia-${report.from}_${report.to}-${entrada}-${tipo}-${grupo}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="community-card acquisition-report" aria-labelledby="acquisition-report-title">
      <h2 id="acquisition-report-title">De dónde vienen · campañas</h2>
      <p className="community-muted">
        {report.since
          ? `Del ${report.from} al ${report.to} · Procedencia medida desde el ${report.since} · Día de Caracas.`
          : "La medición empieza con las próximas visitas; las anteriores no tienen procedencia recuperable."}
      </p>

      <div className="acquisition-report__stats">
        <div><strong>{num(resumen.total.visitors)}</strong><span>visitantes/día</span></div>
        <div><strong>{num(resumen.conCampana.visitors)}</strong><span>llegaron con campaña o enlace</span></div>
        <div><strong>{num(resumen.campanas)}</strong><span>campañas distintas</span></div>
        <div><strong>{num(resumen.catalogo.visitors)}</strong><span>entraron por el catálogo</span></div>
        <div><strong>{num(resumen.total.applications)}</strong><span>con candidatura enviada</span></div>
      </div>

      <div className="community-tabs" role="group" aria-label="Página de entrada">
        {ENTRADAS.map(([value, label]) => (
          <button key={value} type="button" className={entrada === value ? "is-active" : ""} aria-pressed={entrada === value}
            onClick={() => { setEntrada(value); setPagina(0); }}>{label}</button>
        ))}
      </div>

      <div className="community-toolbar acquisition-report__controls">
        <div className="field">
          <label htmlFor="acq-group">Agrupar por</label>
          <select id="acq-group" value={grupo} onChange={(event) => { setGrupo(event.target.value as Grupo); setPagina(0); }}>
            {GRUPOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="acq-type">Tipo de tráfico</label>
          <select id="acq-type" value={tipo} onChange={(event) => { setTipo(event.target.value as Tipo); setPagina(0); }}>
            {TIPOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="acq-search">Buscar fuente o campaña</label>
          <input id="acq-search" type="search" maxLength={100} value={buscar} onChange={(event) => { setBuscar(event.target.value); setPagina(0); }} />
        </div>
        <button type="button" className="btn" onClick={descargar} disabled={!filas.length}>
          <DownloadSimple size={14} aria-hidden="true" /> Descargar CSV
        </button>
      </div>

      {filas.length === 0 ? (
        <p className="community-empty">No hay visitas para estos filtros. Comparte un enlace con utm_campaign y vuelve a consultar.</p>
      ) : (
        <div className="community-table-wrap" role="region" aria-label="Procedencias; desplaza para ver todas las columnas" tabIndex={0}>
          <table className="community-table acquisition-report__table">
            <thead>
              <tr><th scope="col">{GRUPOS.find(([value]) => value === grupo)?.[1] ?? "Procedencia"}</th>
                {COLUMNAS.map(([key, label]) => <th key={key} scope="col" className="is-num">{label}</th>)}</tr>
            </thead>
            <tbody>
              {filas.slice(actual * POR_PAGINA, (actual + 1) * POR_PAGINA).map((fila) => (
                <tr key={fila.key}>
                  <th scope="row">
                    <span>{fila.label}</span>
                    <i className="acquisition-report__bar" style={{ width: `${(fila.visitors / maximo) * 100}%` }} aria-hidden="true" />
                  </th>
                  {COLUMNAS.map(([key]) => <td key={key} className="is-num">{num(fila[key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filas.length > POR_PAGINA ? (
        <div className="acquisition-report__pages">
          <button type="button" className="btn" disabled={actual === 0} onClick={() => setPagina(actual - 1)}>Anterior</button>
          <span>{actual + 1} / {paginas}</span>
          <button type="button" className="btn" disabled={actual >= paginas - 1} onClick={() => setPagina(actual + 1)}>Siguiente</button>
        </div>
      ) : null}

      <CampaignLinkBuilder />

      <details className="acquisition-report__help">
        <summary>Cómo leer estos números</summary>
        <p>Cuenta la primera procedencia observada de cada huella por día y tipo de agente, sin cookies; no son personas únicas. Un enlace registrado (<code>?ref=</code>) manda sobre UTM contradictorias; después cuentan las UTM, luego el dominio referente y, sin nada, «Directo / desconocido».</p>
        <p>El catálogo envía un aviso por documento cargado (navegar dentro de la app no vuelve a contar) y no suma «Solicitudes», que mide el gateway solo en la portada. Las pantallas de curaduría y de la cuenta no se miden.</p>
        <p>Se guardan etiquetas, dominio referente, país, página de entrada y conteos. Nunca la URL completa, <code>utm_term</code>, IP ni agente del navegador.</p>
      </details>
    </section>
  );
}

/** Generador local de enlaces UTM hacia el catálogo; no guarda nada en el servidor. */
function CampaignLinkBuilder() {
  const [campos, setCampos] = useState({ path: "/", source: "", medium: "", campaign: "", content: "" });
  const [estado, setEstado] = useState("");
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  const url = (() => {
    const target = new URL(campos.path.replace(/^\/+/u, ""), base);
    for (const [param, key] of [["utm_source", "source"], ["utm_medium", "medium"], ["utm_campaign", "campaign"], ["utm_content", "content"]] as const) {
      const value = campos[key].trim().toLowerCase();
      if (value) target.searchParams.set(param, value);
    }
    return target.toString();
  })();
  const valido = Boolean(campos.source.trim()) && /^\/[^\s?#]*$/u.test(campos.path);
  const set = (key: keyof typeof campos) => (event: ChangeEvent<HTMLInputElement>) => { setCampos({ ...campos, [key]: event.target.value }); setEstado(""); };

  async function copiar(): Promise<void> {
    try { await navigator.clipboard.writeText(url); setEstado("Enlace copiado."); } catch { setEstado("No se pudo copiar; selecciona el enlace y cópialo a mano."); }
  }

  return (
    <details className="acquisition-report__builder">
      <summary>Crear enlace de campaña para el catálogo</summary>
      <p className="community-muted">Las UTM se aceptan sin registrar el enlace. utm_source es obligatoria para que cuenten; usa etiquetas cortas, sin datos personales (máx. 80 caracteres).</p>
      <div className="community-form">
        <div className="field"><label htmlFor="acq-b-path">Página del catálogo</label><input id="acq-b-path" value={campos.path} onChange={set("path")} placeholder="/artistas/123" maxLength={200} /></div>
        <div className="field"><label htmlFor="acq-b-source">Fuente (utm_source) *</label><input id="acq-b-source" value={campos.source} onChange={set("source")} placeholder="instagram" maxLength={80} /></div>
        <div className="field"><label htmlFor="acq-b-medium">Medio (utm_medium)</label><input id="acq-b-medium" value={campos.medium} onChange={set("medium")} placeholder="social" maxLength={80} /></div>
        <div className="field"><label htmlFor="acq-b-campaign">Campaña (utm_campaign)</label><input id="acq-b-campaign" value={campos.campaign} onChange={set("campaign")} placeholder="lanzamiento-catalogo" maxLength={80} /></div>
        <div className="field"><label htmlFor="acq-b-content">Variante (utm_content)</label><input id="acq-b-content" value={campos.content} onChange={set("content")} placeholder="historia-1" maxLength={80} /></div>
      </div>
      <div className="community-link-box">
        <code>{url}</code>
        <button type="button" className="btn" onClick={() => void copiar()} disabled={!valido}><Copy size={14} aria-hidden="true" /> Copiar</button>
      </div>
      <p className="community-muted" role="status">{valido ? estado : "Indica al menos la fuente y una ruta que empiece por «/»."}</p>
    </details>
  );
}
