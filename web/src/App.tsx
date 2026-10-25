import { ImageCurationProgress } from "./components/ImageCurationProgress";
import { SiteAppearanceProvider } from "./lib/SiteAppearanceContext";
import { startImageQueue } from "./lib/imageCurationQueue";
import { useOperator } from "./lib/OperatorContext";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { VideoProvider } from "./components/VideoPlayer";
import { Layout } from "./components/Layout";
import { RouteFallback } from "./components/Skeletons";
import { PageBoundary } from "./components/PageBoundary";
import { NotFoundPage } from "./pages/NotFoundPage";
import { EphemeridesPage, RadioPage } from "./pages/UpcomingPages";
import { COMMUNITY_PAGES, COMMUNITY_REDIRECTS } from "./lib/communityPages";

// Cada página viaja en su propio chunk (React.lazy): la carga inicial solo trae
// el marco y la página abierta; al navegar, el chunk llega bajo un skeleton de
// fallback (RouteFallback). NotFoundPage queda eager: es diminuta y responde
// cualquier URL desconocida.
const SearchAdministrationPage = lazy(() => import("./pages/SearchAdministrationPage").then(module => ({ default: module.SearchAdministrationPage })));
const CommunityPage = lazy(() => import("./pages/CommunityPage").then(module => ({ default: module.CommunityPage })));
const ConfigurationPage = lazy(() => import("./pages/ConfigurationPage").then((module) => ({ default: module.ConfigurationPage })));
const SearchPage = lazy(() => import("./pages/SearchPage").then((module) => ({ default: module.SearchPage })));
const ArtistsListPage = lazy(() => import("./pages/ArtistsListPage").then((module) => ({ default: module.ArtistsListPage })));
const ArtistDetailPage = lazy(() => import("./pages/ArtistDetailPage").then((module) => ({ default: module.ArtistDetailPage })));
const AlbumsListPage = lazy(() => import("./pages/AlbumsListPage").then((module) => ({ default: module.AlbumsListPage })));
const AlbumDetailPage = lazy(() => import("./pages/AlbumDetailPage").then((module) => ({ default: module.AlbumDetailPage })));
const PersonsListPage = lazy(() => import("./pages/PersonsListPage").then((module) => ({ default: module.PersonsListPage })));
const PersonDetailPage = lazy(() => import("./pages/PersonDetailPage").then((module) => ({ default: module.PersonDetailPage })));
const PersonDuplicatesPage = lazy(() => import("./pages/PersonDuplicatesPage").then((module) => ({ default: module.PersonDuplicatesPage })));
const OrganizationsListPage = lazy(() => import("./pages/OrganizationsListPage").then((module) => ({ default: module.OrganizationsListPage })));
const OrganizationDetailPage = lazy(() => import("./pages/OrganizationDetailPage").then((module) => ({ default: module.OrganizationDetailPage })));
const PlacePage = lazy(() => import("./pages/PlacePage").then((module) => ({ default: module.PlacePage })));
const SeriesPage = lazy(() => import("./pages/SeriesPage").then((module) => ({ default: module.SeriesPage })));
const ClaimReviewPage = lazy(() => import("./pages/ClaimReviewPage").then(module => ({ default: module.ClaimReviewPage })));
const ReviewQueueDetailPage = lazy(() => import("./pages/ReviewQueueDetailPage").then((module) => ({ default: module.ReviewQueueDetailPage })));
const CurationLayout = lazy(() => import("./pages/CurationLayout").then((module) => ({ default: module.CurationLayout })));
const CurationOverviewPage = lazy(() => import("./pages/CurationOverviewPage").then((module) => ({ default: module.CurationOverviewPage })));
const CurationFindingsPage = lazy(() => import("./pages/CurationFindingsPage").then((module) => ({ default: module.CurationFindingsPage })));
const CurationFixesPage = lazy(() => import("./pages/CurationFixesPage").then((module) => ({ default: module.CurationFixesPage })));
const ChangesHistoryPage = lazy(() => import("./pages/ChangesHistoryPage").then((module) => ({ default: module.ChangesHistoryPage })));
const CurationImagesPage = lazy(() => import("./pages/CurationImagesPage").then((module) => ({ default: module.CurationImagesPage })));
const CurationAutofixPage = lazy(() => import("./pages/CurationAutofixPage").then((module) => ({ default: module.CurationAutofixPage })));
const AiCurationPage = lazy(() => import("./pages/AiCurationPage").then((module) => ({ default: module.AiCurationPage })));

/** Enlaces viejos (/revision/:id) siguen llevando a la revisión. */
function LegacyReviewRedirect() {
  const { id } = useParams();
  return <Navigate to={`/curaduria/revision/${id ?? ""}`} replace />;
}

