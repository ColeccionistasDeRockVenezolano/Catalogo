// CRV · Buscador › Etiquetar consultas (etapa 3, versión 1.6.0).
// Consultas reales —autocompletado público de YouTube/Google y búsquedas del
// sitio— que una persona etiqueta a ciegas: la página nunca muestra cómo las
// leen las reglas o Laya. Las etiquetas entrenan y evalúan la versión 1.6.0;
// no cambian el buscador público por sí solas.
import { useEffect, useMemo, useState } from "react";
import { ApiError, searchHumanReviewApi, type QueryLabelEntity, type QueryLabelGold, type QueryLabelItem, type QueryLabelingState, type QueryLabelOption, type QueryLabelStatus } from "../lib/api";
import "../styles/curation-emotions.css";
import "../styles/query-labels.css";

const STATUS: [QueryLabelStatus, string, string][] = [
  ["query_valid", "Se puede buscar completa", "Todo lo que pide se puede expresar con condiciones de la lista."],
  ["partial", "Se busca en parte", "Una parte se expresa con condiciones y otra queda pendiente."],
  ["entity_lookup", "Busca un nombre", "Un artista, disco o canción concretos."],
  ["clarify", "Es ambigua", "Admite lecturas distintas y habría que preguntar."],
  ["unsupported", "No se puede representar", "Pide algo que el buscador aún no expresa: todo queda pendiente."],
  ["contradiction", "Se contradice", "Pide una cosa y su contraria."],
  ["unrecognized", "No es una búsqueda musical", "Ruido, otra intención o algo que no se entiende."],
];
type Role = "req" | "exc" | "pref" | "any1" | "any2" | "alt";
const ROLES: [Role, string][] = [["req", "Debe cumplir"], ["exc", "Excluir"], ["pref", "Si se puede"], ["any1", "Una de estas (grupo 1)"], ["any2", "Una de estas (grupo 2)"], ["alt", "Lectura posible"]];
const SOURCE: Record<string, string> = { youtube_suggest: "Autocompletado de YouTube", web_suggest: "Autocompletado de Google", search_miss: "Búsqueda sin resultados en CRV", search_operation: "Búsqueda confirmada en CRV" };
const KIND: [QueryLabelEntity["kind"], string][] = [["artist", "Artista"], ["album", "Disco"], ["track", "Canción"], [null, "Sin saber"]];

interface Draft { status: QueryLabelStatus | ""; chips: { id: string; role: Role }[]; pending: boolean; ctx: boolean; facet: string; ents: QueryLabelEntity[]; note: string }
const emptyDraft: Draft = { status: "", chips: [], pending: false, ctx: false, facet: "", ents: [], note: "" };
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function draftFrom(item: QueryLabelItem): Draft {
  const g = item.gold;
  if (!g) return { ...emptyDraft, note: item.note };
  const chips = [...g.req.map(id => ({ id, role: "req" as Role })), ...g.exc.map(id => ({ id, role: "exc" as Role })), ...g.pref.map(id => ({ id, role: "pref" as Role })),
    ...g.any.flatMap((group, i) => group.map(id => ({ id, role: (i === 0 ? "any1" : "any2") as Role }))), ...g.alts.map(id => ({ id, role: "alt" as Role }))];
  return { status: g.status, chips, pending: g.pending > 0, ctx: g.ctx > 0, facet: g.facet ?? "", ents: g.ent, note: item.note };
}
function goldFrom(d: Draft): QueryLabelGold {
  const of = (role: Role) => d.chips.filter(c => c.role === role).map(c => c.id);
  return { status: d.status as QueryLabelStatus, req: of("req"), exc: of("exc"), pref: of("pref"), any: [of("any1"), of("any2")].filter(g => g.length),
    alts: of("alt"), ctx: d.ctx ? 1 : 0, pending: d.pending ? 1 : 0, facet: d.pending && d.facet ? d.facet : null, ent: d.ents.filter(e => e.literal.trim()) };
}

