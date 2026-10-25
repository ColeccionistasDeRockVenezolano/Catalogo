// CRV · Piezas del modelo discográfico (plan del primo, etapa 2): versiones,
// línea de serie, créditos en bloques de nombres y en frase, integrantes
// agrupados y línea de tiempo de la banda.
import { Fragment, useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  AlbumVersion, ArtistMember, CreditStatement, DiscographyItem, LabelRef, OrganizationRelation, ScopedCredit, SeriesMembership, Credit,
} from "../lib/types";
import { DeceasedMark } from "./DeceasedMark";
import { albumFilterTypeLabel, roleTitle } from "../lib/labels";
import { creditTarget, orderMusicianBlocks, trackScope, type CreditLine } from "../lib/creditLayout";
import { INSTRUMENT_LABEL } from "../../../src/discography/instruments";
import { plotted, timelineReady } from "../lib/membersTimeline";
import { mediaImage } from "../lib/media";

// ── Versiones ──────────────────────────────────────────────────────────────
function labelsText(labels: LabelRef[]): ReactNode {
  if (!labels.length) return <span className="version-row__muted">Sello sin registrar</span>;
  return labels.map((label, index) => (
    <Fragment key={`${label.organizationId}:${label.role}`}>
      {index > 0 ? " · " : null}
      <Link to={`/organizaciones/${label.organizationId}`}>{label.name}</Link>
      {label.role !== "label" ? <span className="version-row__muted"> ({label.roleLabel.toLowerCase()})</span> : null}
    </Fragment>
  ));
}

