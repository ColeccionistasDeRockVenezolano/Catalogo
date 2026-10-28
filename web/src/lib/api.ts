import type { CatalogTheme, SiteAppearance } from "../../../src/shared/site-appearance";
// CRV · Cliente de la API (src/api/*). El navegador solo habla con esta API,
// nunca con PostgreSQL (CONTRACT #20) — cada función de aquí es una llamada
// HTTP directa, sin lógica de negocio propia.
import { getSessionCsrf, setSessionCsrf, type OperatorUser } from "./operator";
import { cachedCatalogRead, canCacheCatalogRead, clearCatalogReadCache, observeCatalogRevision } from "./catalogReadCache";
import { isCatalogWrite } from "../../../src/shared/catalog-cache-policy";
import type { DailyClock, DailyCycle } from "../../../src/shared/daily-cycle";
import type { ChatEffect, ChatUser, ChatRoom, Wallet as ChatWallet } from "../../../src/chat/protocol";
import type { CatalogDraft,CatalogKind,CatalogPlan,CatalogVocabulary } from "../../../src/curation/ai/types";
import type {
  Alias, AliasWriteResult, AlbumDetail, AlbumListItem, ArtistDetail, ArtistListItem, AuditRow, Claim, CreditSource, EntityWriteResult,
  MergeableKind, OrganizationDetail, OrganizationFacets, OrganizationListItem, Page, PersonDetail, PersonFacets, PersonListItem, RelationUpdateResult, RelationWriteResult,
  PersonConversionResult, PersonDuplicateCandidate, PersonMergePreview, PersonMergeResult, RemovalResult, ReviewActionResult,
  ReviewDetail, ReviewListItem, PersonWebVerification, PersonPairResearch, PersonResearchJob, PersonPairResearchSummary, SearchEntityType, SearchResults, Source, UnmergeResult, VideoDetail, VideoListItem,
  TrackDetail, TrackListItem, TypeFacets,
  CurationFinding, CurationFindingStatus, CurationIgnoreReason, CurationPairKind, CurationScan, CurationScanResult,
  CurationSeverity, CurationSummary,
  CurationAutofixRule, CurationAutofixRun, CurationAutofixState,
  AlbumMergeMode, AlbumMergePreview, AlbumMergeResult, PersonSplitPreview, PersonSplitResult,
  FindingActionsResult, FixBatch, FixBatchSummary, DistinctPair, ConflictResolveResult, ConflictResolveGroupResult,
  AuditUndoPreview, ChangeDetail, ChangeEntityKind, ChangeSummary, ChangeUndoResult, GenreFacets, HomeData,
  PlaceDetail, SeriesDetail, SeriesListItem, SeriesEditorDetail, SeriesEditorSummary, AlbumSeriesMembership,
} from "./types";

/**
 * Dónde vive la API. `VITE_API_BASE_URL` manda si está definida. Si no, un
 * build publicado bajo un prefijo (`build:public` → `/crv/`) habla con la API
 * del mismo origen en `<prefijo>api` (web/server.mjs la reenvía): así no
 * depende de recordar la variable. Sin prefijo (desarrollo) queda la API local.
 *
 * Pasado real (2026-09-15 y 2026-09-16): publicar sin la variable dejó el
 * bundle apuntando a http://127.0.0.1:8080 —el equipo de quien visita, no el
 * servidor— y nadie podía iniciar sesión desde el dominio público.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function apiBaseUrl(): string {
  const configured = (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.trim();
  const prefix = import.meta.env.BASE_URL;
  const sameOrigin = prefix && prefix !== "/" ? `${prefix.replace(/\/$/u, "")}/api` : null;
  // Una ruta relativa («/crv/api») se resuelve contra el origen de la página.
  const resolved = new URL(configured || sameOrigin || "http://127.0.0.1:8080", window.location.origin);
  // Una página abierta desde un dominio real nunca puede alcanzar una API en
  // loopback (sería el equipo del visitante, y la CSP la bloquea): se usa la
  // del mismo origen aunque el build traiga la dirección local.
  if (sameOrigin && LOOPBACK_HOSTS.has(resolved.hostname) && !LOOPBACK_HOSTS.has(window.location.hostname)) {
    return new URL(sameOrigin, window.location.origin).toString();
  }
  return resolved.toString();
}

const BASE_URL = apiBaseUrl();

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

export interface CatalogOverview {
  totals: Record<string, number>;
  genres: Array<{ slug: string; name: string }>;
  decades: number[];
}

export const catalogApi = {
  overview: (signal: AbortSignal) => request<CatalogOverview>("/catalog/overview", { signal }),
};

// ── Chat de la comunidad ───────────────────────────────────────────────────
// El chat corre en su propio proceso (crv-chat) para que un pico de mensajes
// no compita con las consultas del catálogo. En producción comparten origen y
// el gateway enruta /api/chat; en desarrollo se apunta con
// VITE_CHAT_BASE_URL al puerto del chat.
const CHAT_BASE_URL = (import.meta.env["VITE_CHAT_BASE_URL"] as string | undefined)?.trim() || BASE_URL;

function chatRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, { ...options, baseUrl: CHAT_BASE_URL });
}

export interface ChatSession { actor: ChatUser; token: string; wallet: ChatWallet }
export interface ChatCover { albumId: number; title: string; artist: string; coverUrl: string }

export const chatApi = {
  /** Crea el actor invitado o recupera el de la cookie firmada. */
  session: (displayName?: string) => chatRequest<ChatSession>("/chat/session", {
    method: "POST",
    body: displayName ? { displayName } : {},
  }),
  me: () => chatRequest<{ actor: ChatUser; wallet: ChatWallet }>("/chat/session"),
  setName: (displayName: string) => chatRequest<{ actor: ChatUser }>("/chat/profile", {
    method: "PATCH", body: { displayName },
  }),
  rooms: () => chatRequest<{ rooms: ChatRoom[] }>("/chat/rooms"),
  effects: () => chatRequest<{ effects: ChatEffect[] }>("/chat/effects"),
  wallet: () => chatRequest<ChatWallet>("/chat/wallet"),
  buy: (code: string, idempotencyKey: string) => chatRequest<{
    wallet: ChatWallet; effect: { code: string; name: string }; rentedUntil: string | null; effects: ChatEffect[];
  }>(`/chat/effects/${encodeURIComponent(code)}/buy`, { method: "POST", body: { idempotencyKey } }),
  equip: (slot: "name" | "frame" | "background" | "ambient" | "name_font", code: string | null) => chatRequest<{
    equipped: ChatUser["equipped"]; effects: ChatEffect[];
  }>("/chat/equip", { method: "POST", body: { slot, code } }),
  dailyCover: () => chatRequest<ChatCover>("/chat/daily-cover"),
  adminEffects: () => chatRequest<{ effects: ChatEffect[] }>("/chat/admin/effects"),
  publishEffect: (body: Record<string, unknown>) => chatRequest<{ ok: boolean; code: string }>("/chat/admin/effects", {
    method: "POST", body, authenticated: true,
  }),
};

