# Etapa 2 — implementación en curso

Objetivo: ejecutar E2-01 a E2-05 del plan de cinco etapas, conservando todo el alcance. Este expediente no declara cerrada la etapa ni acredita todavía recuperación documental ≥95 % o hechos críticos al 100 %.

## Cambios conectados

- Investigación con registro persistente de búsquedas, adquisiciones, evaluaciones y extracciones. Cada tarea conserva dependencias, intentos, errores y checkpoint. La lectura de campos recorre las fuentes completas en grupos; desaparece el corte de las primeras doce páginas.
- Registro de fuentes descubiertas, obtenidas, leídas parcialmente/completamente, fallidas o inaccesibles; captura y hash conservados cuando se conocen. Una adquisición fallida deja el informe parcial aun si otras fuentes fueron procesadas.
- Agrupación idempotente de afirmaciones equivalentes conservando citas y valores contradictorios. Los límites de llamadas/tokens, una pausa o una cancelación conservan lo obtenido.
- Trabajos con estados `partial`, `paused` y `cancelled`, controles autenticados por la API y botones en las fichas. El proceso mantiene una lease; otra API no invalida una lease vigente y un proceso que perdió su lease no puede escribir el checkpoint.
- Versiones preservadas por invocación de investigación y checkpoints transaccionales. La migración `0064_research_recovery` se ensaya en PostgreSQL desechable; todavía no se aplicó a producción.
- Contexto de curaduría con inventario completo de citas y pendientes. Las peticiones focalizadas cargan su hallazgo; las generales se particionan automáticamente. Un hallazgo con muchas citas se visita en varios lotes sin perder ninguna. Las tareas de planificación conservan contexto y resultados; un fallo de otro lote no borra las propuestas obtenidas.
- Las fuentes adicionales recuperadas durante planificación que exceden una llamada se conservan y generan tareas de continuación. Las claves de operaciones y evidencias se remapean al combinar lotes; las operaciones equivalentes reúnen las citas.
- Lectores de HTML, JSON, páginas con JavaScript, PDF e imágenes/OCR conectados al broker. Se conserva el texto completo, enlaces, datos estructurados, originales por SHA-256, recibos recuperables y posiciones UTF-8/nodos/páginas/coordenadas. Un PDF conserva páginas leídas y continúa las pendientes; el OCR conserva alternativas y exige revisar el original.
- Capturas privadas descargables desde fuentes y citas, con integridad y autenticación comprobadas. Las peticiones del renderizado pasan por la protección de URL pública; la descarga HTTP fija la dirección validada por DNS. Un documento truncado, formato fallido, renderizado pendiente o límite de páginas mantiene el estado parcial.
- Historial paginado de informes en API/ficha y reprocesamiento de copias preservadas contra la ficha vigente. El informe elegido permanece intacto; un fallo, pausa o presupuesto conserva el checkpoint propio del trabajo. Las migraciones 0065/0066 están verificadas en PostgreSQL desechable, sin aplicación a producción.
- Un refresco conserva descubrimientos anteriores y versiones exactas de sus citas, incluyendo contradicciones. El guardado de informe, inventario, candidatos y terminación del trabajo ocurre en una transacción que comprueba y bloquea su propiedad. Las reglas documentales v7 invalidan puntajes anteriores conservando sus informes.

## Evidencia y límites

`context-audit.json` y `preserved/` documentan cuatro peticiones por artista sobre los informes actuales de Jeremías, Apache, La Banana Voladora y Caramelos de Cianuro. Las 16 comprobaciones conservan sus citas y pendientes y caben en sus lotes. Incluyen la petición general y los tres hallazgos focalizados de Jeremías (`suggested.0`, `suggested.215`, `tracks.27694.empty`). El catálogo se abrió con transacciones de solo lectura y no se llamó a un proveedor de IA. Esto comprueba construcción y conservación de contexto; no acredita la corrección de propuestas de un modelo real.

Las pruebas de recuperación cubren pausa, presupuesto, fallo/reintento de una fuente, citas fuera de las primeras doce fuentes, identidad del trabajo y conservación de versiones. Los contratos comprueban API, permisos y controles, además de migrar/revertir/reaplicar. Las pruebas de navegador usan sesión real, CSRF y PostgreSQL aislado; su proveedor HTTP es una fixture local y no cuenta como ejecución de un modelo real.

