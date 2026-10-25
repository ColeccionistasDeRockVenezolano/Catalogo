import { ArtistGallery } from "../components/ArtistGallery";
import { ArtistDocuments } from "../components/ArtistDocuments";
import { EntityAdminBar } from "../components/EntityAdminBar";
import { GenrePeriods } from "../components/GenrePeriods";
import { CatalogResourceEditor } from "../components/CatalogResourceEditor";
import { ImageViewer } from "../components/ImageViewer";
import { CatalogModelPanel } from "../components/CatalogModelPanel";
import { EntityVerification } from "../components/EntityVerification";
import { useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RewritePendingMark } from "../components/RewritePendingMark";
import { BackLink } from "../components/BackLink";
import { ArrowsOutSimple, CalendarBlank, Clock, MapPin, PencilSimple, Trash } from "@phosphor-icons/react";
import { artistsApi, artistMemberWrites, artistWrites } from "../lib/api";
import { useDailyAsync } from "../lib/useDailyAsync";
import { useMovedToRedirect } from "../lib/useMovedTo";
import { useOperator } from "../lib/OperatorContext";
import { useDiscoveryVisitMetric } from "../lib/discoveryMetrics";
import { useToast } from "../lib/ToastContext";
import { DetailSkeleton } from "../components/Skeletons";
import { EntityCard, initialOf } from "../components/EntityCard";
import { ArtistDiscography } from "../components/ArtistDiscography";
import { ArtistAudiovisuals } from "../components/ArtistAudiovisuals";
import { groupMembers, MembersTimeline } from "../components/Discography";
import { DeceasedMark } from "../components/DeceasedMark";
import { AliasEditor } from "../components/AliasEditor";
import { ArtistLogoButton } from "../components/ArtistLogoButton";
import { MembershipEditor } from "../components/MembershipEditor";
import { CatalogGenres, CatalogPeriod, CatalogYear } from "../components/CatalogMetadata";
import { GenreEditor } from "../components/GenreEditor";
import { PlatformLinkEditor } from "../components/PlatformLinkEditor";
import { EntityFormModal } from "../components/EntityFormModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MergeEntityModal } from "../components/MergeEntityModal";
import { EntityProvenance } from "../components/EntityProvenance";
import { EntityHistory } from "../components/EntityHistory";
import { EntityLoadError } from "../components/RemovedEntityState";
import { EntityPicker } from "../components/EntityPicker";
import { Modal } from "../components/Modal";
import { entityFormValues, ARTIST_FIELDS } from "../lib/entityFields";
import { EntityInfo, type InfoItem } from "../components/EntityInfo";
import { EntityTabs, TabEmpty, type TabSpec } from "../components/EntityTabs";
import { ExpandableText } from "../components/ExpandableText";
import { PlatformLinks } from "../components/PlatformLinks";
import { resolveListenPlatform, useListenChoice } from "../components/ListenPlayer";
import { ArtistListenPanel } from "../components/ArtistListenPanel";
import { embedOptions } from "../lib/embeds";
import { artistTypeLabel, foreignCountry, memberRoleLabel } from "../lib/labels";
import { ageText, formatDate } from "../lib/format";
import { TITULAR_ROLE, type ArtistMember, type ArtistRelation, type RelatedArtist, type RelatedRule, type SimilarArtist, type SimilarRule } from "../lib/types";
import { mediaImage } from "../lib/media";

const LINK_PLATFORMS = [
  { key: "youtube", label: "YouTube" },
  { key: "instagram", label: "Instagram" },
  { key: "wordpress", label: "Blog (WordPress)" },
] as const;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** Qué es la otra banda respecto de esta: el linaje se lee en los dos sentidos. */
const RELATION_LABELS: Record<ArtistRelation["type"], Record<ArtistRelation["direction"], string>> = {
  successor: { later: "Proyecto sucesor", earlier: "Proyecto anterior" },
  ex_member_project: { later: "Proyecto de exintegrantes", earlier: "Banda de origen" },
  temporary_name: { later: "Nombre temporal", earlier: "Banda de origen" },
};

function relationLabel(relation: ArtistRelation): string {
  return RELATION_LABELS[relation.type][relation.direction];
}

