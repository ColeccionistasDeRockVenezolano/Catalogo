import { CatalogModelPanel } from "../components/CatalogModelPanel";
import { EntityVerification } from "../components/EntityVerification";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RewritePendingMark } from "../components/RewritePendingMark";
import { BackLink } from "../components/BackLink";
import { DeceasedMark } from "../components/DeceasedMark";
import { ArrowsSplit, GitMerge, PencilSimple, Trash } from "@phosphor-icons/react";
import { personWrites, personsApi, reviewApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useMovedToRedirect } from "../lib/useMovedTo";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { DetailSkeleton } from "../components/Skeletons";
import { AliasEditor } from "../components/AliasEditor";
import { MembershipEditor } from "../components/MembershipEditor";
import { EntityFormModal } from "../components/EntityFormModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MergeEntityModal } from "../components/MergeEntityModal";
import { ConvertPersonModal } from "../components/ConvertPersonModal";
import { SplitPersonModal } from "../components/SplitPersonModal";
import { EntityPicker } from "../components/EntityPicker";
import { PersonPairWebResearch } from "../components/PersonPairWebResearch";
import { PersonOrgManager } from "../components/PersonOrgManager";
import { EntityProvenance } from "../components/EntityProvenance";
import { EntityHistory } from "../components/EntityHistory";
import { EntityLoadError } from "../components/RemovedEntityState";
import { entityHref } from "../lib/routes";
import { initialOf } from "../components/EntityCard";
import { entityFormValues, PERSON_FIELDS } from "../lib/entityFields";
import { EntityInfo, type InfoItem } from "../components/EntityInfo";
import { EntityTabs, TabEmpty, type TabSpec } from "../components/EntityTabs";
import { ExpandableText } from "../components/ExpandableText";
import { creditTypeLabel, membershipNoun, nameClassLabel } from "../lib/labels";
import { ageText, formatDate } from "../lib/format";

