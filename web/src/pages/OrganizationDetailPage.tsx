import { EntityAdminBar } from "../components/EntityAdminBar";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RewritePendingMark } from "../components/RewritePendingMark";
import { BackLink } from "../components/BackLink";
import { organizationWrites, organizationsApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useMovedToRedirect } from "../lib/useMovedTo";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { DetailSkeleton } from "../components/Skeletons";
import { AliasEditor } from "../components/AliasEditor";
import { EntityFormModal } from "../components/EntityFormModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MergeEntityModal } from "../components/MergeEntityModal";
import { PersonOrgManager } from "../components/PersonOrgManager";
import { EntityProvenance } from "../components/EntityProvenance";
import { EntityHistory } from "../components/EntityHistory";
import { EntityVerification } from "../components/EntityVerification";
import { CompleteRecord } from "../components/CompleteRecord";
import { goToCompleteRecord } from "../lib/completeRecord";
import { EntityLoadError } from "../components/RemovedEntityState";
import { initialOf } from "../components/EntityCard";
import { entityFormValues, ORGANIZATION_FIELDS } from "../lib/entityFields";
import { EntityInfo, type InfoItem } from "../components/EntityInfo";
import { EntityTabs, TabEmpty, type TabSpec } from "../components/EntityTabs";
import { ExpandableText } from "../components/ExpandableText";
import { organizationTypeLabel } from "../lib/labels";
import { OrganizationArtistCards, OrganizationDiscographyCards, OrganizationLinkCards } from "../components/LinkedEntityCards";
import { Modal } from "../components/Modal";
import { OrganizationSuccession } from "../components/Discography";
import { mediaImage } from "../lib/media";
import { ArrowsOutSimple, Globe, MapPin } from "@phosphor-icons/react";
import { ImageViewer } from "../components/ImageViewer";

