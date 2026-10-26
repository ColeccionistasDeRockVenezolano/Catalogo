// CRV · Buscador › Etiquetar consultas (etapa 3, versión 1.6.0).
// Consultas reales —autocompletado público de YouTube/Google y búsquedas del
// sitio— que una persona etiqueta a ciegas: la página nunca muestra cómo las
// leen las reglas o Laya. Las etiquetas entrenan y evalúan la versión 1.6.0;
// no cambian el buscador público por sí solas.
// Cada opción lleva icono, explicación y un ejemplo resuelto; el resumen en
// palabras y las comprobaciones repiten las reglas de checkGold antes de guardar.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowsLeftRight, Check, CheckCircle, CircleHalf, Heart, HourglassMedium, Lightbulb, Lightning, MagnifyingGlass, Microphone, MusicNote,
  Prohibit, Question, Star, Target, UserFocus, VinylRecord, WarningCircle, XCircle, type Icon,
} from "@phosphor-icons/react";
import { ApiError, searchHumanReviewApi, type QueryLabelEntity, type QueryLabelGold, type QueryLabelItem, type QueryLabelingState, type QueryLabelOption, type QueryLabelStatus } from "../lib/api";
import "../styles/curation-emotions.css";
import "../styles/query-labels.css";

interface Choice<T> { value: T; icon: Icon; name: string; help: string; example: string; how: string }

const STATUS: Choice<QueryLabelStatus>[] = [
  { value: "query_valid", icon: CheckCircle, name: "Se puede buscar completa", help: "Todo lo que pide está en la lista de condiciones.",
    example: "musica para dormir", how: "condición «Dormir» como Debe cumplir." },
  { value: "partial", icon: CircleHalf, name: "Se busca en parte", help: "Una parte está en la lista y otra no (idioma, duración, instrumento…). Lo que no está queda pendiente.",
    example: "música épica que dure 1 hora", how: "condición «Épico»; la duración queda pendiente (se marca sola)." },
  { value: "entity_lookup", icon: UserFocus, name: "Nombra un artista, disco o canción", help: "Aparece un nombre concreto. Si además pide algo («fuerte», «triste»), se añade como condición.",
    example: "xxtenations musica fuerte", how: "nombre «xxtenations» (Artista, Lo que busca) + condición «Energía alta»." },
  { value: "clarify", icon: Question, name: "Es ambigua", help: "Se puede entender de dos maneras razonables y habría que preguntar.",
    example: "Ira", how: "nombre «Ira» (No sé qué es) + lectura posible «Ira» (emoción)." },
  { value: "unsupported", icon: HourglassMedium, name: "Nada de lo que pide está en la lista", help: "Es una petición musical, pero nada cabe en las condiciones: todo queda pendiente.",
    example: "musica para cocinar", how: "sin condiciones; pendiente se marca solo." },
  { value: "contradiction", icon: Lightning, name: "Se contradice", help: "Pide una cosa y su contraria al mismo tiempo.",
    example: "música alegre y triste a la vez", how: "sin condiciones." },
  { value: "unrecognized", icon: XCircle, name: "No es una búsqueda de música", help: "Ruido, recetas, otra intención o algo que no se entiende.",
    example: "salsa para raviolis de espinacas y ricotta", how: "sin condiciones." },
];

type Role = "req" | "exc" | "pref" | "any1" | "any2" | "alt";
const ROLES: Choice<Role>[] = [
  { value: "req", icon: Check, name: "Debe cumplir", help: "Lo que la consulta pide.", example: "salsa para bailar", how: "«Salsa» y «Bailar»: Debe cumplir." },
  { value: "exc", icon: Prohibit, name: "Excluir", help: "Lo que pide que NO aparezca.", example: "rock sin baladas", how: "«Rock» Debe cumplir; «Balada» Excluir." },
  { value: "pref", icon: Star, name: "Si se puede", help: "Un deseo suave, no obligatorio.", example: "salsa, mejor si es de los 70", how: "«Salsa» Debe cumplir; «Década de 1970» Si se puede." },
  { value: "any1", icon: ArrowsLeftRight, name: "Una de estas (A)", help: "Opciones unidas con «o»: basta una.", example: "salsa o merengue", how: "«Salsa» y «Merengue», las dos en el grupo A." },
  { value: "any2", icon: ArrowsLeftRight, name: "Una de estas (B)", help: "Un segundo grupo de opciones con «o», si hay dos.", example: "salsa o merengue de los 80 o 90", how: "géneros en el grupo A; décadas en el grupo B." },
  { value: "alt", icon: Question, name: "Lectura posible", help: "En una consulta ambigua, cada manera de entenderla.", example: "Ira", how: "«Ira» (emoción) como lectura posible." },
];

