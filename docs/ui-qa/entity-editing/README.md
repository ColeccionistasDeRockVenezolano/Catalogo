# QA · Edición completa de fichas

`web/tests/visual/entity-editing-qa.mjs` usa respuestas de API simuladas; no modifica el catálogo real.

En 1440 px y 390 px comprueba precarga de campos, conservación del borrador al cambiar relaciones, asociación/retiro de persona titular, guardado de redes, fechas vacías como `null`, notas de pista, ausencia de desbordamiento y cuentas admin/reader/visitante. Las capturas muestran las secciones de identidad, redes y datos de disco/organización.

La suite de contrato `test/contract/api-write.test.ts` valida las escrituras reales en PostgreSQL desechable, incluidos géneros, perfiles, videos principales, privacidad y Deshacer. `test/unit/auth.test.ts` cubre rechazo del rol reader también mediante llamadas directas a la API.
