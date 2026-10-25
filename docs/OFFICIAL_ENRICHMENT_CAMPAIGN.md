# Enriquecimiento documental de fuentes primarias · CRV

Campaña autorizada por Brian el 13/10/2026, con gasto de DeepSeek sin límite fijado y alcance sobre el catálogo. Parte del [inventario revisado](../data/research/venezuelan-music-sources.json), reutiliza capturas y busca publicaciones adicionales para las demás fichas. Los resultados y el estado actual están en [RESULTADOS.md](../reports/official-enrichment-2026-10-13/RESULTADOS.md) y [progress.json](../reports/official-enrichment-2026-10-13/progress.json).

## Ejecución y recuperación

La auditoría inicial conserva una lista de 4.786 artistas, 32.152 personas, 15.720 discos y 121.130 pistas. Los vacíos de esa fotografía describen el catálogo; no demuestran que una banda carezca de miembros, discos o actividad.

```bash
# Crear una auditoría en un directorio nuevo, antes de comenzar una campaña.
npm run research:official:audit -- reports/mi-campana

# Ejecutar descubrimiento, recorrido, extracción y propuestas. Reanudable.
npm run research:official:campaign -- --run --output=reports/mi-campana --concurrency=4

# Actualizar resultados y expedientes sin nuevas llamadas al modelo.
npm run research:official:report -- reports/mi-campana

# Reexaminar únicamente una ficha del inventario, sin aceptar cambios.
npm run research:official:run -- --run --scope=known --ids=266 --output=reports/mi-campana
```

El supervisor reutiliza las etapas que ya estén activas. El descubrimiento mantiene consultas espaciadas a SearxNG. Los casos con fuentes descubiertas pasan a lotes de recorrido y análisis; esa ampliación no espera a que termine la búsqueda de todo el catálogo. Los informes se actualizan durante la ejecución. El coordinador y cada etapa tienen locks separados y puntos de recuperación por ficha. Un lock cuyo proceso terminó puede recuperarse; no se toma el lock de un proceso vivo.

`known` recorre los 34 proyectos del inventario que coinciden con nombres o alias explícitos del catálogo. `discovery` conserva búsquedas y candidatos para los restantes. `expanded` contiene sus capturas y propuestas. El presupuesto autorizado es ilimitado, pero se conserva el uso de tokens conocido y los fallos. El caché guarda la última respuesta por hash: sus contadores no representan una factura completa ni el coste de todos los reintentos.

## Recorrido y análisis

Se preserva el documento original con hash y fecha de captura, y se distingue la fecha de lectura posterior. El recorrido sigue biografías, formaciones, discos, canciones, proyectos, PDF y recursos identificados como créditos o libretos. Se excluyen cuentas, carrito, entradas, archivos de audio y enlaces de descarga duplicados. Las páginas largas se leen en fragmentos con solapamiento, incluyendo su final. Una frontera de navegación que exceda 500 páginas queda declarada pendiente, en vez de ocultar el resto del sitio.

Una publicación descubierta debe superar dos controles distintos: identidad musical y atribución del editor. Prensa, directorios, comercios generales y plataformas agregadoras no se convierten en fuentes primarias por mencionar correctamente al artista. Los perfiles de artista autogestionados sin prueba administrativa conservan esa incertidumbre. Las páginas de sellos se restringen al artista del lanzamiento: el campo estructurado `byArtist` impide atribuir todo el catálogo del sello a la banda investigada.

DeepSeek Flash extrae hechos atómicos y citas literales: integrantes, roles, entradas y salidas, fundadores explícitos, actividad documentada, fechas, nombres anteriores, discografía, pistas, créditos, estudios, sellos y colaboraciones. La página identifica el editor; el campo `project` identifica el proyecto del hecho, que puede ser un proyecto paralelo. «Conformada por» no prueba que una lista sea de fundadores. Las letras y reseñas de compradores no se usan como biografía.

