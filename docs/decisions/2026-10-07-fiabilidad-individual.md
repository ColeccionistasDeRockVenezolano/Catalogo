# Verificación individual de fichas

Solicitada por Brian el 7 de octubre de 2026. Se integra en personas, artistas/bandas/solistas y discos. El informe, sus citas y el puntaje se almacenan en `ingest.entity_verification_reports`; las ejecuciones en segundo plano, en `ingest.entity_verification_jobs`. No cambia datos del catálogo.

Todos los endpoints `/entity-verification/*`, incluidas lecturas, exigen rol admin y devuelven `Cache-Control: no-store`. El panel solo se monta para administradores. Visitantes y lectores no reciben solicitudes ni campos de fiabilidad en las fichas públicas.

## Qué se compara

- Identidad y nombre real cuando corresponde; no presume que un nombre artístico sea legal.
- Integrantes, roles, periodos y créditos de discos/pistas.
- Todos los discos registrados en la trayectoria, sus años y tipos.
- Lanzamientos ausentes documentados en fuentes, con deduplicación. Para una persona, los discos de sus bandas no se atribuyen automáticamente como créditos personales.
- Todas las pistas de cada disco, con título y posición por número de disco; detecta huecos y posiciones repetidas. Una edición diferente no justifica cambiar el orden.
- Perfiles sociales, incluidos los aún no marcados como verificados en el catálogo, y enlaces del lanzamiento. Que una URL responda no prueba identidad.
- Géneros propios; no hereda automáticamente los del artista al álbum ni los de una banda a una persona.
- Estado y cronología; falta de fecha de disolución no equivale a proyecto activo.
- Biografía/descripción separada en afirmaciones; no confirma un texto completo por una coincidencia de nombre.

## Puntaje

Las reglas vigentes son v3. Una página leída que documenta el dato completo permite 100 %, sin exigir una segunda procedencia. Los resúmenes permiten hasta 25 % y los componentes parcialmente respaldados aportan su cobertura. Las citas siguen siendo literales y deben corresponder a la ficha y edición.

Solo confirmed, partial y contradicted con evidencia externa y valor registrado entran en el cálculo. Sin verificar, faltantes, pendientes, propuestas, inventario de ausencias e incoherencias internas sin respaldo externo quedan excluidos. Una discrepancia documentada aporta cero; sin datos contrastados el puntaje es null. Los pesos originales de las áreas se normalizan únicamente entre áreas con datos contrastados. El porcentaje mide coincidencia documental de ese subconjunto; no exhaustividad ni probabilidad de verdad. La interfaz muestra el tamaño del subconjunto y los datos excluidos.

La independencia de fuentes no determina si un enlace, rol o género coincide completamente. El seguimiento y los parámetros de idioma se eliminan al comparar enlaces, pero se conservan parámetros que identifican recursos. La normalización incluye tildes, mayúsculas, puntuación, traducciones, géneros concatenados, encabezados y orden de pistas por soporte y cara del vinilo.

## Vigencia y fallos

La huella incluye las unidades, pistas, relaciones y fuentes del expediente. Si cambia, conserva el informe anterior pero suspende el puntaje y marca la investigación como desactualizada. Se conserva el historial de versiones. Un fallo de búsqueda o extracción no confirma ningún dato; los lotes afectados quedan sin verificar y se registra la limitación. Un reinicio deja los trabajos interrumpidos como fallidos recuperables mediante un nuevo intento.

## Validación

Tests de cobertura proporcional, literalidad, contexto, pistas, contradicciones, ausencia documentada, deduplicación y lotes de más de 40 datos; contratos con PostgreSQL para las tres clases de ficha, persistencia, versiones, vigencia, trabajos y rechazo a visitantes/lectores; QA de navegador a 1280 y 400 px para consulta, ejecución, detalle y panel ausente del catálogo público.

### Seguimiento y presentación del informe

El puntaje se presenta como porcentaje en un círculo, con barras por área y contadores que filtran el detalle. Las acciones usan los botones e iconos de la ficha. Un puntaje provisional se identifica expresamente; sin investigación se muestra un círculo pendiente, sin asignar un porcentaje ficticio.

La migración 0047 incorpora progreso y un checkpoint privado a cada trabajo. Se guardan la etapa, consultas terminadas, fuentes obtenidas y datos procesados. Cada lote conserva su informe parcial; al completar el trabajo se guarda la versión final y se libera el checkpoint. Si se interrumpe, el informe parcial sigue disponible y la tarea fallida puede consultarse al volver. Una versión final más reciente prevalece sobre un checkpoint antiguo. El porcentaje de avance corresponde a la etapa actual y no a la fiabilidad.