export function OrganizationDetailPage() {
  const { id } = useParams();
  const orgId = Number(id);
  const navigate = useNavigate();
  const { isAdmin } = useOperator();
  const { notify } = useToast();
  const { data: org, loading, error, errorValue, reload } = useAsync(() => organizationsApi.get(orgId), [orgId]);
  useMovedToRedirect(errorValue);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [editingPersons, setEditingPersons] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<number | null>(null);

  if (loading && (!org || org.id !== orgId)) return <DetailSkeleton />;
  if (error || !org) return <EntityLoadError message={error ?? "Organización no encontrada."} errorValue={errorValue} onRetry={reload} />;

  // Mismo bloque que la ficha de artista (Brian, 2026-11-15): lugar arriba,
  // con icono; identidad en filas debajo.
  const factsInfo: InfoItem[] = [
    { label: "Ubicación", value: org.places?.length ? <span className="artist-profile__fact"><MapPin size={16} aria-hidden="true" /><span>{org.places.map((place, index) => (
      <span key={place.id}>{index ? " · " : ""}<Link to={`/lugares/${place.id}`}>{place.name}</Link></span>
    ))}</span></span> : null },
    // Hay países guardados como «Caracas, Venezuela»: el público no ve la ubicación dos veces.
    { label: "País", value: org.country && (isAdmin || !org.places?.some((place) => place.name.toLowerCase().includes(org.country!.toLowerCase()))) ? <span className="artist-profile__fact"><Globe size={16} aria-hidden="true" />{org.country}</span> : null, fallback: "Sin dato" },
  ];
  const identityInfo: InfoItem[] = [
    { label: "Tipo", value: organizationTypeLabel(org.organizationType) },
    { label: "Sitio web", value: org.websiteUrl ? <a href={org.websiteUrl} target="_blank" rel="noreferrer noopener">{org.websiteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a> : null },
    { label: "Discos como sello", value: org.labelAlbums.length ? org.labelAlbums.length : null },
    { label: "Artistas acreditados", value: (org.artists ?? org.creditedArtists).length || null },
  ];

  const albums = org.albums ?? [];
  const artists = org.artists ?? [];
  const personLinks = org.personLinks ?? [];
  const tabs: TabSpec[] = [
    {
      // Sello, distribución, licencia y estudio en una sola discografía (estandarización 2026-11-14).
      key: "discografia", label: "Discografía asociada", count: albums.length,
      content: albums.length === 0 ? <TabEmpty>Sin discos asociados.</TabEmpty> : <OrganizationDiscographyCards albums={albums} />,
    },
    {
      key: "artistas", label: "Artistas acreditados", count: artists.length,
      content: artists.length === 0 ? <TabEmpty>Sin artistas acreditados.</TabEmpty> : <OrganizationArtistCards artists={artists} />,
    },
    {
      key: "personas", label: "Personas relacionadas", count: personLinks.length,
      content: <>
        {isAdmin ? <div className="page-actions" style={{ marginBottom: 14 }}>
          <button type="button" className="btn btn--sm" onClick={() => setEditingPersons(true)}>Editar vínculos</button>
        </div> : null}
        {personLinks.length === 0 ? <TabEmpty>Sin personas relacionadas.</TabEmpty> : (
          <OrganizationLinkCards links={personLinks} pageParam="personasPage" to={(link) => `/personas/${link.personId}`}
            title={(link) => link.displayName ?? link.name} deceased={(link) => link.isDeceased} />
        )}
      </>,
    },
    ...(isAdmin ? [
      { key: "investigacion", label: "Investigar y completar", content: <CompleteRecord kind="organization" id={org.id} name={org.name}><EntityVerification kind="organization" id={org.id} revision={org} onChanged={reload} /></CompleteRecord> },
      { key: "fuentes", label: "Origen de los datos", content: <EntityProvenance entity="organization" id={org.id} revision={org} /> },
      { key: "historial", label: "Historial", content: <EntityHistory entity="organization" id={org.id} /> },
    ] : []),
  ];
  const defaultKey = tabs.find((tab) => (tab.count ?? 0) > 0)?.key ?? "discografia";

  return (
    <>
      <BackLink fallback="/organizaciones" />

      {isAdmin ? <EntityAdminBar onEdit={() => setEditing(true)} onComplete={goToCompleteRecord} onMerge={() => setMerging(true)} onRemove={() => setDeleting(true)} /> : null}

      <section className="entity-hero artist-profile" aria-label={`Ficha de ${org.name}`}>
        <div className="artist-profile__media">
          {org.pictureUrl ? (
            <button type="button" className="entity-hero__art artist-profile__image-button" aria-label={`Ampliar imagen de ${org.name}`} onClick={() => setViewingPhoto(org.id)}>
              <img {...mediaImage(org.pictureUrl, 640)} alt="" loading="eager" decoding="async" />
              <span className="artist-profile__photo-hint" aria-hidden="true"><ArrowsOutSimple size={16} /><span>Ampliar imagen</span></span>
            </button>
          ) : <span className="entity-hero__art"><span className="placeholder">{initialOf(org.name)}</span></span>}
        </div>
        <div className="artist-profile__content">
          <h1 className="entity-hero__title">{org.name}</h1>
          <div className="artist-profile__facts"><EntityInfo items={factsInfo} showEmpty={isAdmin} /></div>
          <div className="artist-profile__identity"><EntityInfo items={identityInfo} showEmpty={isAdmin} /></div>
          {org.biography ? <div className="artist-profile__biography entity-hero__bio"><h2>Historia</h2><ExpandableText key={org.id} className="entity-hero__desc" text={org.biography} /></div> : null}
          {isAdmin || org.aliases.some((alias) => !alias.publicHidden) ? (
            <div className="artist-profile__aliases">
              <h2>Alias</h2>
              <AliasEditor path="organizations" entityId={org.id} aliases={org.aliases} onChanged={reload} compactTypeLabels />
            </div>
          ) : null}
        </div>
        <RewritePendingMark kind="organization" id={org.id} onDone={reload} />
      </section>

      {viewingPhoto === org.id && org.pictureUrl ? <ImageViewer key={org.id} src={org.pictureUrl}
        title={`Imagen de ${org.name}`} onClose={() => setViewingPhoto(null)} /> : null}

      {org.relations?.length ? (
        <div className="section">
          <h2>Sucesión</h2>
          <OrganizationSuccession relations={org.relations} />
        </div>
      ) : null}

      <EntityTabs tabs={tabs} defaultKey={defaultKey} />

      {isAdmin && editingPersons ? (
        <Modal title={`Personas de «${org.name}»`} wide onClose={() => { setEditingPersons(false); reload(); }}>
          <p className="hint" style={{ marginBottom: 12 }}>Aquí se editan los vínculos registrados. Los que salen «Por créditos» se deducen de los créditos y no se editan aquí.</p>
          <PersonOrgManager
            fixedKind="organization"
            fixedId={org.id}
            rows={org.associatedPersons.map((person) => ({
              id: person.id, role: person.role, fromYear: person.fromYear, toYear: person.toYear,
              otherId: person.personId, otherName: person.personName,
            }))}
            onChanged={reload}
            emptyText="Sin vínculos registrados."
          />
        </Modal>
      ) : null}

      {isAdmin && editing ? (
        <EntityFormModal
          title={`Editar «${org.name}»`}
          fields={ORGANIZATION_FIELDS}
          entity={{kind:"organization",id:org.id}}
          initialValues={entityFormValues(ORGANIZATION_FIELDS, org)}
          onSubmit={(values, note) => organizationWrites.update(org.id, { ...values, note })}
          onSuccess={() => { setEditing(false); reload(); notify("success", "Organización actualizada."); }}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Retirar «${org.name}»`}
          description="Se retira del catálogo. Si tiene discos u otras dependencias, la API lo rechazará."
          confirmLabel="Retirar"
          danger
          onConfirm={async (note) => {
            await organizationWrites.remove(org.id, note);
            notify("success", "Organización retirada.");
            navigate("/organizaciones");
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}

      {merging ? (
        <MergeEntityModal
          kind="organization"
          entityId={org.id}
          entityName={org.name}
          onMerged={(keepId) => { setMerging(false); navigate(`/organizaciones/${keepId}`, { replace: true }); }}
          onClose={() => setMerging(false)}
        />
      ) : null}
    </>
  );
}