const ENT_ROLE: Choice<QueryLabelEntity["role"]>[] = [
  { value: "target", icon: Target, name: "Lo que busca", help: "La persona quiere ese artista, disco o canción.", example: "canciones de los kipus", how: "«los kipus» · Artista · Lo que busca." },
  { value: "reference", icon: ArrowsLeftRight, name: "Parecido a", help: "Quiere otra música que se parezca a ese nombre; añade también la condición «Parecido…».", example: "bandas parecidas a soda stereo", how: "«soda stereo» · Artista · Parecido a + condición «Parecido en general»." },
];
const KIND: { value: QueryLabelEntity["kind"]; icon: Icon; name: string }[] = [
  { value: "artist", icon: Microphone, name: "Artista o banda" }, { value: "album", icon: VinylRecord, name: "Disco" },
  { value: "track", icon: MusicNote, name: "Canción" }, { value: null, icon: Question, name: "No sé qué es" },
];

const SOURCE: Record<string, string> = { youtube_suggest: "Autocompletado de YouTube", web_suggest: "Autocompletado de Google", search_miss: "Búsqueda sin resultados en CRV", search_operation: "Búsqueda confirmada en CRV" };
const AUTO_PENDING: QueryLabelStatus[] = ["partial", "unsupported", "query_valid"];
const NO_CONDITIONS: QueryLabelStatus[] = ["contradiction", "unrecognized", "unsupported"];

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

/** Las reglas de checkGold del servidor, dichas en palabras antes de guardar. */
function problemsOf(d: Draft): string[] {
  if (!d.status) return [];
  const out: string[] = [], conditions = d.chips.filter(c => c.role !== "alt"), has = (r: Role) => d.chips.some(c => c.role === r);
  if (d.status === "query_valid" && !conditions.length) out.push("Añade al menos una condición: es lo que la consulta pide.");
  if (d.status === "partial" && !conditions.length) out.push("Añade la parte que sí está en la lista; si no hay ninguna, elige «Nada de lo que pide está en la lista».");
  if (d.status === "entity_lookup" && !d.ents.some(e => e.role === "target" && e.literal.trim())) out.push("Escribe el nombre que aparece en la consulta, con el papel «Lo que busca».");
  for (const [r, n] of [["any1", "A"], ["any2", "B"]] as const) if (d.chips.filter(c => c.role === r).length === 1) out.push(`El grupo ${n} necesita al menos dos opciones (es un «o»).`);
  if (has("any2") && !has("any1")) out.push("Usa primero el grupo A.");
  if (d.chips.some(c => c.id.startsWith("similarity:")) && !d.ents.some(e => e.role === "reference" && e.literal.trim())) out.push("Un «Parecido…» necesita el nombre de referencia (papel «Parecido a»).");
  if (d.ents.some(e => !e.literal.trim())) out.push("Hay un nombre vacío: escríbelo o quítalo.");
  return out;
}

function summaryOf(d: Draft, label: (id: string) => string): string[] {
  if (!d.status) return [];
  const list = (role: Role) => d.chips.filter(c => c.role === role).map(c => `«${label(c.id)}»`).join(", ");
  const lines: string[] = [STATUS.find(s => s.value === d.status)?.name ?? ""];
  for (const e of d.ents.filter(x => x.literal.trim())) lines.push(`${e.role === "target" ? "Busca" : "Parecido a"} «${e.literal.trim()}» (${KIND.find(k => k.value === e.kind)?.name.toLowerCase()})`);
  for (const [role, prefix] of [["req", "Debe cumplir"], ["exc", "Sin"], ["pref", "Si se puede"], ["any1", "Una de"], ["any2", "Y una de"], ["alt", "Lecturas posibles"]] as const)
    if (list(role)) lines.push(`${prefix}: ${list(role)}`);
  if (d.pending) lines.push("Queda algo pendiente");
  if (d.ctx) lines.push("Cuenta cómo se siente quien busca");
  return lines;
}

function Example({ example, how }: { example: string; how: string }) {
  return <span className="query-labels__example"><Lightbulb size={13} weight="fill" aria-hidden /><span>Ej.: <q>{example}</q> → {how}</span></span>;
}