Las descargas independientes se ejecutan con concurrencia limitada a cuatro y la evaluación a tres lotes; el broker conserva la regulación de búsquedas. No se recortan unidades. Los errores de evaluación dejan los datos pendientes y aparecen en las limitaciones.

La búsqueda, el tipo, la selección y los filtros se conservan por ficha y administrador en sessionStorage. Solo se guardan preferencias e identificadores, nunca los informes ni las evidencias. Se borran al cerrar o expirar la sesión y se tolera que el navegador bloquee el almacenamiento. Los informes y checkpoints siguen en la base de datos, accesibles solo para administradores.

### Antecedente: reglas v2, sustituidas por v3, y correcciones de la auditoría de Caramelos de Cianuro

1. Los órdenes son pares de soporte y pista: `1.01` y `1.1` equivalen; CD/DVD se evalúan por soporte. Un número ajeno al título no verifica el orden.
2. Las contradicciones se contrastan con el valor registrado. Si el supuesto valor opuesto coincide, se valida el respaldo; si fuentes relevantes apoyan ambos valores, se muestra la discrepancia sin declarar incorrecta la ficha.
3. Las citas se validan por componente y por contexto. Una canción incluida en otro álbum no verifica un lanzamiento independiente, ni una cita que omite el título aporta corroboración. La puntuación, tildes y separadores se normalizan para comparar; la cita literal se conserva.
4. Los descubrimientos se deduplican contra todos los campos y álbumes registrados y se presentan como propuestas. No añaden unidades ni penalizan el puntaje. El inventario puntúa únicamente los títulos cotejados, sin presumir exhaustividad.
5. Se agrupan páginas del mismo editor, versiones idiomáticas y plataformas que comparten catálogo distribuido. Se excluyen pantallas de bloqueo y textos vacíos. Fuentes comunitarias tienen techo 50 %, resúmenes y biografías de procedencia débil 25 %. Son reglas conservadoras de cobertura, no una calibración estadística.
6. Cada unidad recibe una evaluación o queda explícitamente pendiente. Los índices numéricos serializados se normalizan; referencias al propio catálogo se rechazan como evidencia sin perder otros datos del lote. Lotes de ocho se reintentan en grupos de cuatro. La migración 0048 persiste páginas, propuestas y pendientes por ficha y huella. El siguiente intento retoma únicamente pendientes compatibles; una ficha o versión de reglas distinta inicia una investigación nueva.

Los informes v1 mantienen sus citas e historial, pero su puntaje queda desactualizado al cambiar las reglas. El contrato privado incluye versión de reglas, propuestas y cobertura de evaluación. El detalle se abre por área y dato, con búsqueda, filtro y páginas de 20 filas; las fuentes y limitaciones tienen desplegables propios. Las comparaciones reutilizan el mismo lector para ambas investigaciones, inicialmente plegadas. No se modifica ningún dato del catálogo.

La recuperación del informe de artista 58 revalida las páginas y propuestas conservadas, incluidos los lotes antes rechazados por índices serializados, y solicita nuevas evaluaciones para las unidades omitidas. Las referencias conservan la fecha de lectura original. Se conserva el informe 11 para auditoría.


Resultado verificado del recálculo del 8/10/2026 UTC: 43,4 %, 743 unidades procesadas, 75 comprobadas, 390 parciales, 19 campos vacíos y 259 sin respaldo suficiente. Nueve propuestas quedan fuera del denominador. 108 referencias conservan contenido utilizable; no se confunden las 163 URL originales con corroboraciones independientes. Pasaron 37 pruebas de unidad/contrato, compilación, lint de los módulos cambiados y QA en navegador de personas, artistas y discos a 1280 y 400 px, incluidas las comparaciones y su privacidad.

## Revisión completa v3

La [auditoría de Caramelos de Cianuro](2026-10-07-caramelos-verificacion-v3.md) y su CSV documentan el caso de prueba completo: 743 unidades procesadas, 96,4 % entre 566 datos contrastados y 177 excluidos. Se preservan las versiones anteriores. Las nuevas investigaciones conservan citas anteriores válidas de la misma huella, remapeando sus índices; se rechazan citas ausentes de una página actualizada.
