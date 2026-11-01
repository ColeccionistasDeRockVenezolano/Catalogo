// CRV · Ventana 3.7 «Métricas» (C7, B10).
//
// «Personas y bots»: solo las personas suman al contador público; la IA, los
// buscadores y los demás bots pueden entrar y se ven únicamente aquí. El
// informe llega ya agregado por día y tipo desde la API (src/traffic/report.ts);
// aquí no se calcula nada que no sea presentación. Barras con SVG propio, sin
// librería nueva.
import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, Warning } from "@phosphor-icons/react";
import { communityApi, type MetricsPairs, type MetricsReport } from "../../lib/community";
import { useToast } from "../../lib/ToastContext";
import { Modal } from "../Modal";
import { ConfirmDialog } from "../ConfirmDialog";

type Categoria = keyof MetricsPairs;
const CATEGORIAS: Array<{ key: Categoria; label: string; color: string; descripcion: string }> = [
  { key: "human", label: "Personas probables", color: "#4f8ef7", descripcion: "Navegador coherente que no ejecutó el JavaScript." },
  { key: "ai", label: "IA", color: "#f2743b", descripcion: "Rastreadores de modelos: entrenamiento, búsqueda o a petición de una persona." },
  { key: "search", label: "Buscadores", color: "#48b47a", descripcion: "Índices de búsqueda y sus herramientas." },
  { key: "bot", label: "Otros bots", color: "#d9a13b", descripcion: "Vistas previas, SEO, monitores y herramientas." },
  { key: "suspicious", label: "Sospechosos", color: "#e0679b", descripcion: "Dicen ser un navegador y se contradicen." },
];
const PANTALLAS: Record<string, string> = {
  roadmap: "Roadmap", collaborate: "Colaborar", login: "Entrar", register: "Registro",
  activate: "Activación", llms: "llms.txt", sitemap: "sitemap.xml", robots: "robots.txt",
};
const USOS: Record<string, string> = {
  training: "Entrenamiento", search: "Búsqueda", user: "A petición de un usuario", seo: "SEO",
  preview: "Vista previa de enlaces", monitor: "Monitorización", tool: "Herramienta", other: "Otro",
};
const VERIFICACION: Record<string, { label: string; tono: string }> = {
  verified: { label: "Verificado", tono: "ok" },
  unverified: { label: "Solo declarado", tono: "warn" },
  spoofed: { label: "Suplantado", tono: "bad" },
  none: { label: "Mixto", tono: "warn" },
};

const nf = new Intl.NumberFormat("es-VE");
const num = (value: number): string => nf.format(value);
const pct = (current: number, previous: number): string => {
  if (previous <= 0) return current > 0 ? "nuevo en el periodo" : "sin datos";
  const delta = Math.round(((current - previous) / previous) * 100);
  return `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% frente al periodo anterior`;
};
const fecha = (iso: string | null): string => {
  if (!iso) return "—";
  const [date, time] = iso.split(/[ T]/);
  return time ? `${date} ${time.slice(0, 5)}` : date ?? "—";
};

