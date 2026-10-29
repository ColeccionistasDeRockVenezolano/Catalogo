// CRV · Configuración de entorno validada con Zod (ARCHITECTURE.md §6).
// Único punto de lectura de process.env: nada más en el código debe leer
// process.env directamente, para que la validación sea real y centralizada.
import { z } from "zod";
import { config as loadDotenv } from "dotenv";

loadDotenv();

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
  // Base SQLite de herra (coleccionistasderockvenezolano.com). Si está, sus
  // cuentas también inician sesión en el CRV; se abre en solo lectura.
  CRV_HERRA_DB_PATH: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  CRV_HERRA_PROJECT_SLUG: z.string().min(1).default("coleccionistas-rock-venezolano"),
  CRV_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  CRV_SESSION_COOKIE_PATH: z.string().regex(/^\/[A-Za-z0-9/_-]*$/u).default("/"),
  // Chat de la comunidad (docs/CHAT.md). El secreto firma la sesión de los
  // invitados; el valor por defecto solo vale en desarrollo y el servidor
  // avisa al arrancar si sigue puesto.
  CRV_CHAT_SECRET: z.string().min(32).default("crv-chat-dev-secret-cambiar-en-produccion"),
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
