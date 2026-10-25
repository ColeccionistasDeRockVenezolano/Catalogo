# Fichas y ediciones: hallazgos y correcciones — 2026-10-16

Se corrigieron los 17 pendientes de la revisión inicial, además del recorte de sugerencias en el modal de fusión, los IDs de campos repetidos, el foco en pestañas ocultas y los guardados sucesivos que creaban relaciones duplicadas.

## Correcciones

| ID | Problema | Comportamiento corregido |
| --- | --- | --- |
| A01 | Guardar una ficha reenviaba valores derivados y podía borrar una URL bloqueada. | Lectura administrativa de los valores almacenados, con autenticación y `private, no-store`; PATCH únicamente de campos modificados en discos, pistas, artistas, personas y organizaciones. |
| A02 | El editor escribía el tiempo general, pero el reproductor leía una ocurrencia del video. | Editor de marcas por video y pista existente, incluido CD/lado. Acepta cero, valida inicio/final contra la duración y permite corregir, añadir o retirar una ocurrencia. Las decisiones se conservan durante la rehidratación; las repeticiones ambiguas se envían a revisión. |
| A03 | El formulario de edición y las versiones públicas usaban tablas diferentes. | CRUD de `ingest.album_versions`: tipos de edición combinables, fecha, año, formato, catálogo, país, portada, notas, discos asociados, versión principal y referencia documental. La sección pública muestra también una sola versión documentada. |
| A04 | Cambiar el sello del core podía quedar oculto por los vínculos públicos. | Editor de sellos, distribuidores y licenciatarios por disco o versión, sobre `album_labels`. La migración conserva como vínculos editables los sellos que solo existían como respaldo. El campo histórico `labelId` también actualiza el vínculo público. |
| A05 | Año, fecha estructurada y literal podían contradecirse sin explicación. | Fecha de obra y fecha de versión tienen ámbitos explícitos. Una fecha estructurada proyecta su año sin inventar precisión; una corrección de año retira una fecha estructurada incompatible. El literal de fuente se conserva y se presenta con su propio rótulo. |
| A06 | No se podían proponer géneros nuevos desde la ficha. | «Proponer un género nuevo» registra nombre, familia, texto/referencia y motivo en la cola de revisión. Se conserva la separación entre propuesta de taxonomía y asignación de género. |
| A07 | Los géneros por período no tenían lectura pública. | API y presentación pública del género y período de cada ficha, separados de los géneros generales y de los filtros de géneros confirmados. |
| A08 | Un conflicto de jerarquía podía terminar en error 500. | Errores de dominio tipados y respuesta de conflicto 409 con explicación del género más específico. |
| A09 | El selector de género por período ocultaba fallos de carga. | Estado de carga, error, reintento y guardado deshabilitado hasta disponer del vocabulario. |
| A10 | No había editor de nombres y enlaces de CD/lado. | CRUD de `album_discs` y `album_disc_links`, que son los datos leídos por la ficha y el reproductor. Los soportes físicos quedan identificados por separado. |
| A11 | Los audiovisuales eran solo lectura. | Alta, edición y retiro editorial sobre `media.artist_audiovisuals`, sin crear discos ni pistas. Se conservan videos no disponibles; la sincronización respeta las ediciones y los retiros humanos. |
| A12 | Las letras se podían consultar, pero no editar. | Campo de letra en la edición de pista y en el PATCH; carga administrativa del texto completo y deshacer. |
| A13 | El buscador podía quedarse cerrado después de elegir por teclado. | Escribir vuelve a abrir las sugerencias; Escape cierra primero las sugerencias y conserva el modal. |
| A14 | Editar una URL de video añadía otro vínculo y dejaba el anterior. | Reemplazo atómico con identidad del vínculo original, detección de destino duplicado y deshacer. |
| A15 | Cliente y servidor duplicaban las plataformas; añadir podía sobrescribir otra. | Vocabulario compartido, altas limitadas a plataformas libres y plataforma fija al editar un vínculo existente. |
| A16 | Las opciones válidas podían quedar con traducciones antiguas. | El editor de propuestas reutiliza las etiquetas comunes del catálogo para los valores canónicos. |
| A17 | Una clasificación inferida no admitía rechazo efectivo. | Decisiones editoriales de aceptación/rechazo independientes de la evidencia de fuente. La vista efectiva, las fichas y los filtros respetan el rechazo, incluso después de sincronizar la hoja; deshacer restaura la decisión anterior. |

## Clasificaciones y error `albumType: null`

El tipo de publicación y las clasificaciones adicionales conservan ámbitos separados y pueden combinarse. El editor carga los tipos del enum de PostgreSQL y las clasificaciones registradas; admite escribir otra clasificación musical. La API de escritura toma el enum canónico del esquema compartido. No se adivina un tipo al guardar una clasificación.

El guardado parcial conserva el tipo existente y evita enviar `albumType: null` por una modificación ajena a ese campo. Una modificación explícita a un tipo vacío se rechaza con explicación antes de escribir. Las categorías nuevas aparecen en fichas, filtros y discografías; sus selecciones se conservan en la URL, se combinan con Y y reinician la paginación al cambiar.

## Archivos principales