Comprobación técnica de este avance: 826 unitarias backend, 57 unitarias web, 51 contratos pertinentes y el recorrido de pausa/reanudación en 1440 y 390 px. Tipos, lint y builds aprobados en las ejecuciones documentadas bajo `quality/`; no equivalen al corpus completo ni al cierre de los gates. El recorrido de navegador está integrado en CI y en `quality:evidence` mediante `test:browser:research`.

Comandos: `npm run stage2:context-audit -- <corpus-de-casos.json> <salida.json>` abre el catálogo en solo lectura y preserva copias en un directorio nuevo por ejecución. Para el navegador, construir con `VITE_API_BASE_URL=/api npm --prefix web run build` y ejecutar `npm run test:browser:research`; el harness bloquea conexiones del navegador a otra API local.

El avance de lectores/historial añade pruebas con Chromium, Poppler y OCR reales sobre documentos de prueba conocidos: HTML largo, tablas/JSON-LD, valores JSON, PDF nativo/escaneado, coordenadas, lectura tardía con JavaScript y URLs internas bloqueadas. Los archivos de prueba no se contabilizan como corpus editorial real. El contrato de historial comprueba presupuesto/reanudación sin red, copias inmutables y checkpoint propio tras un fallo de publicación. La actualización de la prueba antigua de retención conserva la cita en su captura anterior en lugar de eliminarla cuando cambia la página.

`browser-history/checks.json` registra sesión/CSRF reales en 1440/390 px: pausa, reanudación, descarga de bytes originales, apertura de historia y reprocesamiento. Su modelo HTTP sigue siendo una fixture local. La comprobación integrada nueva se ejecuta bajo `quality-documents-history-r2/`; hasta que finalice no se acredita como aprobada. La primera ejecución (`quality-documents-history/`) detectó un error de tipos en una prueba nueva; se conserva como fallo, corregido en la segunda candidata.

Las copias completas de los cuatro informes y estados están en `preserved-research/0f548980-8657-46a4-bdb8-7c79051f7516/`, obtenidas con `BEGIN READ ONLY`. Incluyen 1316/63/68/187 descubrimientos crudos respectivamente; son extracciones previas, no hechos aceptados editorialmente. Todos los documentos de sus informes (232/98/30/108) tienen copia cuyo texto coincide con el hash. El estado histórico de Caramelos incluye además 50 marcadores vacíos de resúmenes, sin citas ni hechos que los referencien, con hashes históricos inconsistentes. `integrity-audit.json` distingue esos marcadores de documentos útiles; su normalización explícita sigue pendiente antes de reprocesar el estado legado completo. Ninguna copia original fue alterada.

## Pendiente para cerrar el alcance original

1. E2-01: terminar la recuperación del planificador a nivel de rondas y su coordinación entre procesos; comprobar la preparación real de las cuatro peticiones de Jeremías, no solo la construcción de contexto.
2. E2-02: completar y congelar el corpus editorial de 120 documentos con la distribución requerida y ejecutar fallos de red/reserva. Los lectores, originales y posiciones están conectados y probados; esas pruebas no acreditan todavía recall sobre fuentes reales.
3. E2-03: resolver identidad para todos los tipos, pertenencias, país, época, repertorio y edición; medir agrupación/contradicciones y atribución sobre la reserva, no solo los casos de solista existentes.
4. E2-04: incluir organizaciones/sellos y pistas con contexto de álbum; inventario exhaustivo de hechos extraídos con destino (`ya presente`, `propuesta`, `conflicto`, `pendiente`, `descartado con motivo`). Conservar también datos que el evaluador actual omite de las sugerencias.
5. E2-05: compatibilidad de reprocesamiento con estados/informes legados, normalización auditada de marcadores vacíos y ejecución sobre las copias de los cuatro artistas. La API/UI de versiones y reprocesamiento nuevo está conectada. Completar presupuesto global/financiero del piloto y continuidad/consumo del planificador antes de aceptación con proveedor real.
6. Medir M01/M02/M03/M04/M12 con denominadores reales y ejecutar tres repeticiones de reserva. No sustituir recall por trazabilidad ni considerar evaluado un denominador vacío.
7. Validación integrada del mismo candidato (tipos, lint, builds, unitarias backend/web, contratos pertinentes, navegador y doctor en aceptación), expediente y revisión exigidos por el contrato.

E2-01/E2-02/E2-03/E2-05 están en ejecución; E2-04 sigue pendiente. El objetivo permanece activo.