export function CurationSearchQueryLabelsPage() {
  const [data, setData] = useState<QueryLabelingState>();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [search, setSearch] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    try { const next = await searchHumanReviewApi.queryLabels(); setData(next); setError(null); return next; } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se pudieron cargar las consultas."); return undefined;
    }
  }
  useEffect(() => { void load(); }, []);

  const byId = useMemo(() => new Map([...(data?.options.conditions ?? []), ...(data?.options.facets ?? [])].map(o => [o.id, o])), [data]);
  const matches = useMemo(() => {
    const q = fold(search.trim());
    if (!q || !data) return [] as QueryLabelOption[];
    const taken = new Set(draft.chips.map(c => c.id));
    return data.options.conditions.filter(o => !taken.has(o.id) && (fold(o.label).includes(q) || o.id.includes(q)))
      .sort((a, b) => Number(!fold(b.label).startsWith(q)) - Number(!fold(a.label).startsWith(q)) || a.label.length - b.label.length).slice(0, 10);
  }, [search, data, draft.chips]);

  const current = data?.items.find(i => i.id === selected) ?? null;
  const visible = data ? data.items.filter(i => !onlyOpen || !i.outcome || i.id === selected) : [];
  function choose(item: QueryLabelItem) { setSelected(item.id); setDraft(draftFrom(item)); setSearch(""); setError(null); setMessage(""); }
  function setStatus(status: QueryLabelStatus) {
    setDraft(d => ({ ...d, status, pending: status === "partial" || status === "unsupported" ? true : status === "query_valid" ? false : d.pending,
      chips: status === "clarify" ? d.chips.map(c => ({ ...c, role: "alt" })) : d.chips.map(c => (c.role === "alt" ? { ...c, role: "req" } : c)) }));
  }
  function add(option: QueryLabelOption) {
    setDraft(d => ({ ...d, chips: [...d.chips, { id: option.id, role: d.status === "clarify" ? "alt" : "req" }],
      ents: option.id.startsWith("similarity:") && !d.ents.some(e => e.role === "reference") ? [...d.ents, { role: "reference", kind: "artist", literal: "" }] : d.ents }));
    setSearch("");
  }
  async function save(outcome: "labeled" | "skipped") {
    if (!current) return;
    setSaving(true); setError(null); setMessage("");
    try {
      await searchHumanReviewApi.saveQueryLabel(current.id, outcome === "labeled" ? { outcome, gold: goldFrom(draft), note: draft.note } : { outcome, note: draft.note });
      const next = await load();
      const after = next?.items.find((i, k) => k > next.items.findIndex(x => x.id === current.id) && !i.outcome) ?? next?.items.find(i => !i.outcome);
      setMessage(outcome === "labeled" ? `Etiqueta guardada para «${current.text}».` : `«${current.text}» quedó como «no sé».`);
      if (after) choose(after); else setSelected(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se pudo guardar la etiqueta.");
    } finally { setSaving(false); }
  }
  const showConditions = draft.status !== "" && !["contradiction", "unrecognized", "unsupported"].includes(draft.status);
  const ready = draft.status !== "";

  return <div className="emotion-review">
    <header className="emotion-review__head">
      <h2>Etiquetar consultas reales</h2>
      <p>Consultas que la gente escribe de verdad. Anota qué pide cada una con las condiciones del buscador y marca lo que queda pendiente. No verás cómo la lee el sistema: tu etiqueta es la referencia con la que se entrena y se evalúa Laya.</p>
      {data ? <span className="emotion-review__count">{data.labeled} etiquetadas · {data.skipped} «no sé» · {data.total - data.labeled - data.skipped} por hacer de {data.total} · lote {data.batchVersion}</span> : null}
    </header>
    <details className="query-labels__guide">
      <summary>Cómo etiquetar</summary>
      <ul>
        <li><strong>Pendiente</strong> es lo que el buscador aún no expresa: idioma, tempo, duración, instrumentos, tipo de voz, versión (en vivo, cover), país u origen, popularidad o novedad, y ocasiones como dedicar, limpiar, cocinar, orar o «para la playa».</li>
        <li><strong>No se anota el relleno</strong>: valoraciones («buena», «chévere» junto a otra cosa), circunstancias de tiempo, lugar o compañía («esta noche», «con mis panas») y frases que solo refuerzan.</li>
        <li>Un subgénero que no está en la lista: elige su género padre y marca pendiente.</li>
        <li>«Instrumental» como estilo es el género Instrumental.</li>
        <li>«Como X» o «parecido a X»: condición «Parecido…» y X como referencia.</li>
        <li>Un nombre suelto que también es una emoción («Ira»): ambigua, con el nombre y la lectura emocional.</li>
        <li>Si dudas entre dos lecturas razonables, usa «No sé» y explica en la nota.</li>
      </ul>
    </details>
    {error ? <p role="alert" className="emotion-review__error">{error}</p> : null}
    {message ? <p role="status" className="emotion-review__saved">{message}</p> : null}
    {!data ? (error ? null : <p role="status">Cargando consultas…</p>) : (
      <div className="emotion-review__workspace">
        <div>
          <label className="query-labels__filter"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Solo por hacer</label>
          <div className="emotion-review__list" aria-label="Consultas para etiquetar">
            {visible.map(item => <button key={item.id} type="button" className={`emotion-review__item${selected === item.id ? " is-selected" : ""}`} onClick={() => choose(item)}>
              <strong>{item.text}</strong>
              <span>{item.outcome === "labeled" ? `Etiquetada · ${STATUS.find(s => s[0] === item.gold?.status)?.[1] ?? ""}` : item.outcome === "skipped" ? "No sé" : item.stale ? "El texto cambió: volver a etiquetar" : "Por hacer"}</span>
            </button>)}
          </div>
        </div>
        <section className="emotion-review__detail" aria-live="polite">
          {current ? <>
            <h2>«{current.text}»</h2>
            <p className="emotion-review__help">{SOURCE[current.source] ?? current.source} · {current.id}</p>
            <fieldset className="query-labels__status">
              <legend>¿Qué es esta consulta?</legend>
              {STATUS.map(([value, name, help]) => <label key={value} className={draft.status === value ? "is-on" : ""}>
                <input type="radio" name="query-status" checked={draft.status === value} onChange={() => setStatus(value)} />
                <span><strong>{name}</strong><small>{help}</small></span>
              </label>)}
            </fieldset>
            {showConditions ? <>
              <h3>{draft.status === "clarify" ? "Lecturas posibles (si las hay)" : "Condiciones"}</h3>
              <ul className="query-labels__chips">
                {draft.chips.map(chip => <li key={chip.id}>
                  <span title={byId.get(chip.id)?.hint}>{byId.get(chip.id)?.label ?? chip.id} <small>{byId.get(chip.id)?.group}</small></span>
                  <select aria-label="Papel de la condición" value={chip.role} onChange={e => setDraft(d => ({ ...d, chips: d.chips.map(c => (c.id === chip.id ? { ...c, role: e.target.value as Role } : c)) }))}>
                    {ROLES.filter(([r]) => (draft.status === "clarify") === (r === "alt")).map(([r, name]) => <option key={r} value={r}>{name}</option>)}
                  </select>
                  <button type="button" className="btn btn--sm" aria-label={`Quitar ${byId.get(chip.id)?.label ?? chip.id}`} onClick={() => setDraft(d => ({ ...d, chips: d.chips.filter(c => c.id !== chip.id) }))}>Quitar</button>
                </li>)}
              </ul>
              <label>Añadir condición
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Escribe: bailar, triste, salsa, noventa, parecido…"
                  onKeyDown={e => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); add(matches[0]); } }} />
              </label>
              {matches.length ? <ul className="query-labels__matches">
                {matches.map(o => <li key={o.id}><button type="button" onClick={() => add(o)} title={o.hint}>{o.label} <small>{o.group}</small></button></li>)}
              </ul> : null}
            </> : null}
            {draft.status ? <>
              <label className="query-labels__check"><input type="checkbox" checked={draft.pending} disabled={["partial", "unsupported", "query_valid"].includes(draft.status)}
                onChange={e => setDraft(d => ({ ...d, pending: e.target.checked }))} /> Deja algo pendiente que el buscador no expresa</label>
              {draft.pending ? <label>Faceta pendiente (opcional)
                <select value={draft.facet} onChange={e => setDraft(d => ({ ...d, facet: e.target.value }))}>
                  <option value="">Ninguna en particular</option>
                  {data.options.facets.map(f => <option key={f.id} value={f.id} title={f.hint}>{f.label} — {f.hint}</option>)}
                </select>
              </label> : null}
              <label className="query-labels__check"><input type="checkbox" checked={draft.ctx} onChange={e => setDraft(d => ({ ...d, ctx: e.target.checked }))} /> Cuenta cómo se siente o qué le pasa a quien busca</label>
              <h3>Nombres en la consulta</h3>
              {draft.ents.map((ent, k) => <div key={k} className="query-labels__entity">
                <select aria-label="Papel del nombre" value={ent.role} onChange={e => setDraft(d => ({ ...d, ents: d.ents.map((x, j) => (j === k ? { ...x, role: e.target.value as QueryLabelEntity["role"] } : x)) }))}>
                  <option value="target">Lo que busca</option><option value="reference">Referencia de parecido</option>
                </select>
                <select aria-label="Tipo de nombre" value={ent.kind ?? ""} onChange={e => setDraft(d => ({ ...d, ents: d.ents.map((x, j) => (j === k ? { ...x, kind: (e.target.value || null) as QueryLabelEntity["kind"] } : x)) }))}>
                  {KIND.map(([v, name]) => <option key={name} value={v ?? ""}>{name}</option>)}
                </select>
                <input aria-label="Nombre tal como aparece" value={ent.literal} placeholder="Nombre tal como aparece" onChange={e => setDraft(d => ({ ...d, ents: d.ents.map((x, j) => (j === k ? { ...x, literal: e.target.value } : x)) }))} />
                <button type="button" className="btn btn--sm" onClick={() => setDraft(d => ({ ...d, ents: d.ents.filter((_, j) => j !== k) }))}>Quitar</button>
              </div>)}
              <div><button type="button" className="btn btn--sm" onClick={() => setDraft(d => ({ ...d, ents: [...d.ents, { role: "target", kind: "artist", literal: "" }] }))}>Añadir nombre</button></div>
            </> : null}
            <label htmlFor="query-label-note">Nota opcional</label>
            <textarea id="query-label-note" value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} maxLength={1000} rows={2} placeholder="Por qué, si no es obvio" />
            <div className="emotion-review__actions">
              <button className="btn btn--primary" type="button" disabled={!ready || saving} onClick={() => void save("labeled")}>{saving ? "Guardando…" : "Guardar y seguir"}</button>
              <button className="btn" type="button" disabled={saving} onClick={() => void save("skipped")}>No sé</button>
            </div>
            {current.labeledAt ? <small>Guardada el {new Date(current.labeledAt).toLocaleString("es-VE")}</small> : null}
          </> : <p>{data.total - data.labeled - data.skipped ? "Elige una consulta de la lista." : "No quedan consultas por etiquetar en este lote."}</p>}
        </section>
      </div>
    )}
  </div>;
}