/** Lista sobria de versiones de la obra, al estilo de Discogs (imagen 2 del plan). */
export function AlbumVersions({ versions, coverUrl }: { versions: AlbumVersion[]; coverUrl: string | null }) {
  if (!versions.length || (versions.length === 1 && !versions[0]?.editionTypes?.length)) return null;
  return (
    <ul className="version-list" aria-label="Versiones">
      {versions.map((version) => {
        const cover = version.coverUrl ?? coverUrl;
        return (
          <li key={version.id} className="version-row">
            <span className="version-row__art">{cover ? <img {...mediaImage(cover, 64)} alt="" loading="lazy" decoding="async" /> : null}</span>
            <div className="version-row__body">
              <p className="version-row__title">
                {version.title ?? (version.isPrimary ? "Edición original" : "Versión")}
                {version.isPrimary ? <span className="badge" style={{ marginLeft: 8 }}>Principal</span> : null}
              </p>
              {version.editionTypes?.length ? <div className="entity-hero__meta">{version.editionTypes.map(type => <Link className="badge" key={type} to={`/discos?tipo=${encodeURIComponent(type)}`}>{albumFilterTypeLabel(type)}</Link>)}</div> : null}
              {version.formatDetails ?? version.format ? <p className="version-row__format">{version.formatDetails ?? version.format}</p> : null}
              <p className="version-row__label">
                {labelsText(version.labels)}
                {version.catalogNumber ? <span className="mono"> – {version.catalogNumber}</span> : null}
              </p>
              <p className="version-row__place">
                {[version.country ?? "País sin dato", version.releaseDate ?? (version.releaseYear !== null ? String(version.releaseYear) : "año sin dato")].join(" — ")}
              </p>
              {version.notes ? <p className="version-row__notes">{version.notes}</p> : null}
            </div>
            {version.sourceUrl ? (
              <a className="version-row__source" href={version.sourceUrl} target="_blank" rel="noreferrer noopener">Fuente</a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** «Serie: Venezuela Electrónica – Vol. 1», con el volumen anterior y el siguiente. */
export function SeriesLines({ series }: { series: SeriesMembership[] }) {
  if (!series.length) return null;
  return (
    <div className="series-lines">
      {series.map((item) => (
        <p key={item.id} className="series-line">
          <span className="series-line__label">Serie:</span>{" "}
          <Link to={`/series/${item.id}`}>{item.line}</Link>
          {item.previous || item.next ? (
            <span className="series-line__nav">
              {item.previous ? <Link to={`/discos/${item.previous.albumId}`} title={item.previous.title}>← anterior</Link> : null}
              {item.previous && item.next ? " · " : null}
              {item.next ? <Link to={`/discos/${item.next.albumId}`} title={item.next.title}>siguiente →</Link> : null}
            </span>
          ) : null}
        </p>
      ))}
    </div>
  );
}

// ── Créditos en bloques de nombres (imagen 1) ──────────────────────────────
export { roleTitle };

/** Bloques por rol con chips de nombres; un nombre acotado a pistas lleva sus números. */
export function CreditChips({ credits, scoped, musicians = false }: { credits: Credit[]; scoped: ScopedCredit[]; musicians?: boolean }) {
  const blocks = new Map<string, Array<{ credit: Credit; scope: string | null }>>();
  const push = (credit: Credit, scope: string | null) => {
    const key = roleTitle(credit.role || credit.creditType);
    const list = blocks.get(key) ?? [];
    const target = creditTarget(credit);
    if (target && list.some((item) => creditTarget(item.credit)?.to === target.to && item.scope === scope)) return;
    blocks.set(key, [...list, { credit, scope }]);
  };
  for (const credit of credits) push(credit, null);
  for (const credit of scoped) push(credit, trackScope(credit.tracks));
  if (!blocks.size) return <p className="credit-chips__empty">Sin créditos registrados.</p>;
  const entries = [...blocks.entries()].map(([role, items]) => ({ role, items }));
  // Músicos: «Lead Vocals» primero y luego el bloque más grande (plan v2, punto 11).
  const ordered = musicians ? orderMusicianBlocks(entries, ({ credit }) => creditTarget(credit)?.name ?? credit.role) : entries;
  return (
    <div className="credit-chips">
      {ordered.map(({ role, items }) => (
        <div key={role} className="credit-chips__block">
          <h4 className="credit-chips__role">{role}</h4>
          <ul className="credit-chips__names">
            {items.map(({ credit, scope }) => {
              const target = creditTarget(credit);
              return (
                <li key={`${credit.id}:${scope ?? ""}`}>
                  {target ? (
                    <Link className="credit-chip" to={target.to}>
                      {target.name}<DeceasedMark deceased={target.deceased} />
                      {scope ? <span className="credit-chip__scope">{scope}</span> : null}
                    </Link>
                  ) : <span className="credit-chip">{credit.role}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── Créditos en frase ──────────────────────────────────────────────────────
function partLink(part: CreditStatement["parts"][number]): string | null {
  if (part.personId !== null) return `/personas/${part.personId}`;
  if (part.artistId !== null) return `/artistas/${part.artistId}`;
  if (part.organizationId !== null) return `/organizaciones/${part.organizationId}`;
  if (part.placeId !== null) return `/lugares/${part.placeId}`;
  return null;
}

/** «[Mixed & Mastered] by [José Morales] at [Casita], [2026] ([Chicago, IL])», con sus partes enlazadas. */
export function CreditStatementLine({ statement }: { statement: CreditStatement }) {
  const chars = Array.from(statement.text);
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const part of statement.parts) {
    if (part.start < cursor || part.end > chars.length) continue;
    if (part.start > cursor) out.push(chars.slice(cursor, part.start).join(""));
    const text = chars.slice(part.start, part.end).join("");
    const to = partLink(part);
    const className = `statement-part statement-part--${part.type}`;
    out.push(part.type === "role" ? <span key={part.start} className={className}>{roleTitle(text)}</span>
      : to ? <Link key={part.start} className={className} to={to}>{text}</Link>
        : <span key={part.start} className={className}>{text}</span>);
    cursor = part.end;
  }
  if (cursor < chars.length) out.push(chars.slice(cursor).join(""));
  return <p className="credit-statement">{out}</p>;
}

export function CreditStatements({ statements, title = "Créditos del canal" }: { statements: CreditStatement[]; title?: string | null }) {
  if (!statements.length) return null;
  return (
    <div className="credit-statements">
      {title ? <h3>{title}</h3> : null}
      {statements.map((statement) => <CreditStatementLine key={statement.id} statement={statement} />)}
    </div>
  );
}

/** «Recorded & Mixed by Boris Milan», con el mismo aspecto que las líneas del canal (plan v2, punto 12). */
export function CreditLines({ lines }: { lines: CreditLine[] }) {
  if (!lines.length) return null;
  return (
    <div className="credit-lines">
      {lines.map((line) => (
        <p key={line.key} className="credit-statement">
          <span className="statement-part statement-part--role">{line.roles}</span>
          {line.joiner === ":" ? ": " : ` ${line.joiner} `}
          {line.targets.map(({ target, fallback }, index) => (
            <Fragment key={target?.key ?? `${fallback}:${index}`}>
              {index > 0 ? (index === line.targets.length - 1 ? " & " : ", ") : null}
              {target ? (
                <Link className={`statement-part statement-part--${target.key.startsWith("o") ? "organization" : "person"}`} to={target.to}>
                  {target.name}<DeceasedMark deceased={target.deceased} />
                </Link>
              ) : <span className="statement-part">{fallback}</span>}
            </Fragment>
          ))}
          {line.scope ? <span className="credit-line__scope"> ({line.scope})</span> : null}
        </p>
      ))}
    </div>
  );
}

// ── Integrantes ────────────────────────────────────────────────────────────
export type MemberGroupKey = "current" | "past" | "founders";

/** Actuales primero, luego pasados; los fundadores aparte (también pueden estar en los otros dos). */
export function groupMembers(members: ArtistMember[]): Array<{ key: MemberGroupKey; title: string; members: ArtistMember[] }> {
  const groups: Array<{ key: MemberGroupKey; title: string; members: ArtistMember[] }> = [
    { key: "current", title: "Integrantes actuales", members: members.filter((member) => member.isCurrent) },
    { key: "past", title: "Integrantes pasados", members: members.filter((member) => !member.isCurrent) },
    { key: "founders", title: "Integrantes fundadores", members: members.filter((member) => member.isFounder) },
  ];
  return groups.filter((group) => group.members.length > 0);
}

// ── Línea de tiempo (imagen 4) ─────────────────────────────────────────────
const INSTRUMENT_COLORS: Readonly<Record<string, string>> = {
  vocals: "#e5484d", backing_vocals: "#f5a3a6", lead_guitar: "#30a46c", guitar: "#46a758", bass: "#0b68cb", drums: "#f76b15",
  percussion: "#ffb224", keyboards: "#8e4ec6", programming: "#6e56cf", turntables: "#12a594", cuatro: "#a18072", strings: "#978365",
  woodwinds: "#29a383", brass: "#d6409f", accordion: "#ad7f58", all_instruments: "#687076", direction: "#3e63dd",
};

const memberSortYear = (member: ArtistMember) => member.fromYear ?? member.toYear ?? Number.MAX_SAFE_INTEGER;

export function MembersTimeline({ members, albums, endYear, formedYear = null }: { members: ArtistMember[]; albums: DiscographyItem[]; endYear: number; formedYear?: number | null }) {
  const instrumentLabels = INSTRUMENT_LABEL as Readonly<Record<string, string>>;
  const uid = useId().replace(/[^a-zA-Z0-9]/gu, "");
  if (!timelineReady(members, formedYear)) return null;
  const knownYears = members.flatMap((member) => [member.fromYear, member.toYear]).filter((year): year is number => year !== null);
  const start = Math.min(...(formedYear !== null ? [formedYear] : []), ...knownYears);
  const end = Math.max(endYear, ...knownYears);
  const shown = members.filter((member) => plotted(member, true));
  const shownPeople = new Set(shown.map((member) => member.personId));
  const missing = [...new Map(members.filter((member) => !shownPeople.has(member.personId)).map((member) => [member.personId, member])).values()];
  // Una fila por persona, en orden de entrada (los que solo tienen salida, por su salida).
  const byPerson = new Map<number, ArtistMember[]>();
  for (const member of [...shown].sort((a, b) => memberSortYear(a) - memberSortYear(b))) byPerson.set(member.personId, [...(byPerson.get(member.personId) ?? []), member]);
  const rows = [...byPerson.values()];
  const studio = albums.filter((album) => album.albumType === "studio_album" && album.releaseYear !== null && album.releaseYear >= start && album.releaseYear <= end);
  const labelWidth = 200; const rowHeight = 22; const width = 1000; const chartWidth = width - labelWidth - 12;
  const x = (year: number) => labelWidth + ((year - start) / Math.max(1, end + 1 - start)) * chartWidth;
  const height = rows.length * rowHeight + 30;
  const step = Math.max(1, Math.ceil((end - start + 1) / 12));
  const ticks = Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, index) => start + index * step);
  const used = new Set(shown.flatMap((member) => member.instruments ?? []));
  const uncertain = shown.some((member) => member.fromYear === null || (member.toYear === null && !member.isCurrent));
  const periodText = (member: ArtistMember) => `${member.fromYear ?? "?"}–${member.isCurrent ? "hoy" : member.toYear ?? "?"}`;
  return (
    <figure className="members-timeline">
      <div className="members-timeline__scroll">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Línea de tiempo de los integrantes">
          <defs>
            <linearGradient id={`${uid}-out`}><stop offset="0" stopColor="#fff" stopOpacity="1" /><stop offset="0.3" stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="0.06" /></linearGradient>
            <linearGradient id={`${uid}-in`}><stop offset="0" stopColor="#fff" stopOpacity="0.06" /><stop offset="0.7" stopColor="#fff" stopOpacity="0.3" /><stop offset="1" stopColor="#fff" stopOpacity="1" /></linearGradient>
            <mask id={`${uid}-fade-out`} maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill={`url(#${uid}-out)`} /></mask>
            <mask id={`${uid}-fade-in`} maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill={`url(#${uid}-in)`} /></mask>
          </defs>
          {rows.map((row, index) => (
            <g key={row[0]!.personId}>
              <rect x={labelWidth} y={index * rowHeight} width={chartWidth} height={rowHeight} className={index % 2 ? "tl-band" : "tl-band tl-band--alt"} />
              <text x={labelWidth - 8} y={index * rowHeight + rowHeight / 2 + 4} textAnchor="end" className="tl-name">{row[0]!.personDisplayName ?? row[0]!.personName}</text>
              {row.map((member) => {
                // Entrada desconocida: desde el inicio de la banda, difuminado. Salida desconocida: hasta el final, difuminado.
                const from = x(member.fromYear ?? start);
                const to = x(member.toYear !== null ? member.toYear + 0.999 : end + 1);
                const fade = member.fromYear === null ? "in" : member.toYear === null && !member.isCurrent ? "out" : null;
                const [main, second] = member.instruments?.length ? member.instruments : ["all_instruments"];
                return (
                  <g key={member.id} mask={fade ? `url(#${uid}-fade-${fade})` : undefined}>
                    <title>{`${member.personName}: ${roleTitle(member.role)} (${periodText(member)})`}</title>
                    <rect x={from} y={index * rowHeight + 5} width={Math.max(2, to - from)} height={rowHeight - 10} fill={INSTRUMENT_COLORS[main!] ?? "#687076"} />
                    {second ? <rect x={from} y={index * rowHeight + rowHeight / 2 - 2} width={Math.max(2, to - from)} height={4} fill={INSTRUMENT_COLORS[second] ?? "#687076"} /> : null}
                  </g>
                );
              })}
            </g>
          ))}
          {studio.map((album) => (
            <line key={album.albumId} x1={x(album.releaseYear!) + 1} x2={x(album.releaseYear!) + 1} y1={0} y2={rows.length * rowHeight} className="tl-album">
              <title>{`${album.title} (${album.releaseYear})`}</title>
            </line>
          ))}
          {ticks.map((year) => (
            <g key={year}>
              <line x1={x(year)} x2={x(year)} y1={rows.length * rowHeight} y2={rows.length * rowHeight + 5} className="tl-axis" />
              <text x={x(year)} y={rows.length * rowHeight + 20} textAnchor="middle" className="tl-year">{year}</text>
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="members-timeline__legend">
        {[...used].map((key) => (
          <span key={key}><i style={{ background: INSTRUMENT_COLORS[key] ?? "#687076" }} />{instrumentLabels[key] ?? key}</span>
        ))}
        {studio.length ? <span><i className="tl-legend-album" />Disco de estudio</span> : null}
        {uncertain ? <span><i className="tl-legend-uncertain" />Entrada o salida sin fecha</span> : null}
      </figcaption>
      {missing.length ? (
        <p className="members-timeline__missing">Sin periodo conocido: {missing.map((member) => member.personDisplayName ?? member.personName).join(", ")}.</p>
      ) : null}
    </figure>
  );
}

// ── Sucesión de un sello (siempre con fuente) ──────────────────────────────
const RELATION_TEXT: Readonly<Record<string, { outgoing: string; incoming: string }>> = {
  renamed_from: { outgoing: "Antes se llamaba", incoming: "Pasó a llamarse" },
  absorbed_by: { outgoing: "Absorbida por", incoming: "Absorbió a" },
  division_of: { outgoing: "División de", incoming: "Tiene como división a" },
  successor_of: { outgoing: "Sucesora de", incoming: "La sucedió" },
};

function yearsText(start: number | null, end: number | null): string {
  if (start !== null && end !== null) return ` (${start}–${end})`;
  if (start !== null) return ` (${start})`;
  return end !== null ? ` (hasta ${end})` : "";
}

/** «Absorbida por PolyGram Venezuela (1995)», cada relación con su cita y sus fuentes. */
export function OrganizationSuccession({ relations }: { relations: OrganizationRelation[] }) {
  if (!relations.length) return null;
  // De lo más viejo a lo más nuevo: nombre anterior, sucesión, absorción; las divisiones al final.
  const order = ["renamed_from", "successor_of", "absorbed_by", "division_of"];
  const sorted = [...relations].sort((a, b) => order.indexOf(a.relationType) - order.indexOf(b.relationType)
    || (a.startYear ?? 9999) - (b.startYear ?? 9999) || a.other.name.localeCompare(b.other.name, "es"));
  return (
    <ul className="org-succession">
      {sorted.map((relation) => (
        <li key={`${relation.direction}:${relation.relationType}:${relation.other.id}`}>
          <p className="org-succession__line">
            {RELATION_TEXT[relation.relationType]?.[relation.direction] ?? relation.relationType}{" "}
            <Link to={`/organizaciones/${relation.other.id}`}>{relation.other.name}</Link>
            {yearsText(relation.startYear, relation.endYear)}
          </p>
          <p className="org-succession__evidence">
            {relation.evidenceNote}
            {relation.sourceUrls.map((url, index) => (
              <Fragment key={url}> <a href={url} target="_blank" rel="noreferrer noopener">Fuente{relation.sourceUrls.length > 1 ? ` ${index + 1}` : ""}</a></Fragment>
            ))}
          </p>
        </li>
      ))}
    </ul>
  );
}