function CommunityRedirect({ redirect }: { redirect: typeof COMMUNITY_REDIRECTS[number] }) {
  const { hash, search } = useLocation();
  let anchor: string = redirect.anchor;
  try {
    const oldAnchor = decodeURIComponent(hash.slice(1));
    anchor = (redirect.anchors as Readonly<Record<string, string>>)[oldAnchor] ?? redirect.anchor;
  } catch { /* Un ancla mal codificada abre la sección principal. */ }
  return <Navigate to={`${redirect.to}${search}#${anchor}`} replace />;
}

export function App() {
  const { isAdmin } = useOperator();
  useEffect(() => { if (isAdmin) return startImageQueue(); }, [isAdmin]);
  return (
    <SiteAppearanceProvider><VideoProvider><Layout>
      {/* El marco (topbar + nav) no se suspende: solo la página en curso. */}
      <ImageCurationProgress compact />
      <PageBoundary><Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          {/* «Catálogo» abre Artistas, la entidad por defecto. */}
          <Route path="/catalogo" element={<Navigate to="/artistas" replace />} />
          <Route path="/efemerides" element={<EphemeridesPage />} />
          <Route path="/radio" element={<RadioPage />} />
          {COMMUNITY_PAGES.map(page => <Route key={page.id} path={page.path} element={<CommunityPage pageId={page.id} />} />)}
          {COMMUNITY_REDIRECTS.map(redirect => <Route key={redirect.from} path={redirect.from} element={<CommunityRedirect redirect={redirect} />} />)}
          <Route path="/artistas" element={<ArtistsListPage />} />
          <Route path="/artistas/:id" element={<ArtistDetailPage />} />
          <Route path="/discos" element={<AlbumsListPage />} />
          <Route path="/discos/:id" element={<AlbumDetailPage />} />
          <Route path="/personas" element={<PersonsListPage />} />
          <Route path="/personas/duplicados" element={<Navigate to="/curaduria/duplicados" replace />} />
          <Route path="/personas/:id" element={<PersonDetailPage />} />
          <Route path="/organizaciones" element={<OrganizationsListPage />} />
          <Route path="/organizaciones/:id" element={<OrganizationDetailPage />} />
          <Route path="/lugares/:id" element={<PlacePage />} />
          <Route path="/series/:id" element={<SeriesPage />} />
          <Route path="/curaduria" element={<CurationLayout />}>
            <Route index element={<CurationOverviewPage />} />
            <Route path="categoria/:key" element={<CurationFindingsPage />} />
            <Route path="hallazgos" element={<CurationFindingsPage />} />
            <Route path="aportes" element={<ClaimReviewPage />} />
            {/* La cola de revisión vive ahora dentro de las categorías del detector. */}
            <Route path="revision" element={<Navigate to="/curaduria" replace />} />
            <Route path="revision/:id" element={<ReviewQueueDetailPage />} />
            <Route path="duplicados" element={<PersonDuplicatesPage />} />
            {/* Portadas y fotos de artista para elegir a ojo (0038). */}
            <Route path="imagenes" element={<CurationImagesPage />} />
            {/* Las revisiones del buscador viven ahora en Administrar › Buscador. */}
            <Route path="emociones" element={<Navigate to="/administrar/buscador?seccion=Emociones" replace />} />
            <Route path="buscador-evaluacion" element={<Navigate to="/administrar/buscador?seccion=Evaluar%20lecturas" replace />} />
            <Route path="buscador-correspondencias" element={<Navigate to="/administrar/buscador?seccion=Correspondencias%20RYM" replace />} />
            {/* Historial de lotes de corrección, con su deshacer (PLAN_CURADURIA E8.5). */}
            <Route path="correcciones" element={<CurationFixesPage />} />
            <Route path="correcciones/:batchId" element={<CurationFixesPage />} />
            {/* Lista blanca de la autocorrección, solo admin (PLAN_CURADURIA E10). */}
            <Route path="autocorreccion" element={<CurationAutofixPage />} />
            <Route path="ia" element={<AiCurationPage />} />
          </Route>
          <Route path="/administrar/buscador" element={<SearchAdministrationPage />} />
          <Route path="/administrar" element={<Navigate to="/curaduria" replace />} />
          <Route path="/configuracion" element={<Navigate to="/configuracion/temas" replace />} />
          <Route path="/configuracion/temas" element={<ConfigurationPage />} />
          <Route path="/historial" element={<ChangesHistoryPage />} />
          <Route path="/revision" element={<Navigate to="/curaduria" replace />} />
          <Route path="/revision/:id" element={<LegacyReviewRedirect />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense></PageBoundary>
    </Layout></VideoProvider></SiteAppearanceProvider>
  );
}
