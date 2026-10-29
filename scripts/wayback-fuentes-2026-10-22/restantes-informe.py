"""Informe de filas sobrevivientes y decisiones; no toca la base de datos."""
import json, shutil
from pathlib import Path
from collections import Counter
O=Path('/home/brian/crv-staging/reports/wayback-restantes-2026-10-23')
c=json.loads((O/'cierre-catalogo.json').read_text());n=lambda table:c['counts'][table]['newAlive']
f=json.loads((O/'fechas-resoluciones-aprobadas.json').read_text());e=json.loads((O/'evidence-results.json').read_text())
held={x['name'] for x in c['unassignedCredits'] if x.get('name')}
text=f'''# Recuperación de pendientes del archivo Wayback

Cierre de la base: {c['closedAt']}. Suplemento de la incorporación del 23 de octubre de 2026, autorizado expresamente por Brian para aprovechar toda la información restante e investigar los conflictos.

Las cifras siguientes son **adicionales a la incorporación anterior**, calculadas desde las filas sobrevivientes del diario nativo. No se suman los intentos de fases repetidas ni los duplicados que se fusionaron. Manifiesto: [cierre-catalogo.json](cierre-catalogo.json).

## Aplicado en el catálogo activo

| Resultado adicional | Cantidad |
|---|---:|
| Artistas/proyectos nuevos | {n('public.artists')} |
| Pares de artistas unificados por identidad documentada | 4 |
| Publicaciones musicales nuevas, netas | {n('public.albums')} |
| Pares de publicaciones duplicadas unificados | 4 |
| Pistas nuevas, netas | {n('public.tracks')} |
| Nuevas relaciones históricas de integrantes | {n('public.artist_members')} |
| Personas nuevas, después de la depuración de créditos | {n('public.persons')} |
| Organizaciones gráficas nuevas | {n('public.organizations')} |
| Créditos nuevos de publicaciones / pistas | {n('public.album_credits')} / {n('public.track_credits')} |
| Variantes de edición documentadas | {n('ingest.album_versions')} |
| Años originales corregidos en la revisión de 54 conflictos | 10 |
| Efemérides nuevas con fecha completa declarada por artista/editor | {n('ingest.ephemerides')} |
| Documentos nuevos en Otros | {n('media.artist_documents')} |
| Documentos nuevos visibles / retenidos por decisión editorial | {c['visibleDocuments']} / {c['documents']-c['visibleDocuments']} |
| Registros de hitos con año, ahora consultables en cronologías de artistas | 1076 |

Se crearon Armando y Alejandro, Pachi Jiménez y los Matamoro Mackenzie y DJ Electro (Daniel Arias). Las fusiones documentadas son Joudy Ju → Joudy; Presidente → Sr. Presidente; Rafael L. Garnica → Garnica; Miguel Ángel Noya → Miguel Noya. Tres biografías fusionadas se revisaron antes de aplicarse; Loocila se documentó como proyecto solista de Lorena Orlando. Zion se identificó con Zion TPL por integrantes y ciudad; su fecha de formación sigue discrepante, expresamente documentada.

Los cuatro pares de discos unificados fueron El Soundtrack de Tus Historias Vol. 1, Festival Nuevas Bandas 2015, En vivo en Carora y Cala. Se conservaron las 20 y 16 posiciones coincidentes de los dos compilados, sus intérpretes y créditos. Cala quedó bajo el dúo documentado; se conservó la referencia de 2020 como variante frente al estreno de 2014. La fecha original de Soundtrack quedó en 2010. Las 46 pistas insertadas durante la fase no son 46 altas netas: 36 coincidieron con pistas preexistentes y se fusionaron, dejando 10 altas netas.

Los 41 registros de fuentes discográficas pendientes —40 títulos— tienen ahora asignación y documentación: **cero fuentes pendientes sin documento**. Las ocho imágenes de Loocila se comprobaron en su galería con títulos y descripciones; ya estaban incorporadas, por lo que este suplemento no las cuenta como imágenes nuevas.

Se revisaron los créditos directamente por párrafos HTML, separando funciones, coautores, colectivos, estudios y títulos de obras. Se retiraron las entidades mal interpretadas durante los intentos iniciales y se fusionó María Carolina Rauseo con la identidad documentada Carito Rauseo. La atribución de MASA se corrigió con fuentes de identidad. No se creó una persona a partir del título del film Le Sauvage ni del título de una pintura. Los literales, enlaces de autor y decisiones permanecen en Otros.

## Destino de cada grupo que estaba pendiente

| Grupo previo | Aprovechamiento y límite |
|---|---|
| 23 propuestas documentales rechazadas | 21 se recuperaron o reasignaron al artista/contexto correcto; dos biografías extranjeras quedan como evidencia de revisión, sin atribuirlas a bandas venezolanas. Se recuperó la entrevista completa de Fidel Nadal como contexto histórico y se conservaron autores y preguntas/respuestas. |
| 36 propuestas de integrantes | 28 relaciones nuevas; seis ya existían con variantes documentadas; dos nombres incompletos quedan en el texto, sin crear personas. Se añadieron además cuatro vínculos de titulares/proyectos contrastados. |
| 62 propuestas de créditos y 42 asociaciones retiradas previamente | Se sustituyó el recuento de propuestas por revisión de los párrafos originales de 257 fuentes. Los resultados netos son los créditos indicados arriba; no todos los intentos representaban información ausente. |
| 1076 hitos sin día y mes | Se conservan como registros en cronologías públicas de 402 artistas, dentro de Otros → Eventos. No se inventa una fecha anual de aniversario. El recuento es de registros, no de acontecimientos únicos. |
| 819 pares artista/disco de distribución CaracasPunk | Conservados en 23 documentos de catálogo y contexto internacional. Una tienda distribuidora no demuestra nacionalidad ni autoría local. |
| 56 nombres del directorio Skaypunk | Conservados como directorio histórico contextual, sin adjudicar países a partir de una lista global. |
| Siete anuncios de conciertos | Documentos de eventos con fecha/cartel de la fuente y etiqueta de realización no confirmada. |
| Once referencias Fusible: seis álbum / cinco canción | Conservadas como referencias sonoras/listas con repertorio y atribución. Los dos sets de DJ Electro también se documentaron en su ficha; la casilla «album» de una plataforma social no prueba una edición musical. |
| Once discrepancias de pistas | Ocho títulos se conservaron como alias documentados; tres diferencias de orden/repertorio se documentaron como posible variante de edición, sin alterar posiciones ni marcas de reproducción arbitrariamente. |
| Diez referencias audiovisuales | Se conservaron inventario, etiqueta de campaña y documentos. La revisión de candidatos del catálogo y la consulta oficial del ID de YouTube identificable no recuperaron una versión incrustable confirmada; siguen sin reproductor público. |

Etiquetas comunes: `archivo-wayback-2026-10-22` y `recuperacion-restantes`. Se conservan etiquetas de contenido y conflicto para permitir reclasificación en lote desde Otros. Las listas internacionales y referencias sin artista venezolano confirmado están en el contexto de Varios artistas, sin crear fichas por mera mención.

## Fechas: resolución de los 54 expedientes

| Decisión aprobada | Cantidad |
|---|---:|
| Año original corregido con evidencia suficiente | 10 |
| Año actual respaldado por artista/editor | 5 |
| Diferencia de edición o alcance conservada | 3 |
| Conflicto de tipo de publicación, con año coincidente | 2 |
| Año original aún sin prueba suficiente | 34 |

Los diez años corregidos son A.O.M. (2011), Breve Casi Eterno (2013), El Segundo (2013), Superllanero (2003), Todo Muerto (2009), Coctel #5 Cacao, Mujer y Beats (2006), La Reina Peinándose (2008), 46 dpi (2015), Cuentos, Cantos y Espantos (2012) y Un Cuento Sin Pensalo (2009). La distribución digital de 46 dpi en 2016 se conservó como variante; no se borró su evidencia. El año 2025 antes asignado a Cuentos, Cantos y Espantos se conserva como dato discrepante, sin inventar una reedición de 2025. Un 1 de enero genérico de plataforma y los anuncios futuros no se convirtieron en efemérides verificadas.

Las fuentes y motivos individuales están en [fechas-resoluciones-aprobadas.json](fechas-resoluciones-aprobadas.json). Los expedientes conservan fuente histórica, estado anterior y comparación. **fechas-decisiones.jsonl contiene propuestas automáticas no aprobadas**; no es la resolución editorial ni autoriza escrituras. Algunas propuestas confundían el alcance de una edición y por ello no se aplicaron.

## Lo que continúa sin asociación o sin fecha exacta, y por qué

- **Nueve identidades de créditos:** {', '.join(sorted(held))}. Hay homónimos, alias sin vínculo inequívoco, un nombre incompleto o incertidumbre entre persona y entidad. El nombre literal, función y enlaces sí están publicados en Otros con `identidad-de-creditos-en-revision`; falta la asociación a una identidad normalizada.
- **Dos integrantes con nombre incompleto:** Luis / Luis Felipe y Daniel «el nuevo». Se conserva lo escrito por la fuente, sin ampliar nombres.
- **34 fechas originales y dos tipos de publicación:** las fuentes no distinguen de forma suficiente original, edición digital, gráfica, grabación o publicación. Se conserva el conflicto en cada artista; no se pierde la información de la fuente.
- **Tres diferencias de posición/repertorio:** ocho variantes ortográficas ya tienen alias; las tres restantes requieren una edición identificable para modificar el orden.
- **1076 registros históricos con año:** siguen sin día y mes para el calendario de aniversarios, aunque ya son legibles en las cronologías. No son una pérdida de contenido.
- **Diez audiovisuales:** ninguna reproducción incrustable recuperada está confirmada conforme a la regla editorial de YouTube.
- **Zion:** identidad resuelta; se mantienen las versiones 1996/1998 de formación. **Mind Shelter:** su vínculo venezolano queda documentado, conservando Holanda y la exclusión editorial vigente.
- Las biografías de Chicovar (México), Desorden Social (Colombia) y los otros homónimos descartados se conservan como evidencia de revisión; no se convierten en biografías de artistas distintos. La noticia de 2001 sobre el técnico Oswaldo Rodríguez no demuestra que sea Manao: se ocultó esa asociación, manteniendo el premio públicamente en Caramelos de Cianuro (documento 1496).

## Evidencia, verificación y recuperación

Se realizaron 175 búsquedas iniciales, consultas complementarias y 54 intentos directos de búsqueda Bandcamp. Estos últimos devolvieron desafíos de JavaScript y no se usaron como prueba de ausencia. Se conservaron {len(e)} resultados de captura; una respuesta HTTP 200 con desafío no se considera una página verificada. Se utilizaron los catálogos de artista/editor, entrevistas y prensa de época para resolver sólo las discrepancias necesarias.

- {len(c['runs'])} runs nativos del suplemento, todos con estado `ok`; diario completo en [diario-cambios.json](diario-cambios.json). Los errores de intentos iniciales siguen registrados y fueron corregidos/reintentados; no representan cambios confirmados.
- Cero fuentes pendientes de las 41 referencias discográficas; cero referencias JSON a discos o personas eliminadas en los documentos del suplemento; cero entidades mal formadas de la lista auditada aún existentes. Detalle: [verificacion-integridad.json](verificacion-integridad.json).
- Ocho fichas reales respondieron HTTP 200; Loocila devuelve ocho imágenes en galería. Se verificaron compilados de 20/16 pistas y el disco nuevo de Pachi de diez pistas.
- Contratos de documentos y galería: **cinco pruebas correctas** en PostgreSQL desechable, incluyendo permisos, pertenencia, lotes, edición e historial/deshacer. Evidencia: `contratos.log`.
- TypeScript de los scripts del suplemento y sus dependencias: correcto (`typecheck-suplemento.log`). La compilación global se detuvo en un error de sintaxis ajeno al suplemento, `scripts/mp3com-archivo.mts:31` (TS7060), observado durante trabajo simultáneo sobre esa campaña. No se modificó ese archivo.
- Respaldo consistente anterior a las mutaciones de este suplemento: `/mnt/datos/backups/crv/wayback-restantes-before-20261023.dump`. Índice legible con `pg_restore --list`, guardado en `respaldo-contenido.txt`. No se presenta como restauración ensayada.

La línea base `antes-*`, previsualizaciones de fusiones, planes, aprobaciones y fuentes se conservan en este informe. Las fuentes originales y los informes anteriores permanecen sin sobrescribir. Las copias de los scripts usados están en `scripts-reproducibilidad/`; requieren revisar rutas, permisos y decisiones antes de ejecutarlos. La publicación del informe usa staging SSD → almacén de 1 TB con comparación SHA-256.
'''
(O/'INFORME.md').write_text(text)
(O/'PROPUESTAS-NO-APROBADAS.md').write_text('Las propuestas de fechas-decisiones.jsonl no están aprobadas. La única resolución editorial es fechas-resoluciones-aprobadas.json. No usarlas para escrituras. Las discrepancias y límites están en INFORME.md.\n')
dest=O/'scripts-reproducibilidad';dest.mkdir(exist_ok=True)
for f in Path('scripts/wayback-fuentes-2026-10-22').glob('restantes-*'):
 if f.is_file():shutil.copy2(f,dest/f.name)
shutil.copy2('scripts/wayback-fuentes-2026-10-22/catalogo-complementos.mts',dest/'catalogo-complementos.mts')
print('Informe creado',len(text),'caracteres')
