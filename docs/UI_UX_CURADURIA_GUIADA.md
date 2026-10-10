# Curaduría guiada: propuestas, duplicados y fichas

La interfaz conserva la identidad del catálogo y organiza la corrección en tres pasos: elegir ficha, revisar cambios e implementar. La IA y las reglas de autorización mantienen su comportamiento.

## Propuestas con IA

- El nombre de la ficha y el paso actual permanecen visibles. Se busca por nombre; el ID queda como alternativa.
- Al abrir una propuesta existente, la solicitud, el historial, el consumo y los pendientes son desplegables secundarios.
- Los cambios muestran estado y selección. Los filtros separan todos, los que requieren atención y los excluidos; los bloqueados pueden excluirse en conjunto.
- «Qué cambiará» presenta los campos actuales y propuestos o el contenido que se incorporará, con nombres de entidades y etiquetas legibles. El resultado interno del motor queda en «Detalle técnico de la validación».
- Se pueden editar datos, pistas, créditos, géneros, alias y formatos; las colecciones extensas despliegan cada registro a petición.
- «Guardar y validar» permite continuar después de editar. «Implementar» conserva las comprobaciones de revisión, autorización y datos vigentes. «Descartar mis ajustes» vuelve al borrador guardado sin llamar a la IA.
- La implementación no tapa la revisión ni la navegación móvil. El historial y la reversión se conservan.

## Duplicados y fichas repetidas

Los pares muestran identidad, conclusión y acciones antes del desglose de evidencias. «Revisar fusión» abre una comparación con más espacio, indica qué ficha se conserva y cuál se integra, muestra los identificadores para distinguir nombres iguales y permite elegir los datos. En móvil, la comparación se lee en registros verticales.

«Preparar propuesta con IA» lleva ambas identidades en la instrucción. Los hallazgos de fichas repetidas y otras categorías permiten preparar una corrección sobre la ficha correspondiente, con el hallazgo ya descrito. Estos enlaces abren un borrador; no ejecutan una fusión ni generan llamadas al modelo por sí solos.

## Fichas de artistas, personas y discos

«Ver informe y datos pendientes» abre directamente la búsqueda y el detalle por áreas. «Corregir datos con IA» abre la propuesta de esa ficha. Las preferencias de la interfaz anterior recuperan el detalle al abrir el informe. La nueva verificación y la comparación se agrupan en «Más herramientas». Los criterios del puntaje quedan disponibles en su propio desplegable.

## Verificación

`web/tests/visual/curation-guided-qa.ts` recorre datos reales con una sesión HttpOnly temporal de una hora en una API local conectada en modo de solo lectura a PostgreSQL. Comprueba propuestas existentes, edición local y descarte, propuesta vacía, duplicados, evidencias, ventana de fusión, fichas repetidas y fichas de artista, persona y disco a 320, 390, 768 y 1366 px. Bloquea toda escritura desde el navegador de revisión.

La prueba de propuestas con respuestas controladas verifica editar, guardar, validar, implementar y mostrar el resultado, en escritorio y móvil, sin llamadas adicionales al modelo. El recorrido completo pasó en los cuatro tamaños. También pasaron las pruebas de preferencias anteriores e investigación guardada desplegable, las comprobaciones de tipos, ESLint y la compilación pública. Las capturas se guardan en `/tmp/crv-guided-*.png` durante el recorrido; las seleccionadas se conservan en `docs/ui-qa/curation-guided/`.

Las credenciales de revisión son efímeras, se mantienen fuera del repositorio y se eliminan al terminar. La API temporal se detiene y sus sesiones quedan invalidadas. No se modifican cuentas ni sesiones del servidor publicado.