/** Encabezado de cada regla de relacionados, en el orden en que llegan de la API. */
const RELATED_HEADINGS: Record<RelatedRule, string> = {
  lineage: "Linaje documentado",
  shared_members: "Integrantes en común",
  solo_project: "Proyecto solista de un integrante",
  shared_member: "Un integrante en común",
  collaboration: "Colaboraciones",
  guest_member: "Integrantes invitados",
  composer: "Composiciones cruzadas",
};

/** La API más antigua no manda la regla: solo había linaje e integrantes en común. */
function relatedRuleOf(item: RelatedArtist): RelatedRule {
  return item.rule ?? (item.relations?.length ? "lineage" : "shared_members");
}

function quoted(titles: Array<string | null>): string {
  return titles.filter(Boolean).map((title) => `«${title}»`).join(", ");
}

function relatedSubtitle(item: RelatedArtist): string {
  const relation = item.relations?.[0];
  const parts: string[] = [];
  if (relation) {
    const period = relation.startYear === null ? null
      : relation.endYear !== null && relation.endYear !== relation.startYear ? `${relation.startYear}–${relation.endYear}` : String(relation.startYear);
    parts.push([relation.bridgeMembers ? `Vínculo: ${relation.bridgeMembers}` : null, period].filter(Boolean).join(" · "));
  }
  if (item.sharedMembers > 0) parts.push(`${item.sharedMembers} en común: ${item.sharedMemberNames.join(", ")}`);
  const bridges = item.bridges ?? [];
  const rule = relatedRuleOf(item);
  if (rule === "collaboration" && bridges.length) parts.push(`En ${quoted(bridges.map((bridge) => bridge.album))}`);
  if ((rule === "guest_member" || rule === "composer") && bridges.length) {
    // Una persona puente con sus discos: «Persona en «A», «B»».
    const byPerson = new Map<string, Array<string | null>>();
    for (const bridge of bridges) byPerson.set(bridge.person ?? "", [...byPerson.get(bridge.person ?? "") ?? [], bridge.album]);
    const verb = rule === "composer" ? "compuso en" : "en";
    parts.push([...byPerson].map(([person, albums]) => `${person} ${verb} ${quoted(albums)}`).join(" · "));
  }
  return parts.filter(Boolean).join(" — ");
}

/** Agrupa una lista ya ordenada por regla, conservando el orden de llegada. */
function groupByRule<T, R extends string>(items: T[], ruleOf: (item: T) => R): Array<{ rule: R; items: T[] }> {
  const groups: Array<{ rule: R; items: T[] }> = [];
  for (const item of items) {
    const rule = ruleOf(item);
    const last = groups[groups.length - 1];
    if (last?.rule === rule) last.items.push(item);
    else groups.push({ rule, items: [item] });
  }
  return groups;
}

function similarHeading(rule: SimilarRule, genre: string | null, decade: number | null, city: string | null): string {
  const era = decade === null ? null : `años ${decade}`;
  switch (rule) {
    case "same_style": return ["Mismo estilo", genre, era].filter(Boolean).join(" · ");
    case "same_genre_decade": return [genre, era].filter(Boolean).join(" · ");
    case "same_compilation": return "En las mismas recopilaciones";
    case "same_producer": return "Mismo productor";
    case "same_scene": return ["Escena", city, era].filter(Boolean).join(" · ");
    case "near_decade": return [genre, "décadas vecinas"].filter(Boolean).join(" · ");
    case "same_label": return "Mismo sello";
    case "same_genre": return [genre, decade === null ? null : "otras épocas"].filter(Boolean).join(" · ");
  }
}

function similarSubtitle(item: SimilarArtist): string {
  const evidence = item.evidence ?? [];
  if (item.rule === "same_compilation" && evidence.length) return `En ${quoted(evidence)}`;
  if (item.rule === "same_producer" && evidence.length) return `Producción: ${evidence.join(", ")}`;
  if (item.rule === "same_label" && evidence.length) return `Sello: ${evidence.join(", ")}`;
  return foreignCountry(item.originCountry) ?? "";
}

