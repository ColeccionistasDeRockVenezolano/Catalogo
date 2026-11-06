BEGIN;
-- Campañas propias y atribución diaria. Ninguna tabla conserva IP, UA ni URL completa.
CREATE TABLE auth.traffic_links (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES auth.projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 80),
  medium TEXT NOT NULL DEFAULT '' CHECK (length(medium) <= 80),
  campaign TEXT NOT NULL DEFAULT '' CHECK (length(campaign) <= 80),
  content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 80),
  destination TEXT NOT NULL DEFAULT '/' CHECK (destination IN ('/', '/colaborar')),
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
CREATE TABLE auth.traffic_acquisition_daily (
  project_id INTEGER NOT NULL REFERENCES auth.projects(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  bucket TEXT NOT NULL,
  dimensions JSONB NOT NULL,
  visitors INTEGER NOT NULL DEFAULT 0 CHECK (visitors >= 0),
  js_visitors INTEGER NOT NULL DEFAULT 0 CHECK (js_visitors >= 0),
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  pages INTEGER NOT NULL DEFAULT 0 CHECK (pages >= 0),
  collaborate INTEGER NOT NULL DEFAULT 0 CHECK (collaborate >= 0),
  radio INTEGER NOT NULL DEFAULT 0 CHECK (radio >= 0),
  applications INTEGER NOT NULL DEFAULT 0 CHECK (applications >= 0),
  PRIMARY KEY (project_id, day, bucket)
);
CREATE TABLE auth.traffic_acquisition_visitors (
  project_id INTEGER NOT NULL REFERENCES auth.projects(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  actor TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  first_at TIMESTAMPTZ NOT NULL,
  last_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, day, visitor, actor)
);
CREATE TABLE auth.traffic_acquisition_receipts (
  project_id INTEGER NOT NULL REFERENCES auth.projects(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  actor TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (project_id, day, visitor, actor, event_id)
);
COMMENT ON TABLE auth.traffic_acquisition_daily IS 'Agregados de 400 días; visitantes son huellas por día y tipo, no personas identificadas.';
COMMENT ON TABLE auth.traffic_acquisition_visitors IS 'Primera procedencia del día; HMAC diario, retención de 3 días.';
COMMIT;
