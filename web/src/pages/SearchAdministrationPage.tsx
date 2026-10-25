// CRV · Administrar › Buscador y descubrimiento.
//
// El mismo marco que Configuración: un menú de secciones a la izquierda y el
// contenido con su título, una introducción corta y lo que hay que decidir.
// Las explicaciones de cómo se mide cada cosa quedan plegadas en «Cómo se
// calcula», a mano pero sin tapar las cifras.
//
// También viven aquí las revisiones humanas del buscador que antes estaban en
// Curaduría (emociones, evaluación de lecturas y correspondencias RYM): son
// decisiones sobre cómo se busca, no sobre las fichas.
import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useSearchParams } from "react-router-dom";
import {
  BookOpen, ChartLineUp, Database, Gauge, Heart, Info, LockSimple, MagnifyingGlass, MagnifyingGlassMinus, Scales, SignIn, Sparkle, TreeStructure, type Icon,
} from "@phosphor-icons/react";
import { SearchKnowledgeReview } from "../components/SearchKnowledgeReview";
import { ResourceFieldTable } from "../components/ResourceFieldTable";
import { SearchKnowledgePanel } from "../components/SearchKnowledgePanel";
import { EntityPicker } from "../components/EntityPicker";
import { NoteField } from "../components/NoteField";
import { useOperator } from "../lib/OperatorContext";
import { aliasWrites, ApiError, searchApi, type EntityPath } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { aliasTypeLabel } from "../lib/labels";
import { formatCount } from "../lib/curation";
import { OperatorDialog } from "../components/OperatorSettings";
import { ErrorState } from "../components/StateViews";
import { RowsSkeleton } from "../components/Skeletons";
import { CurationEmotionsPage } from "./CurationEmotionsPage";
import { CurationSearchEvaluationPage } from "./CurationSearchEvaluationPage";
import { CurationSearchMappingsPage } from "./CurationSearchMappingsPage";
import { LayaEvaluation } from "../components/LayaEvaluation";
import "../styles/search-administration.css";
import "../styles/curation-emotions.css";

type Administration = Awaited<ReturnType<typeof searchApi.administration>>;

const qualityNames: Record<string, string> = { received: "Eventos recibidos", queued: "Encolados", duplicates: "Duplicados", excluded: "Excluidos", lost: "Perdidos", failed: "Intentos de escritura fallidos", invalid: "Recibos inválidos", requests: "Peticiones elegibles", previews: "Peticiones sin confirmación", receiptsExpired: "Recibos caducados", persisted: "Intentos persistidos", lastFlush: "Último vaciado", pending: "Pendientes", receipts: "Recibos en memoria", version: "Versión" };
const metrics = { unresolved_entities: "Entidades no resueltas", undetermined_entities: "Resolución aún no determinada", total: "Búsquedas confirmadas", direct: "Directas", emotional: "Emocionales", contextual: "Contextuales", mixed: "Combinadas", unidentified: "Interpretación pendiente", incidents: "Con incidente técnico", failures: "Fallos terminales", empty: "Sin resultados", navigations: "Navegaciones directas", cache_hits: "Respuestas de caché" };

interface SectionSpec {
  key: string;
  label: string;
  group: "Lecturas" | "Decidir" | "Referencia";
  icon: Icon;
  intro?: string;
  /** La sección trae su propio encabezado (las revisiones que venían de Curaduría). */
  ownHeader?: boolean;
  /** No necesita las lecturas del buscador para mostrarse. */
  standalone?: boolean;
}