/** URL del WebSocket del chat a partir de la base del proceso de chat. */
export function chatSocketUrl(token: string, room: string): string {
  const url = new URL(CHAT_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/chat/ws`;
  url.search = `?t=${encodeURIComponent(token)}&room=${encodeURIComponent(room)}`;
  return url.toString();
}


export const aiCurationApi = {
  resolveArtist:(personId:number)=>request<import("../../../src/curation/ai/person-artist-types").PersonArtistJob>(`/curation/ai/persons/${personId}/resolve-artist`,{method:"POST",authenticated:true}),
  artistResolution:(personId:number)=>request<import("../../../src/curation/ai/person-artist-types").PersonArtistJob|null>(`/curation/ai/persons/${personId}/resolve-artist`),
  vocabulary:()=>request<CatalogVocabulary>("/curation/ai/vocabulary"),
  list:(kind?:CatalogKind,entityId?:number)=>request<CatalogPlan[]>("/curation/ai/plans",{query:{kind,entityId}}),
  get:(id:number)=>request<CatalogPlan>(`/curation/ai/plans/${id}`),
  start:(kind:CatalogKind,entityId:number,instruction:string)=>request<CatalogPlan>("/curation/ai/plans",{method:"POST",authenticated:true,body:{kind,entityId,instruction}}),
  resume:(id:number)=>request<CatalogPlan>(`/curation/ai/plans/${id}/resume`,{method:"POST",authenticated:true}),
  save:(plan:CatalogPlan,draft:CatalogDraft,reviewedKeys:string[])=>request<CatalogPlan>(`/curation/ai/plans/${plan.id}`,{method:"PATCH",authenticated:true,body:{revision:plan.revision,draft,reviewedKeys}}),
  decide:(plan:CatalogPlan,key:string,decision:"accepted"|"rejected")=>request<CatalogPlan>(`/curation/ai/plans/${plan.id}/decisions`,{method:"POST",authenticated:true,body:{revision:plan.revision,key,decision}}),
  refresh:(plan:CatalogPlan)=>request<CatalogPlan>(`/curation/ai/plans/${plan.id}/refresh`,{method:"POST",authenticated:true,body:{revision:plan.revision}}),
  implement:(plan:CatalogPlan,confirmSensitive:boolean)=>request<CatalogPlan>(`/curation/ai/plans/${plan.id}/implement`,{method:"POST",authenticated:true,body:{revision:plan.revision,previewHash:plan.preview?.hash,confirmSensitive}}),
};

function buildUrl(path: string, query?: Query, baseUrl: string = BASE_URL): string {
  // La API puede vivir en el origen (desarrollo) o bajo un prefijo detrás de
  // un proxy, por ejemplo /crv/api en Tailscale Funnel. Un path que empieza
  // por / haría que URL descartase ese prefijo, por lo que se normaliza aquí.
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(path.replace(/^\/+/, ""), base);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

interface RequestOptions {
  binaryBody?: File;
  onSearchReceipt?: (receipt: string) => void;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: object;
  body?: unknown;
  /** Cancela una lectura que ya no representa lo que la persona está viendo. */
  signal?: AbortSignal;
  /** Esta llamada escribe: exige el token del operador. */
  authenticated?: boolean;
  /** Uso interno: la carga compartida ejecuta el transporte una sola vez. */
  skipReadCache?: boolean;
  /** El chat vive en su propio proceso (crv-chat); el resto en la API del catálogo. */
  baseUrl?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const baseUrl = options.baseUrl ?? BASE_URL;
  if (method === "GET" && !options.skipReadCache && canCacheCatalogRead(path, options.query)) {
    const key = new URL(buildUrl(path, options.query as Query | undefined, baseUrl));
    key.pathname = path;
    return cachedCatalogRead(key, signal => request<T>(path, {
      ...options, skipReadCache: true, signal,
    }), options.signal);
  }
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.binaryBody) headers["content-type"] = options.binaryBody.type;
  if (options.authenticated) {
    const csrf = getSessionCsrf();
    if (!csrf) throw new ApiError(401, "missing_session", "Inicia sesión para poder editar.");
    headers["x-crv-csrf"] = csrf;
  }
  const init: RequestInit = {
    method,
    headers,
    credentials: "include",
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.binaryBody ? { body: options.binaryBody } : options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  };
  const response = await fetch(buildUrl(path, options.query as Query | undefined, baseUrl), init);
  observeCatalogRevision(response.headers.get("x-crv-cache-version"));
  const receipt = response.headers.get("x-crv-search-receipt");
  if (receipt) options.onSearchReceipt?.(receipt);
  const text = await response.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const error = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined)?.error;
    // Una sesión también puede caducar mientras se hace una LECTURA protegida
    // (Curaduría, candidatos de duplicados). Antes solo reaccionábamos a los
    // 401 de escrituras: tras reiniciar la API, el panel conservaba el último
    // resumen bueno y seguía diciendo «hace 4 días» aunque cada refresco
    // recibiera 401. Si había CSRF en memoria, el navegador creía tener una
    // sesión: se invalida para que OperatorContext quite el panel viejo y pida
    // iniciar sesión de nuevo. No se dispara en la visita anónima inicial,
    // donde todavía no existe CSRF.
    if (response.status === 401 && getSessionCsrf()) {
      setSessionCsrf("");
      window.dispatchEvent(new Event("crv-session-expired"));
    }
    throw new ApiError(response.status, error?.code ?? "unknown", error?.message ?? response.statusText, error?.details);
  }
  if (isCatalogWrite(method, path)) window.dispatchEvent(new Event(CATALOG_DATA_CHANGED_EVENT));
  // Toda escritura del catálogo es un run: se anuncia para que la barra de
  // «Deshacer» (ChangeFeedback) lo ofrezca a la vista, sea edición, fusión,
  // división, retiro o un deshacer (que se deshace = rehacer).
  const runId = (json as { runId?: unknown } | undefined)?.runId;
  if (method !== "GET" && typeof runId === "number") {
    window.dispatchEvent(new CustomEvent<CatalogChangeEvent>(CATALOG_CHANGE_EVENT, { detail: { runId, method, path } }));
  }
  return json as T;
}

/** Evento de ventana tras cada escritura con run (ver ChangeFeedback). */
export const CATALOG_CHANGE_EVENT = "crv-change";

export const imageUploadsApi = {
  upload: async (file: File, signal: AbortSignal) => {
    try {
      return await request<import("../../../src/shared/image-upload").UploadedImage>("/media/uploads", {
        method: "POST", authenticated: true, binaryBody: file, signal,
      });
    } catch (error) {
      if (error instanceof ApiError || signal.aborted) throw error;
      throw new Error("No se pudo subir la imagen. Comprueba la conexión y vuelve a intentarlo.", { cause: error });
    }
  },
};
/** Evento de ventana tras deshacer o rehacer: las vistas abiertas recargan (useAsync). */
export const CATALOG_DATA_CHANGED_EVENT = "crv-data-changed";
window.addEventListener(CATALOG_DATA_CHANGED_EVENT, clearCatalogReadCache);
window.addEventListener("crv-session-expired", clearCatalogReadCache);
window.addEventListener("crv-session-changed", clearCatalogReadCache);

// Detectar deploy/CLI al retomar una pestaña, sin un temporizador de consultas.
let synchronizingCatalogCache = false;
async function synchronizeCatalogCache() {
  if (document.hidden || synchronizingCatalogCache) return;
  synchronizingCatalogCache = true;
  try {
    const value = await request<{ revision: string }>("/catalog/cache-version", { signal: AbortSignal.timeout(5000) });
    if (observeCatalogRevision(value.revision)) window.dispatchEvent(new Event(CATALOG_DATA_CHANGED_EVENT));
  } catch { /* Un fallo de red no invalida una lectura vigente. */ }
  finally { synchronizingCatalogCache = false; }
}
window.addEventListener("focus", () => { void synchronizeCatalogCache(); });
document.addEventListener("visibilitychange", () => { void synchronizeCatalogCache(); });
void synchronizeCatalogCache();
export interface CatalogChangeEvent { runId: number; method: string; path: string }

export interface AuthSession {
  user: OperatorUser;
  csrf: string;
}

export const authApi = {
  me: async () => {
    const session = await request<AuthSession>("/auth/me");
    setSessionCsrf(session.csrf);
    return session;
  },
  login: async (username: string, password: string) => {
    const session = await request<AuthSession>("/auth/login", { method: "POST", body: { username, password } });
    setSessionCsrf(session.csrf);
    return session;
  },
  logout: async () => {
    await request<void>("/auth/logout", { method: "POST", authenticated: true });
    setSessionCsrf("");
  },
};

export interface Paged { limit?: number; offset?: number; }
type CatalogSortParams = { sort?: "name" | "name_desc" | "year_desc" | "year_asc" };

// ---------- lectura ----------
export const searchApi = {
  knowledgeReview: (id: number, signal?: AbortSignal) => request<import("../../../src/search/knowledge-publication").KnowledgeReviewDetail>(`/search/administration/knowledge/reviews/${id}`, { ...(signal ? {signal} : {}) }),
  decideKnowledge: (id: number, body: import("zod").input<typeof import("../../../src/search/knowledge-publication").knowledgeDecisionSchema>) => request<{runId:number;result:{revision:number;status:string}}>(`/search/administration/knowledge/reviews/${id}/decision`, {method:"POST",body}),
  knowledge: (signal?: AbortSignal) => request<import("../../../src/search/knowledge-administration").KnowledgeAdministration>("/search/administration/knowledge", { ...(signal ? { signal } : {}) }),
  /** More hits of one type, paginated (the API caps at 200 known matches). */
  byType: (q: string, type: SearchEntityType, limit: number, offset = 0, signal?: AbortSignal) =>
    request<SearchResults>("/search", { query: { q, types: type, limit, offset }, ...(signal ? { signal } : {}) }),
  observed: async (q: string, signal?: AbortSignal) => {
    let receipt: string | null = null;
    try {
      const results = await request<SearchResults>("/search", { query: { q, limit: 20 }, onSearchReceipt: value => { receipt = value; }, ...(signal ? { signal } : {}) });
      return { results, receipt, error: undefined as string | undefined, clientIncident: undefined as "network" | "invalid_response" | undefined };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { results: null, receipt, error: error instanceof Error ? error.message : "No se pudo consultar el catálogo", clientIncident: error instanceof ApiError ? undefined : error instanceof SyntaxError ? "invalid_response" as const : "network" as const };
    }
  },
  administration: (signal?: AbortSignal) => request<import("../../../src/search/administration").SearchAdministration>("/search/administration", { ...(signal ? { signal } : {}) }),
  laya: (signal?: AbortSignal) => request<Awaited<ReturnType<typeof import("../../../src/search/laya-models").layaAdministration>>>("/search/administration/laya", { ...(signal ? { signal } : {}) }),
  layaActivation: (body: import("zod").input<typeof import("../../../src/search/laya-models").activationRequestSchema>) =>
    request<{ runId: number; result: { id: number; task: string; modelId: string; action: string } }>("/search/administration/laya/activations", { method: "POST", body }),
  observe: (q: string, onSearchReceipt: (receipt: string) => void, signal?: AbortSignal) => request<SearchResults>("/search", { query: { q, limit: 20 }, onSearchReceipt, ...(signal ? { signal } : {}) }),
  confirm: (body: import("../../../src/search/observability").Confirmation) => request<{status:string}>("/search/confirmations", { method: "POST", body }),
  search: (q: string, types?: string[], limit = 20, signal?: AbortSignal) =>
    request<SearchResults>("/search", { query: { q, limit, ...(types?.length ? { types: types.join(",") } : {}) }, ...(signal ? { signal } : {}) }),
};

/** Filtros por género de las listas de discos y artistas (ver `genreListFilterSchema`). */
export type GenreListParams = { genre?: string; withoutGenre?: boolean; relatedGenre?: boolean };

export const homeApi = {
  get: (signal?: AbortSignal, date?: string) => request<HomeData>("/home", { query: { date }, ...(signal ? { signal } : {}) }),
};
export const dailyClockApi = { get: (signal?: AbortSignal) => request<DailyClock>("/daily-cycle", { ...(signal ? { signal } : {}) }) };
export interface Ephemeris {
  id:number; title:string; description:string; date:string; year:number; place:string; subject:string;
  sources:Array<{title:string;url:string}>;
}
export const ephemeridesApi = {
  get:(date:string,signal?:AbortSignal)=>request<{dailyCycle:DailyCycle;today:Ephemeris[];events:Ephemeris[]}>("/ephemerides",{query:{date},...(signal?{signal}:{})}),
};

export const genresApi = {
  propose: (kind:"artist"|"album",id:number,body:{proposedName:string;familySlug?:string;rawValue?:string;note:string})=>request<{runId:number;reviewId:number}>(`/genres/${kind}/${id}/proposal`,{method:"POST",authenticated:true,body}),
  periods: (kind:string,id:number)=>request<Array<{id:number;name:string;period:string|null}>>(`/genres/${kind}/${id}/periods`),
  vocabulary: () => request<Array<{ slug: string; name: string; level: string }>>("/genres/vocabulary"),
  decide: (kind: "artist" | "album", id: number, action: "confirm_primary" | "add_secondary" | "reject", genreSlug: string, note: string) =>
    request<{ runId: number }>(`/genres/${kind}/${id}/decision`, { method: "POST", authenticated: true, body: { action, genreSlug, note } }),
  facets: (kind: "album" | "artist", signal?: AbortSignal) => request<GenreFacets>("/genres/facets", { query: { kind }, ...(signal ? { signal } : {}) }),
};

export const artistsApi = {
  facets: () => request<TypeFacets>("/artists/facets"),
  list: (params: Paged & CatalogSortParams & Omit<GenreListParams, "relatedGenre"> & { q?: string; artistType?: string; decade?: number; withoutYear?: boolean } = {}, signal?: AbortSignal) => request<Page<ArtistListItem>>("/artists", { query: params, ...(signal ? { signal } : {}) }),
  get: (id: number, date?: string, signal?: AbortSignal) => request<ArtistDetail>(`/artists/${id}`, { query: { date }, ...(signal ? { signal } : {}) }),
};

export const albumsApi = {
  facets: () => request<TypeFacets>("/albums/facets"),
  list: (params: Paged & CatalogSortParams & GenreListParams & { q?: string; artistId?: number; albumType?: string; decade?: number; withoutYear?: boolean; beforeYear?: number } = {}, signal?: AbortSignal) => request<Page<AlbumListItem>>("/albums", { query: params, ...(signal ? { signal } : {}) }),
  get: (id: number) => request<AlbumDetail>(`/albums/${id}`),
};

export const personsApi = {
  list: (params: Paged & { q?: string; hasCredits?: boolean; role?: string; suspect?: string; sort?: "name" | "credits" } = {}, signal?: AbortSignal) =>
    request<Page<PersonListItem>>("/persons", { query: params, ...(signal ? { signal } : {}) }),
  facets: (signal?: AbortSignal) => request<PersonFacets>("/persons/facets", { ...(signal ? { signal } : {}) }),
  get: (id: number) => request<PersonDetail>(`/persons/${id}`),
};

// ---------- fusión de personas (E11.3/E11.4/E11.5) ----------
export interface PersonMergeRequest {
  dropId: number;
  previewHash: string;
  /** `combine` solo para `combinableFields` (biografía). */
  fieldChoices?: Partial<Record<string, "keep" | "drop" | "combine">>;
  /** Texto final de cada campo combinado (camelCase: `biography`). */
  combinedTexts?: Partial<Record<string, string>>;
  /** Los campos combinados quedan marcados para que la IA los reescriba después. */
  rewriteLater?: boolean;
  keepDropNameAsAlias: boolean;
  /** Personas: confirmo que son la misma pese al `eraConflict` de la previsualización. */
  allowEraConflict?: boolean;
  note: string;
}

const MERGE_PATHS: Record<MergeableKind, string> = { person: "persons", organization: "organizations", artist: "artists" };
export type RewriteKind = MergeableKind | "album";
const REWRITE_PATHS: Record<RewriteKind, string> = { ...MERGE_PATHS, album: "albums" };

export const entityMergeApi = {
  /** Previsualización de la fusión de dos fichas del mismo kind (E11.3/E11.10). */
  preview: (kind: MergeableKind, keepId: number, dropId: number) =>
    request<PersonMergePreview>(`/${MERGE_PATHS[kind]}/${keepId}/merge-preview`, { query: { with: dropId } }),
  merge: (kind: MergeableKind, keepId: number, body: PersonMergeRequest) =>
    request<PersonMergeResult>(`/${MERGE_PATHS[kind]}/${keepId}/merge`, { method: "POST", authenticated: true, body }),
  /** Textos de la ficha que una fusión unió y esperan reescritura con IA. */
  pendingRewrites: (kind: RewriteKind, id: number) =>
    request<{ pending: Array<{ id: number; field: string; sources: number; createdAt: string }> }>(`/${REWRITE_PATHS[kind]}/${id}/text-rewrites`),
  /** Reescribe ya con IA los textos marcados (run propio, se puede deshacer). */
  runRewrites: (kind: RewriteKind, id: number, note: string) =>
    request<{ runId: number | null; written: number; failed: string[] }>(`/${REWRITE_PATHS[kind]}/${id}/text-rewrites/run`, { method: "POST", authenticated: true, body: { note } }),
  /** DeepSeek flash propone un texto que une los de las dos fichas; no escribe nada. */
  rewrite: (kind: MergeableKind, keepId: number, dropId: number, field: string) =>
    request<{ text: string; model: string }>(`/${MERGE_PATHS[kind]}/${keepId}/merge-rewrite`, { method: "POST", authenticated: true, body: { dropId, field } }),
  duplicateCandidates: (params: Paged & { minScore?: number } = {}) =>
    request<Page<PersonDuplicateCandidate>>("/persons/duplicate-candidates", { query: params }),
  convert: (personId: number, body: {
    to: "organization" | "artist";
    targetId?: number;
    create?: { name: string; organizationType?: string; artistType?: string };
    keepNameAsAlias: boolean;
    note: string;
  }) => request<PersonConversionResult>(`/persons/${personId}/convert`, { method: "POST", authenticated: true, body }),
  undo: (mergeRunId: number, note: string) =>
    request<UnmergeResult>(`/merge-runs/${mergeRunId}/undo`, { method: "POST", authenticated: true, body: { note } }),
};

// ---------- fusión de discos (E6.5; la API ya la ofrecía, la web no) ----------
export interface AlbumMergeRequest {
  dropId: number;
  previewHash: string;
  fieldChoices?: Record<string, "keep" | "drop">;
  keepDropNameAsAlias: boolean;
  /** match: el mismo disco; append: se suma como disco siguiente (Lado B, CD 2, B-Sides). */
  mode: AlbumMergeMode;
  keepDiscTitle?: string | null;
  dropDiscTitle?: string | null;
  title?: string | null;
  note: string;
}

export const albumMergeApi = {
  preview: (keepId: number, dropId: number, mode: AlbumMergeMode = "match") =>
    request<AlbumMergePreview>(`/albums/${keepId}/merge-preview`, { query: { with: dropId, mode } }),
  merge: (keepId: number, body: AlbumMergeRequest) =>
    request<AlbumMergeResult>(`/albums/${keepId}/merge`, { method: "POST", authenticated: true, body }),
};

// ---------- división de personas (E6.3) ----------
export const personSplitApi = {
  preview: (personId: number, into: string[]) =>
    request<PersonSplitPreview>(`/persons/${personId}/split-preview`, { query: { into: into.join(",") } }),
  split: (personId: number, into: string[], note: string) =>
    request<PersonSplitResult>(`/persons/${personId}/split`, { method: "POST", authenticated: true, body: { into, note } }),
};

export const organizationsApi = {
  list: (params: Paged & { q?: string; organizationType?: string } = {}, signal?: AbortSignal) => request<Page<OrganizationListItem>>("/organizations", { query: params, ...(signal ? { signal } : {}) }),
  facets: () => request<OrganizationFacets>("/organizations/facets"),
  get: (id: number) => request<OrganizationDetail>(`/organizations/${id}`),
};

/** Plan del primo, etapa 2: página de lugar y de serie. */
export const discographyApi = {
  listSeries: (params: Paged & CatalogSortParams & GenreListParams & { q?: string; albumType?: string; decade?: number; withoutYear?: boolean; beforeYear?: number } = {}) => request<Page<SeriesListItem>>("/series", { query: params }),
  place: (id: number) => request<PlaceDetail>(`/places/${id}`),
  series: (id: number) => request<SeriesDetail>(`/series/${id}`),
};

/** Lectura de pistas (auditoría #7: el CRUD era asimétrico, sin GET). */
export const tracksApi = {
  list: (params: Paged & { q?: string; albumId?: number } = {}) => request<Page<TrackListItem>>("/tracks", { query: params }),
  get: (id: number) => request<TrackDetail>(`/tracks/${id}`),
};

export const sourcesApi = {
  list: () => request<Source[]>("/sources"),
  get: (id: number) => request<Source & { lastRun: { id: number; kind: string; status: string; startedAt: string; finishedAt: string | null } | null }>(`/sources/${id}`),
};

export const claimsApi = {
  forEntity: (entity: "artist" | "person" | "organization" | "album" | "track" | "album_credit" | "track_credit", id: number, params: Paged = {}) =>
    request<Page<Claim>>("/claims", { query: { entity, id, ...params } }),
  creditSources: (entity: "album" | "track", id: number) => request<CreditSource[]>("/credit-sources", { query: { entity, id } }),
};

export const auditApi = {
  forEntity: (entity: string, id: number, params: Paged = {}) => request<Page<AuditRow>>("/audit", { query: { entity, id, ...params } }),
  /** Qué pasaría al deshacer esa fusión o conversión suelta (no escribe nada). */
  undoPreview: (auditId: number) => request<AuditUndoPreview>(`/audit/${auditId}/undo`),
  undoEntry: (auditId: number, note: string) =>
    request<{ runId: number; auditId: number; kind: "merge" | "absorption" }>(`/audit/${auditId}/undo`, { method: "POST", body: { note }, authenticated: true }),
  run: (id: number) => request<{ id: number; kind: string; status: string; sourceId: number | null; startedAt: string; finishedAt: string | null; params: unknown; counters: unknown; errorLog: string | null }>(`/runs/${id}`),
};

export const changesApi = {
  list: (params: Paged & { entity?: ChangeEntityKind; id?: number; journaled?: boolean } = {}) =>
    request<Page<ChangeSummary>>("/changes", { query: params }),
  get: (runId: number) => request<ChangeDetail>(`/changes/${runId}`),
  undo: (runId: number, note: string) =>
    request<ChangeUndoResult>(`/changes/${runId}/undo`, { method: "POST", body: { note }, authenticated: true }),
};

export const youtubeApi = {
  saveAlbumVideo: (albumId: number, videoId: string, kind: string, isPrimaryLink: boolean, note: string, previousVideoId?: string) =>
    request<{ runId: number }>(`/albums/${albumId}/videos/${videoId}`, { method: "PATCH", authenticated: true, body: { kind, isPrimaryLink, note, previousVideoId } }),
  removeAlbumVideo: (albumId: number, videoId: string, note: string) =>
    request<{ runId: number }>(`/albums/${albumId}/videos/${videoId}`, { method: "DELETE", authenticated: true, query: { note } }),
  list: (params: Paged & { q?: string } = {}) => request<Page<VideoListItem>>("/youtube/videos", { query: params }),
  get: (id: number) => request<VideoDetail>(`/youtube/videos/${id}`),
};

export const reviewApi = {
  list: (params: Paged & { status?: string; kind?: string } = {}) => request<Page<ReviewListItem>>("/review-queue", { query: params }),
  get: (id: number) => request<ReviewDetail>(`/review-queue/${id}`),
  webVerification: (id: number) => request<PersonWebVerification | null>(`/review-queue/${id}/web-verification`),
  investigateWeb: (id: number) => request<PersonWebVerification>(`/review-queue/${id}/web-verification`, { method: "POST", authenticated: true }),
  investigatePersonPair: (aId: number, bId: number) => request<PersonPairResearch>("/persons/identity-research", {
    method: "POST", authenticated: true, body: { aId, bId },
  }),
  personPairResearch: (aId: number, bId: number) => request<PersonPairResearch | null>("/persons/identity-research", { query: { aId, bId } }),
  personResearchList: (personId: number) => request<PersonPairResearchSummary[]>(`/persons/${personId}/identity-research`),
  startPersonPairResearch: (aId: number, bId: number) => request<PersonResearchJob>("/persons/identity-research/jobs", {
    method: "POST", authenticated: true, body: { aId, bId },
  }),
  activePersonPairJob: (aId: number, bId: number) => request<PersonResearchJob | null>("/persons/identity-research/active-job", { query: { aId, bId } }),
  personResearchJob: (id: number) => request<PersonResearchJob>(`/persons/identity-research/jobs/${id}`),
  declarePersonsDistinct: (aId: number, bId: number, note: string) => request<{ runId: number; closedReviews: number }>(
    "/persons/identity-research/distinct", { method: "POST", authenticated: true, body: { aId, bId, note } }),
  markWebReviewed: (id: number, note: string) => request<PersonWebVerification>(`/review-queue/${id}/web-verification/review`, { method: "POST", authenticated: true, body: { note } }),
  mixedVerification: (personId: number) => request<PersonWebVerification | null>(`/review-queue/person/${personId}/web-verification`),
  investigateMixed: (personId: number) => request<PersonWebVerification>(`/review-queue/person/${personId}/web-verification`, { method: "POST", authenticated: true }),
  markMixedReviewed: (personId: number, note: string) => request<PersonWebVerification>(`/review-queue/person/${personId}/web-verification/review`, { method: "POST", authenticated: true, body: { note } }),
  accept: (id: number, note: string, targetId?: number) =>
    request<ReviewActionResult>(`/review-queue/${id}/accept`, { method: "POST", authenticated: true, body: { note, ...(targetId === undefined ? {} : { targetId }) } }),
  reject: (id: number, note: string) =>
    request<ReviewActionResult>(`/review-queue/${id}/reject`, { method: "POST", authenticated: true, body: { note } }),
  resolveConflict: (id: number, note: string, choice?: string, value?: string | number | boolean | null) =>
    request<ReviewActionResult>(`/review-queue/${id}/resolve-conflict`, {
      method: "POST", authenticated: true,
      body: { note, ...(choice === undefined ? {} : { choice }), ...(value === undefined ? {} : { value }) },
    }),
  setPriority: (id: number, priority: number, note: string) =>
    request<{ reviewId: number; priority: number; runId: number }>(`/review-queue/${id}/priority`, {
      method: "PATCH", authenticated: true, body: { priority, note },
    }),
};

export interface CurationFindingQuery extends Paged {
  sort?: "priority" | "oldest" | "newest" | "entity";
  category?: string;
  detector?: string;
  signature?: string;
  severity?: CurationSeverity;
  entityKind?: string;
  status?: CurationFindingStatus | "all";
  q?: string;
  scanId?: number;
  chained?: boolean;
}

/** Filtro de una acción de grupo: el mismo que el listado, sin paginar ni estado (siempre `open`). */
export interface CurationFindingGroupFilter {
  category: string;
  detector: string;
  signature?: string;
  severity?: CurationSeverity;
  entityKind?: string;
  q?: string;
  scanId?: number;
  chained?: boolean;
}

/**
 * Filtro de «marcar como revisado» en grupo (E8.7): los mismos filtros de la
 * pantalla, sin exigir categoría ni detector — «Surgidos tras corregir» los
 * cruza todos. `chained` no viaja: la API siempre lo da por cierto.
 */
export interface CurationChainGroupFilter {
  category?: string;
  detector?: string;
  signature?: string;
  severity?: CurationSeverity;
  entityKind?: string;
  status?: CurationFindingStatus | "all";
  q?: string;
  scanId?: number;
}

/** Cuerpo de `POST /curation/fixes/preview` (E4): todo lote nace de una vista previa. */
export interface CurationFixesPreviewRequest {
  mode: "individual" | "selected" | "group";
  findingIds?: number[];
  filter?: CurationFindingGroupFilter;
  actionKey?: string;
  overrides?: {
    params?: Record<string, unknown>;
    byFinding?: Record<string, { actionKey?: string; params?: Record<string, unknown> }>;
  };
}

export const curationApi = {
  summary: () => request<CurationSummary>("/curation/summary"),
  findings: (params: CurationFindingQuery = {}) => request<Page<CurationFinding>>("/curation/findings", { query: params }),
  finding: (id: number) => request<CurationFinding>(`/curation/findings/${id}`),
  /** Acciones de corrección ofrecidas para un hallazgo, con la recomendada primero (E4). */
  findingsActions: (id: number) => request<FindingActionsResult>(`/curation/findings/${id}/actions`),
  scans: (limit = 20) => request<{ data: CurationScan[] }>("/curation/scans", { query: { limit } }),
  scan: () => request<CurationScanResult>("/curation/scan", { method: "POST", authenticated: true }),
  ignore: (id: number, reason: CurationIgnoreReason, note: string) =>
    request<CurationFinding>(`/curation/findings/${id}/ignore`, { method: "POST", authenticated: true, body: note ? { reason, note } : { reason } }),
  reopen: (id: number) => request<CurationFinding>(`/curation/findings/${id}/reopen`, { method: "POST", authenticated: true }),
  // ---- Valores en disputa sin revisión viva (E7.1): resolver un conflicto directo ----
  resolveConflict: (id: number, note: string, choice?: "a" | "b" | "both" | "dismiss", value?: string | number | boolean | null) =>
    request<ConflictResolveResult>(`/curation/findings/${id}/resolve-conflict`, {
      method: "POST", authenticated: true,
      body: { note, ...(choice === undefined ? {} : { choice }), ...(value === undefined ? {} : { value }) },
    }),
  resolveConflictsGroup: (input: CurationFindingGroupFilter & { note: string }) =>
    request<ConflictResolveGroupResult>("/curation/findings/resolve-conflicts-group", { method: "POST", authenticated: true, body: input }),
  ignoreGroup: (input: CurationFindingGroupFilter & { reason: CurationIgnoreReason; note: string }) =>
    request<{ ignored: number }>("/curation/findings/ignore-group", { method: "POST", authenticated: true, body: input }),
  declareDistinct: (input: { kind: CurationPairKind; aId: number; bId: number; note: string }) =>
    request<{ created: boolean }>("/curation/distinct-pairs", { method: "POST", authenticated: true, body: input }),
  distinctPairs: (params: Paged = {}) => request<Page<DistinctPair>>("/curation/distinct-pairs", { query: params }),
  retractDistinct: (id: number) =>
    request<{ pair: DistinctPair }>(`/curation/distinct-pairs/${id}`, { method: "DELETE", authenticated: true }),
  // ---- Lotes de corrección (E4): vista previa → aplicar → deshacer ----
  fixesPreview: (body: CurationFixesPreviewRequest) =>
    request<FixBatch>("/curation/fixes/preview", { method: "POST", authenticated: true, body }),
  fixApply: (batchId: number, input: { previewHash: string; excludeItemIds?: number[]; note: string }) =>
    request<FixBatch>(`/curation/fixes/${batchId}/apply`, { method: "POST", authenticated: true, body: input }),
  fixUndo: (batchId: number, note: string) =>
    request<FixBatch>(`/curation/fixes/${batchId}/undo`, { method: "POST", authenticated: true, body: { note } }),
  /** Historial de lotes (E8.5); sin `status` la API omite las vistas previas que nadie aplicó. */
  fixes: (params: Paged & { mode?: string; status?: string } = {}) =>
    request<Page<FixBatchSummary>>("/curation/fixes", { query: params }),
  fix: (batchId: number, params: Paged & { status?: string } = {}) =>
    request<FixBatch>(`/curation/fixes/${batchId}`, { query: params }),
  // ---- Autocorrección segura (E10): la lista blanca y su pasada ----
  autofix: () => request<CurationAutofixState>("/curation/autofix"),
  autofixRun: () => request<CurationAutofixRun>("/curation/autofix/run", { method: "POST", authenticated: true }),
  autofixCreateRule: (body: { detector: string; signature?: string | null; actionKey: string; enabled?: boolean; maxPerScan?: number | null; note?: string }) =>
    request<CurationAutofixRule>("/curation/autofix/rules", { method: "POST", authenticated: true, body }),
  autofixUpdateRule: (id: number, body: { enabled?: boolean; maxPerScan?: number | null; note?: string }) =>
    request<CurationAutofixRule>(`/curation/autofix/rules/${id}`, { method: "PATCH", authenticated: true, body }),
  autofixDeleteRule: (id: number) =>
    request<CurationAutofixRule>(`/curation/autofix/rules/${id}`, { method: "DELETE", authenticated: true }),
  // ---- «Surgidos tras corregir» dados por revisados (E8.7) ----
  acknowledgeChain: (id: number) =>
    request<CurationFinding>(`/curation/findings/${id}/acknowledge-chain`, { method: "POST", authenticated: true }),
  acknowledgeChainGroup: (filter: CurationChainGroupFilter) =>
    request<{ acknowledged: number }>("/curation/findings/acknowledge-chain-group", { method: "POST", authenticated: true, body: filter }),
};

export type EmotionReviewCategory = "no_expresa_emocion" | "emocion" | "tristeza" | "enfocado" | "libertad" | "cachonda" | "aumenta_mi_aura";
export interface EmotionReviewTag {
  tag: string;
  suggested: string;
  probability: number | null;
  category: EmotionReviewCategory | null;
  uses: number;
  weight: number;
  artists: { id: number; name: string; weight: number }[];
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}
export const emotionCurationApi = {
  list: (params: { status: "pending" | "reviewed" | "all"; q: string; limit: number; offset: number }) =>
    request<{ data: EmotionReviewTag[]; total: number; pending: number }>("/curation/emotions/tags", { query: params }),
  decide: (tag: string, category: EmotionReviewCategory, note: string) =>
    request<{ saved: true }>("/curation/emotions/tags/decision", { method: "POST", authenticated: true, body: { tag, category, note } }),
};

// ---------- buscador: evaluación humana y correspondencias (etapa 2) ----------
export type HumanBlind = { object: "album" | "track" | "artist" | "unknown"; type: string; state: string; appreciation: string; coverage: string };
export type HumanVerdict = "supported" | "appreciation_error" | "scope_error" | "unsupported_generalization" | "other_error";
export interface HumanEvaluationItem {
  id: string; study: string; work: string | null; workKind: string; quote: string; language: string; source: string;
  blind: HumanBlind | null; verdict: HumanVerdict | null; note: string; stale: boolean;
  annotation: null | { object: string; type: string; aspect: string; value: string; state: string; appreciation: string; coverage: string;
    listeningCondition: string | null; interpretation: string; alternative: string; analyst: string; dependencies: string[] };
}
export interface HumanEvaluationState {
  studyVersion: string; evaluator: string; items: HumanEvaluationItem[]; complete: boolean; meetsThresholds: boolean;
  metrics: { total: number; blind: number; judged: number; scopeErrors: number; unsupportedGeneralizations: number; supportPrecision: number | null };
  thresholds: { status: string; scopeErrorsAllowed: number; unsupportedGeneralizationsAllowed: number; supportPrecision: number };
}
export type MappingRelation = "equivalence" | "specialization" | "partial" | "pending";
export interface MappingTerm {
  originalTerm: string;
  proposal: { targetSlug: string | null; relation: MappingRelation; sourceConceptKind: string; rationale: string; analyst: string };
  decision: null | { decision: "approved" | "corrected" | "rejected"; targetSlug: string | null; relation: MappingRelation | null; note: string; decidedBy: string; decidedAt: string; reviewVersion: string };
}
export interface MappingAdjudicationState { reviewVersion: string; terms: MappingTerm[]; genres: { slug: string; name: string }[]; decided: number; total: number }
export type QueryLabelStatus = "query_valid" | "partial" | "entity_lookup" | "clarify" | "unsupported" | "contradiction" | "unrecognized";
export interface QueryLabelEntity { role: "target" | "reference"; kind: "artist" | "album" | "track" | null; literal: string }
export interface QueryLabelGold {
  status: QueryLabelStatus; req: string[]; exc: string[]; any: string[][]; pref: string[]; ctx: number;
  ent: QueryLabelEntity[]; pending: number; alts: string[]; facet: string | null;
}
export interface QueryLabelOption { id: string; label: string; group: string; hint: string }
export interface QueryLabelItem { id: string; text: string; source: string; outcome: "labeled" | "skipped" | null; gold: QueryLabelGold | null; note: string; labeledAt: string | null; stale: boolean }
export interface QueryLabelingState {
  batchVersion: string; labeler: string; items: QueryLabelItem[]; labeled: number; skipped: number; total: number;
  options: { conditions: QueryLabelOption[]; facets: QueryLabelOption[] };
}
export const searchHumanReviewApi = {
  evaluation: () => request<HumanEvaluationState>("/search/administration/human-evaluation"),
  blind: (id: string, blind: HumanBlind) =>
    request<{ annotation: NonNullable<HumanEvaluationItem["annotation"]> }>(`/search/administration/human-evaluation/${encodeURIComponent(id)}/blind`, { method: "POST", authenticated: true, body: blind }),
  verdict: (id: string, verdict: HumanVerdict, note: string) =>
    request<{ saved: true }>(`/search/administration/human-evaluation/${encodeURIComponent(id)}/verdict`, { method: "POST", authenticated: true, body: { verdict, note } }),
  mappings: () => request<MappingAdjudicationState>("/search/administration/mapping-adjudications"),
  decideMapping: (body: { term: string; decision: "approved" | "corrected" | "rejected"; targetSlug: string | null; relation: MappingRelation | null; note: string }) =>
    request<{ saved: true }>("/search/administration/mapping-adjudications/decision", { method: "POST", authenticated: true, body }),
  queryLabels: () => request<QueryLabelingState>("/search/administration/query-labels"),
  saveQueryLabel: (id: string, body: { outcome: "labeled"; gold: QueryLabelGold; note: string } | { outcome: "skipped"; note: string }) =>
    request<{ saved: true; gold: QueryLabelGold | null }>(`/search/administration/query-labels/${encodeURIComponent(id)}`, { method: "POST", authenticated: true, body }),
};

// ---------- escritura de entidades del core ----------
export type EntityPath = "artists" | "persons" | "organizations" | "albums" | "tracks";

function entityWriteApi(path: EntityPath) {
  return {
    create: (values: Record<string, unknown>) =>
      request<EntityWriteResult>(`/${path}`, { method: "POST", authenticated: true, body: values }),
    update: (id: number, values: Record<string, unknown>) =>
      request<EntityWriteResult>(`/${path}/${id}`, { method: "PATCH", authenticated: true, body: values }),
    remove: (id: number, note?: string) =>
      request<RemovalResult>(`/${path}/${id}`, { method: "DELETE", authenticated: true, query: note ? { note } : {} }),
  };
}

export const artistWrites = entityWriteApi("artists");
export const personWrites = entityWriteApi("persons");
export const organizationWrites = entityWriteApi("organizations");
export const albumWrites = entityWriteApi("albums");
export const trackWrites = entityWriteApi("tracks");

// ---------- escritura de relaciones puente ----------
export type RelationPath = "artist-members" | "person-organizations" | "album-credits" | "track-credits" | "album-formats";

function relationWriteApi(path: RelationPath) {
  return {
    create: (values: Record<string, unknown>) =>
      request<RelationWriteResult>(`/${path}`, { method: "POST", authenticated: true, body: values }),
    update: (id: number, values: Record<string, unknown>) =>
      request<RelationUpdateResult>(`/${path}/${id}`, { method: "PATCH", authenticated: true, body: values }),
    remove: (id: number, note?: string) =>
      request<RemovalResult>(`/${path}/${id}`, { method: "DELETE", authenticated: true, query: note ? { note } : {} }),
  };
}

export const artistMemberWrites = relationWriteApi("artist-members");
export const personOrganizationWrites = relationWriteApi("person-organizations");
export const albumCreditWrites = relationWriteApi("album-credits");
export const trackCreditWrites = relationWriteApi("track-credits");
export const albumFormatWrites = relationWriteApi("album-formats");

// ---------- escritura de alias ----------
function aliasWriteApi(path: EntityPath) {
  return {
    create: (entityId: number, input: { alias: string; aliasType: string; isPrimary: boolean; note?: string }) =>
      request<AliasWriteResult>(`/${path}/${entityId}/aliases`, { method: "POST", authenticated: true, body: input }),
    update: (entityId: number, aliasId: number, input: Partial<Pick<Alias, "alias" | "aliasType" | "isPrimary">> & { note?: string }) =>
      request<AliasWriteResult>(`/${path}/${entityId}/aliases/${aliasId}`, { method: "PATCH", authenticated: true, body: input }),
    remove: (entityId: number, aliasId: number, note?: string) =>
      request<{ id: number; entityId: number; runId: number }>(`/${path}/${entityId}/aliases/${aliasId}`, {
        method: "DELETE", authenticated: true, query: note ? { note } : {},
      }),
  };
}

export const aliasWrites: Record<EntityPath, ReturnType<typeof aliasWriteApi>> = {
  artists: aliasWriteApi("artists"),
  persons: aliasWriteApi("persons"),
  organizations: aliasWriteApi("organizations"),
  albums: aliasWriteApi("albums"),
  tracks: aliasWriteApi("tracks"),
};

// ---------- Curaduría: elegir portada o foto de artista a ojo (0038) ----------
export type ImageCandidateKind = "album" | "artist";
export interface ImageCandidate {
  id: number;
  url: string;
  source: string;
  pageUrl: string | null;
  width: number | null;
  height: number | null;
  /** Parecido con la imagen actual (0–1); null cuando no se calculó. */
  score: number | null;
  /** Inspección al descargar; null mientras no se haya inspeccionado. */
  naturalWidth: number | null;
  naturalHeight: number | null;
  effectiveWidth: number | null;
  quality: "high" | "medium" | "low" | "failed" | null;
  use: string | null;
  reasons: string[];
  /** Cómo describe la página esta imagen (pie, alt, «Imagen: …»), cuando se conoce. */
  context: string | null;
  /** Otra candidata de la misma ficha con la misma imagen (variante). */
  variantOf: number | null;
}
export interface ImageCandidateGroup {
  kind: ImageCandidateKind;
  entityId: number;
  name: string;
  subtitle: string | null;
  currentUrl: string | null;
  stale: boolean;
  candidates: ImageCandidate[];
}

export const imageCandidatesApi = {
  jobs: () => request<import("../../../src/shared/image-curation-jobs").ImageJob[]>("/curation/images/jobs"),
  enqueue: (tasks: import("../../../src/shared/image-curation-jobs").ImageTask[]) => request<import("../../../src/shared/image-curation-jobs").ImageJob[]>("/curation/images/jobs", { method: "POST", authenticated: true, body: { tasks } }),
  retry: (id: number) => request<import("../../../src/shared/image-curation-jobs").ImageJob>(`/curation/images/jobs/${id}/retry`, { method: "POST", authenticated: true, body: {} }),
  dismiss: (id: number) => request<{ dismissed: true }>(`/curation/images/jobs/${id}/dismiss`, { method: "POST", authenticated: true, body: {} }),
  summary: () => request<Record<ImageCandidateKind, number>>("/curation/images/summary"),
  list: (kind: ImageCandidateKind, params: Paged & { entityId?: number; artistId?: number } = {}) =>
    request<Page<ImageCandidateGroup>>("/curation/images", { query: { kind, ...params } }),
  /** Descarga y mide candidatas pendientes; no cambia ninguna ficha. */
  inspect: (body: { ids?: number[]; limit?: number; vision?: boolean } = {}) =>
    request<{ runId: number; inspected: number; failed: number; visual: number }>("/curation/images/inspect", { method: "POST", authenticated: true, body }),
  /** `candidateId` null = dejar la imagen actual y descartar las candidatas. */
  decide: (kind: ImageCandidateKind, entityId: number, candidateId: number | null) =>
    request<{ runId: number; kind: ImageCandidateKind; entityId: number; chosenUrl: string | null }>(
      `/curation/images/${kind}/${entityId}/decide`, { method: "POST", authenticated: true, body: { candidateId } }),
  /** Deja la imagen actual en varias fichas a la vez (un run). */
  keepCurrent: (kind: ImageCandidateKind, entityIds: number[]) =>
    request<{ runId: number; kind: ImageCandidateKind; entities: number; candidates: number }>(
      `/curation/images/${kind}/keep-current`, { method: "POST", authenticated: true, body: { entityIds } }),
};

// Informes de fiabilidad: la API exige rol de administrador, también en lectura.
export const entityVerificationApi = {
  budget:()=>request<{id:string;maxUsd:number;chargedUsd:number;calls:number;tokens:number;unknownCalls:number}|null>("/entity-verification/budget"),
  versions: (kind:import("../../../src/verification/types").VerificationKind,id:number,beforeId?:number) => request<import("../../../src/verification/types").VerificationHistory>(`/entity-verification/${kind}/${id}/versions`,{query:{beforeId}}),
  version: (kind:import("../../../src/verification/types").VerificationKind,id:number,versionId:number) => request<import("../../../src/verification/types").VerificationReport>(`/entity-verification/${kind}/${id}/versions/${versionId}`),
  reprocess: (kind:import("../../../src/verification/types").VerificationKind,id:number,versionId:number) => request<import("../../../src/verification/types").VerificationJob>(`/entity-verification/${kind}/${id}/versions/${versionId}/reprocess`,{method:"POST",authenticated:true}),
  originalUrl: (captureId:number) => buildUrl(`/entity-verification/captures/${captureId}/original`),
  latest: (kind: import("../../../src/verification/types").VerificationKind, id: number) =>
    request<import("../../../src/verification/types").VerificationJob | null>(`/entity-verification/${kind}/${id}/latest-job`),
  get: (kind: import("../../../src/verification/types").VerificationKind, id: number) =>
    request<import("../../../src/verification/types").VerificationReport>(`/entity-verification/${kind}/${id}`),
  active: (kind: import("../../../src/verification/types").VerificationKind, id: number) =>
    request<import("../../../src/verification/types").VerificationJob | null>(`/entity-verification/${kind}/${id}/active-job`),
  start: (kind: import("../../../src/verification/types").VerificationKind, id: number) =>
    request<import("../../../src/verification/types").VerificationJob>(`/entity-verification/${kind}/${id}/jobs`, { method: "POST", authenticated: true }),
  job: (id: number) => request<import("../../../src/verification/types").VerificationJob>(`/entity-verification/jobs/${id}`),
  control: (id:number,action:"pause"|"resume"|"cancel",budget?:{maxCalls?:number;maxTokens?:number}) =>
    request<import("../../../src/verification/types").VerificationJob>(`/entity-verification/jobs/${id}/control`, {method:"POST",authenticated:true,body:{action,...(budget?{budget}:{})}}),
};

function comparisonQuery(left:import("../../../src/verification/comparison-types").EntityRef,right:import("../../../src/verification/comparison-types").EntityRef) {
 return {leftKind:left.kind,leftId:left.id,rightKind:right.kind,rightId:right.id};
}
export const entityComparisonApi = {
 get:(left:import("../../../src/verification/comparison-types").EntityRef,right:import("../../../src/verification/comparison-types").EntityRef)=>request<import("../../../src/verification/comparison-types").ComparisonReport>("/entity-verification/compare",{query:comparisonQuery(left,right)}),
 active:(left:import("../../../src/verification/comparison-types").EntityRef,right:import("../../../src/verification/comparison-types").EntityRef)=>request<import("../../../src/verification/comparison-types").ComparisonJob|null>("/entity-verification/compare/active-job",{query:comparisonQuery(left,right)}),
 start:(left:import("../../../src/verification/comparison-types").EntityRef,right:import("../../../src/verification/comparison-types").EntityRef)=>request<import("../../../src/verification/comparison-types").ComparisonJob>("/entity-verification/compare/jobs",{method:"POST",authenticated:true,body:{left,right}}),
 job:(id:number)=>request<import("../../../src/verification/comparison-types").ComparisonJob>(`/entity-verification/compare/jobs/${id}`),
 history:(ref:import("../../../src/verification/comparison-types").EntityRef)=>request<import("../../../src/verification/comparison-store").ComparisonHistoryItem[]>(`/entity-verification/compare/history/${ref.kind}/${ref.id}`),
};

export const discoveryApi = {
  event: (body: { id: string; client: string; kind: "impression" | "acceptance" | "search" | "visit"; token: string; visibleMs?: number }) =>
    request<{ status: string; receipt?: string }>("/discovery/metrics/events", { method: "POST", body }),
  suggestions: (signal: AbortSignal, date?: string) => request<import("./discovery").DiscoveryResponse>("/discovery/search-suggestions", { signal, query: { date } }),
};

// Enlaces editables: incluye perfiles pendientes; solo los administradores los consultan.
export interface EditablePlatformLink { platform: string; url: string; handle: string | null; verified: boolean; }
export const catalogLinksApi = {
  list: (kind: "artist" | "album", id: number, category: "social" | "streaming") =>
    request<EditablePlatformLink[]>(`/catalog-links/${kind}/${id}/${category}`),
  save: (kind: "artist" | "album", id: number, category: "social" | "streaming", link: EditablePlatformLink, note: string) =>
    request<{ runId: number }>(`/catalog-links/${kind}/${id}/${category}/${link.platform}`, { method: "PATCH", authenticated: true, body: { url: link.url, handle: link.handle, verified: link.verified, note } }),
  remove: (kind: "artist" | "album", id: number, category: "social" | "streaming", platform: string, note: string) =>
    request<{ runId: number }>(`/catalog-links/${kind}/${id}/${category}/${platform}`, { method: "DELETE", authenticated: true, query: { note } }),
};

export interface CatalogModelData {
  identities: Record<string, unknown>[]; editions: Record<string, unknown>[];
  works: Record<string, unknown>[]; supports: Record<string, unknown>[]; genres: Record<string, unknown>[];
}
export const catalogModelApi = {
  get: (kind: "artist" | "person" | "album" | "track", id: number) => request<CatalogModelData>(`/catalog-model/${kind}/${id}`),
  write: (kind: string, body: object, id?: number) => request<{ id: number; runId: number }>(`/catalog-model/${kind}${id === undefined ? "" : `/${id}`}`, { method: id === undefined ? "POST" : "PATCH", authenticated: true, body }),
  remove: (kind: string, id: number, note: string) => request<{runId:number}>(`/catalog-model/${kind}/${id}`, { method: "DELETE", authenticated: true, query: { note } }),
};

/** La elección del administrador se comparte con todos los visitantes. */
export const siteAppearanceApi = {
  get: (signal?: AbortSignal) => request<SiteAppearance>("/site-appearance", signal ? { signal } : {}),
  update: (catalogTheme: CatalogTheme) => request<SiteAppearance>("/site-appearance", { method: "PATCH", authenticated: true, body: { catalogTheme } }),
};

export const catalogEditorApi = {
 vocabulary: ()=>request<{albumTypes:string[];classifications:string[]}>("/catalog-editor/vocabulary"),
 entity: (kind: string, id: number) => request<{values: Record<string, unknown>; vocabulary: {albumTypes: string[]; classifications: string[]}}>(`/catalog-editor/entity/${kind}/${id}`),
 list: (owner: "album"|"artist", id: number, resource: string) => request<Record<string, unknown>[]>(`/catalog-editor/${owner}/${id}/${resource}`),
 save: (owner: "album"|"artist", ownerId: number, resource: string, body: Record<string, unknown>, id?: number) => request<{id:number;runId:number}>(`/catalog-editor/${owner}/${ownerId}/${resource}${id===undefined?"":`/${id}`}`, {method:id===undefined?"POST":"PATCH",authenticated:true,body}),
 remove: (owner: "album"|"artist", ownerId: number, resource: string, id: number, note: string) => request<{id:number;runId:number}>(`/catalog-editor/${owner}/${ownerId}/${resource}/${id}`, {method:"DELETE",authenticated:true,query:{note}}),
};

/** Series: la serie, sus entregas y la pertenencia de un disco. Cada escritura es un run que se puede deshacer. */
export const seriesEditorApi = {
  list: (query: { q?: string; status?: "all" | "public" | "hidden"; limit?: number; offset?: number } = {}) =>
    request<{ data: SeriesEditorSummary[]; pagination: { total: number; limit: number; offset: number } }>("/catalog-editor/series", { query }),
  get: (id: number) => request<SeriesEditorDetail>(`/catalog-editor/series/${id}`),
  forAlbum: (albumId: number) => request<AlbumSeriesMembership[]>(`/catalog-editor/album/${albumId}/series`),
  save: (body: Record<string, unknown>, id?: number) =>
    request<{ id: number; runId: number }>(`/catalog-editor/series${id === undefined ? "" : `/${id}`}`, { method: id === undefined ? "POST" : "PATCH", authenticated: true, body }),
  remove: (id: number, note: string) => request<{ id: number; runId: number }>(`/catalog-editor/series/${id}`, { method: "DELETE", authenticated: true, query: { note } }),
  saveEntry: (seriesId: number, body: Record<string, unknown>, entryId?: number) =>
    request<{ id: number; runId: number }>(`/catalog-editor/series/${seriesId}/entries${entryId === undefined ? "" : `/${entryId}`}`,
      { method: entryId === undefined ? "POST" : "PATCH", authenticated: true, body }),
  removeEntry: (seriesId: number, entryId: number, note: string) =>
    request<{ id: number; runId: number }>(`/catalog-editor/series/${seriesId}/entries/${entryId}`, { method: "DELETE", authenticated: true, query: { note } }),
};

/** Bandeja visual: el servidor recibe únicamente los aportes seleccionados y su versión. */
export const claimReviewApi = {
  groups: (query: { limit: number;offset: number;bucket: string;q: string;kind: string },signal?: AbortSignal) =>
    request<{ data: import("../../../src/shared/claim-review").ClaimReviewGroup[];pagination: { total: number;limit: number;offset: number };claims: number }>("/claims/review/groups",{ query,...(signal ? { signal } : {}) }),
  group: (id: number,query: { limit: number;offset: number;bucket: string },signal?: AbortSignal) =>
    request<import("../../../src/shared/claim-review").ClaimReviewDetail>(`/claims/review/groups/${id}`,{ query,...(signal ? { signal } : {}) }),
  decide: (body: { groupId: number;claims: Array<{ id: number;version: string }>;action: "accept" | "reject";note: string }) =>
    request<import("../../../src/shared/claim-review").ClaimReviewResult>("/claims/review/decide",{ method: "POST",authenticated: true,body }),
};

export const artistGalleryApi = {
  upload: (file: File, signal: AbortSignal) => request<import("../../../src/shared/image-upload").UploadedImage>("/media/gallery-uploads", {
    method: "POST", authenticated: true, binaryBody: file, signal,
  }),
  add: (artistId: number, photos: import("../../../src/shared/artist-gallery").GalleryPhotoInput[], note: string) =>
    request<{ runId: number; ids: number[] }>(`/artists/${artistId}/gallery`, { method: "POST", authenticated: true, body: { photos, note } }),
  update: (artistId: number, photoId: number, photo: import("../../../src/shared/artist-gallery").GalleryPhotoInput, note: string) =>
    request<{ runId: number }>(`/artists/${artistId}/gallery/${photoId}`, { method: "PATCH", authenticated: true, body: { ...photo, note } }),
  remove: (artistId: number, photoId: number, note: string) =>
    request<{ runId: number }>(`/artists/${artistId}/gallery/${photoId}?note=${encodeURIComponent(note)}`, { method: "DELETE", authenticated: true }),
};
export const artistDocumentsApi = {
 reclassify:(artistId:number,ids:number[],category:import('../../../src/shared/artist-documents').DocumentCategory,note:string)=>request<{runId:number;updated:number}>(`/artists/${artistId}/documents`,{method:'PATCH',authenticated:true,body:{ids,category,note}}),
};
