# QA · Edición completa de fichas

`web/tests/visual/entity-editing-qa.mjs` usa respuestas de API simuladas; no modifica el catálogo real.

En 1440 px y 390 px comprueba precarga de campos, conservación del borrador al cambiar relaciones, asociación/retiro de persona titular, guardado de redes, fechas vacías como `null`, notas de pista, ausencia de desbordamiento y cuentas admin/reader/visitante. Las capturas muestran las secciones de identidad, redes y datos de disco/organización.

Comportamiento del diálogo comprobado en el mismo script:

- El foco entra al primer campo de la ficha (el motivo), nunca al botón «Cerrar»: un Enter por inercia no descarta la edición.
- Mientras el diálogo está abierto, el resto de la página queda `inert` y oculto para lectores de pantalla; el bloqueo lo lleva un contador compartido, así que al cerrar un diálogo anidado —la confirmación de descarte, por ejemplo— el fondo recupera su árbol de accesibilidad completo (ni `inert` ni `aria-hidden` residuales).
- El cuerpo del diálogo scrollea mientras el título, el cierre y las pestañas de sección siguen visibles.
- Cerrar con cambios sin guardar (Escape, clic fuera, «Cerrar» o «Cancelar») pide confirmación; cancelar conserva el borrador y descartar cierra sin escribir. El descarte confirmado no envía PATCH.
- Motivo en blanco y campos obligatorios vacíos se señalan junto al campo, con el foco en el primero: la validación propia sustituye al globo nativo del navegador (`noValidate`).
- Los errores del servidor se anuncian en el aviso superior y este recibe el foco.

La suite de contrato `test/contract/api-write.test.ts` valida las escrituras reales en PostgreSQL desechable, incluidos géneros, perfiles, videos principales, privacidad y Deshacer. `test/unit/auth.test.ts` cubre rechazo del rol reader también mediante llamadas directas a la API. `web/tests/visual/admin-edit-qa.ts` (`npm run test:visual-admin`) recorre nueve flujos de administración contra PostgreSQL desechable y comprueba la base tras cada paso.
