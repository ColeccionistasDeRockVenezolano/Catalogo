import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { personsApi, personWrites } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useDebouncedQuery } from "../lib/useDebouncedQuery";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { ErrorState, EmptyState } from "../components/StateViews";
import { CardGridSkeleton } from "../components/Skeletons";
import { EntityCard, initialOf } from "../components/EntityCard";
import { Pagination } from "../components/Pagination";
import { EntityFormModal } from "../components/EntityFormModal";
import { PERSON_FIELDS } from "../lib/entityFields";
import { nameClassLabel, PERSON_ROLES, personRoleLabel } from "../lib/labels";
import { PersonFilter, WITHOUT_CREDITS } from "../components/PersonFilter";
import { ListSummary } from "../components/ListFilters";
import { CatalogSearchInput } from "../components/CatalogSearchInput";
import { MobileCatalogTools } from "../components/MobileCatalogTools";
import { MOBILE_QUERY } from "../components/TopbarTools";
import { useMediaQuery } from "../lib/useMediaQuery";

const LIMIT = 30;
const SUSPECT_CLASSES = ["organization_like", "duration", "fragment", "multiple_people"] as const;

/** Buscador y filtros de personas (E11.9): la consulta ignora tildes. */
export function PersonsListPage() {
  const paginationStartRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const hasCredits = params.get("hasCredits") === "false" ? false : undefined;
  const suspectParam = params.get("suspect") ?? "";
  const suspect = SUSPECT_CLASSES.find((value) => value === suspectParam) ?? "";
  const roleParam = params.get("rol");
  const role = roleParam && PERSON_ROLES.includes(roleParam) ? roleParam : null;
  const sort = params.get("sort") === "credits" ? "credits" as const : "name" as const;
  const offset = Number(params.get("offset") ?? "0") || 0;

  const { isAdmin } = useOperator();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const { notify } = useToast();
  const [creating, setCreating] = useState(false);

  const facets = useAsync((signal) => personsApi.facets(signal), []);
  const { data, loading, error, reload } = useAsync(
    (signal) => personsApi.list({
      limit: LIMIT, offset, sort,
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(hasCredits === false ? { hasCredits } : {}),
      ...(suspect ? { suspect } : {}),
      ...(role ? { role } : {}),
    }, signal),
    [q, hasCredits, suspect, role, sort, offset],
  );

  const update = useCallback((next: Record<string, string | undefined>, replace = false) => {
    setParams((current) => {
      const merged = new URLSearchParams(current);
      for (const [key, value] of Object.entries(next)) {
        if (!value) merged.delete(key); else merged.set(key, value);
      }
      merged.delete("offset");
      return merged;
    }, { replace });
  }, [setParams]);

  function selectParticipation(value: string | null) {
    update({ rol: value && value !== WITHOUT_CREDITS ? value : undefined,
      hasCredits: value === WITHOUT_CREDITS ? "false" : undefined });
  }

  function clearFilters() {
    setQuery("");
    update({ q: undefined, rol: undefined, hasCredits: undefined, suspect: undefined });
  }

  // La consulta se aplica con retardo (patrón compartido con las otras
  // listas): teclear no dispara una petición ni una entrada de historial por
  // letra; el resto de filtros siguen siendo inmediatos.
  const [query, setQuery] = useDebouncedQuery(q, (value) => update({ q: value }, true));

  const activeFilters = [
    ...(role ? [{ key: "role", label: personRoleLabel(role), onClear: () => update({ rol: undefined }) }] : []),
    ...(hasCredits === false ? [{ key: "credits", label: "Sin créditos", onClear: () => update({ hasCredits: undefined }) }] : []),
    ...(suspect ? [{ key: "suspect", label: `Sospechosas: ${nameClassLabel(suspect)}`, onClear: () => update({ suspect: undefined }) }] : []),
  ];
  const filtered = Boolean(query.trim()) || activeFilters.length > 0;
  const searchField = (
    <CatalogSearchInput scope="person" value={query} onChange={setQuery}
      placeholder="Buscar por nombre o alias (jose encuentra «José»)…" label="Buscar personas" />
  );
  const participationFilter = (
    <PersonFilter facets={facets.data} error={facets.error} onRetry={facets.reload}
      selection={hasCredits === false ? WITHOUT_CREDITS : role}
      onSelect={selectParticipation} />
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Personas</h1>
          <p className="page-lead">Explora las personas por sus créditos y participación en bandas.</p>
        </div>
        {isAdmin ? <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>+ Nueva persona</button> : null}
      </div>

      {isMobile ? (
        <MobileCatalogTools search={searchField} query={query} onClearQuery={() => setQuery("")}
          activeCount={activeFilters.length} total={data?.pagination.total} noun={{ one: "persona", many: "personas" }} onClearAll={clearFilters}
          settings={<>
            <div className="catalog-sort">
              <label htmlFor="person-sort">Ordenar por</label>
              <select id="person-sort" className="filter-input" value={sort} onChange={(event) => update({ sort: event.target.value })}>
                <option value="name">Nombre</option>
                <option value="credits">Más créditos</option>
              </select>
            </div>
            <div className="catalog-sort">
              <label htmlFor="person-suspect">Mostrar</label>
              <select id="person-suspect" className="filter-input" value={suspect} onChange={(event) => update({ suspect: event.target.value })}>
                <option value="">Todas las fichas</option>
                {SUSPECT_CLASSES.map((value) => <option key={value} value={value}>Sospechosas: {nameClassLabel(value)}</option>)}
              </select>
            </div>
          </>}
          groups={[{ key: "participation", label: "Participación", empty: "Todas",
            value: hasCredits === false ? "Sin créditos" : role ? personRoleLabel(role) : null, content: participationFilter }]} />
      ) : (
        <>
          <div className="list-toolbar">
            {searchField}
            <label className="visually-hidden" htmlFor="person-sort">Ordenar</label>
            <select id="person-sort" className="filter-input" value={sort} onChange={(event) => update({ sort: event.target.value })}>
              <option value="name">Ordenar por nombre</option>
              <option value="credits">Ordenar por más créditos</option>
            </select>
          </div>

          {participationFilter}

          <div className="list-toolbar">
            <label className="visually-hidden" htmlFor="person-suspect">Filtrar por nombres sospechosos</label>
            <select id="person-suspect" className="filter-input" value={suspect} onChange={(event) => update({ suspect: event.target.value })}>
              <option value="">Todas las fichas</option>
              {SUSPECT_CLASSES.map((value) => <option key={value} value={value}>Sospechosas: {nameClassLabel(value)}</option>)}
            </select>
          </div>
        </>
      )}

      <ListSummary total={data?.pagination.total} noun={{ one: "persona", many: "personas" }} loading={loading}
        query={query} filters={activeFilters} onClearQuery={() => setQuery("")} onClearAll={clearFilters} />

      <div ref={paginationStartRef} className="pagination-start" />

      {loading && !data ? <CardGridSkeleton count={12} label="Cargando personas…" /> : error ? <ErrorState message={error} onRetry={reload} /> : !data || data.data.length === 0 ? (
        <EmptyState title={filtered ? "Ninguna persona coincide con estos filtros" : "No hay personas para mostrar"}
          hint={filtered ? "Prueba con otro nombre o participación, o quita alguno de los filtros." : undefined}
          action={filtered ? <button type="button" className="btn btn--sm" onClick={clearFilters}>Quitar filtros</button> : null} />
      ) : (
        <>
          <div className={`grid-cards${loading ? " is-refreshing" : ""}`}>
            {data.data.map((person) => (
              <EntityCard
                key={person.id}
                to={`/personas/${person.id}`}
                title={person.name}
                deceased={person.isDeceased}
                subtitle={person.nameClass === "ok"
                  ? person.nationality
                  : `${nameClassLabel(person.nameClass)}: ${person.nameClassReason}`}
                imageUrl={person.pictureUrl}
                placeholder={initialOf(person.name)}
              />
            ))}
          </div>
          <Pagination
            scrollTargetRef={paginationStartRef}
            limit={LIMIT} offset={offset} total={data.pagination.total}
            onOffsetChange={(next) => setParams((current) => {
              const merged = new URLSearchParams(current);
              merged.set("offset", String(next));
              return merged;
            })}
          />
        </>
      )}

      {creating ? (
        <EntityFormModal
          title="Nueva persona"
          fields={PERSON_FIELDS}
          initialValues={{ isVenezuelan: true }}
          onSubmit={(values, note) => personWrites.create({ ...values, note })}
          onSuccess={() => { setCreating(false); reload(); facets.reload(); notify("success", "Persona creada."); }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
