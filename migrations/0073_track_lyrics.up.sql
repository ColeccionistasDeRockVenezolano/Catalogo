-- CRV · Letra de la canción (2026-10-13).
--
-- POR QUÉ: la campaña de musicavenezuela.com aporta 164 letras completas de
-- canciones venezolanas con créditos de composición, y el core no tenía dónde
-- guardarlas. Es la NOVENA excepción aprobada al core.
--
-- APROBACIÓN LITERAL DE BRIAN (2026-10-13): «Implementa las letras para los
-- tracks correspondientes. Absorve todo lo que tiene valor para CRV y ya de una
-- sola vez abre los claims para imagenes de artistas y sus portadas de albums».
--
-- DECISIONES:
--  · Columna TEXT en `tracks` (no tabla aparte): la letra en CRV es de la pista
--    (misma canción = misma letra en sus distintas ediciones) y así viaja por el
--    pipeline de claims existente (entityKind=track, field='lyrics') sin abrir
--    un entityKind nuevo. Mismo criterio que `persons.biography` (0033).
--  · NULL = sin letra conocida. NULLable, SIN CHECK, sin DEFAULT: los CHECK
--    rompen fusiones y el motor distingue «sin dato» de «vacío».
--  · El texto es la letra tal cual la publica la fuente (con saltos de línea);
--    la limpieza/normalización va en el extractor, no en el esquema.
--
-- REGLAS: solo el merge engine / el operador escriben esta columna (claim de
-- fuente + run reversible); la web la muestra cuando existe.
BEGIN;
SET LOCAL crv.journal = 'off';
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS lyrics text;
COMMIT;
