import { claimReference, creditSourceGroups } from "../lib/provenance";
import { fieldLabel } from "../lib/curation";
import type { CreditSource } from "../lib/types";

export interface CreditProvenanceState {
  data: CreditSource[] | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => void;
}

const STATES: Record<string, string> = {
  accepted: "Aceptado", candidate: "Pendiente", conflict: "En conflicto", superseded: "Reemplazado", rejected: "Rechazado",
};
const FIELDS: Record<string, string> = { artist_name: "Artista", album_title: "Disco", track_title: "Pista", credited_name: "Nombre acreditado", credit_role: "Rol", credit_scope: "Ámbito", credit_type: "Tipo de crédito" };

export function CreditProvenance({ kind, ids, state }: {
  kind: CreditSource["entityKind"]; ids: number[]; state: CreditProvenanceState;
}) {
  if (state.loading) return <p className="credit-provenance" role="status">Cargando fuentes…</p>;
  if (state.error) return <div className="credit-provenance" role="alert">No se pudo cargar el origen. <button type="button" className="btn btn--sm btn--ghost" onClick={state.reload}>Reintentar fuentes</button></div>;
  const selected = new Set(ids);
  const claims = (state.data ?? []).filter((row) => row.entityKind === kind && selected.has(row.entityId)).flatMap((row) => row.claims);
  const groups = creditSourceGroups(claims);
  if (!groups.length) return <p className="credit-provenance">Sin fuente registrada para este crédito.</p>;

  return <div className="credit-provenance">
    {groups.map(({ claim, claims: entries, reference }) => {
      const excerpts = [...new Set(entries.flatMap((item) => item.evidence.map((e) => e.excerpt)).filter((text): text is string => Boolean(text)))];
      const urls = [...new Set(entries.flatMap((item) => claimReference(item).evidenceUrls))];
      const statuses = [...new Set(entries.map((item) => STATES[item.status] ?? item.status))];
      return <div key={`${claim.sourceId}:${reference.url ?? ""}`}>
        <p>Fuente: {reference.url ? <a href={reference.url} target="_blank" rel="noopener noreferrer">{claim.sourceName}</a> : <strong>{claim.sourceName}</strong>} <span className="credit-provenance__status">· {statuses.join(" / ")}</span></p>
        <details>
          <summary>Ver origen del crédito</summary>
          {reference.isSourceHomepage ? <p>Enlace general de la fuente; sin página de evidencia registrada.</p> : !reference.url ? <p>Sin enlace web registrado.{entries.some((item) => item.createdBy === "human") ? " Edición manual." : ""}</p> : null}
          <ul>
            {entries.map((item) => {
              const value = item.normalizedValue ?? item.rawValue;
              return <li key={item.id}><strong>{FIELDS[item.field] ?? fieldLabel(item.field)}:</strong> {typeof value === "object" ? JSON.stringify(value) : String(value ?? "Sin valor")} <span className="credit-provenance__status">· {STATES[item.status] ?? item.status} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString("es-VE")}</time></span></li>;
            })}
          </ul>
          {excerpts.map((text, index) => <blockquote key={index}>{text}</blockquote>)}
          {urls.filter((url) => url !== reference.url).map((url, index) => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">Referencia adicional {index + 1}</a></p>)}
        </details>
      </div>;
    })}
  </div>;
}
