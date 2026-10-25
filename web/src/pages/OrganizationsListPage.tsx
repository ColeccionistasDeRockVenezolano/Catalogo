import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { organizationsApi, organizationWrites } from "../lib/api";
import { useEntityList } from "../lib/useEntityList";
import { useAsync } from "../lib/useAsync";
import { OrganizationFilter } from "../components/OrganizationFilter";
import { ListSummary } from "../components/ListFilters";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { ErrorState, EmptyState } from "../components/StateViews";
import { CardGridSkeleton } from "../components/Skeletons";
import { EntityCard, initialOf } from "../components/EntityCard";
import { Pagination } from "../components/Pagination";
import { EntityFormModal } from "../components/EntityFormModal";
import { ORGANIZATION_FIELDS } from "../lib/entityFields";
import { ORGANIZATION_TYPES, organizationTypeLabel } from "../lib/labels";
import { CatalogSearchInput } from "../components/CatalogSearchInput";
import { MobileCatalogTools } from "../components/MobileCatalogTools";
import { MOBILE_QUERY } from "../components/TopbarTools";
import { useMediaQuery } from "../lib/useMediaQuery";

export function OrganizationsListPage() {
  const paginationStartRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const typeParam = params.get("tipo");
  const selectedType = typeParam && ORGANIZATION_TYPES.includes(typeParam) ? typeParam : null;
  const facets = useAsync(organizationsApi.facets, []);
  const { data, loading, error, reload, q, offset, limit, setQuery, setOffset } = useEntityList(
    organizationsApi.list, [], selectedType ? { organizationType: selectedType } : {},
  );
  const typeLabel = selectedType ? organizationTypeLabel(selectedType) : null;
  const filtered = Boolean(q.trim()) || selectedType !== null;
  const { isAdmin } = useOperator();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const { notify } = useToast();
  const [creating, setCreating] = useState(false);

  function selectType(value: string | null) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set("tipo", value); else next.delete("tipo");
      next.delete("offset");
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ["q", "tipo", "offset"]) next.delete(key);
      return next;
    });
  }

  const searchField = (
    <CatalogSearchInput scope="organization" value={q} onChange={setQuery}
      placeholder="Filtrar por nombre…" label="Filtrar organizaciones por nombre" />
  );
  const typeFilter = (
    <OrganizationFilter facets={facets.data} error={facets.error} onRetry={facets.reload}
      selectedType={selectedType} onSelect={selectType} />
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Organizaciones</h1>
        </div>
        {isAdmin ? <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>+ Nueva organización</button> : null}
      </div>

      {isMobile ? (
        <MobileCatalogTools search={searchField} query={q} onClearQuery={() => setQuery("")}
          activeCount={selectedType ? 1 : 0} total={data?.pagination.total} noun={{ one: "organización", many: "organizaciones" }}
          onClearAll={clearFilters} groups={[{ key: "type", label: "Tipo de organización", value: typeLabel, content: typeFilter }]} />
      ) : (
        <>
          <div className="list-toolbar">{searchField}</div>
          {typeFilter}
        </>
      )}

      <ListSummary total={data?.pagination.total} noun={{ one: "organización", many: "organizaciones" }} loading={loading}
        query={q} filterLabel={typeLabel} onClearQuery={() => setQuery("")} onClearFilter={() => selectType(null)}
        onClearAll={clearFilters} />

      <div ref={paginationStartRef} className="pagination-start" />

      {loading && !data ? <CardGridSkeleton count={12} label="Cargando organizaciones…" /> : error ? <ErrorState message={error} onRetry={reload} /> : !data || data.data.length === 0 ? (
        <EmptyState title={filtered ? "Ninguna organización coincide con estos filtros" : "No hay organizaciones para mostrar"}
          hint={filtered ? "Prueba con otro nombre o tipo de organización, o quita alguno de los filtros." : undefined}
          action={filtered ? <button type="button" className="btn btn--sm" onClick={clearFilters}>Quitar filtros</button> : null} />
      ) : (
        <>
          <div className={`grid-cards${loading ? " is-refreshing" : ""}`}>
            {data.data.map((org) => (
              <EntityCard
                key={org.id}
                to={`/organizaciones/${org.id}`}
                title={org.name}
                imageUrl={org.pictureUrl}
                imageFit="contain"
                subtitle={[organizationTypeLabel(org.organizationType), org.country].filter(Boolean).join(" · ")}
                placeholder={initialOf(org.name)}
              />
            ))}
          </div>
          <Pagination scrollTargetRef={paginationStartRef} limit={limit} offset={offset} total={data.pagination.total} onOffsetChange={setOffset} />
        </>
      )}

      {creating ? (
        <EntityFormModal
          title="Nueva organización"
          fields={ORGANIZATION_FIELDS}
          initialValues={{ organizationType: "record_label" }}
          onSubmit={(values, note) => organizationWrites.create({ ...values, note })}
          onSuccess={() => { setCreating(false); reload(); facets.reload(); notify("success", "Organización creada."); }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