export function MetricsWindow({ title, kicker, onClose }: {
  title: string;
  kicker: string;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [report, setReport] = useState<MetricsReport | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<"visitors" | "requests">("visitors");
  const [dia, setDia] = useState<number | null>(null);
  const [tabla, setTabla] = useState(false);
  const [pestana, setPestana] = useState<"todos" | "ai" | "search" | "bot">("todos");
  const [cero, setCero] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function cargar(periodo: 7 | 30 | 90 = days): Promise<void> {
    setCargando(true);
    setError(null);
    try {
      setReport(await communityApi.metrics(periodo));
      setDia(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el informe.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { void cargar(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const totales = useMemo(() => {
    if (!report) return null;
    const max = Math.max(1, ...report.daily.map((row) => CATEGORIAS.reduce(
      (sum, item) => sum + (item.key === "human" ? row.confirmed : row[item.key][modo === "visitors" ? "visitors" : "requests"]), 0)));
    return { max };
  }, [report, modo]);

  const agentes = useMemo(() => {
    if (!report) return [];
    if (pestana === "todos") return report.agents;
    return report.agents.filter((agent) => agent.category === pestana);
  }, [report, pestana]);

  async function ponerACero(): Promise<void> {
    setGuardando(true);
    try {
      const resultado = await communityApi.resetMetrics();
      notify("success", `Contador a cero: ${num(resultado.daily)} filas diarias y ${num(resultado.visitors)} huellas.`);
      setCero(false);
      await cargar(days);
    } catch (caught) {
      notify("error", caught instanceof Error ? caught.message : "No se pudo poner a cero.");
    } finally {
      setGuardando(false);
    }
  }

  const actual = dia !== null ? report?.daily[dia] : undefined;

  return (
    <Modal title={title} kicker={kicker} onClose={onClose} wide panelClassName="roadmap-admin__window metrics-window">
      <div className="metrics">
        <header className="metrics__head">
          <div>
            <h3>Personas y bots</h3>
            <p>Solo las personas suman al contador público. La IA, los buscadores y los demás bots pueden entrar y se ven únicamente aquí.</p>
          </div>
          <div className="metrics__ranges" role="group" aria-label="Periodo">
            {([7, 30, 90] as const).map((value) => (
              <button key={value} type="button" className={value === days ? "is-active" : ""}
                aria-pressed={value === days} onClick={() => setDays(value)}>{value} días</button>
            ))}
          </div>
        </header>

        {report ? (
          <div className="metrics__meta">
            <span>Del {report.from} al {report.to} · Datos desde el {report.since ?? "—"}</span>
            <span>Listas de bots: {report.verification.lists} de {report.verification.listsTotal} · Actualizado a las {fecha(report.verification.updatedAt)}</span>
            <button type="button" className="metrics__refresh" onClick={() => void cargar(days)} disabled={cargando}>
              <ArrowsClockwise size={14} aria-hidden="true" /> {cargando ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="metrics__error"><Warning size={16} aria-hidden="true" /> {error}</p>
        ) : null}

        {cargando && !report ? <p className="metrics__loading">Cargando el informe…</p> : null}

        {report ? (
          <>
            <section className="metrics__confirmed" aria-label="Personas confirmadas">
              <span className="metrics__confirmed-label">Personas confirmadas</span>
              <strong>{num(report.totals.confirmed.current)}</strong>
              <p>Navegadores coherentes que además ejecutaron el JavaScript de la portada.</p>
              <em>{pct(report.totals.confirmed.current, report.totals.confirmed.previous)}</em>
            </section>

            <div className="metrics__cards">
              {CATEGORIAS.map((item) => {
                const par = report.totals.categories.current[item.key];
                const previo = report.totals.categories.previous[item.key];
                return (
                  <article key={item.key} className="metrics__card" style={{ ["--metric-color" as string]: item.color }}>
                    <span>{item.label}</span>
                    <strong>{num(par.visitors)}</strong>
                    <p>{num(par.requests)} peticiones</p>
                    <em>{pct(par.visitors, previo.visitors)}</em>
                  </article>
                );
              })}
            </div>

            <section className="metrics__block">
              <header className="metrics__block-head">
                <h4>Tráfico diario por tipo</h4>
                <div className="metrics__toggle" role="group" aria-label="Medida">
                  <button type="button" className={modo === "visitors" ? "is-active" : ""} onClick={() => setModo("visitors")}>Visitantes</button>
                  <button type="button" className={modo === "requests" ? "is-active" : ""} onClick={() => setModo("requests")}>Peticiones</button>
                  <button type="button" className={tabla ? "is-active" : ""} onClick={() => setTabla((value) => !value)} aria-pressed={tabla}>Ver como tabla</button>
                </div>
              </header>
              <ul className="metrics__legend">
                {CATEGORIAS.map((item) => (
                  <li key={item.key}><i style={{ background: item.color }} aria-hidden="true" /> {item.label}</li>
                ))}
              </ul>
              {tabla ? (
                <div className="metrics__table-wrap">
                  <table className="metrics__table">
                    <thead><tr><th>Día</th><th>Confirmadas</th>{CATEGORIAS.map((item) => <th key={item.key}>{item.label}</th>)}</tr></thead>
                    <tbody>
                      {report.daily.map((row) => (
                        <tr key={row.day}>
                          <td>{row.day}</td>
                          <td>{num(row.confirmed)}</td>
                          {CATEGORIAS.map((item) => (
                            <td key={item.key}>{num(row[item.key][modo === "visitors" ? "visitors" : "requests"])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <svg className="metrics__chart" viewBox={`0 0 ${Math.max(1, report.daily.length) * 22} 140`}
                    role="img" aria-label="Barras apiladas por día y tipo">
                    {report.daily.map((row, index) => {
                      let y = 140;
                      return (
                        <g key={row.day} onMouseEnter={() => setDia(index)} onFocus={() => setDia(index)}
                          tabIndex={0} role="button" aria-label={row.day}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowRight") setDia(Math.min(report.daily.length - 1, index + 1));
                            if (event.key === "ArrowLeft") setDia(Math.max(0, index - 1));
                          }}>
                          <title>{`${row.day}: ${num(row.confirmed)} personas confirmadas`}</title>
                          <rect x={index * 22 + 2} y={0} width={18} height={140} fill="transparent" />
                          {CATEGORIAS.map((item) => {
                            const value = item.key === "human" && modo === "visitors" ? row.confirmed : row[item.key][modo === "visitors" ? "visitors" : "requests"];
                            const height = totales ? (value / totales.max) * 132 : 0;
                            y -= height;
                            return height > 0
                              ? <rect key={item.key} x={index * 22 + 4} y={y} width={14} height={height} fill={item.color} rx={2} />
                              : null;
                          })}
                          {dia === index ? <rect x={index * 22 + 2} y={0} width={18} height={140} fill="none" stroke="#fff" strokeOpacity={0.5} /> : null}
                        </g>
                      );
                    })}
                  </svg>
                  <p className="metrics__day">
                    {actual
                      ? `${actual.day}: ${num(actual.confirmed)} personas confirmadas · ${CATEGORIAS.map((item) => `${item.label} ${num(actual[item.key][modo === "visitors" ? "visitors" : "requests"])}`).join(" · ")}`
                      : "Pasa el cursor por una barra (o usa las flechas) para ver el día."}
                  </p>
                </>
              )}
            </section>

            <section className="metrics__block">
              <header className="metrics__block-head">
                <h4>Agentes automáticos</h4>
                <div className="metrics__toggle" role="group" aria-label="Tipo de agente">
                  {(["todos", "ai", "search", "bot"] as const).map((value) => {
                    const total = value === "todos"
                      ? report.agents.length
                      : report.agents.filter((agent) => agent.category === value).length;
                    return (
                      <button key={value} type="button" className={pestana === value ? "is-active" : ""}
                        onClick={() => setPestana(value)}>
                        {value === "todos" ? "Todos" : value === "ai" ? "IA" : value === "search" ? "Buscadores" : "Otros bots"} ({total})
                      </button>
                    );
                  })}
                </div>
              </header>
              {agentes.length === 0 ? (
                <p className="metrics__empty">Todavía no hay agentes automáticos en este periodo.</p>
              ) : (
                <div className="metrics__table-wrap">
                  <table className="metrics__table">
                    <thead>
                      <tr><th>Agente</th><th>Uso</th><th>Verificación</th><th>Peticiones</th><th>Visitantes</th><th>Ejecutó JS</th><th>Última visita</th></tr>
                    </thead>
                    <tbody>
                      {agentes.map((agent) => {
                        const principal = (["verified", "spoofed", "unverified", "none"] as const)
                          .reduce((mejor, clave) => (agent.verification[clave] > agent.verification[mejor] ? clave : mejor), "none" as keyof typeof agent.verification);
                        const chip = VERIFICACION[principal] ?? VERIFICACION["none"]!;
                        return (
                          <tr key={agent.key}>
                            <td><strong>{agent.label}</strong><br /><small>{agent.operator} · {agent.category}</small></td>
                            <td>{USOS[agent.purpose] ?? agent.purpose}</td>
                            <td><span className={`metrics__chip metrics__chip--${chip.tono}`}>{chip.label}</span></td>
                            <td>{num(agent.requests)}</td>
                            <td>{num(agent.visitors)}</td>
                            <td>{agent.jsVisitors > 0 ? num(agent.jsVisitors) : "—"}</td>
                            <td>{fecha(agent.lastAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="metrics__two">
              <section className="metrics__block">
                <h4>Pantallas más pedidas</h4>
                {report.pages.length === 0 ? <p className="metrics__empty">Sin peticiones en este periodo.</p> : (
                  <ul className="metrics__pages">
                    {report.pages.map((page) => (
                      <li key={page.page}>
                        <span>{PANTALLAS[page.page] ?? page.page}</span>
                        <div className="metrics__stack" aria-hidden="true">
                          {CATEGORIAS.map((item) => {
                            const value = page[item.key as "human"];
                            const width = page.total > 0 ? (value / page.total) * 100 : 0;
                            return width > 0 ? <i key={item.key} style={{ width: `${width}%`, background: item.color }} /> : null;
                          })}
                        </div>
                        <em>{num(page.total)}</em>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="metrics__block">
                <h4>Países</h4>
                <div className="metrics__countries">
                  <div>
                    <span className="metrics__countries-title">Personas confirmadas</span>
                    {report.countries.people.length === 0 ? <p className="metrics__empty">Sin datos.</p> : (
                      <ul>{report.countries.people.map((country) => (
                        <li key={country.code}><span>{country.name}</span><em>{num(country.count)}</em></li>
                      ))}</ul>
                    )}
                  </div>
                  <div>
                    <span className="metrics__countries-title">Tráfico automático (peticiones)</span>
                    {report.countries.automated.length === 0 ? <p className="metrics__empty">Sin datos.</p> : (
                      <ul>{report.countries.automated.map((country) => (
                        <li key={country.code}><span>{country.name}</span><em>{num(country.count)}</em></li>
                      ))}</ul>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <details className="metrics__how">
              <summary>Como se decide y qué se guarda</summary>
              <ol>
                <li><strong>Persona probable:</strong> un navegador que se comporta como tal (cabeceras coherentes y, si ejecuta JavaScript, el aviso de la portada).</li>
                <li><strong>IA y buscadores:</strong> se reconocen por su User-Agent y se verifican con las listas de IPs que publica cada operador o con su DNS inverso.</li>
                <li><strong>Sospechoso:</strong> dice ser un navegador moderno y le faltan cabeceras que ese navegador manda siempre, o llega marcado como automatizado.</li>
                <li><strong>Detección probabilística:</strong> un robot que conduce un navegador real con un User-Agent normal puede pasar por persona. Se presenta así, no como una certeza.</li>
                <li><strong>Sin IP ni User-Agent de personas:</strong> solo se guarda una huella diaria con sal (HMAC), la categoría, el agente declarado, el país y la pantalla.</li>
                <li><strong>Huella diaria:</strong> cambia cada medianoche de Caracas; dos días no se pueden deduplicar entre sí sin guardar lo que no se quiere guardar.</li>
                <li><strong>Visitantes = persona-día:</strong> la misma unidad del contador público; quien abre tres pantallas cuenta una vez en el resumen del día.</li>
                <li><strong>Listas de IPs:</strong> se descargan una vez al día por un proceso propio, no en cada petición. El contador público acumulado no se toca al poner a cero estas métricas.</li>
              </ol>
            </details>

            <footer className="metrics__foot">
              <div>
                <strong>Poner el contador a cero</strong>
                <p>Borra el agregado diario y las huellas de estos {report.days} días. No cambia el contador público acumulado ({num(report.publicCounter.total)} visitas).</p>
              </div>
              <button type="button" className="metrics__danger" onClick={() => setCero(true)} disabled={guardando}>
                Poner a cero
              </button>
            </footer>
          </>
        ) : null}
      </div>

      {cero ? (
        <ConfirmDialog
          title="Poner el contador a cero"
          description="Se borrará el agregado de tráfico de esta instancia (peticiones, visitantes, agentes y países). El contador público de visitas no cambia. ¿Continuar?"
          confirmLabel="Poner a cero"
          danger
          requireNote={false}
          onConfirm={() => ponerACero()}
          onClose={() => setCero(false)}
        />
      ) : null}
    </Modal>
  );
}
