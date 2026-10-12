-- CRV · Plan del primo, etapa 1 (2026-10-12): dos tipos de alias nuevos.
--   nickname       — apodo de una persona («Cheo», «Cayayo»). La pantalla compone
--                    «Nombre "Apodo" Apellido» a partir del nombre y de este alias;
--                    la base sigue guardando el nombre real (decisión de Brian).
--   source_variant — forma en que una fuente escribió el nombre («Atkinson - La
--                    Banda»). Se oculta al público pero NO se borra: sirve para la
--                    búsqueda y para emparejar ingestas.
-- Solo toca `ingest`. ADD VALUE dentro de la transacción del migrador es válido
-- en PostgreSQL ≥ 12 mientras los valores no se usen en la misma transacción.
BEGIN;
ALTER TYPE ingest.alias_type ADD VALUE IF NOT EXISTS 'nickname';
ALTER TYPE ingest.alias_type ADD VALUE IF NOT EXISTS 'source_variant';
COMMIT;
