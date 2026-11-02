// CRV · Configuración de entorno validada con Zod (ARCHITECTURE.md §6).
// Único punto de lectura de process.env: nada más en el código debe leer
// process.env directamente, para que la validación sea real y centralizada.
import { z } from "zod";
import { config as loadDotenv } from "dotenv";

// CRV_ENV_FILE permite que una instancia (staging, pruebas) lea SU archivo de
// entorno en vez del `.env` del repositorio. Sin la variable se conserva el
// comportamiento histórico: dotenv busca `.env` en el cwd.
const envFile = process.env["CRV_ENV_FILE"];
loadDotenv(envFile ? { path: envFile } : {});

const envSchema = z.object({
  CRV_LAYA_PYTHON: z.string().min(1).default("/home/brian/.venvs/laya/bin/python"),
  CRV_RECOMMENDATIONS_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  CRV_RECOMMENDATION_PROVIDER: z.enum(["disabled", "laya", "jev"]).default("disabled"),
  CRV_RECOMMENDATION_BASE_URL: z.string().url().default("http://127.0.0.1:8000/"),
  CRV_RECOMMENDATION_MODEL: z.string().min(1).default("multilingual"),
  CRV_RECOMMENDATION_API_KEY: z.string().min(1).optional(),
  CRV_RECOMMENDATION_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.8),
  CRV_RECOMMENDATION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(10000),
  CRV_DISCOVERY_METRICS_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  CRV_DISCOVERY_METRICS_SECRET: z.string().min(32).optional(),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL es obligatorio (postgresql://usuario:pass@host:puerto/db)"),

  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("127.0.0.1"),
  // El bearer histórico queda disponible solo para scripts internos. La web
  // usa cuentas scrypt y sesiones HttpOnly configuradas en el JSON siguiente.
  CRV_OPERATOR_TOKEN: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(24, "CRV_OPERATOR_TOKEN debe tener al menos 24 caracteres").optional(),
  ),
  // Nombre por defecto con que se firman las decisiones cuando la petición no
  // trae la cabecera X-CRV-Operator.
  CRV_OPERATOR_NAME: z.string().trim().min(1).max(80).default("operador"),
  CRV_COLLABORATORS_JSON: z.string().optional(),
  CRV_AUTH_BACKEND: z.enum(["legacy", "postgres"]).default("postgres"),
  // Solo para rollback con CRV_AUTH_BACKEND=legacy. El modo postgres usa
  // auth en DATABASE_URL y no consulta SQLite ni cuentas del entorno.
  CRV_HERRA_DB_PATH: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  CRV_HERRA_PROJECT_SLUG: z.string().min(1).default("coleccionistas-rock-venezolano"),
  CRV_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  CRV_SESSION_COOKIE_PATH: z.string().regex(/^\/[A-Za-z0-9/_-]*$/u).default("/"),
  // Chat de la comunidad (docs/CHAT.md). El secreto firma la sesión de los
  // invitados; el valor por defecto solo vale en desarrollo y el servidor
  // avisa al arrancar si sigue puesto.
  CRV_CHAT_SECRET: z.string().min(32).default("crv-chat-dev-secret-cambiar-en-produccion"),
  // Secreto para la huella diaria del contador de visitas. Si falta, se usa el
  // del chat; en producción conviene darle uno propio.
  CRV_VISITS_SECRET: z.string().min(32).optional(),
  // Interruptores de la Fase 2A.1. Producción arranca con la comunidad y la
  // radio nuevas apagadas; staging los enciende en su propio env. Sin ellos,
  // las rutas no se registran (404), aunque el código esté desplegado.
  CRV_COMMUNITY_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  CRV_RADIO_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  // Ventana 3.7 · Métricas (C7). La escritura en `traffic_daily` y
  // `traffic_visitors` va detrás de este interruptor, APAGADO por defecto: hasta
  // que la Fase 2B cambie el dueño de las tablas, producción no debe competir
  // con Herra por el mismo agregado (R5). Encendido solo en staging.
  CRV_TRAFFIC_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  // Token del aviso interno del gateway (`POST /traffic/page`). Sin él la ruta
  // no se registra: el aviso es entre procesos de la misma máquina.
  CRV_TRAFFIC_TOKEN: z.string().optional(),
  // Verificación por DNS inverso de los agentes que la documentan. Apagada por
  // defecto; las listas de IPs se cargan igual, una vez al día.
  CRV_TRAFFIC_VERIFY_NETWORK: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  // Carpeta de las listas de IPs (por defecto ~/.cache/crv-traffic).
  CRV_TRAFFIC_LISTS_DIR: z.string().optional(),
  // Radio en sombra: catálogo exportado por Herra durante la transición y URL
  // del `/api/radio/now` vivo para comparar. Ninguno se usa para emitir al
  // público todavía.
  CRV_RADIO_DATA_DIR: z.string().optional(),
  CRV_RADIO_LIVE_URL: z.string().url().optional(),
  // Dueña de la emisión: barre la disponibilidad y guarda exclusiones y respaldo de
  // géneros en su carpeta. Un solo proceso a la vez y nunca sobre los datos de Herra.
  CRV_RADIO_OWNER: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  CRV_RADIO_STATE_DIR: z.string().optional(),
  // Diagnósticos de escucha (radio-diagnostics.jsonl).
  CRV_RADIO_LOG_DIR: z.string().optional(),
  CRV_RADIO_SHEET_CREDENTIALS: z.string().optional(),
  CRV_RADIO_TEST_SHEET_ID: z.string().optional(),
  // Proceso propio del chat (src/chat/server.ts): no comparte event loop con
  // las consultas del catálogo.
  CHAT_PORT: z.coerce.number().int().positive().default(8081),
  // Mensajes por ventana de 10 s y por actor, sumando todas sus conexiones
  // (0 desactiva el límite). Los demás topes viven en src/chat/guard.ts.
  CRV_CHAT_RATE_LIMIT: z.coerce.number().int().nonnegative().default(8),
  // Entorno del proceso. En `production` el chat se niega a arrancar con el
  // secreto de desarrollo (docs/CHAT.md §«Seguridad y moderación»).
  // Texto libre a propósito: un valor inesperado no puede tumbar la API.
  NODE_ENV: z.string().default("development"),
  // Fase 2B: distingue las instancias de producción de los ensayos. `legacy`
  // mantiene el comportamiento histórico (catálogo y staging); `production`
  // activa la guarda de src/config/deployment.ts y `rehearsal` la admite de
  // forma explícita para probar contra crv_staging.
  CRV_DEPLOYMENT: z.enum(["legacy", "production", "rehearsal"]).default("legacy"),
  // Vida del token de invitado; se renueva en cada POST /chat/session.
  CRV_CHAT_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  // Bits a cero de la prueba de trabajo para crear un invitado (0 la apaga).
  // 16 bits ≈ 65.000 hashes: menos de un segundo en un móvil, caro en masa.
  CRV_CHAT_POW_BITS: z.coerce.number().int().min(0).max(24).default(16),
  // Invitados nuevos por IP cada 10 minutos (0 desactiva el límite).
  CRV_CHAT_SESSIONS_PER_IP: z.coerce.number().int().nonnegative().default(5),
  // Minutos durante los que una cuenta nueva no envía enlaces y va más lenta.
  CRV_CHAT_NEW_ACCOUNT_MINUTES: z.coerce.number().int().nonnegative().max(1440).default(10),
  // Clasificación de odio y amenazas con Laya local (CRV_LAYA_PYTHON).
  CRV_CHAT_AI_MODERATION: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  // Monedas de bienvenida al crear un actor invitado.
  CRV_CHAT_MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  CRV_CHAT_GUEST_COINS: z.coerce.number().int().nonnegative().max(10_000).default(150),
  CRV_ALLOWED_ORIGINS: z.string().default("http://127.0.0.1:5173,http://localhost:5173"),
  // IP real detrás de Cloudflare. `CF-Connecting-IP` solo se acepta cuando la
  // petición llega del túnel local (peer en loopback, ver `clientIp`) y la
  // instancia está de verdad detrás del borde de Cloudflare, que sobrescribe
  // esa cabecera. Detrás del Funnel de Tailscale no existe: se usa el último
  // `X-Forwarded-For`. Encendido solo en la instancia que corresponda.
  CRV_TRUST_CF_HEADERS: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  // Ráfaga de escrituras por cuenta (auditoría 2026-09-17, hallazgo #10):
  // escrituras autenticadas por minuto antes de responder 429. Generoso para
  // un operador (los lotes de Curaduría aplican hasta CRV_CURATION_FIX_BATCH_MAX
  // ítems por llamada y el resto sigue con otra llamada) y estrecho para un
  // bucle descontrolado. 0 desactiva el límite.
  CRV_WRITE_RATE_LIMIT: z.coerce.number().int().nonnegative().default(240),
  // Lecturas públicas anónimas por IP y minuto (endurecimiento anti-scraping
  // 2026-10-13): el catálogo abierto se puede recorrer, pero no vaciar a
  // velocidad de script. 0 desactiva el límite. No se aplica al tráfico local
  // (scripts, campañas, tests) ni a quien tiene sesión.
  CRV_READ_RATE_LIMIT: z.coerce.number().int().nonnegative().default(600),

  // Detector de conflictos de Curaduría (src/curation/). Cada escritura de
  // la API dispara un análisis que verifica si la corrección abrió errores
  // nuevos; el vigilante compara cada tanto los contadores del catálogo para
  // cubrir cambios hechos fuera de la API. 0 apaga el vigilante.
  // Interruptor general del trabajo de fondo de esta instancia. La API de la
  // portada (crv-api-landing) lo apaga: comparte base con el catálogo y no debe
  // lanzar el vigilante de Curaduría, la retención ER, la verificación de bots
  // ni los refrescos de YouTube por duplicado. Sin definir, se mantiene el
  // comportamiento de siempre (encendido).
  CRV_BACKGROUND_JOBS: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  CRV_CURATION_AUTOSCAN: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  CRV_CURATION_WATCH_MS: z.coerce.number().int().nonnegative().default(60_000),
  // Lotes de correcciones de Curaduría (PLAN_CURADURIA E4): cuántos ítems
  // aplica o deshace una llamada (el resto sigue con otra llamada explícita) y
  // cuántos hallazgos entran como máximo en la vista previa de un lote.
  CRV_CURATION_FIX_BATCH_MAX: z.coerce.number().int().positive().max(5000).default(500),
  CRV_CURATION_FIX_PREVIEW_MAX: z.coerce.number().int().positive().max(50_000).default(5000),
  // Análisis incremental (PLAN_CURADURIA E9, A9): una escritura del catálogo ya
  // no dispara un análisis completo. Verifica al instante las fichas que tocó
  // (detectores locales, análisis dirigido) y deja el completo —duplicados,
  // cola y «Otros»— para cuando las escrituras paren `IDLE_MS`, o como muy
  // tarde `MAX_WAIT_MS` después de la primera escritura sin analizar.
  CRV_CURATION_FULL_SCAN_IDLE_MS: z.coerce.number().int().nonnegative().default(30_000),
  CRV_CURATION_FULL_SCAN_MAX_WAIT_MS: z.coerce.number().int().nonnegative().default(600_000),
  // Autocorrección segura (PLAN_CURADURIA E10): escribe en el core sin que
  // nadie lo pida, así que llega apagada. Aun encendida, solo aplica acciones
  // de nivel 0 de las reglas que un administrador haya encendido
  // (`ingest.curation_autofix_rules`), con tope por análisis y por día.
  CRV_CURATION_AUTOFIX: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  /** Detector global de duplicados de artista por evidencia (etapa 1: solo lectura). */
  CRV_CURATION_DUPLICATE_DETECTOR: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  /** Incluye fragmentos citables del almacén local (RHV, RYM, Hippito, etc.). */
  CRV_CURATION_LOCAL_EVIDENCE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  /** Acción «verificar identidad con IA» en la bandeja de Curaduría (llamada bajo demanda). */
  CRV_CURATION_AI_VERDICTS: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  CRV_CURATION_AUTOFIX_MAX_PER_SCAN: z.coerce.number().int().nonnegative().max(5000).default(50),
  CRV_CURATION_AUTOFIX_MAX_PER_DAY: z.coerce.number().int().nonnegative().max(50_000).default(200),

  // Géneros (PLAN_GENEROS §4): encendido, `albums.genre` deja de escribirlo el
  // motor de fusión y pasa a ser la proyección de `ingest.album_genres` (único
  // escritor). Llega apagado: se enciende tras el backfill de géneros.
  GENRES_PROJECTION_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),

  // Géneros, fuentes externas (PLAN_GENEROS etapa 4). Apagado, ninguna
  // importación sale a la red y el catálogo funciona igual; además cada fuente
  // necesita su ficha autorizada en `ingest.genre_external_sources`.
  GENRES_EXTERNAL_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Contacto obligatorio en el User-Agent de las APIs que lo exigen
  // (MusicBrainz pide identificarse con una forma de contacto).
  GENRES_EXTERNAL_CONTACT: z.string().optional(),
  GENRES_EXTERNAL_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(30),
  GENRES_EXTERNAL_MAX_ENTITIES: z.coerce.number().int().positive().max(5000).default(200),
  GENRES_EXTERNAL_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
  GENRES_EXTERNAL_AMBIGUOUS_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
  GENRES_EXTERNAL_MATCH_MARGIN: z.coerce.number().min(0).max(1).default(0.08),
  // Token personal de la API de Discogs. Va en la cabecera `Authorization`,
  // nunca en la URL (la caché guarda la URL de cada respuesta).
  DISCOGS_TOKEN: z.string().optional(),

  CRV_DISCOVERY_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  CRV_DISCOVERY_INTERVAL_MS: z.coerce.number().int().min(3000).max(60000).default(5000),
  // Orden de turnos; repetir un grupo le da más turnos, sin omitir los otros.
  CRV_DISCOVERY_GROUP_POLICY: z.string().default("historicos,alternativo,contemporaneos,experimental"),

  DATA_DIR: z.string().default("./data"),

  CRAWL_USER_AGENT: z.string().default("CRV-bot/0.1"),
  CRAWL_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  CRAWL_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  CRAWL_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  CRAWL_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // Opcionales: el sistema debe funcionar sin ellas (CONTRACT §6/§12, ARCH §4.11).
  YOUTUBE_API_KEY: z.string().optional(),
  // Presupuesto diario de la clave (YouTube concede 10.000 unidades). El
  // enriquecimiento dirigido no gasta si lo consumido hoy no deja margen.
  YOUTUBE_DAILY_QUOTA_UNITS: z.coerce.number().int().positive().default(10_000),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL_FAST: z.string().min(1).default("deepseek-flash"),
  DEEPSEEK_MODEL_REASONING: z.string().min(1).default("deepseek-v4-pro"),
  DEEPSEEK_MODEL_VISION: z.string().min(1).default("deepseek-flash"),
  DEEPSEEK_MAX_TOKENS_PER_RUN: z.coerce.number().int().positive().default(4000),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // V4.1 Flash se invoca como deepseek-flash en la API oficial. Sin fallback.
  CRV_AI_CURATION_MODEL: z.string().min(1).default("deepseek-flash"),
  CRV_AI_CURATION_MAX_TOKENS: z.coerce.number().int().min(1000).max(12000).default(6000),
  CRV_AI_CURATION_MAX_CALLS: z.coerce.number().int().min(1).max(3).default(2),
  CRV_AI_CURATION_CONTEXT_CHARS: z.coerce.number().int().min(8000).max(80000).default(40000),
  // Alta asistida de videos del canal (espacio «Videos de YouTube»): cuántos
  // videos prepara cada pasada y si las altas seguras se aplican sin esperar a
  // que una persona acepte cambio por cambio.
  CRV_YT_INTAKE_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  CRV_YT_INTAKE_AUTO: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  CRV_YT_INTAKE_MAX: z.coerce.number().int().min(1).max(20).default(4),
  CRV_YT_INTAKE_ENRICH: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  // Un video nuevo que la portada ve en el canal lanza en el acto vigilante →
  // alta con IA → radio (unidad transitoria crv-youtube-nuevo), sin esperar al timer.
  CRV_YT_NEW_TRIGGER: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Discos del canal a los que cada pasada completa tipo y géneros (fuentes → IA → herencia).
  CRV_YT_COMPLETE_MAX: z.coerce.number().int().min(1).max(50).default(6),
  // Perfiles por API en la petición general de un artista: la discografía la
  // compara el código (MusicBrainz, Discogs, Deezer/iTunes) y el modelo no la lee.
  CRV_SOURCE_PROFILES_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Buscador privado para verificar identidades; vacío = solo fuentes ya conocidas.
  CRV_SEARXNG_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  CRV_RESEARCH_DOCUMENT_MAX_BYTES: z.coerce.number().int().positive().default(25000000),
  CRV_RESEARCH_DOCUMENT_MAX_PAGES: z.coerce.number().int().positive().default(100),
  CRV_RESEARCH_DOCUMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  CRV_RESEARCH_MIN_FREE_MB: z.coerce.number().int().nonnegative().default(256),
  CRV_RESEARCH_RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  CRV_RESEARCH_RENDER_ENABLED: z.enum(["true","false"]).default("true").transform(value=>value==="true"),
  CRV_RESEARCH_OCR_LANGUAGES: z.string().regex(/^[a-z]{3}(?:\+[a-z]{3})*$/u).default("spa+eng"),
  CRV_RESEARCH_OCR_LANG_PATH: z.string().optional(),
  CRV_RESEARCH_PDF_TEXT_COMMAND: z.string().min(1).default("pdftotext"),
  CRV_RESEARCH_PDF_RENDER_COMMAND: z.string().min(1).default("pdftoppm"),
  CRV_RESEARCH_PDF_INFO_COMMAND: z.string().min(1).default("pdfinfo"),
  CRV_RESEARCH_PDF_IMAGES_COMMAND: z.string().min(1).default("pdfimages"),
  CRV_RESEARCH_PDF_RASTER_SIZE: z.coerce.number().int().min(1000).max(8000).default(3200),
  CRV_RESEARCH_MAX_CALLS: z.coerce.number().int().positive().default(200),
  CRV_AI_BUDGET_ID: z.string().min(1).max(100).optional(),
  CRV_RESEARCH_MAX_TOKENS: z.coerce.number().int().positive().default(1000000),
  CRV_RESEARCH_LEASE_SECONDS: z.coerce.number().int().min(30).default(180),
  CRV_WEB_SEARCH_CACHE_DAYS: z.coerce.number().int().positive().default(30),
  CRV_WEB_PAGE_CACHE_DAYS: z.coerce.number().int().positive().default(30),

  ER_AUTO_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
  ER_POSSIBLE_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
  ER_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  ER_NO_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0),
  ER_MINIMUM_MARGIN: z.coerce.number().min(0).max(1).default(0.08),

  // Retención de decisiones de resolución (src/er/retention.ts): días de
  // dossier completo de candidatas que se conservan antes de compactar, tope
  // de filas por barrido de la API y cada cuánto barre. La decisión nunca se
  // borra; `0` días compacta todo lo que ya no esté en la ventana.
  ER_DECISION_FULL_DAYS: z.coerce.number().int().nonnegative().default(3),
  ER_RETENTION_MAX_ROWS: z.coerce.number().int().nonnegative().default(20_000),
  ER_RETENTION_INTERVAL_HOURS: z.coerce.number().positive().default(12),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
}).superRefine((value, ctx) => {
  if (value.CRV_RADIO_OWNER && !value.CRV_RADIO_STATE_DIR) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CRV_RADIO_STATE_DIR"], message: "CRV_RADIO_OWNER exige una carpeta de estado propia." });
  }
  if (value.CRV_RADIO_OWNER && value.CRV_RADIO_STATE_DIR && value.CRV_RADIO_STATE_DIR === value.CRV_RADIO_DATA_DIR) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CRV_RADIO_STATE_DIR"], message: "El estado de la radio no puede escribirse sobre el catálogo que exporta Herra." });
  }
  if (value.CRV_DISCOVERY_METRICS_ENABLED && !value.CRV_DISCOVERY_METRICS_SECRET) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CRV_DISCOVERY_METRICS_SECRET"], message: "Las métricas requieren un secreto independiente de al menos 32 caracteres" });
  }
  if (!(value.ER_AUTO_MATCH_THRESHOLD > value.ER_POSSIBLE_MATCH_THRESHOLD
    && value.ER_POSSIBLE_MATCH_THRESHOLD > value.ER_REVIEW_THRESHOLD
    && value.ER_REVIEW_THRESHOLD > value.ER_NO_MATCH_THRESHOLD)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ER_AUTO_MATCH_THRESHOLD"],
      message: "thresholds ER invalidos: AUTO_MATCH > POSSIBLE_MATCH > REVIEW > NO_MATCH",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Valida y devuelve el entorno (memoizado). Lanza con un mensaje legible si falta algo. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuración de entorno inválida:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Solo para tests: permite forzar un entorno distinto entre casos. */
export function resetEnvCache(): void {
  cached = undefined;
}
