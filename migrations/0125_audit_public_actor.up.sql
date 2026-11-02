-- Fase 2B · auditoría de las escrituras públicas de comunidad.
--
-- El CHECK original de 0112 solo admitía 'admin' y 'user'. Las candidaturas y
-- activaciones anónimas se registran con actor_type 'public' y actor_id 0, así
-- que el INSERT fallaba y la API seguía sin auditoría (solo dejaba un error en
-- el log). Esta migración amplía el CHECK; no toca datos ni otras tablas.
ALTER TABLE auth.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
ALTER TABLE auth.audit_log
  ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('admin', 'user', 'public'));