export function ArtistDetailPage() {
  const { id } = useParams();
  const artistId = Number(id);
  const navigate = useNavigate();
  const { isAdmin, isChecking } = useOperator();
  const { notify } = useToast();
  const { data: artist, loading, error, errorValue, reload } = useDailyAsync((date, signal) => artistsApi.get(artistId, date, signal), [artistId]);
  useMovedToRedirect(errorValue);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [editingMember, setEditingMember] = useState<ArtistMember | null>(null);
  const [merging, setMerging] = useState(false);
  const [viewingImage, setViewingImage] = useState<"photo" | "logo" | null>(null);
  const [chosenPlatform, choosePlatform] = useListenChoice(artistId);
  useDiscoveryVisitMetric(artistId, Boolean(artist) && !loading && !error, !isAdmin && !isChecking);

  if (loading && (!artist || artist.id !== artistId)) return <DetailSkeleton />;
  if (error || !artist) return <EntityLoadError message={error ?? "Artista no encontrado."} errorValue={errorValue} onRetry={reload} />;
  // Lo más escuchado del artista en cada plataforma con reproductor (perfiles verificados).
  const channelLinks = artist.channelVideo ? [{ platform: "crv_youtube", url: artist.channelVideo.url }] : [];
  const playbackAlbums = artist.playbackAlbums ?? [];
  const listenLinks = [...(artist.platforms ?? []), ...channelLinks];
  for (const link of playbackAlbums) if (!listenLinks.some(existing => existing.platform === link.platform)) listenLinks.push(link);
  const listenOptions = embedOptions([{ label: null, links: artist.platforms ?? [] },
    { label: artist.channelVideo?.title ?? null, links: channelLinks },
    ...playbackAlbums.map(link => ({label:link.albumTitle,links:[link],owner:"album" as const}))], "artist");
  const listenActive = resolveListenPlatform(listenOptions.map((option) => option.platform), chosenPlatform, listenOptions[0]?.platform);
  const listenOption = listenOptions.find((option) => option.platform === listenActive) ?? null;

  const hasCurrentMember = artist.members.some((member) => member.isCurrent);
  // Una persona aparece una vez aunque tenga varias etapas en la banda
  // (Darrell Laclé en Cultura Tres: 2008–2009 y 2017–2020): sus filas van
  // juntas bajo su nombre (caso Abaddon, 2026-10-04).
  const memberGroups = groupMembersByPerson(artist.members);
  // Un artista puede ser el proyecto o el nombre artístico de una persona
  // (caso Ashwave, 2026-09-30). Entonces la ficha del proyecto es la de alguien
  // y no tiene por qué mandar a otra página a ver quién: su nombre y sus fechas
  // se muestran aquí, con el enlace a la ficha donde están sus créditos
  // (Brian, 2026-10-01, caso Canserbero: «todo en uno, sin perder nada»).
  const titular = artist.members.find((member) => member.role === TITULAR_ROLE) ?? null;
  const titularDead = titular?.personIsDeceased === true;
  const knownStatus = artist.status === "unknown" ? null : artist.status;
  const status = knownStatus ? ({ active: "Activo", split_up: "Disuelto", on_hold: "En pausa", changed_name: "Cambió de nombre" } as Record<string, string>)[knownStatus] ?? knownStatus : artist.disbandedYear ? "Disuelto" : hasCurrentMember ? "Activo" : null;
  const activeYears = artist.yearsActive ?? (artist.formedYear
    ? `${artist.formedYear}–${artist.disbandedYear ?? (status === "Activo" ? "presente" : "?")}`
    : null);
  const currentLocation = [artist.currentCity, artist.currentCountry].filter(Boolean).join(", ") || null;
  const originInfo: InfoItem[] = [
    { label: "Origen", value: artist.originCity ? <span className="artist-profile__fact"><MapPin size={16} aria-hidden="true" />{artist.originCity}</span> : null },
    { label: "Ubicación actual", value: currentLocation ? <span className="artist-profile__fact"><MapPin size={16} aria-hidden="true" />{currentLocation}</span> : null },
    { label: "Formado en", value: artist.formedYear === null ? null : <span className="artist-profile__fact"><CalendarBlank size={16} aria-hidden="true" /><CatalogYear year={artist.formedYear} kind="artist" /></span>, fallback: "Sin dato" },
    { label: "Años activos", value: activeYears ? <span className="artist-profile__fact"><Clock size={16} aria-hidden="true" /><span><CatalogPeriod text={activeYears} /></span></span> : null },
  ];
  const identityInfo: InfoItem[] = [
    { label: "País de origen", value: isAdmin ? artist.originCountry : foreignCountry(artist.originCountry) },
    { label: "Contacto", value: artist.email ? <a href={`mailto:${artist.email}`}>{artist.email}</a> : null },
    { label: "Estado", value: status, fallback: "Desconocido" },
    { label: "Nombre real", value: titular ? <Link to={`/personas/${titular.personId}`}>{titular.personRealName ?? titular.personDisplayName ?? titular.personName}</Link> : null },
    // En un proyecto solista «formado en» es la carrera, y el nacimiento y el
    // fallecimiento son los de su titular: solo salen si hay quien los tenga.
    ...(titular ? [
      { label: "Nacimiento", value: formatDate(titular.personBirthDate ?? null) },
      { label: "Lugar de nacimiento", value: titular.personBirthCity ?? null },
      { label: "Fallecimiento", value: titularDead ? formatDate(titular.personDeathDate ?? null) : null },
      { label: titularDead ? "Edad al fallecer" : "Edad",
        value: ageText(titular.personBirthDate ?? null, titularDead ? titular.personDeathDate ?? null : null) },
    ] satisfies InfoItem[] : []),
    { label: "Temas de las letras", value: artist.themes },
    { label: "Tipo", value: <Link to={`/artistas?tipo=${artist.artistGroup ?? artist.artistType}`}>{artistTypeLabel(artist.artistGroup ?? artist.artistType)}</Link> },
  ];
  // La API más antigua no manda estos campos: la ficha sigue abriendo sin ellos.
  const related = artist.related ?? [];
  const similar = artist.similar ?? [];
  const links = artist.links ?? [];
  const similarDecade = artist.similarDecade ?? null;
  const relatedGroups = groupByRule(related, relatedRuleOf);
  const similarGroups = groupByRule(similar, (item) => item.rule ?? "same_genre_decade");
  const linksByPlatform = LINK_PLATFORMS
    .map((platform) => ({ ...platform, items: links.filter((link) => link.platform === platform.key) }))
    .filter((group) => group.items.length > 0);

  const tabs: TabSpec[] = [
    {
      key: "discografia", label: "Discografía", count: artist.discography.length,
      content: artist.discography.length === 0 ? <TabEmpty>Sin discos registrados.</TabEmpty> : (
        <ArtistDiscography albums={artist.discography} artistName={artist.name} artistId={artist.id} />
      ),
    },
    {
      key: "audiovisuales", label: "Audiovisuales", count: artist.audiovisuals?.length ?? 0,
      content: <ArtistAudiovisuals key={artist.id} items={artist.audiovisuals ?? []} artistId={artist.id} artistName={artist.name} />,
    },
    {
      key: "galeria", label: "Galería", count: artist.gallery?.length ?? 0,
      content: <ArtistGallery key={artist.id} artistId={artist.id} artistName={artist.name} items={artist.gallery ?? []} onChanged={reload} />,
    },
    {
      key: "otros", label: "Otros", count: artist.documents?.length ?? 0,
      content: <ArtistDocuments key={artist.id} artistId={artist.id} items={artist.documents ?? []} onChanged={reload} />,
    },
    {
      key: "miembros", label: "Integrantes", count: memberGroups.length,
      content: (
        <>
          {isAdmin ? (
            <div className="page-actions" style={{ marginBottom: 14 }}>
              <button type="button" className="btn btn--sm" onClick={() => setAddingMember(true)}>+ Añadir integrante</button>
            </div>
          ) : null}
          {artist.members.length === 0 ? <TabEmpty>Sin integrantes registrados.</TabEmpty> : (
            <>
              {/* Línea de tiempo también con periodos parciales (Brian, 2026-10-13). */}
              <MembersTimeline members={artist.members} albums={artist.discography} formedYear={artist.formedYear ?? null}
                endYear={!hasCurrentMember && artist.disbandedYear ? artist.disbandedYear : new Date().getFullYear()} />
              <div className="member-groups">
                {groupMembers(artist.members).map((section) => (
                  <section key={section.key}>
                    <h3 className="similar-reason">{section.title}</h3>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Persona</th><th>Rol</th><th>Periodo</th><th></th></tr></thead>
                        <tbody>
                          {groupMembersByPerson(section.members).flatMap((group) => group.map((member, index) => (
                            <MemberRow key={member.id} member={member} personSpan={index === 0 ? group.length : 0}
                              canEdit={isAdmin} onEdit={() => setEditingMember(member)} onChanged={reload} />
                          )))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </>
      ),
    },
    {
      key: "relacionados", label: "Artistas relacionados", count: related.length,
      content: related.length === 0 ? <TabEmpty>Sin linajes, integrantes, colaboraciones ni invitados en común con otros artistas.</TabEmpty> : (
        <>
          {relatedGroups.map((group) => (
            <section key={group.rule}>
              <h3 className="similar-reason">{RELATED_HEADINGS[group.rule]}</h3>
              <div className="grid-cards">
                {group.items.map((item) => {
                  const relation = item.relations?.[0];
                  return (
                    <EntityCard key={item.id} to={`/artistas/${item.id}`} title={item.name} imageUrl={item.pictureUrl} placeholder={initialOf(item.name)}
                      subtitle={relatedSubtitle(item)}
                      tag={relation ? relationLabel(relation) : null}
                      tagTitle={relation?.note ?? undefined} />
                  );
                })}
              </div>
            </section>
          ))}
        </>
      ),
    },
    {
      key: "similares", label: "Artistas similares", count: similar.length,
      content: similar.length === 0 ? <TabEmpty>Aún no hay artistas del mismo género, época o escena.</TabEmpty> : (
        <>
          {similarGroups.map((group) => {
            const heading = similarHeading(group.rule, artist.primaryGenre?.name ?? null, similarDecade, artist.originCity);
            return (
              <section key={group.rule}>
                {heading ? <h3 className="similar-reason">{heading}</h3> : null}
                <div className="grid-cards">
                  {group.items.map((item) => (
                    <EntityCard key={item.id} to={`/artistas/${item.id}`} title={item.name} imageUrl={item.pictureUrl} placeholder={initialOf(item.name)}
                      subtitle={similarSubtitle(item)} year={item.startYear} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      ),
    },
    {
      key: "enlaces", label: "Enlaces", count: links.length,
      content: linksByPlatform.length === 0 ? <TabEmpty>Sin enlaces registrados.</TabEmpty> : (
        <div className="link-groups">
          {linksByPlatform.map((group) => (
            <section key={group.key}>
              <h3 className="link-group__title">{group.label}</h3>
              <ul className="link-list">
                {group.items.map((link) => (
                  <li key={`${link.albumId}-${link.platform}`}>
                    <a href={link.url} target="_blank" rel="noreferrer noopener">
                      <span>{link.albumTitle}</span>
                      <span className="link-list__host">{hostOf(link.url)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ),
    },
    ...(isAdmin ? [
      { key: "generos-periodos", label: "Géneros por período", content: <GenrePeriods kind="artist" id={artist.id}/> },
      { key: "fuentes", label: "Origen de los datos", content: <EntityProvenance entity="artist" id={artist.id} revision={artist} /> },
      { key: "historial", label: "Historial", content: <EntityHistory entity="artist" id={artist.id} /> },
    ] : []),
  ];

  return (
    <>
      <BackLink fallback="/artistas" />

      {isAdmin ? <EntityAdminBar onEdit={() => setEditing(true)} onMerge={() => setMerging(true)} onRemove={() => setDeleting(true)} /> : null}

      <section className={`entity-hero artist-profile${listenLinks.length ? " artist-profile--with-listen" : ""}`} aria-label={`Ficha de ${artist.name}`}>
        <div className="artist-profile__media">
          {artist.pictureUrl ? (
            <button type="button" className="entity-hero__art artist-profile__image-button" aria-label={`Ampliar foto de ${artist.name}`} onClick={() => setViewingImage("photo")}>
              <img {...mediaImage(artist.pictureUrl, 640)} alt="" loading="eager" decoding="async" />
              <span className="artist-profile__photo-hint" aria-hidden="true"><ArrowsOutSimple size={16} /><span>Ampliar foto</span></span>
            </button>
          ) : <span className="entity-hero__art"><span className="placeholder">{initialOf(artist.name)}</span></span>}
          {artist.logoUrl ? (
            <ArtistLogoButton key={artist.logoUrl} src={artist.logoUrl} artistId={artist.id} name={artist.name} onOpen={() => setViewingImage("logo")} />
          ) : null}
        </div>
        <div className="artist-profile__content">
          <h1 className="entity-hero__title">{artist.name}<DeceasedMark deceased={artist.isDeceased} /></h1>
          <div className="artist-profile__facts"><EntityInfo items={originInfo} showEmpty={isAdmin} /></div>
          {artist.genres?.length || isAdmin ? (
            <div className="artist-profile__genres">
              <h2>Género</h2>
              {artist.genres?.length ? <div className="entity-info__tags"><CatalogGenres genres={artist.genres} kind="artist" className="badge" /></div> : <p className="muted-note">Sin clasificar</p>}
            </div>
          ) : null}
          <div className="artist-profile__identity"><EntityInfo items={identityInfo} showEmpty={isAdmin} /></div>
          {artist.biography ? <div className="artist-profile__biography entity-hero__bio"><h2>Biografía</h2><ExpandableText key={artist.id} className="entity-hero__desc" text={artist.biography} /></div> : null}
          {isAdmin || artist.aliases.some((alias) => !alias.publicHidden) ? (
            <div className="artist-profile__aliases">
              <h2>Alias</h2>
              <AliasEditor path="artists" entityId={artist.id} aliases={artist.aliases} onChanged={reload} compactTypeLabels />
            </div>
          ) : null}
          {artist.socials?.length || artist.platforms?.length ? (
            <div className="artist-profile__connections">
              {artist.socials?.length ? <div className="platform-block"><h2>{(artist.artistGroup ?? artist.artistType) === "solo_artist" ? "Síguelo en" : "Síguelos en"}</h2><PlatformLinks links={artist.socials} subject={artist.name} /></div> : null}
              {artist.platforms?.length ? <div className="platform-block"><h2>Escucha en</h2><PlatformLinks links={artist.platforms} subject={artist.name} /></div> : null}
            </div>
          ) : null}
        </div>
        {listenLinks.length ? <ArtistListenPanel subject={artist.name} links={listenLinks} options={listenOptions}
          selected={listenOption} onChange={choosePlatform} /> : null}
        <RewritePendingMark kind="artist" id={artist.id} onDone={reload} />
      </section>

      {viewingImage ? <ImageViewer
        key={`${artist.id}:${viewingImage}`}
        src={viewingImage === "photo" ? artist.pictureUrl! : artist.logoUrl!}
        title={`${viewingImage === "photo" ? "Foto" : "Logo"} de ${artist.name}`}
        onClose={() => setViewingImage(null)} /> : null}

      {isAdmin ? <EntityVerification kind="artist" id={artist.id} revision={artist} /> : null}

      <EntityTabs tabs={tabs} defaultKey="discografia" />

      {isAdmin && editing ? (
        <EntityFormModal
          title={`Editar «${artist.name}»`}
          fields={ARTIST_FIELDS}
          wide
          panels={[
            { key: "gallery-editor", label: "Galería", content: <ArtistGallery key={artist.id} artistId={artist.id} artistName={artist.name} items={artist.gallery ?? []} onChanged={reload} /> },
            { key: "audiovisual-editor", label: "Audiovisuales", content: <CatalogResourceEditor owner="artist" id={artist.id} resource="audiovisual" onChanged={reload}/> },
            { key: "model", label: "Vínculos y períodos", content: <CatalogModelPanel kind="artist" id={artist.id} onChanged={reload} /> },
            { key: "genres", label: "Géneros", content: <GenreEditor kind="artist" id={artist.id} genres={artist.genres ?? []} primaryGenre={artist.primaryGenre ?? null} onChanged={reload} /> },
            { key: "members", label: "Titular e integrantes", content: <MembershipEditor fixedKind="artist" fixedId={artist.id} rows={artist.members.map((member) => ({ ...member, otherId: member.personId, otherName: member.personName }))} onChanged={reload} /> },
            { key: "socials", label: "Redes sociales", content: <PlatformLinkEditor kind="artist" id={artist.id} category="social" onChanged={reload} /> },
            { key: "streaming", label: "Escuchar en", content: <PlatformLinkEditor kind="artist" id={artist.id} category="streaming" onChanged={reload} /> },
          ]}
          entity={{kind:"artist",id:artist.id}}
          initialValues={entityFormValues(ARTIST_FIELDS, artist)}
          onSubmit={(values, note) => artistWrites.update(artist.id, { ...values, note })}
          onSuccess={() => { setEditing(false); reload(); notify("success", "Artista actualizado."); }}
          onClose={() => setEditing(false)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Retirar «${artist.name}»`}
          description="Se retira del catálogo. Si tiene discos u otras dependencias, la API lo rechazará."
          confirmLabel="Retirar"
          danger
          onConfirm={async (note) => {
            await artistWrites.remove(artist.id, note);
            notify("success", "Artista retirado.");
            navigate("/artistas");
          }}
          onClose={() => setDeleting(false)}
        />
      ) : null}

      {addingMember ? (
        <MemberFormModal artistId={artist.id} onClose={() => setAddingMember(false)} onDone={() => { setAddingMember(false); reload(); }} />
      ) : null}

      {editingMember ? (
        <MemberFormModal artistId={artist.id} member={editingMember} onClose={() => setEditingMember(null)}
          onDone={() => { setEditingMember(null); reload(); }} />
      ) : null}

      {merging ? (
        <MergeEntityModal
          kind="artist"
          entityId={artist.id}
          entityName={artist.name}
          onMerged={(keepId) => { setMerging(false); navigate(`/artistas/${keepId}`, { replace: true }); }}
          onClose={() => setMerging(false)}
        />
      ) : null}
    </>
  );
}

/** Membresías agrupadas por persona, en el orden en que aparece cada una. */
function groupMembersByPerson(members: ArtistMember[]): ArtistMember[][] {
  const groups = new Map<number, ArtistMember[]>();
  for (const member of members) groups.set(member.personId, [...(groups.get(member.personId) ?? []), member]);
  return [...groups.values()];
}

/** `personSpan` > 0: primera fila de la persona (ocupa sus etapas); 0: etapa siguiente. */
function MemberRow({ member, personSpan, canEdit, onEdit, onChanged }: {
  canEdit: boolean; onEdit: () => void; onChanged: () => void; member: ArtistMember; personSpan: number;
}) {
  const { notify } = useToast();
  const [removing, setRemoving] = useState(false);

  return (
    <tr>
      {personSpan > 0 ? (
        <td rowSpan={personSpan}>
          <Link to={`/personas/${member.personId}`}>{member.personDisplayName ?? member.personName}</Link><DeceasedMark deceased={member.personIsDeceased} />
          {member.isFounder ? <span className="badge member-founder" title={member.founderEvidence ?? undefined}>Fundador/a</span> : null}
        </td>
      ) : null}
      <td>{memberRoleLabel(member.role)}</td>
      <td className="mono">{member.fromYear ?? "—"}{member.isCurrent ? "–presente" : member.toYear ? `–${member.toYear}` : ""}</td>
      <td className="row-actions">
        {canEdit ? (
          <>
            <button type="button" className="btn btn--sm" onClick={onEdit} title="Corregir rol, periodo o persona">
              <PencilSimple size={14} weight="bold" aria-hidden="true" />Editar
            </button>
            <button type="button" className="btn btn--sm btn--danger" onClick={() => setRemoving(true)}>
              <Trash size={14} weight="bold" aria-hidden="true" />Quitar
            </button>
          </>
        ) : null}
      </td>
      {removing ? (
        <ConfirmDialog
          title={`Quitar a ${member.personName}`}
          description="Se retira la membresía; no borra a la persona ni sus créditos."
          confirmLabel="Quitar"
          danger
          onConfirm={async (note) => {
            await artistMemberWrites.remove(member.id, note);
            notify("success", "Integrante retirado.");
            setRemoving(false);
            onChanged();
          }}
          onClose={() => setRemoving(false)}
        />
      ) : null}
    </tr>
  );
}

/**
 * Alta y edición de una membresía. En edición solo viaja lo que cambió; la
 * persona se corrige con su extremo (la API la sustituye con auditoría).
 */
function MemberFormModal({ artistId, member, onDone, onClose }: {
  artistId: number; member?: ArtistMember; onDone: () => void; onClose: () => void;
}) {
  const editing = member !== undefined;
  const [personId, setPersonId] = useState<number | null>(member?.personId ?? null);
  const [personLabel, setPersonLabel] = useState<string | null>(member?.personName ?? null);
  const [role, setRole] = useState(member?.role ?? "");
  const [fromYear, setFromYear] = useState(member?.fromYear === null || member?.fromYear === undefined ? "" : String(member.fromYear));
  const [toYear, setToYear] = useState(member?.toYear === null || member?.toYear === undefined ? "" : String(member.toYear));
  const [isCurrent, setIsCurrent] = useState(member?.isCurrent ?? false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const currentId = useId();
  const roleId = useId();
  const fromId = useId();
  const toId = useId();
  const noteId = useId();
  const { notify } = useToast();

  function parseYear(value: string): number | null {
    const text = value.trim();
    if (!text) return null;
    return Number(text);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (personId === null || !role.trim()) { setError("Persona y rol son obligatorios."); return; }
    const nextFrom = parseYear(fromYear);
    const nextTo = isCurrent ? null : parseYear(toYear);
    if ((nextFrom !== null && (!Number.isInteger(nextFrom) || nextFrom < 1000 || nextFrom > 9999))
      || (nextTo !== null && (!Number.isInteger(nextTo) || nextTo < 1000 || nextTo > 9999))) {
      setError("Los años van de 1000 a 9999."); return;
    }
    if (nextFrom !== null && nextTo !== null && nextTo < nextFrom) { setError("El año final no puede ser anterior al inicial."); return; }
    if (!note.trim()) { setError("El motivo es obligatorio."); return; }
    setBusy(true);
    setError(undefined);
    try {
      if (!member) {
        await artistMemberWrites.create({
          artistId, personId, role: role.trim(), isCurrent,
          ...(nextFrom === null ? {} : { fromYear: nextFrom }),
          ...(nextTo === null ? {} : { toYear: nextTo }),
          note: note.trim(),
        });
        notify("success", "Integrante añadido.");
      } else {
        const changes: Record<string, unknown> = {};
        if (personId !== member.personId) changes["personId"] = personId;
        if (role.trim() !== member.role) changes["role"] = role.trim();
        if (nextFrom !== member.fromYear) changes["fromYear"] = nextFrom;
        if (nextTo !== member.toYear) changes["toYear"] = nextTo;
        if (isCurrent !== member.isCurrent) changes["isCurrent"] = isCurrent;
        if (Object.keys(changes).length === 0) { setError("No hay cambios que guardar."); setBusy(false); return; }
        await artistMemberWrites.update(member.id, { ...changes, note: note.trim() });
        notify("success", "Integrante actualizado.");
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Corregir membresía de ${member.personName}` : "Añadir integrante"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <p className="form-error-banner" role="alert">{error}</p> : null}
        <EntityPicker kind="person" label="Persona *" value={personId} valueLabel={personLabel}
          onSelect={(id, label) => { setPersonId(id); setPersonLabel(label); }} />
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor={roleId}>Rol *</label><input id={roleId} value={role} onChange={(event) => setRole(event.target.value)} placeholder="Guitarra, voz…" /></div>
          <div className="field"><label htmlFor={fromId}>Desde (año)</label><input id={fromId} type="number" value={fromYear} onChange={(event) => setFromYear(event.target.value)} /></div>
          <div className="field"><label htmlFor={toId}>Hasta (año)</label><input id={toId} type="number" value={isCurrent ? "" : toYear} disabled={isCurrent} onChange={(event) => setToYear(event.target.value)} /></div>
          <div className="checkbox-field field">
            <input id={currentId} type="checkbox" checked={isCurrent} onChange={(event) => setIsCurrent(event.target.checked)} />
            <label htmlFor={currentId}>Integrante actual</label>
          </div>
          <div className="field span-2">
            <label htmlFor={noteId}>Motivo *</label>
            <textarea id={noteId} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Guardando…" : editing ? "Guardar corrección" : "Añadir"}</button>
        </div>
      </form>
    </Modal>
  );
}
