// CRV · Curaduría: evaluación humana del estudio del buscador (etapa 2).
//
// Dos pasos por cita. Primero se lee a ciegas: la persona anota objeto, tipo,
// estado, valoración y alcance sin ver la lectura del analista. Solo después
// la API revela la anotación y se juzga si la representa. La lectura ciega no
// se reescribe tras verla; así la comparación conserva su independencia.
import { useEffect, useState } from "react";
import { ApiError, searchHumanReviewApi, type HumanBlind, type HumanEvaluationItem, type HumanEvaluationState, type HumanVerdict } from "../lib/api";
import "../styles/curation-emotions.css";

const OBJECT = [["album", "El disco"], ["track", "Una pista"], ["artist", "La banda o artista"], ["unknown", "No se sabe"]] as const;
const TYPE = [["sound", "Sonido"], ["lyrics", "Letra"], ["experience", "Experiencia del oyente"], ["comparison", "Comparación"], ["taste", "Gusto sin atributo"],
  ["context", "Contexto o dato"], ["attributed_intent", "Intención atribuida"], ["fact", "Hecho"]] as const;
const STATE = [["affirmed", "Afirma"], ["negated", "Niega"], ["hypothetical", "Hipotético"], ["conditional", "Condicional"], ["quoted", "Cita a otro"],
  ["possible_irony", "Posible ironía"], ["corrected", "Se corrige"], ["withdrawn", "Se retracta"], ["uncertain", "Incierto"]] as const;
const APPRECIATION = [["liked", "Le gusta"], ["disliked", "No le gusta"], ["mixed", "Mixta"], ["descriptive", "Solo describe"]] as const;
const COVERAGE = [["complete", "Toda la unidad"], ["partial", "Una parte"], ["unknown", "No se sabe"]] as const;
const VERDICT: [HumanVerdict, string][] = [["supported", "La representa bien"], ["appreciation_error", "Error de valoración"], ["scope_error", "Error de alcance"],
  ["unsupported_generalization", "Generaliza sin soporte"], ["other_error", "Otro error"]];
const label = (list: readonly (readonly [string, string])[], value: string) => list.find(([v]) => v === value)?.[1] ?? value;
const empty: HumanBlind = { object: "unknown", type: "", state: "", appreciation: "", coverage: "" };