La visión recibe bytes de imágenes capturadas mediante `image_url`, no una URL para que el proveedor descargue contenido. El registro conserva hashes, sin duplicar el base64. Las transcripciones visuales quedan pendientes de contraste del original. La integración se comprobó contra el endpoint real de DeepSeek, además de pruebas del transporte y su caché. Flash admite visión según la [documentación del proveedor](https://api-docs.deepseek.com/guides/vision/).

Antes de planificar cambios se cotejan nombres canónicos, alias, integrantes y discografía existentes. Se añaden perfiles de identidad con biografía, pertenencias y créditos en discos y pistas del proyecto raíz. Una coincidencia nominal ambigua no crea automáticamente otra persona. Una coincidencia única ya vinculada al proyecto permite reutilizar su ID en dependencias de una propuesta; el motor de CRV sigue validando la operación.

La planificación separa los datos estructurados de la combinación de biografía. Cada ronda estructurada visita su grupo de citas; la síntesis recibe todas las citas y las narraciones existentes. Las rondas conservan sus respuestas en el caché, incluso cuando el contrato las rechaza. La combinación mantiene claves y dependencias válidas y conserva las fuentes completas. Una propuesta anterior queda deshabilitada si el conjunto de evidencia que la sustentaba cambia, salvo decisiones ya tomadas, que mantienen su historial.

## Resultados y revisión

Cada caso contiene las páginas leídas, capturas, hechos, citas, atribución, rechazos, fallos, incertidumbres, tokens registrados y referencia a su propuesta nativa. Su expediente Markdown presenta los hechos junto a su alcance —persona, proyecto, disco y canción— y los asuntos sin resolver. La propuesta nativa calcula valores anteriores y posteriores mediante una transacción de vista previa que se revierte.

Las operaciones se revisan en el flujo de curaduría de CRV. Esta campaña prepara propuestas y evidencia; no ejecuta aceptaciones automáticas del catálogo. Las contradicciones, identidades ambiguas, hechos visuales y relaciones que el modelo de datos aún no representa quedan explícitos. Los fundadores pueden conservarse en el expediente aunque el contrato actual de propuestas no escriba `membership_details`; no se finge que fueron importados. Tampoco se transforma una fecha de anuncio en concierto realizado ni una incorporación histórica en prueba de actividad vigente.

| Estado | Interpretación |
| --- | --- |
| `sources_discovered` | Fuentes candidatas localizadas; todavía falta recorrerlas |
| `collecting` / `extracting` / `planning` | Trabajo en curso |
| `done` | Terminó esta pasada sin fallos de recorrido declarados; aún puede haber revisión editorial |
| `partial` | Lecturas, atribuciones, identidades o propuestas pendientes |
| `no_primary_source` | No se recuperó una fuente utilizable en los intentos conservados; no prueba su inexistencia |
| Propuesta con error de vista previa | Operación bloqueada por las validaciones de CRV |
| Operación aceptada | Cambio aplicado y auditado por el flujo nativo, con posibilidad de reversión |

## Criterios de calidad

El objetivo de calidad se comprueba con evidencia, cobertura y pendientes visibles. Los contadores de hechos candidatos no equivalen a hechos verdaderos ni a datos incorporados.

| N.º | Criterio | Comprobación |
| ---: | --- | --- |
| 1 | Cobertura del catálogo | Lista auditada y estado por artista |
| 2 | Reutilización de investigación | Inventario, búsquedas, capturas y respuestas conservadas |
| 3 | Identidad del artista | País, repertorio, nombres e integrantes |
| 4 | Atribución primaria | Editor y citas, separados de la identidad |
| 5 | Titularidad pendiente | Bandcamp y otros perfiles sin afirmación administrativa inventada |
| 6 | Alcance de sellos | Artista estructurado del lanzamiento y navegación restringida |
| 7 | Lectura de páginas largas | Fragmentación con solapamiento y final conservado |
| 8 | Recorrido documental | Discos, canciones, biografías, PDF y créditos |
| 9 | Lectura visual | Bytes reales, hash y contraste pendiente |
| 10 | Citas verificables | Presencia literal en la captura |
| 11 | Fundadores explícitos | Vocabulario de fundación y participante identificado |
| 12 | Integrantes e invitados | Relaciones y tipos de participación diferenciados |
| 13 | Proyectos paralelos | Persona y proyecto explícitos en la cita de relación |
| 14 | Precisión temporal | Sin días inventados ni fechas relativas tratadas como exactas |
| 15 | Discografía y ediciones | Lanzamiento, soporte y regrabación diferenciados |
| 16 | Créditos por alcance | Disco/canción, rol, productor, estudio y colaborador |
| 17 | Identidades existentes | Alias, pertenencias y créditos antes de proponer nuevas personas |
| 18 | Conservación de biografía | Texto anterior y todas las citas para la síntesis |
| 19 | Contradicciones y fallos | Valores, causas y asuntos pendientes conservados |
| 20 | Cambios comprobables | Contrato tipado, vista previa nativa, decisión y auditoría |

La evaluación del conjunto sigue pendiente mientras continúen el recorrido y la revisión. Las pruebas de software verifican los controles; no certifican por sí mismas la exactitud histórica de cada publicación.