const SECTIONS: readonly SectionSpec[] = [
  { key: "Resumen", label: "Resumen", group: "Lecturas", icon: Gauge, intro: "Cómo se está usando el buscador en los últimos 30 días y qué conviene atender." },
  { key: "Consultas y patrones", label: "Consultas", group: "Lecturas", icon: MagnifyingGlass, intro: "Las consultas confirmadas más frecuentes, agrupadas por texto exacto." },
  { key: "Sugerencias", label: "Sugerencias", group: "Lecturas", icon: Sparkle, intro: "Qué sugerencias se exponen y cómo responde la gente a ellas." },
  { key: "Alimentación", label: "Fuentes", group: "Lecturas", icon: Database, intro: "Las fuentes que alimentan el conocimiento del buscador y su estado de revisión." },
  { key: "Sin resultados", label: "Sin resultados", group: "Decidir", icon: MagnifyingGlassMinus, intro: "Lo que la gente buscó y no encontró. Si la consulta es otra forma de escribir una ficha que existe, añádela como alias y la próxima vez aparecerá." },
  { key: "Conocimiento", label: "Conocimiento", group: "Decidir", icon: BookOpen, intro: "Afirmaciones propuestas para el buscador, pendientes de una decisión humana." },
  { key: "Emociones", label: "Emociones", group: "Decidir", icon: Heart, ownHeader: true, standalone: true },
  { key: "Evaluar lecturas", label: "Evaluar lecturas", group: "Decidir", icon: Scales, ownHeader: true, standalone: true },
  { key: "Correspondencias RYM", label: "Correspondencias RYM", group: "Decidir", icon: TreeStructure, ownHeader: true, standalone: true },
  { key: "Laya y evaluación", label: "Laya y evaluación", group: "Decidir", icon: ChartLineUp, standalone: true,
    intro: "Modelos de Laya evaluados contra criterios congelados. Activar o desactivar deja una fila atribuida y reversible; no cambia decisiones humanas ni el buscador público." },
  { key: "Cómo funciona", label: "Cómo funciona", group: "Referencia", icon: Info, intro: "Las reglas que gobiernan el buscador y dónde se deshace cada decisión.", standalone: true },
];
/** Nombres antiguos de `?seccion=` que siguen funcionando en enlaces guardados. */
const LEGACY: Record<string, string> = { "Reglas e historial": "Cómo funciona" };

