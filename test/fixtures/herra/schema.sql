-- Esquema de Herra — SQLite, multi-proyecto.
-- Idempotente: CREATE TABLE IF NOT EXISTS. Las restricciones de unicidad
-- van como índices (no como constraints de tabla) para que las migraciones
-- de bases antiguas puedan añadirlas sin reconstruir.

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL COLLATE NOCASE,
  name        TEXT NOT NULL,
  theme_json  TEXT,
  -- Configuración del formulario público de colaboración: textos propios y
  -- qué campos se piden. NULL = todo por defecto (ver collaborate-form.ts).
  collaborate_json TEXT,
  -- Identidad pública: metadatos de la página, tarjeta al compartir el enlace,
  -- redes sociales y donación. NULL = valores por defecto (ver branding.ts).
  branding_json TEXT,
  i18n_json TEXT,
  visibility_mode TEXT NOT NULL DEFAULT 'hidden'
                  CHECK (visibility_mode IN ('hidden','progress','completed','full')),
  -- Idioma por defecto de las páginas del proyecto para quien llega sin haber
  -- elegido: 'es' o 'en' lo fijan, 'system' lo deja al navegador del visitante
  -- (y cae en inglés si su idioma no es ninguno de los dos). La elección
  -- explícita del visitante, que vive en la cookie, siempre manda sobre esto.
  default_lang    TEXT NOT NULL DEFAULT 'es'
                  CHECK (default_lang IN ('es','en','system')),
  -- La convocatoria pública es independiente de la visibilidad del roadmap:
  -- un proyecto con el roadmap oculto puede seguir recibiendo candidaturas.
  accepts_applications INTEGER NOT NULL DEFAULT 0,
  -- Enlaces «Entrar» del lado público. Apagado los esconde de la cabecera, la
  -- portada y el roadmap; /login sigue existiendo para quien conozca la URL,
  -- que es justo lo que necesita la administración para entrar.
  show_login  INTEGER NOT NULL DEFAULT 1,
  -- Contador público de visitas por país (ver project_visits).
  visitor_counter INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);

-- Imágenes de identidad del proyecto (favicon e imagen de la tarjeta al
-- compartir). Van dentro de la base para viajar en la copia de seguridad
-- cifrada y desaparecer con el proyecto, sin un directorio suelto que
-- sincronizar. Un único registro por proyecto y tipo.
CREATE TABLE IF NOT EXISTS project_assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('favicon','share_image')),
  mime_type   TEXT NOT NULL,
  bytes       BLOB NOT NULL,
  byte_size   INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  -- Prefijo del SHA-256 del binario: se añade a la URL pública para que el
  -- navegador descarte la versión anterior en cuanto se sustituye la imagen.
  checksum    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_assets_kind ON project_assets(project_id, kind);

-- Administradores. role='superadmin' gobierna toda la instancia y tiene
-- project_id NULL; role='admin' queda atado a un único proyecto.
CREATE TABLE IF NOT EXISTS admins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'admin'
              CHECK (role IN ('superadmin','admin')),
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mfa_secret_enc TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0 CHECK (mfa_enabled IN (0,1)),
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_username ON admins(username);
CREATE INDEX IF NOT EXISTS idx_admins_project ON admins(project_id);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  color_key   TEXT NOT NULL,
  -- Título en los demás idiomas: {"en":"..."} (ver content-i18n.ts). NULL = se
  -- sirve en español, que es el original.
  i18n_json   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_project_slug ON categories(project_id, slug);