- Backend: `src/catalog/editor.ts`, `src/api/routes/catalog-editor.ts`, `src/api/routes/catalog-writes.ts`, `src/catalog/album-classifications.ts`, `src/catalog/album-labels.ts`, `src/genres/errors.ts`, `src/api/routes/genres.ts`, `src/youtube/editorial-times.ts`.
- UI: `EntityFormModal`, `CatalogResourceEditor`, `GenreEditor`, `GenrePeriods`, `CatalogModelPanel`, `FormFields`, `EntityPicker`, `AlbumVideoEditor` y `PlatformLinkEditor`.
- Vocabularios: `src/shared/album-categories.ts`, `src/shared/classification-filters.ts`, `src/shared/platforms.ts`.
- Migraciones: `0078_editorial_catalog_decisions` , `0079_editorial_decision_indexes` y `0080_audiovisual_fk_indexes`. Registra las tablas nuevas en el diario reversible y conserva las fuentes originales.

## Validación

- **78/78 pruebas aprobadas** en nueve archivos. Contratos contra PostgreSQL desechable: lectura privada, PATCH parcial, clasificaciones libres y filtros con Y, rechazo persistente, versiones y sellos públicos, fechas, letras, reemplazo de video, tiempos por video, audiovisuales, propuestas de género, conflictos de jerarquía y deshacer.
- **7/7 comprobaciones adicionales de esquema aprobadas**, incluidas migración, segunda aplicación sin cambios, índices de todas las FK y reversión completa.
- Regresiones: escritura general, títulos y categorías, reproducción por video/CD, audiovisuales, modelo de catálogo, discografía y etiquetas.
- Navegador a 1440 y 390 px: valores originales, payload parcial sin `albumType: null`, clasificación libre, tipos de edición combinados, marcas con inicio cero, propuesta de género, búsquedas sucesivas, Escape y ausencia de desbordamiento horizontal.
- Typecheck de backend y web aprobado; lint de los archivos intervenidos; detector visual de los editores; build público.

Los contratos y las pruebas de navegador no escriben en fichas reales. En la instalación local se aplica la migración y se publica la compilación; la copia de sellos de respaldo conserva su identidad y no agrega información nueva de fuentes.

Publicación local verificada: `crv-api` y `crv-web` activos; `/crv/` y `/crv/api/health` responden 200, y el editor sin sesión devuelve 401. El reinicio de la API requiere iniciar sesión de nuevo.

## Ronda de experiencia del diálogo (misma fecha)

Evaluación por criterios del modal de edición de fichas (15/20 el 2026-10-16; brechas señaladas y corregidas aquí):

| Brecha | Corrección | Dónde |
| --- | --- | --- |
| Cerrar con cambios sin guardar descartaba la edición en silencio. | Confirmación «Descartar cambios» en Escape, clic fuera, «Cerrar» y «Cancelar»; cancelar conserva el borrador. | `EntityFormModal` (`requestClose` + `ConfirmDialog`) |
| El foco inicial caía en el botón «Cerrar»: un Enter descartaba el diálogo. | El foco entra al primer campo del contenido (el motivo); si no hay campos, al primer control. | `Modal` |
| Los errores de validación se anunciaban en la cabecera, fuera de la vista del botón Guardar. | Validación propia (`noValidate`) con marca y mensaje junto al campo —motivo incluido—, foco al primer error y `aria-invalid`. | `EntityFormModal` + `FormFields` (`errors`) |
| El título, la X y las pestañas de sección se iban con el scroll en formularios largos. | Cabecera fija y cuerpo con scroll propio (`.modal-panel` flex + `.modal-body`); pestañas y barra de acciones ancladas con `--modal-pad-*`. | `Modal` + `global.css` |
| El fondo seguía siendo navegable con el diálogo abierto. | Los hermanos del portal quedan `inert` y `aria-hidden` mientras el diálogo esté abierto; se restaura al cerrar (incluye diálogos anidados). | `Modal` |
| Etiquetas de 12 px y pistas de 11,5 px poco legibles. | Etiquetas a 12,5 px y pistas a 12 px con el color de texto secundario. | `global.css` |

Verificación: `web/tests/visual/entity-editing-qa.mjs` ampliado (foco inicial, fondo inerte, título y pestañas visibles al desplazar, confirmación de descarte en ambos sentidos —cancelar conserva, descartar no escribe—, motivo en blanco y campo obligatorio señalados con foco) en verde a 1440 y 390 px; `npm run test:web` 90/90; `web/tests/unit/entity-fields.test.ts` actualizado al reparto actual entre formulario, selectores y datos que la API valida aparte; `web/tests/visual/admin-edit-qa.ts` adaptado al editor de hoy —pestañas de la ficha (`?tab=miembros`, `?tab=organizaciones`), texto de género rechazado por la proyección, «Historial de campos» y la corrección recomendada de la tarjeta de hallazgo— y con los **nueve flujos en verde** contra PostgreSQL desechable, comprobando la base tras cada paso. El servidor de desarrollo ya no vigila `.media-variants` ni `public/media` (`web/vite.config.ts`): sus decenas de miles de archivos agotaban el límite de inotify de la máquina y Vite no llegaba a arrancar.