export function SearchAdministrationPage() {
  const { isAdmin, isChecking } = useOperator();
  const [signingIn, setSigningIn] = useState(false);
  const [params, setParams] = useSearchParams();
  const reviewId = Number(params.get("revision"));
  const requested = params.get("seccion") ?? "Resumen";
  const section = SECTIONS.find((item) => item.key === (LEGACY[requested] ?? requested)) ?? SECTIONS[0]!;
  const { data, loading, error, reload } = useAsync(signal => isAdmin ? searchApi.administration(signal) : Promise.resolve(null), [isAdmin]);

  if (isChecking) return <p role="status">Comprobando acceso…</p>;
  if (!isAdmin) return <div className="state-block access-block">
    <LockSimple size={32} aria-hidden="true" /><h1>Buscador y descubrimiento</h1>
    <p>Esta sección requiere una cuenta administradora.</p>
    <button type="button" className="btn" onClick={() => setSigningIn(true)}><SignIn size={18} aria-hidden="true" />Iniciar sesión</button>
    {signingIn ? <OperatorDialog onClose={() => setSigningIn(false)} /> : null}
  </div>;

  const emptyQueue = data ? missingQueries(data) : [];
  const counts: Record<string, number | undefined> = { "Sin resultados": data ? emptyQueue.length : undefined };

  return (
    <div className="settings-shell search-admin">
      <aside className="settings-sidebar" aria-label="Buscador y descubrimiento">
        <h1>Buscador</h1>
        <nav aria-label="Secciones del buscador">
          {(["Lecturas", "Decidir", "Referencia"] as const).map((group) => (
            <div key={group} className="search-admin__nav-group">
              <p className="search-admin__nav-heading">{group}</p>
              {SECTIONS.filter((item) => item.group === group).map((item) => (
                <NavLink key={item.key} to={`/administrar/buscador?seccion=${encodeURIComponent(item.key)}`}
                  className={() => (item.key === section.key ? "active" : "")} aria-current={item.key === section.key ? "page" : undefined}>
                  <item.icon size={20} aria-hidden="true" />
                  <span className="search-admin__nav-label">{item.label}</span>
                  {counts[item.key] ? <span className="search-admin__nav-count">{formatCount(counts[item.key]!)}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <section className="settings-content" aria-labelledby={section.ownHeader ? undefined : "search-admin-title"} aria-label={section.ownHeader ? section.label : undefined}>
        {section.ownHeader ? null : (
          <header className="search-admin__header">
            <div>
              <h2 id="search-admin-title">{section.label}</h2>
              {section.intro ? <p className="settings-intro">{section.intro}</p> : null}
            </div>
            {section.standalone ? null : (
              <button type="button" className="btn btn--sm" onClick={reload} disabled={loading}>{loading ? "Actualizando…" : "Actualizar lecturas"}</button>
            )}
          </header>
        )}

        {section.key === "Emociones" ? <CurationEmotionsPage />
          : section.key === "Evaluar lecturas" ? <CurationSearchEvaluationPage />
          : section.key === "Correspondencias RYM" ? <CurationSearchMappingsPage />
          : section.key === "Cómo funciona" ? <HowItWorks />
          : section.key === "Laya y evaluación" ? <LayaEvaluation />
          : error ? <ErrorState message={error} onRetry={reload} />
          : !data ? <RowsSkeleton rows={5} label="Cargando lecturas…" />
          : section.key === "Resumen" ? <Overview data={data} queue={emptyQueue} onOpen={(key) => setParams({ seccion: key })} />
          : section.key === "Consultas y patrones" ? <Queries data={data} />
          : section.key === "Sin resultados" ? <EmptyQueue queue={emptyQueue} />
          : section.key === "Conocimiento" ? (Number.isSafeInteger(reviewId) && reviewId > 0
            ? <SearchKnowledgeReview key={reviewId} id={reviewId} onClose={() => setParams({ seccion: "Conocimiento" })} />
            : <SearchKnowledgePanel />)
          : section.key === "Sugerencias" ? <Suggestions data={data} />
          : <Feeding data={data} />}
      </section>
    </div>
  );
}

function About({ children, title = "Cómo se calcula" }: { children: ReactNode; title?: string }) {
  return (
    <details className="search-admin__about">
      <summary><Info size={16} aria-hidden="true" />{title}</summary>
      <div>{children}</div>
    </details>
  );
}

const num = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0) || 0;
const pct = (part: number, total: number) => total > 0 ? `${((part / total) * 100).toFixed(part / total < 0.1 ? 1 : 0)} %` : "—";

/** Serie diaria de los últimos días (del más antiguo al más reciente) para una métrica. */
function series(data: Administration, key: "total" | "empty" | "incidents", days = 30): number[] {
  return [...(data.daily as Array<Record<string, unknown>>)].slice(0, days).reverse().map((row) => num(row[key]));
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const width = 120, height = 32;
  const points = values.map((value, index) => `${((index / (values.length - 1)) * width).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg className="kpi__spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Kpi({ label, value, detail, spark, tone }: { label: string; value: string; detail?: string; spark?: number[]; tone?: "warn" | "bad" | undefined }) {
  return (
    <div className={`kpi${tone ? ` kpi--${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>
        <span className="kpi__value">{value}</span>
        {detail ? <span className="kpi__detail">{detail}</span> : null}
        {spark ? <Sparkline values={spark} label={`Tendencia diaria de ${label.toLowerCase()}`} /> : null}
      </dd>
    </div>
  );
}

function hotP95(data: Administration): number | null {
  const rows = (data.latencies as Array<{ n: number; cold: string; perceived_ms: Array<number | null> | null }>).filter((row) => row.cold !== "true");
  const main = rows.sort((a, b) => num(b.n) - num(a.n))[0];
  return main?.perceived_ms?.[1] ?? null;
}

function Overview({ data, queue, onOpen }: { data: Administration; queue: EmptyRow[]; onOpen: (key: string) => void }) {
  const summary = (data.summary ?? {}) as Record<string, unknown>;
  const total = num(summary["total"]), empty = num(summary["empty"]), incidents = num(summary["incidents"]), unresolved = num(summary["unresolved_entities"]);
  const p95 = hotP95(data);
  const attention: Array<{ text: string; action: string; key: string }> = [];
  if (queue.length) attention.push({ text: `${formatCount(queue.length)} consultas sin resultados; la más repetida: «${queue[0]!.query}» (${formatCount(queue[0]!.misses)} veces).`, action: "Revisar", key: "Sin resultados" });
  if (unresolved) attention.push({ text: `${formatCount(unresolved)} búsquedas no pudieron resolverse a una ficha concreta.`, action: "Ver consultas", key: "Consultas y patrones" });
  if (data.resources.fieldReviewStatus === "needs_review") attention.push({ text: "La revisión de campos de las fuentes necesita revalidarse.", action: "Ver fuentes", key: "Alimentación" });
  if (incidents) attention.push({ text: `${formatCount(incidents)} búsquedas tuvieron un incidente técnico.`, action: "Ver consultas", key: "Consultas y patrones" });

  return (
    <>
      <dl className="kpi-grid">
        <Kpi label="Búsquedas confirmadas" value={formatCount(total)} detail={`${data.periodDays} días`} spark={series(data, "total")} />
        <Kpi label="Sin resultados" value={pct(empty, total)} detail={`${formatCount(empty)} búsquedas`} spark={series(data, "empty")} tone={total && empty / total > 0.15 ? "warn" : undefined} />
        <Kpi label="Rapidez percibida (p95)" value={p95 === null ? "—" : `${Math.round(p95)} ms`} detail="caché caliente" tone={p95 !== null && p95 > 500 ? "warn" : undefined} />
        <Kpi label="Con incidente" value={formatCount(incidents)} detail={pct(incidents, total)} spark={series(data, "incidents")} tone={incidents ? "bad" : undefined} />
      </dl>

      <section className="search-admin__block" aria-labelledby="search-attention">
        <h3 id="search-attention">Qué atender</h3>
        {attention.length ? (
          <ul className="attention-list">
            {attention.map((item) => (
              <li key={item.text}>
                <span>{item.text}</span>
                <button type="button" className="btn btn--sm" onClick={() => onOpen(item.key)}>{item.action}</button>
              </li>
            ))}
          </ul>
        ) : <p className="search-admin__calm">Nada pendiente: las búsquedas encuentran lo que buscan.</p>}
      </section>

      <section className="search-admin__block" aria-labelledby="search-kinds">
        <h3 id="search-kinds">Todas las cifras</h3>
        <dl className="search-admin__metrics">{Object.entries(metrics).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{formatCount(num(summary[key]))}</dd></div>)}</dl>
        <h4>Combinaciones observadas</h4>
        <ul className="search-admin__plain">{(data.combinations as Array<{ types: string[] | null; count: number }>).map((row, i) => <li key={i}>{row.types?.length ? row.types.join(" + ") : "Tipo no determinado"}: {row.count} / {total}</li>)}</ul>
        <h4>Rapidez observada</h4>
        <div className="search-admin__table"><table><thead><tr><th>Vía</th><th>Muestra</th><th>Servidor p50 / p95 / p99</th><th>Recuperación p50 / p95 / p99</th><th>Percibido p50 / p95 / p99</th></tr></thead><tbody>{(data.latencies as Array<Record<string, never>>).map((row, i) => <tr key={i}><td>{row["cache"]} · {row["cold"] === "true" ? "arranque" : "caliente"}</td><td>{row["n"]}</td><td>{numbers(row["server_ms"])}</td><td>{numbers(row["retrieval_ms"])}</td><td>{numbers(row["perceived_ms"])}</td></tr>)}</tbody></table></div>
        {!data.latencies.length && <p>Aún no hay confirmaciones elegibles para calcular percentiles.</p>}
      </section>

      <About>
        <p>Últimos {data.periodDays} días. Corte editorial: {data.dailyCycle.date}, {data.dailyCycle.timeZone}. Lectura: {new Date(data.generatedAt).toLocaleString("es")}.</p>
        <p>El total cuenta confirmaciones distintas del buscador principal. Los tipos y los incidentes se superponen; no deben sumarse.</p>
        <p>Muestras conservadas: {String(summary["sampled"] ?? 0)} / {total}. Máximo de {data.sampling.maximumExamplesPerEditorialDay} ejemplos por día editorial; se prioriza diagnóstico. Los contadores incluyen también operaciones sin muestra.</p>
        <p>Contadores del proceso actual, buffer máximo de 5.000; vaciado cada 5 segundos. Los reinicios pueden perder recibos y eventos pendientes.</p>
        <dl className="search-admin__metrics">{Object.entries(data.quality).map(([key, value]) => <div key={key}><dt>{qualityNames[key] ?? key}</dt><dd>{String(value ?? "Sin volcado")}</dd></div>)}</dl>
        <ul>{data.limitations.map((text: string) => <li key={text}>{text}</li>)}</ul>
      </About>
    </>
  );
}

function Queries({ data }: { data: Administration }) {
  const [filter, setFilter] = useState("");
  const rows = (data.queries as Array<{ fingerprint: string; sample: string; count: number; empty: number; incidents: number; interpretations: string[] }>)
    .filter((row) => !filter.trim() || row.sample.toLocaleLowerCase("es").includes(filter.trim().toLocaleLowerCase("es")));
  return (
    <>
      <label className="visually-hidden" htmlFor="search-admin-filter">Filtrar consultas</label>
      <input id="search-admin-filter" className="search-admin__filter" type="search" placeholder="Filtrar consultas…" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <div className="search-admin__table"><table><thead><tr><th>Consulta</th><th>Confirmaciones</th><th>Vacías</th><th>Incidentes</th><th>Interpretación</th></tr></thead><tbody>{rows.map(row => <tr key={row.fingerprint}><td><Link to={`/?q=${encodeURIComponent(row.sample)}`}>{row.sample}</Link></td><td>{row.count}</td><td>{row.empty ? <span className="badge badge--amber">{row.empty}</span> : 0}</td><td>{row.incidents ? <span className="badge badge--red">{row.incidents}</span> : 0}</td><td>{row.interpretations.join(", ")}</td></tr>)}</tbody></table></div>
      {!data.queries.length && <p>No hay consultas confirmadas registradas todavía.</p>}
      <About>
        <p>Coincidencias exactas de texto sanitizado. Las negaciones y cifras se conservan. La agrupación semántica y las decisiones de unir o dividir corresponden a la etapa 5.</p>
      </About>
    </>
  );
}

interface EmptyRow { key: string; query: string; misses: number; source: "confirmadas" | "histórico" }

/** Consultas confirmadas que salieron vacías y el registro histórico (0072), sin repetir el mismo texto. */
function missingQueries(data: Administration): EmptyRow[] {
  const rows = new Map<string, EmptyRow>();
  for (const row of data.queries as Array<{ fingerprint: string; sample: string; empty: number }>) {
    if (row.empty > 0) rows.set(row.sample.trim().toLocaleLowerCase("es"), { key: row.fingerprint, query: row.sample, misses: row.empty, source: "confirmadas" });
  }
  for (const row of data.legacy.rows as Array<{ normalized_query: string; sample_query: string; misses: number }>) {
    const id = row.sample_query.trim().toLocaleLowerCase("es");
    const known = rows.get(id);
    if (known) { known.misses = Math.max(known.misses, num(row.misses)); continue; }
    rows.set(id, { key: `legacy:${row.normalized_query}`, query: row.sample_query, misses: num(row.misses), source: "histórico" });
  }
  return [...rows.values()].sort((a, b) => b.misses - a.misses);
}

const ALIAS_TARGETS: ReadonlyArray<{ kind: "artist" | "album" | "person" | "organization"; path: EntityPath; label: string }> = [
  { kind: "artist", path: "artists", label: "Artista" },
  { kind: "album", path: "albums", label: "Disco" },
  { kind: "person", path: "persons", label: "Persona" },
  { kind: "organization", path: "organizations", label: "Organización" },
];

function EmptyQueue({ queue }: { queue: EmptyRow[] }) {
  const [assigning, setAssigning] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  if (!queue.length) return <p className="search-admin__calm">No hay consultas sin resultados en este periodo.</p>;
  return (
    <>
      <ol className="miss-queue">
        {queue.map((row) => (
          <li key={row.key} className={`miss-queue__row${done[row.key] ? " is-done" : ""}`}>
            <div className="miss-queue__main">
              <span className="miss-queue__query">«{row.query}»</span>
              <span className="miss-queue__meta">{formatCount(row.misses)} {row.misses === 1 ? "vez" : "veces"} · {row.source}</span>
              {done[row.key] ? <span className="miss-queue__done">{done[row.key]}</span> : null}
            </div>
            <div className="miss-queue__actions">
              <Link className="btn btn--sm btn--ghost" to={`/?q=${encodeURIComponent(row.query)}`}>Probar búsqueda</Link>
              {done[row.key] ? null : (
                <button type="button" className="btn btn--sm" aria-expanded={assigning === row.key} onClick={() => setAssigning(assigning === row.key ? null : row.key)}>
                  Añadir como alias…
                </button>
              )}
            </div>
            {assigning === row.key ? (
              <AliasAssign query={row.query} onCancel={() => setAssigning(null)}
                onDone={(text) => { setAssigning(null); setDone((prev) => ({ ...prev, [row.key]: text })); }} />
            ) : null}
          </li>
        ))}
      </ol>
      <About title="De dónde salen">
        <p>Se juntan las consultas confirmadas que terminaron vacías y el registro histórico de búsquedas sin resultados (0072, que incluye previas y no se suma al total nuevo). El mismo texto aparece una sola vez, con su mayor conteo.</p>
      </About>
    </>
  );
}

function AliasAssign({ query, onCancel, onDone }: { query: string; onCancel: () => void; onDone: (text: string) => void }) {
  const { notify } = useToast();
  const [target, setTarget] = useState(ALIAS_TARGETS[0]!);
  const [picked, setPicked] = useState<{ id: number; label: string } | null>(null);
  const [aliasType, setAliasType] = useState("misspelling");
  const [alias, setAlias] = useState(query);
  const [note, setNote] = useState("Consulta sin resultados en el buscador");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const types = useMemo(() => ["misspelling", "spelling_variant", "name_variant", "acronym", "former_name", "stage_name", "alternate_title"], []);

  async function save() {
    if (!picked) { setError("Elige la ficha a la que corresponde la consulta."); return; }
    if (!alias.trim() || !note.trim()) { setError("El alias y el motivo son obligatorios."); return; }
    setBusy(true); setError(undefined);
    try {
      await aliasWrites[target.path].create(picked.id, { alias: alias.trim(), aliasType, isPrimary: false, note: note.trim() });
      notify("success", `«${alias.trim()}» ahora lleva a ${picked.label}.`);
      onDone(`Alias de ${picked.label}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo añadir el alias.");
      setBusy(false);
    }
  }

  return (
    <div className="miss-queue__assign">
      <div className="form-grid">
        <div className="field">
          <label htmlFor="miss-kind">Tipo de ficha</label>
          <select id="miss-kind" value={target.kind} onChange={(event) => { setTarget(ALIAS_TARGETS.find((item) => item.kind === event.target.value)!); setPicked(null); }}>
            {ALIAS_TARGETS.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="miss-type">Tipo de alias</label>
          <select id="miss-type" value={aliasType} onChange={(event) => setAliasType(event.target.value)}>
            {types.map((type) => <option key={type} value={type}>{aliasTypeLabel(type)}</option>)}
          </select>
        </div>
        <div className="field span-2">
          <label htmlFor="miss-alias">Alias</label>
          <input id="miss-alias" value={alias} onChange={(event) => setAlias(event.target.value)} />
        </div>
      </div>
      <EntityPicker kind={target.kind} label={`${target.label} al que lleva`} value={picked?.id ?? null} valueLabel={picked?.label ?? null}
        onSelect={(id, label) => setPicked({ id, label })} />
      <NoteField value={note} onChange={setNote} rows={1} presets={["Consulta sin resultados en el buscador", "Error de escritura frecuente", "Nombre con el que se le conoce"]} />
      {error ? <p className="form-error-banner" role="alert">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={busy || !picked}>{busy ? "Guardando…" : "Añadir alias"}</button>
      </div>
    </div>
  );
}

function Suggestions({ data }: { data: Administration }) {
  return (
    <>
      <dl className="kpi-grid kpi-grid--two">
        <Kpi label="Sugerencias" value={data.flags.suggestions ? "Activadas" : "Apagadas"} />
        <Kpi label="Métricas del embudo" value={data.flags.suggestionMetrics ? "Activadas" : "Apagadas"} />
      </dl>
      <section className="search-admin__block">
        <h3>Decisiones de exposición</h3>
        <dl className="search-admin__metrics">{(data.suggestions.decisions as Array<{ status: string; count: number }>).map(row => <div key={row.status}><dt>{row.status}</dt><dd>{formatCount(row.count)}</dd></div>)}</dl>
        <h3>Embudo heredado</h3>
        <p className="search-admin__lede">Impresiones → aceptaciones → búsquedas atribuidas → visitas.</p>
        <dl className="search-admin__metrics">{(data.suggestions.funnel as Array<{ kind: string; count: number }>).map(row => <div key={row.kind}><dt>{row.kind}</dt><dd>{formatCount(row.count)}</dd></div>)}</dl>
        {!data.suggestions.funnel.length && <p>Sin eventos del embudo. Consultar la bandera de métricas antes de interpretar este vacío como falta de uso.</p>}
      </section>
      <About>
        <p>Decisiones existentes de exposición, con sus mismos IDs, evidencia y vigencias. El embudo usa cohortes UTC, separadas del nuevo total de búsquedas.</p>
      </About>
    </>
  );
}

function Feeding({ data }: { data: Administration }) {
  return (
    <>
      {data.resources.fieldReviewStatus === "needs_review" && <p className="alert-block" role="status">La revisión de campos necesita revalidación porque cambió o falta evidencia. Sus disposiciones no se muestran como verificadas.</p>}
      {data.resources.fieldReviewStatus === "missing" && <p className="alert-block">Aún no se generó la revisión por campo.</p>}
      <SearchKnowledgePanel feeding />
      <section className="search-admin__block">
        <h3>Recursos</h3>
        <ResourceFieldTable resources={data.resources} />
        <p><Link to="/curaduria">Abrir casos y fuentes existentes en Curaduría</Link></p>
      </section>
      <About>
        <p>Recursos R01–R44, disponibilidad contrastada el {new Date(data.resources.checkedAt).toLocaleString("es")}. La extracción y validación musical requieren revisión en las etapas indicadas.</p>
        {data.resources.fieldReview && <p>{data.resources.fieldReview.coverage.resources} recursos y {data.resources.fieldReview.coverage.fields} grupos de campos con disposición explícita · revisión {data.resources.fieldReview.revision}. Esta revisión no acredita cobertura musical ni integración de los campos diferidos.</p>}
        <p>+shoutbox y sus clasificaciones permanecen retirados. Los originales históricos no autorizan reimportarlos.</p>
      </About>
    </>
  );
}

function HowItWorks() {
  return (
    <div className="search-admin__rules">
      <section className="search-admin__block">
        <h3><ChartLineUp size={18} aria-hidden="true" /> Laya y evaluación</h3>
        <p>La etapa 3 evalúa Laya por tarea (consultas, decisiones sobre evidencia y extracción de citas) contra criterios congelados y una prueba reservada. Las activaciones están en <Link to="/administrar/buscador?seccion=Laya%20y%20evaluaci%C3%B3n">Laya y evaluación</Link>; el uso público se decide en la etapa 4.</p>
        <p>La medición distingue la lógica heredada. Una inferencia fallida se registra como indisponibilidad técnica.</p>
        <p>Objetivos iniciales de servidor en caliente: p95 directa &lt;150 ms; semántica &lt;500 ms, sujetos a evaluación representativa.</p>
      </section>
      <section className="search-admin__block">
        <h3><Scales size={18} aria-hidden="true" /> Reglas e historial</h3>
        <p>Las decisiones humanas prevalecen. Modelos, fuentes, alias e índices solo pueden proponer una revisión de una decisión vigente.</p>
        <p>Los casos conservan aprobación, feedback, snapshots, fusión y deshacer del proyecto.</p>
        <p className="search-admin__links"><Link to="/historial">Abrir historial y deshacer</Link><Link to="/administrar/buscador?seccion=Emociones">Revisar etiquetas emocionales</Link><Link to="/curaduria/correcciones">Abrir lotes existentes</Link></p>
      </section>
    </div>
  );
}

function numbers(values: Array<number | null> | null) { return values?.map(value => value == null ? "—" : `${value.toFixed(1)} ms`).join(" / ") ?? "Sin muestra"; }
