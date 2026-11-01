// CRV · Curaduría › Visitas y métricas (Fase 2).
//
// Lectura de las tablas existentes: `project_visits` (personas, últimos 3 días),
// `project_visit_stats` (histórico por país) y `traffic_daily`/`traffic_visitors`
// (solicitudes, páginas y agentes). No escribe nada.
import { useAsync } from "../lib/useAsync";
import { roadmapApi, type AdminVisits } from "../lib/roadmap";
import { ErrorState, LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";

const number = new Intl.NumberFormat("es-VE");

function dayLabel(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year?.slice(2)}`;
}

export function CurationVisitsPage() {
  const visits = useAsync<AdminVisits>(() => roadmapApi.adminVisits(30), []);

  if (visits.loading) return <div className="community-page"><LoadingState label="Cargando las visitas…" /></div>;
  if (visits.error) return <div className="community-page"><ErrorState message={visits.error} onRetry={() => void visits.reload()} /></div>;
  const data = visits.data;
  if (!data) return null;

  return (
    <div className="community-page">
      <div className="page-header">
        <div>
          <h1>Visitas y métricas</h1>
          <p className="hint">Personas por día, histórico por país y solicitudes de las pantallas públicas. Los últimos 3 días conservan el detalle; el histórico por país no se poda.</p>
        </div>
      </div>

      <div className="roadmap-admin__stats">
        <div><strong>{number.format(data.today)}</strong><span>personas hoy</span></div>
        <div><strong>{number.format(data.online)}</strong><span>en línea (5 min)</span></div>
        <div><strong>{number.format(data.total)}</strong><span>visitas históricas</span></div>
        <div><strong>{number.format(data.trafficRequests)}</strong><span>solicitudes (30 días)</span></div>
      </div>

      <div className="community-grid">
        <section className="community-card">
          <h2>Países (histórico)</h2>
          <div className="community-table-wrap">
            <table className="community-table">
              <thead><tr><th>País</th><th>Visitas</th></tr></thead>
              <tbody>
                {data.totalCountries.map((country) => (
                  <tr key={country.code}><td>{country.name} <span className="community-muted">{country.code}</span></td><td>{number.format(country.count)}</td></tr>
                ))}
                {data.totalCountries.length === 0 ? <tr><td colSpan={2} className="community-empty">Sin datos.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="community-card">
          <h2>Países (hoy)</h2>
          <div className="community-table-wrap">
            <table className="community-table">
              <thead><tr><th>País</th><th>Personas</th></tr></thead>
              <tbody>
                {data.todayCountries.map((country) => (
                  <tr key={country.code}><td>{country.name} <span className="community-muted">{country.code}</span></td><td>{number.format(country.count)}</td></tr>
                ))}
                {data.todayCountries.length === 0 ? <tr><td colSpan={2} className="community-empty">Sin visitas hoy.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="community-card">
        <h2>Últimos 30 días</h2>
        <div className="community-table-wrap">
          <table className="community-table">
            <thead><tr><th>Día</th><th>Personas</th><th>Solicitudes</th><th>Visitantes únicos</th></tr></thead>
            <tbody>
              {data.daily.map((row) => (
                <tr key={row.day}>
                  <td>{dayLabel(row.day)}</td>
                  <td>{number.format(row.visits)}</td>
                  <td>{number.format(row.requests)}</td>
                  <td>{number.format(row.uniqueVisitors)}</td>
                </tr>
              ))}
              {data.daily.length === 0 ? <tr><td colSpan={4} className="community-empty">Sin tráfico registrado.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="community-muted">«Personas» sale de `project_visits` (detalle de 3 días); el resto, de `traffic_daily`/`traffic_visitors`.</p>
      </section>

      <div className="community-grid">
        <section className="community-card">
          <h2>Pantallas</h2>
          <div className="community-table-wrap">
            <table className="community-table">
              <thead><tr><th>Pantalla</th><th>Categoría</th><th>Solicitudes</th><th>Visitantes</th></tr></thead>
              <tbody>
                {data.pages.map((row) => (
                  <tr key={`${row.page}-${row.category}`}>
                    <td>{row.page}</td><td className="community-muted">{row.category}</td>
                    <td>{number.format(row.requests)}</td><td>{number.format(row.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="community-card">
          <h2>Agentes</h2>
          <div className="community-table-wrap">
            <table className="community-table">
              <thead><tr><th>Agente</th><th>Solicitudes</th></tr></thead>
              <tbody>
                {data.agents.map((row) => (
                  <tr key={row.agent}><td>{row.agent || "—"}</td><td>{number.format(row.requests)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