export function PersonDetailPage() {
  const { id } = useParams();
  const personId = Number(id);
  const navigate = useNavigate();
  const { isAdmin } = useOperator();
  const { notify } = useToast();
  const { data: person, loading, error, errorValue, reload } = useAsync(() => personsApi.get(personId), [personId]);
  const { data: identityResearch, reload: reloadIdentityResearch } = useAsync(
    () => isAdmin ? reviewApi.personResearchList(personId) : Promise.resolve([]), [personId, isAdmin]);
  useMovedToRedirect(errorValue);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeFromResearch, setMergeFromResearch] = useState(false);
  const [declaringDistinct, setDeclaringDistinct] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [converting, setConverting] = useState<"organization" | "artist" | null>(null);
  const [researchOpen, setResearchOpen] = useState(false);
  const [researchOther, setResearchOther] = useState<{ id: number; name: string } | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);

  useEffect(() => { setResearchOpen(false); setResearchOther(null); setResearchError(null); }, [personId]);

  if (loading && (!person || person.id !== personId)) return <DetailSkeleton />;
  if (error || !person) return <EntityLoadError message={error ?? "Persona no encontrada."} errorValue={errorValue} onRetry={reload} />;

  const dead = person.isDeceased === true;
  // Un solista no está «en una banda»: está al frente de su proyecto, y si la
  // persona ES el artista (caso Ashwave) las dos fichas son la misma identidad
  // repartida en dos tipos. El vínculo se nombra por lo que es.
  const vinculo = membershipNoun(person.bands);
  const info: InfoItem[] = [
    { label: "Nombre real", value: person.realName },
    { label: "Ciudad de nacimiento", value: person.birthCity },
    { label: "Género", value: person.gender ? ({ male: "Masculino", female: "Femenino", unknown: "Desconocido" } as Record<string, string>)[person.gender] ?? person.gender : null },
    { label: "Nacionalidad", value: person.nationality, fallback: "Sin dato" },
    { label: "Venezolano/a", value: person.isVenezuelan === true ? "Sí" : person.isVenezuelan === false ? "No (extranjero/a)" : null, fallback: "Sin dato" },
    { label: "Estado", value: dead ? "Fallecido/a" : null, fallback: "Sin dato" },
    { label: "Causa de fallecimiento", value: dead ? person.deathCause : null },
    { label: "Nacimiento", value: formatDate(person.birthDate) },
    { label: "Fallecimiento", value: dead ? formatDate(person.deathDate) : null },
    { label: dead ? "Edad al fallecer" : "Edad", value: dead && !person.deathDate ? null : ageText(person.birthDate, dead ? person.deathDate : null) },
    { label: person.bands.length === 1 ? vinculo.singular : vinculo.plural, value: person.bands.length ? (
      <>
        {[...new Map(person.bands.map((band) => [band.artistId, band])).values()].slice(0, 4).map((band, index) => (
          <span key={band.artistId}>{index > 0 ? ", " : ""}<Link to={`/artistas/${band.artistId}`}>{band.artistName}</Link></span>
        ))}
        {new Set(person.bands.map((band) => band.artistId)).size > 4 ? ` y ${new Set(person.bands.map((band) => band.artistId)).size - 4} más` : ""}
      </>
    ) : null },
  ];

  const bandPeriod = (band: { fromYear: number | null; toYear: number | null; isCurrent: boolean }) =>
    `${band.fromYear ?? "—"}${band.isCurrent ? "–presente" : band.toYear ? `–${band.toYear}` : ""}`;

  const tabs: TabSpec[] = [
    {
      key: "bandas", label: person.bands.length === 1 ? vinculo.singular : vinculo.plural, count: person.bands.length,
      content: person.bands.length === 0 ? <TabEmpty>Sin bandas ni proyectos registrados.</TabEmpty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{vinculo.singular}</th><th>Rol</th><th>Periodo</th></tr></thead>
            <tbody>
              {person.bands.map((band) => (
                <tr key={band.id}>
                  <td><Link to={`/artistas/${band.artistId}`}>{band.artistName}</Link></td>
                  <td>{band.role}</td>
                  <td className="mono">{bandPeriod(band)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      key: "discos", label: "Créditos de disco", count: person.albumCredits.length,
      content: person.albumCredits.length === 0 ? <TabEmpty>Sin créditos registrados.</TabEmpty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Disco</th><th>Artista</th><th>Tipo</th><th>Rol</th></tr></thead>
            <tbody>
              {person.albumCredits.map((credit) => (
                <tr key={credit.id}>
                  <td><Link to={`/discos/${credit.albumId}`}>{credit.albumTitle}</Link></td>
                  <td><Link to={`/artistas/${credit.artistId}`}>{credit.artistName}</Link></td>
                  <td><span className="badge">{creditTypeLabel(credit.creditType)}</span></td>
                  <td>{credit.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      key: "pistas", label: "Créditos de pista", count: person.trackCredits.length,
      content: person.trackCredits.length === 0 ? <TabEmpty>Sin créditos registrados.</TabEmpty> : (
        <div className="table-wrap table-wrap--scroll">
          <table>
            <thead><tr><th>Pista</th><th>Disco</th><th>Tipo</th><th>Rol</th></tr></thead>
            <tbody>
              {person.trackCredits.map((credit) => (
                <tr key={credit.id}>
                  <td>{credit.trackTitle}</td>
                  <td><Link to={`/discos/${credit.albumId}`}>{credit.albumTitle}</Link></td>
                  <td><span className="badge">{creditTypeLabel(credit.creditType)}</span></td>
                  <td>{credit.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      key: "organizaciones", label: "Organizaciones", count: person.organizations.length,
      content: isAdmin ? (
        <PersonOrgManager
          fixedKind="person"
          fixedId={person.id}
          rows={person.organizations.map((org) => ({
            id: org.id, role: org.role, fromYear: org.fromYear, toYear: org.toYear,
            otherId: org.organizationId, otherName: org.organizationName,
          }))}
          onChanged={reload}
          emptyText="Sin organizaciones registradas."
        />
      ) : person.organizations.length === 0 ? <TabEmpty>Sin vínculos con organizaciones.</TabEmpty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Organización</th><th>Rol</th><th>Periodo</th></tr></thead>
            <tbody>
              {person.organizations.map((org) => (
                <tr key={org.id}>
                  <td><Link to={`/organizaciones/${org.organizationId}`}>{org.organizationName}</Link></td>
                  <td>{org.role}</td>
                  <td className="mono">{org.fromYear ?? "—"}{org.toYear ? `–${org.toYear}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    ...(isAdmin ? [
      { key: "fuentes", label: "Origen de los datos", content: <EntityProvenance entity="person" id={person.id} revision={person} /> },
      { key: "historial", label: "Historial", content: <EntityHistory entity="person" id={person.id} /> },
    ] : []),
  ];
  // La pestaña inicial es la primera con datos: una persona sin bandas abre en sus créditos.
  const defaultKey = tabs.find((tab) => (tab.count ?? 0) > 0)?.key ?? "bandas";

  return (
    <>
      <BackLink fallback="/personas" />

      <div className="entity-hero">
        <span className="entity-hero__art">
          {person.pictureUrl ? <img src={person.pictureUrl} alt="" loading="lazy" decoding="async" /> : <span className="placeholder">{initialOf(person.name)}</span>}
        </span>
        <div>
          <h1 className="entity-hero__title">{person.name}<DeceasedMark deceased={person.isDeceased} /></h1>
          <EntityInfo items={info} wide={{ label: "Alias", content: <AliasEditor path="persons" entityId={person.id} aliases={person.aliases} onChanged={reload} /> }} />
          {person.biography ? <div className="entity-hero__bio"><ExpandableText className="entity-hero__desc" text={person.biography} /></div> : null}
          {person.trivia ? <div className="entity-hero__bio"><h2>Datos adicionales</h2><ExpandableText text={person.trivia} /></div> : null}
          <RewritePendingMark kind="person" id={person.id} onDone={reload} />
        </div>
      </div>

      {isAdmin ? (
        <div className="page-actions" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>
            <PencilSimple size={14} weight="bold" aria-hidden="true" />Editar
          </button>
          <button type="button" className="btn btn--sm" onClick={() => { setMergeFromResearch(false); setMerging(true); }}>
            <GitMerge size={14} weight="bold" aria-hidden="true" />Fusionar con…
          </button>
          <button type="button" className="btn btn--sm" onClick={() => setSplitting(true)}>
            <ArrowsSplit size={14} weight="bold" aria-hidden="true" />Dividir en varias…
          </button>
          <button type="button" className="btn btn--sm btn--outline" onClick={() => setResearchOpen((open) => !open)}>
            Investigar identidad con otra ficha{identityResearch?.length ? ` · ${identityResearch.length} guardadas` : ""}
          </button>
          <button type="button" className="btn btn--sm btn--danger" onClick={() => setDeleting(true)}>
            <Trash size={14} weight="bold" aria-hidden="true" />Retirar
          </button>
        </div>
      ) : null}

      {isAdmin && researchOpen ? <section className="section" aria-label="Investigar identidad de dos personas" style={{ marginTop: 16 }}>
        <h2>Comparar identidad de «{person.name}»</h2>
        <p>Busca la otra ficha y examina las fuentes antes de decidir si corresponde a la misma persona.</p>
        {identityResearch?.length ? <div className="person-research-history">
          <h3>Comparaciones guardadas</h3>
          <ul>{identityResearch.map((item) => <li key={item.otherId}>
            <button type="button" className="btn btn--sm btn--outline" onClick={() => setResearchOther({ id: item.otherId, name: item.otherName })}>
              Ver con {item.otherName}
            </button>{" "}
            <Link to={`/personas/${item.otherId}`}>Ficha #{item.otherId}</Link>{" · "}
            {item.declaredDistinct ? "Confirmadas como distintas" : item.verdict === "same" ? "Podrían ser la misma persona" : item.verdict === "different" ? "Podrían ser distintas" : item.verdict === "mixed" ? "Posible ficha mezclada" : "Sin conclusión"}
            {" · "}{new Date(item.createdAt).toLocaleDateString("es-VE")}
          </li>)}</ul>
        </div> : null}
        <EntityPicker kind="person" label="Otra ficha de persona" value={researchOther?.id ?? null}
          valueLabel={researchOther?.name ?? null} placeholder="Escribe el nombre de la otra persona…"
          onSelect={(otherId, otherName) => {
            if (otherId === person.id) { setResearchOther(null); setResearchError("Selecciona una ficha distinta de la actual."); return; }
            setResearchError(null); setResearchOther({ id: otherId, name: otherName });
          }} />
        {researchError ? <p role="alert">{researchError}</p> : null}
        {researchOther ? <p><Link to={`/personas/${researchOther.id}`}>Abrir ficha de «{researchOther.name}»</Link></p> : null}
        {researchOther ? <PersonPairWebResearch key={`${person.id}-${researchOther.id}`}
          aId={person.id} bId={researchOther.id} onResearch={reloadIdentityResearch}
          onConsiderMerge={() => { setMergeFromResearch(true); setMerging(true); }}
          onDeclareDistinct={() => setDeclaringDistinct(true)} /> : null}
      </section> : null}

      {person.nameClass !== "ok" ? (
        <div className="alert-block" role="alert" style={{ marginTop: 14 }}>
          <strong>Este nombre no parece de una persona: {nameClassLabel(person.nameClass).toLowerCase()}.</strong>
          <p style={{ margin: "6px 0 0" }}>{person.nameClassReason}</p>
          {isAdmin ? (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" className="btn btn--sm" onClick={() => setConverting("organization")}>Convertir en organización…</button>
              <button type="button" className="btn btn--sm" onClick={() => setConverting("artist")}>Convertir en artista…</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {isAdmin ? <EntityVerification kind="person" id={person.id} revision={person} onChanged={reload} /> : null}

      <EntityTabs tabs={tabs} defaultKey={defaultKey} />

      {isAdmin && editing ? (
        <EntityFormModal
          title={`Editar «${person.name}»`}
          fields={PERSON_FIELDS}
          wide
          panels={[
            { key: "model", label: "Identidad y períodos", content: <CatalogModelPanel kind="person" id={person.id} onChanged={reload} /> },
            { key: "bands", label: "Bandas y proyectos", content: <MembershipEditor fixedKind="person" fixedId={person.id} rows={person.bands.map((band) => ({ ...band, otherId: band.artistId, otherName: band.artistName }))} onChanged={reload} /> },
          ]}
          initialValues={{ ...entityFormValues(PERSON_FIELDS, person), isDeceased: person.isDeceasedFlag }}
          onSubmit={(values, note) => personWrites.update(person.id, { ...values, note })}
          onSuccess={() => { setEditing(false); reload(); notify("success", "Persona actualizada."); }}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Retirar «${person.name}»`}
          description="Se retira del catálogo. Si tiene créditos u otras dependencias, la API lo rechazará."
          confirmLabel="Retirar"
          danger
          onConfirm={async (note) => {
            await personWrites.remove(person.id, note);
            notify("success", "Persona retirada.");
            navigate("/personas");
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}

      {merging ? (
        <MergeEntityModal
          kind="person"
          entityId={person.id}
          entityName={person.name}
          {...(mergeFromResearch && researchOther ? { otherId: researchOther.id, otherName: researchOther.name } : {})}
          onMerged={(keepId) => { setMerging(false); navigate(`/personas/${keepId}`, { replace: true }); }}
          onClose={() => setMerging(false)}
        />
      ) : null}

      {declaringDistinct && researchOther ? <ConfirmDialog
        title="Confirmar que son personas distintas"
        description={`La investigación propone separar «${person.name}» de «${researchOther.name}». Confirma tu conclusión con un motivo; el par dejará de proponerse como duplicado.`}
        confirmLabel="Son personas distintas"
        onConfirm={async (note) => {
          await reviewApi.declarePersonsDistinct(person.id, researchOther.id, note);
          notify("success", "El par quedó registrado como personas distintas.");
          setDeclaringDistinct(false);
          reloadIdentityResearch();
        }} onClose={() => setDeclaringDistinct(false)} /> : null}

      {splitting ? (
        <SplitPersonModal
          personId={person.id}
          personName={person.name}
          onSplit={(result) => {
            setSplitting(false);
            if (result.targetIds.length) navigate(`/personas/${result.targetIds[0]}`, { replace: true });
          }}
          onClose={() => setSplitting(false)}
        />
      ) : null}

      {converting ? (
        <ConvertPersonModal
          person={{ id: person.id, name: person.name, nameClassReason: person.nameClassReason }}
          kind={converting}
          onConverted={(result) => {
            setConverting(null);
            navigate(entityHref(result.targetKind, result.targetId), { replace: true });
          }}
          onClose={() => setConverting(null)}
        />
      ) : null}
    </>
  );
}