-- Registro global de una persona, independiente del proyecto. Los datos de
-- contacto y la fecha de nacimiento son internos: nunca salen al perfil
-- público. La edad se calcula a partir de birth_date para que no envejezca mal.
CREATE TABLE IF NOT EXISTS people (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  last_name   TEXT,
  birth_date  TEXT,
  whatsapp_phone TEXT,
  email       TEXT,
  city        TEXT,
  country     TEXT,
  bio         TEXT,
  experience  TEXT,
  availability TEXT,
  contact_preference TEXT NOT NULL DEFAULT 'whatsapp'
              CHECK (contact_preference IN ('whatsapp','email','both')),
  profile_visibility TEXT NOT NULL DEFAULT 'private'
              CHECK (profile_visibility IN ('private','public')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Catálogo global de categorías de perfil. Deliberadamente separado de
-- `categories`, que son las etapas del roadmap de cada proyecto.
CREATE TABLE IF NOT EXISTS catalog_terms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL
              CHECK (type IN ('skill','contribution_area','link_type')),
  label       TEXT NOT NULL,
  slug        TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  archived_at TEXT,
  -- Etiqueta en los demás idiomas: {"en":"..."} (ver content-i18n.ts).
  i18n_json   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_terms_type_slug ON catalog_terms(type, slug);
CREATE INDEX IF NOT EXISTS idx_catalog_terms_type ON catalog_terms(type, archived_at);

CREATE TABLE IF NOT EXISTS person_catalog_terms (
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  term_id   INTEGER NOT NULL REFERENCES catalog_terms(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_person_catalog_terms_term ON person_catalog_terms(term_id);

-- Cada enlace decide por separado si puede mostrarse en el perfil público.
CREATE TABLE IF NOT EXISTS person_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  label       TEXT,
  url         TEXT NOT NULL,
  is_public   INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_person_links_person ON person_links(person_id, sort_order);

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL COLLATE NOCASE,
  first_name  TEXT,
  last_name   TEXT,
  access_code_hash TEXT,
  session_version INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'approved'
              CHECK (status IN ('pending','approved','rejected')),
  signup_source TEXT NOT NULL DEFAULT 'admin'
              CHECK (signup_source IN ('admin','self','application')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_project_name ON users(project_id, name);

-- Candidaturas públicas: todavía no son una cuenta ni una persona. Los datos
-- se copian a `people` solo cuando la administración acepta la solicitud.
CREATE TABLE IF NOT EXISTS applications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  first_name  TEXT NOT NULL,
  last_name   TEXT,
  birth_date  TEXT,
  whatsapp_phone TEXT,
  email       TEXT,
  city        TEXT,
  country     TEXT,
  contact_preference TEXT NOT NULL DEFAULT 'whatsapp'
              CHECK (contact_preference IN ('whatsapp','email','both')),
  experience  TEXT,
  contribution_text TEXT,
  idea        TEXT,
  idea_reason TEXT,
  wants_to_implement TEXT NOT NULL DEFAULT 'maybe'
              CHECK (wants_to_implement IN ('yes','maybe','share_only')),
  availability TEXT,
  status      TEXT NOT NULL DEFAULT 'new'
              CHECK (status IN ('new','reviewing','contact','accepted','rejected','archived')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  source_addr TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_project ON applications(project_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS application_catalog_terms (
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  term_id        INTEGER NOT NULL REFERENCES catalog_terms(id) ON DELETE CASCADE,
  PRIMARY KEY (application_id, term_id)
);

CREATE TABLE IF NOT EXISTS application_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  label       TEXT,
  url         TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_application_links_application ON application_links(application_id, sort_order);

-- Enlaces individuales de activación para candidaturas ya aceptadas: un solo
-- uso, atados a una colaboración concreta. Solo se guarda el hash del token.
CREATE TABLE IF NOT EXISTS activation_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  revoked_at  TEXT,
  created_by  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activation_tokens_user ON activation_tokens(user_id);

CREATE TABLE IF NOT EXISTS registration_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_by  TEXT NOT NULL,
  use_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_registration_tokens_project ON registration_tokens(project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  -- Título en los demás idiomas: {"en":"..."} (ver content-i18n.ts).
  i18n_json   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','in_progress','completed')),
  sort_order  INTEGER NOT NULL,
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  seed_key    TEXT,
  -- Momento en que la actividad pasó a 'completed'. Ordena la cola de
  -- finalizadas al pie de la etapa: la primera en terminarse va primero.
  -- NULL mientras no esté completada; se limpia si vuelve a abrirse.
  completed_at TEXT,
  -- 1 = un administrador la colocó a mano. Esa actividad conserva su posición
  -- exacta y deja de obedecer la regla automática hasta que se desancle.
  order_pinned INTEGER NOT NULL DEFAULT 0 CHECK (order_pinned IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_user ON tasks(assigned_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_seed ON tasks(project_id, seed_key);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);

-- Bitácora de acciones sensibles: no conserva cuerpos, claves, tokens ni
-- cabeceras. Permite investigar cambios administrativos y de usuarios.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('admin','user')),
  actor_id    INTEGER NOT NULL,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      INTEGER NOT NULL,
  source_addr TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred ON audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_type, actor_id, occurred_at DESC);

-- Contador público de visitas, por país y por proyecto.
--
-- Se guarda en dos piezas con vidas distintas, a propósito:
--
--   project_visits      es el registro fino y EFÍMERO. Una fila por visitante
--                       y día local del proyecto, con la que se resuelven «hoy»
--                       y «en línea». Se poda a los pocos días (ver
--                       visits.service.ts): no es un historial de navegación.
--   project_visit_stats es el acumulado PERMANENTE por país. Suma uno cada vez
--                       que nace una fila diaria nueva, así que el histórico
--                       sobrevive a la poda sin conservar nada de cada persona.
--
-- `visitor` es un HMAC de la IP con la sal de la instancia y el día: cambia
-- cada medianoche, así que no sirve para seguir a nadie de una fecha a otra ni
-- para recuperar la dirección de la que salió.
CREATE TABLE IF NOT EXISTS project_visits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Día local del proyecto (APP_TIME_ZONE) en formato YYYY-MM-DD, no UTC: el
  -- «hoy» que cuenta es el de quien administra el proyecto.
  day         TEXT NOT NULL,
  -- ISO 3166-1 alfa-2 en minúsculas. 'zz' cuando el proxy no informa el país.
  country     TEXT NOT NULL,
  visitor     TEXT NOT NULL,
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_visits_unique ON project_visits(project_id, day, visitor);
CREATE INDEX IF NOT EXISTS idx_project_visits_online ON project_visits(project_id, last_seen);
CREATE INDEX IF NOT EXISTS idx_project_visits_day ON project_visits(day);

CREATE TABLE IF NOT EXISTS project_visit_stats (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  country     TEXT NOT NULL,
  visits      INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, country)
);

-- Métricas de tráfico para administración: personas y bots por separado.
--
-- Mismo reparto que el contador, con las mismas garantías:
--
--   traffic_visitors  registro EFÍMERO de deduplicación: el HMAC diario de la
--                     IP y el «cubo» en el que ya se contó. Se poda a los tres
--                     días; no guarda país, página visitada en orden ni hora.
--   traffic_daily     agregado PERMANENTE por día, página, tipo de tráfico,
--                     agente, verificación y país. Nunca guarda una IP ni el
--                     User-Agent de una persona: los bots se guardan por la
--                     clave de su catálogo (traffic/agents.ts), no por su texto.
--
-- `page` es la pantalla pública ('roadmap', 'robots'…), '*' para el resumen de
-- todas ellas y 'js' para el aviso que manda el JavaScript de la portada: una
-- persona confirmada es un navegador coherente que además lo ejecutó.
-- `project_id` NULL es tráfico de la instancia (portada sin proyecto raíz).
CREATE TABLE IF NOT EXISTS traffic_daily (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,
  page         TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('human','suspicious','ai','search','bot')),
  agent        TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT 'none'
               CHECK (verification IN ('none','verified','unverified','spoofed')),
  country      TEXT NOT NULL DEFAULT 'zz',
  requests     INTEGER NOT NULL DEFAULT 0,
  visitors     INTEGER NOT NULL DEFAULT 0,
  last_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_traffic_daily_key
  ON traffic_daily(IFNULL(project_id, 0), day, page, category, agent, verification, country);
CREATE INDEX IF NOT EXISTS idx_traffic_daily_day ON traffic_daily(day);

CREATE TABLE IF NOT EXISTS traffic_visitors (
  project_key INTEGER NOT NULL,
  day         TEXT NOT NULL,
  visitor     TEXT NOT NULL,
  bucket      TEXT NOT NULL,
  PRIMARY KEY (project_key, day, visitor, bucket)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_traffic_visitors_day ON traffic_visitors(day);

-- Ajustes de la instancia que no cuelgan de un proyecto (p. ej. la política de
-- robots.txt). Clave y valor JSON; cada módulo valida lo suyo al leerlo.
CREATE TABLE IF NOT EXISTS instance_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Capacidades opcionales de cada proyecto (p. ej. la radio). Una fila por
-- proyecto y capacidad: su existencia con enabled = 1 es lo que la activa. La
-- configuración es JSON versionado por schema_version, que valida y migra el
-- módulo de la capacidad (src/features/): una instancia más nueva acepta la
-- configuración de una anterior y rechaza la de una posterior. Viaja con el
-- proyecto; sus secretos no, solo la declaración de cuáles necesita.
CREATE TABLE IF NOT EXISTS project_features (
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature        TEXT NOT NULL CHECK (feature GLOB '[a-z]*' AND length(feature) <= 40),
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  config_json    TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, feature)
);