export function CurationSearchEvaluationPage() {
  const [data, setData] = useState<HumanEvaluationState>();
  const [selected, setSelected] = useState<string | null>(null);
  const [blind, setBlind] = useState<HumanBlind>(empty);
  const [verdict, setVerdict] = useState<HumanVerdict | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(keep?: string) {
    try {
      const next = await searchHumanReviewApi.evaluation();
      setData(next); setError(null);
      if (keep) setSelected(keep);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se pudo cargar la evaluación.");
    }
  }
  useEffect(() => { void load(); }, []);

  const current = data?.items.find((item) => item.id === selected) ?? null;
  function choose(item: HumanEvaluationItem) {
    setSelected(item.id); setBlind(item.blind ?? empty); setVerdict(item.verdict ?? ""); setNote(item.note); setError(null);
  }
  async function run(action: () => Promise<unknown>, keep: string) {
    setSaving(true); setError(null);
    try { await action(); await load(keep); } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se pudo guardar.");
    } finally { setSaving(false); }
  }
  const blindReady = Boolean(blind.type && blind.state && blind.appreciation && blind.coverage);
  const m = data?.metrics;

  return <div className="emotion-review">
    <header className="emotion-review__head">
      <h2>Evaluación humana del buscador</h2>
      <p>Lee cada cita sin ver la interpretación del analista y anota qué afirma. Al guardar se revela la anotación del estudio y juzgas si la representa. Tu lectura ciega no se puede cambiar después de verla.</p>
      {m && data ? <span className="emotion-review__count">
        {m.judged} de {m.total} juzgadas · alcance {m.scopeErrors} (máx. {data.thresholds.scopeErrorsAllowed}) · sin soporte {m.unsupportedGeneralizations} (máx. {data.thresholds.unsupportedGeneralizationsAllowed}) · precisión {m.supportPrecision === null ? "—" : `${Math.round(m.supportPrecision * 1000) / 10} %`} (mín. {data.thresholds.supportPrecision * 100} %)
        {data.complete ? (data.meetsThresholds ? " · cumple los umbrales" : " · no cumple los umbrales") : ""}
      </span> : null}
    </header>
    {error ? <p role="alert" className="emotion-review__error">{error}</p> : null}
    {!data ? (error ? null : <p role="status">Cargando citas…</p>) : (
      <div className="emotion-review__workspace">
        <div className="emotion-review__list" aria-label="Citas para evaluar">
          {data.items.map((item) => <button key={item.id} type="button" className={`emotion-review__item${selected === item.id ? " is-selected" : ""}`} onClick={() => choose(item)}>
            <strong>{item.work ?? "Obra"} · {item.id}</strong>
            <span>{item.verdict ? `Juzgada: ${label(VERDICT, item.verdict)}` : item.blind ? "Lectura ciega guardada" : item.stale ? "La cita cambió: volver a leer" : "Pendiente"}</span>
          </button>)}
        </div>
        <section className="emotion-review__detail" aria-live="polite">
          {current ? <>
            <h2>{current.work ?? "Obra"}</h2>
            <p>{current.workKind === "track" ? "Pista" : current.workKind === "artist" ? "Artista" : "Disco"} · idioma {current.language} · <a href={current.source} target="_blank" rel="noreferrer">reseña original</a></p>
            <blockquote lang={current.language} style={{ margin: 0, paddingLeft: 12, borderLeft: "2px solid var(--border)" }}>«{current.quote}»</blockquote>
            {!current.blind ? <>
              <h3>1. Tu lectura ciega</h3>
              {([["object", "¿Sobre qué habla?", OBJECT], ["type", "¿Qué tipo de afirmación es?", TYPE], ["state", "¿Cómo lo afirma?", STATE],
                ["appreciation", "¿Qué valoración expresa?", APPRECIATION], ["coverage", "¿A qué parte se refiere?", COVERAGE]] as const).map(([key, text, options]) =>
                <label key={key}>{text}
                  <select value={blind[key]} onChange={(event) => setBlind({ ...blind, [key]: event.target.value })}>
                    {key !== "object" ? <option value="">Elegir</option> : null}
                    {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                  </select>
                </label>)}
              <div className="emotion-review__actions">
                <button className="btn btn--primary" type="button" disabled={!blindReady || saving}
                  onClick={() => void run(() => searchHumanReviewApi.blind(current.id, blind), current.id)}>{saving ? "Guardando…" : "Guardar y ver la anotación"}</button>
              </div>
            </> : <>
              <h3>Tu lectura ciega</h3>
              <p>{label(OBJECT, current.blind.object)} · {label(TYPE, current.blind.type)} · {label(STATE, current.blind.state)} · {label(APPRECIATION, current.blind.appreciation)} · {label(COVERAGE, current.blind.coverage)}</p>
              {current.annotation ? <>
                <h3>2. Anotación del estudio ({current.annotation.analyst.split(";")[0]})</h3>
                <p>{label(OBJECT, current.annotation.object)} · {label(TYPE, current.annotation.type)} · {label(STATE, current.annotation.state)} · {label(APPRECIATION, current.annotation.appreciation)} · {label(COVERAGE, current.annotation.coverage)}</p>
                <p><strong>{current.annotation.aspect}</strong> = {current.annotation.value}{current.annotation.listeningCondition ? ` · condición: ${current.annotation.listeningCondition}` : ""}{current.annotation.dependencies.length ? ` · depende de: ${current.annotation.dependencies.join(", ")}` : ""}</p>
                <p>{current.annotation.interpretation}</p>
                <p className="emotion-review__help">Alternativa: {current.annotation.alternative}</p>
              </> : null}
              <label htmlFor="human-verdict">¿La anotación representa lo que dice la cita?</label>
              <select id="human-verdict" value={verdict} onChange={(event) => setVerdict(event.target.value as HumanVerdict | "")}>
                <option value="">Elegir</option>
                {VERDICT.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
              <label htmlFor="human-note">Nota opcional</label>
              <textarea id="human-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} placeholder="Qué corregirías y por qué" />
              <div className="emotion-review__actions">
                <button className="btn btn--primary" type="button" disabled={!verdict || saving}
                  onClick={() => verdict && void run(() => searchHumanReviewApi.verdict(current.id, verdict, note), current.id)}>{saving ? "Guardando…" : "Guardar juicio"}</button>
              </div>
            </>}
          </> : <p>Elige una cita de la lista. No verás la anotación del estudio hasta guardar tu lectura ciega.</p>}
        </section>
      </div>
    )}
  </div>;
}
