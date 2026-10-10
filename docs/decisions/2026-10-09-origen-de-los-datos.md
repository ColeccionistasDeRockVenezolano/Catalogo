# Origen de los datos — acceso administrativo

Las fichas de artista, persona y organización incorporan la pestaña «Origen de los datos». Los discos incorporan una sección con el mismo nombre. Tanto estas fuentes como la pestaña de historial se ocultan a visitantes y lectores. El componente privado solo se monta con una sesión administradora y no consulta fuentes en otras sesiones.

Cada aporte muestra campo, valor, estado, confianza, fecha, fuente y evidencia. El nombre de la fuente es un hipervínculo, por ejemplo «Fuente: Spotify». Se prioriza la URL registrada en la evidencia y después la página capturada. Si únicamente existe el enlace general del sitio, se identifica como tal; si no existe un enlace web, se indica. No se convierte un enlace de escucha en prueba de procedencia. Las referencias internas de edición se muestran como texto, sin hipervínculos ejecutables. Los extractos, referencias adicionales y valores extensos se pueden desplegar. Se conserva la fila de importación cuando está registrada.

La lista conserva todos los estados de los aportes, incluidos pendientes, rechazados y reemplazados, y se pagina con orden estable por fecha e ID. Un aporte aceptado no necesariamente representa el valor vigente: la interfaz explicita esta limitación. La evidencia faltante no se reconstruye ni se inventa.

`GET /claims`, `GET /sources` y `GET /sources/:id` y las lecturas de investigación de identidad de personas requieren acceso administrador en el servidor, igual que el historial. Visitantes reciben 401 y lectores 403. Las respuestas privadas llevan `Cache-Control: no-store`. Se mantiene el mecanismo de token interno ya existente para automatizaciones. No se necesita una migración.

Validación: pruebas de sesiones con GET y HEAD para las cuatro entidades, pruebas de contrato sobre PostgreSQL desechable que recuperan múltiples evidencias sin duplicar aportes, pruebas de enlaces seguros y QA de las cuatro fichas en escritorio (1440 px) y móvil (390 px), con sesiones administradora, lectora y visitante. El QA de interfaz usa respuestas privadas de prueba y snapshots públicos del catálogo local; no escribe en el catálogo.

## Créditos de disco y pista

Las fuentes de los créditos se muestran junto a cada acreditado, con el enlace de evidencia y el estado del aporte. «Ver origen del crédito» abre los campos respaldados, fechas y extractos. Los créditos sin evidencia registrada lo indican y las ediciones manuales conservan su registro interno.

`GET /credit-sources?entity=album&id=...` entrega las fuentes de todos los créditos del disco y sus pistas en una sola carga de interfaz; `entity=track` acota a una pista. La API y la interfaz exigen administración. La búsqueda combina las FKs de claims y los enlaces de auditoría: un aporte de varias pistas puede tener FK solo hacia el primer crédito, pero la auditoría conserva los demás. Al agrupar créditos de pistas en la ficha se mantienen todos sus IDs, para consultar las fuentes de cada uno.

Se comprobó el disco 1946, «Ordenador»: 12 créditos de Sincopa con enlace concreto a `godsnewversion_ordenador.htm` y dos créditos de edición manual. Se verificaron GET/HEAD privados, aislamiento por obra, evidencia auditada, agrupación sin pérdida de IDs, escritorio/móvil y ausencia de consultas privadas para visitantes y lectores. No se modificaron créditos ni otras fichas del catálogo.
