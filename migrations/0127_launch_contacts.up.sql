BEGIN;
-- Inscripciones del aviso de lanzamiento y cola durable hacia Google Sheets.
CREATE TABLE auth.launch_contacts (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  type TEXT NOT NULL CHECK (type IN ('Oyente', 'Músico / banda', 'Investigador', 'Coleccionista')),
  email TEXT NOT NULL UNIQUE CHECK (length(email) <= 254 AND email = lower(email)),
  phone TEXT NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  social TEXT NOT NULL DEFAULT '' CHECK (length(social) <= 500),
  origin TEXT NOT NULL DEFAULT 'Roadmap' CHECK (origin = 'Roadmap'),
  campaign TEXT NOT NULL DEFAULT '' CHECK (length(campaign) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX launch_contacts_pending ON auth.launch_contacts(next_attempt_at) WHERE synced_at IS NULL;
COMMENT ON TABLE auth.launch_contacts IS 'Aviso de lanzamiento; correo único y reintentos hacia Contactos. No son cuentas ni candidaturas.';
COMMIT;