function Section({ step, title, help, children }: { step: number; title: string; help?: ReactNode; children: ReactNode }) {
  return <section className="query-labels__section">
    <h3><span className="query-labels__step">{step}</span>{title}</h3>
    {help ? <div className="query-labels__help">{help}</div> : null}
    {children}
  </section>;
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
      chips: NO_CONDITIONS.includes(status) ? [] : status === "clarify" ? d.chips.map(c => ({ ...c, role: "alt" })) : d.chips.map(c => (c.role === "alt" ? { ...c, role: "req" } : c)),
      ents: status === "entity_lookup" && !d.ents.some(e => e.role === "target") ? [...d.ents, { role: "target", kind: "artist", literal: "" }] : d.ents }));
  }
  function add(option: QueryLabelOption) {
    setDraft(d => ({ ...d, chips: [...d.chips, { id: option.id, role: d.status === "clarify" ? "alt" : "req" }],
      ents: option.id.startsWith("similarity:") && !d.ents.some(e => e.role === "reference") ? [...d.ents, { role: "reference", kind: "artist", literal: "" }] : d.ents }));
    setSearch("");
  }
  const setEnt = (k: number, patch: Partial<QueryLabelEntity>) => setDraft(d => ({ ...d, ents: d.ents.map((x, j) => (j === k ? { ...x, ...patch } : x)) }));
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
  const showConditions = draft.status !== "" && !NO_CONDITIONS.includes(draft.status);
  const showNames = draft.status !== "" && !["unrecognized", "contradiction"].includes(draft.status);
  const problems = problemsOf(draft);
  const summary = summaryOf(draft, id => byId.get(id)?.label ?? id);
  const ready = draft.status !== "" && !problems.length;
  const roles = ROLES.filter(r => (draft.status === "clarify") === (r.value === "alt"));
  let step = 1;

  return <div className="emotion-review">
    <header className="emotion-review__head">
      <h2>Etiquetar consultas reales</h2>
      <p>Consultas que la gente escribe de verdad. Anota <strong>solo lo que dice el texto</strong>, no lo que sabes del artista: si la consulta no dice «triste», no se marca «Tristeza». No verás cómo la lee el sistema; tu etiqueta es la referencia con la que se entrena y se evalúa Laya.</p>
      {data ? <span className="emotion-review__count">{data.labeled} etiquetadas · {data.skipped} «no sé» · {data.total - data.labeled - data.skipped} por hacer de {data.total} · lote {data.batchVersion}</span> : null}
    </header>
    <details className="query-labels__guide">
      <summary>Reglas generales</summary>
      <ul>
        <li><strong>Solo lo escrito.</strong> «xxtenations musica fuerte» lleva «Energía alta» por «fuerte»; no «Tristeza» ni «Trap», porque no lo dice.</li>
        <li><strong>No se anota el relleno:</strong> valoraciones («buena», «la mejor», «chévere»), circunstancias («esta noche», «en el carro», «con mis panas») y frases que solo refuerzan.</li>
        <li><strong>Pendiente</strong> es lo que el buscador aún no expresa: idioma, tempo, duración, instrumentos, tipo de voz, versión (en vivo, cover), país u origen, popularidad o novedad, y ocasiones como dedicar, limpiar, cocinar, orar o «para la playa».</li>
        <li>Un <strong>subgénero que no está</strong> en la lista: elige su género padre y marca pendiente.</li>
        <li>«Instrumental» como estilo es el género <strong>Instrumental</strong>.</li>
        <li>Si dudas entre dos lecturas razonables, usa <strong>No sé</strong> y explica en la nota.</li>
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
              <span>{item.outcome === "labeled" ? `Etiquetada · ${STATUS.find(s => s.value === item.gold?.status)?.name ?? ""}` : item.outcome === "skipped" ? "No sé" : item.stale ? "El texto cambió: volver a etiquetar" : "Por hacer"}</span>
            </button>)}
          </div>
        </div>
        <section className="emotion-review__detail" aria-live="polite">
          {current ? <>
            <h2 className="query-labels__query">«{current.text}»</h2>
            <p className="emotion-review__help">{SOURCE[current.source] ?? current.source} · {current.id}</p>

            <Section step={step++} title="¿Qué es esta consulta?">
              <div className="query-labels__cards" role="radiogroup" aria-label="Tipo de consulta">
                {STATUS.map(s => <button key={s.value} type="button" role="radio" aria-checked={draft.status === s.value}
                  className={`query-labels__card${draft.status === s.value ? " is-on" : ""}`} onClick={() => setStatus(s.value)}>
                  <s.icon size={22} weight={draft.status === s.value ? "fill" : "regular"} aria-hidden />
                  <span><strong>{s.name}</strong><small>{s.help}</small><Example example={s.example} how={s.how} /></span>
                </button>)}
              </div>
            </Section>

            {showConditions ? <Section step={step++} title={draft.status === "clarify" ? "Lecturas posibles" : "Condiciones: lo que pide"}
              help={<>Busca en la lista cada cosa que la consulta pide (género, emoción, actividad, energía, década…) y elige su papel. Cada opción muestra su definición.
                <ul className="query-labels__legend">{roles.map(r => <li key={r.value}><r.icon size={16} weight="bold" aria-hidden /><span><strong>{r.name}:</strong> {r.help} <Example example={r.example} how={r.how} /></span></li>)}</ul></>}>
              <ul className="query-labels__chips">
                {draft.chips.map(chip => {
                  const o = byId.get(chip.id);
                  return <li key={chip.id}>
                    <span className="query-labels__option"><strong>{o?.label ?? chip.id}</strong> <small>{o?.group}</small>{o?.hint ? <em>{o.hint}</em> : null}</span>
                    <span className="query-labels__seg" role="radiogroup" aria-label={`Papel de ${o?.label ?? chip.id}`}>
                      {roles.map(r => <button key={r.value} type="button" role="radio" aria-checked={chip.role === r.value} title={`${r.name}: ${r.help}`}
                        className={chip.role === r.value ? "is-on" : ""} onClick={() => setDraft(d => ({ ...d, chips: d.chips.map(c => (c.id === chip.id ? { ...c, role: r.value } : c)) }))}>
                        <r.icon size={15} weight="bold" aria-hidden /><span>{r.name}</span>
                      </button>)}
                    </span>
                    <button type="button" className="btn btn--sm" aria-label={`Quitar ${o?.label ?? chip.id}`} onClick={() => setDraft(d => ({ ...d, chips: d.chips.filter(c => c.id !== chip.id) }))}>Quitar</button>
                  </li>;
                })}
              </ul>
              <label className="query-labels__search"><MagnifyingGlass size={16} aria-hidden />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Busca: bailar, tristeza, salsa, energía, 1990, parecido…" aria-label="Añadir condición"
                  onKeyDown={e => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); add(matches[0]); } }} />
              </label>
              {matches.length ? <ul className="query-labels__matches">
                {matches.map(o => <li key={o.id}><button type="button" onClick={() => add(o)} className="query-labels__option"><strong>{o.label}</strong> <small>{o.group}</small>{o.hint ? <em>{o.hint}</em> : null}</button></li>)}
              </ul> : search.trim() ? <p className="query-labels__hint">No está en la lista. Si la consulta lo pide, va como <strong>pendiente</strong> (paso siguiente).</p> : null}
            </Section> : null}

            {draft.status ? <Section step={step++} title="¿Queda algo fuera de la lista?">
              <div className="query-labels__toggles">
                <label className={`query-labels__card${draft.pending ? " is-on" : ""}${AUTO_PENDING.includes(draft.status) ? " is-locked" : ""}`}>
                  <input type="checkbox" checked={draft.pending} disabled={AUTO_PENDING.includes(draft.status)} onChange={e => setDraft(d => ({ ...d, pending: e.target.checked }))} />
                  <HourglassMedium size={22} weight={draft.pending ? "fill" : "regular"} aria-hidden />
                  <span><strong>Pide algo que no está en la lista (pendiente)</strong>
                    <small>Idioma, duración, instrumento, tipo de voz, en vivo o cover, país, popularidad, novedad, o una ocasión como dedicar, cocinar u orar.{AUTO_PENDING.includes(draft.status) ? " Con el tipo elegido en el paso 1 se marca solo." : ""}</small>
                    <Example example="canciones de los kipus en vivo" how="nombre «los kipus» + pendiente (versión en vivo)." /></span>
                </label>
                {draft.pending ? <label className="query-labels__facet">¿Qué queda pendiente? (opcional)
                  <select value={draft.facet} onChange={e => setDraft(d => ({ ...d, facet: e.target.value }))}>
                    <option value="">No lo sé / varias cosas</option>
                    {data.options.facets.map(f => <option key={f.id} value={f.id}>{f.label} — {f.hint}</option>)}
                  </select>
                </label> : null}
                <label className={`query-labels__card${draft.ctx ? " is-on" : ""}`}>
                  <input type="checkbox" checked={draft.ctx} onChange={e => setDraft(d => ({ ...d, ctx: e.target.checked }))} />
                  <Heart size={22} weight={draft.ctx ? "fill" : "regular"} aria-hidden />
                  <span><strong>Cuenta cómo se siente o qué le pasa a quien busca</strong>
                    <small>Solo si la persona habla de sí misma, no de la música.</small>
                    <Example example="estoy despechado, canciones de despecho" how="marcar esto + condición «Tristeza»." /></span>
                </label>
              </div>
            </Section> : null}

            {showNames ? <Section step={step++} title="Nombres en la consulta"
              help={<>Si aparece un artista, disco o canción, cópialo <strong>tal como está escrito</strong>, aunque tenga errores («xxtenations», «Abddon»). Si no hay ninguno, deja esto vacío.</>}>
              {draft.ents.map((ent, k) => <div key={k} className="query-labels__entity">
                <input aria-label="Nombre tal como aparece" value={ent.literal} placeholder="Nombre tal como aparece en la consulta" onChange={e => setEnt(k, { literal: e.target.value })} />
                <span className="query-labels__seg" role="radiogroup" aria-label="Papel del nombre">
                  {ENT_ROLE.map(r => <button key={r.value} type="button" role="radio" aria-checked={ent.role === r.value} title={`${r.name}: ${r.help}`}
                    className={ent.role === r.value ? "is-on" : ""} onClick={() => setEnt(k, { role: r.value })}><r.icon size={15} weight="bold" aria-hidden /><span>{r.name}</span></button>)}
                </span>
                <span className="query-labels__seg" role="radiogroup" aria-label="Tipo de nombre">
                  {KIND.map(o => <button key={o.name} type="button" role="radio" aria-checked={ent.kind === o.value} title={o.name}
                    className={ent.kind === o.value ? "is-on" : ""} onClick={() => setEnt(k, { kind: o.value })}><o.icon size={15} weight="bold" aria-hidden /><span>{o.name}</span></button>)}
                </span>
                <button type="button" className="btn btn--sm" onClick={() => setDraft(d => ({ ...d, ents: d.ents.filter((_, j) => j !== k) }))}>Quitar</button>
              </div>)}
              <ul className="query-labels__legend">{ENT_ROLE.map(r => <li key={r.value}><r.icon size={16} weight="bold" aria-hidden /><span><strong>{r.name}:</strong> {r.help} <Example example={r.example} how={r.how} /></span></li>)}</ul>
              <div><button type="button" className="btn btn--sm" onClick={() => setDraft(d => ({ ...d, ents: [...d.ents, { role: "target", kind: "artist", literal: "" }] }))}>Añadir nombre</button></div>
            </Section> : null}

            <Section step={step} title="Nota (opcional)">
              <textarea id="query-label-note" aria-label="Nota opcional" value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} maxLength={1000} rows={2}
                placeholder="Una línea si algo no es obvio. Ej.: «XXXTentacion mal escrito»." />
            </Section>

            {summary.length ? <div className="query-labels__summary"><strong>Así queda:</strong><ul>{summary.map(line => <li key={line}>{line}</li>)}</ul></div> : null}
            {problems.length ? <ul className="query-labels__problems" role="alert">{problems.map(p => <li key={p}><WarningCircle size={15} weight="fill" aria-hidden />{p}</li>)}</ul> : null}
            <div className="emotion-review__actions">
              <button className="btn btn--primary" type="button" disabled={!ready || saving} onClick={() => void save("labeled")}>{saving ? "Guardando…" : "Guardar y seguir"}</button>
              <button className="btn" type="button" disabled={saving} onClick={() => void save("skipped")} title="Si dudas entre dos lecturas razonables; explica en la nota.">No sé</button>
            </div>
            {current.labeledAt ? <small>Guardada el {new Date(current.labeledAt).toLocaleString("es-VE")}</small> : null}
          </> : <p>{data.total - data.labeled - data.skipped ? "Elige una consulta de la lista." : "No quedan consultas por etiquetar en este lote."}</p>}
        </section>
      </div>
    )}
  </div>;
}
