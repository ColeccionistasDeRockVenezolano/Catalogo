# CRV · Fuentes musicales venezolanas · 13 de octubre de 2026

El informe recibido se convirtió en un [inventario JSON](../data/research/venezuelan-music-sources.json) y en entradas para la investigación dirigida existente. Se reconstruyeron **34 proyectos musicales, 53 URL y dos fuentes de descubrimiento**. Hay **ocho proyectos de prioridad crítica**. Los números 35/62/16 del informe se conservan como cifras declaradas, pero no se presentan como conteos comprobados: el JSON original y sus enlaces no estaban incluidos.

La comprobación encontró 42 páginas con texto recuperable, cinco URL localizadas únicamente en el índice y seis URL cuya lectura directa falló. De las páginas recuperadas, 36 ofrecen entradas pertinentes para investigar fichas; las páginas promocionales y los directorios generales no se añaden automáticamente. Los conteos se calculan desde el JSON:

```bash
npm run research:sources -- --summary
npm run research:sources
```

El primer comando valida y resume el inventario. El segundo emite el JSON validado a stdout. Ambos funcionan sin base de datos, red ni llamadas a modelos.

## Revisión del informe

El valor principal del inventario es documentar personas, proyectos y grabaciones con evidencia por afirmación. La [biografía de Zapato 3](https://www.zapato3.com/biografia) efectivamente relata formaciones, sustituciones y Un Perfecto Extraño. La [biografía de Paul Gillman](https://paulgillman.com.ve/biografia/) permite investigar Power Age, Arkangel, Gillman y otros proyectos; su [discografía](https://paulgillman.com.ve/discografia/) separa trabajos oficiales y no oficiales, aunque algunas celdas no entregaron títulos legibles.

Las fichas de [Tiempo al Tiempo de C4 Trío](https://www.c4trio.com/en/album/tiempo-al-tiempo/), [Tierra de Nadie de La Vida Bohème](https://lavidaboheme.bandcamp.com/album/tierra-de-nadie), [Museo de Los Pillos de Los Mentas](https://losmentas.bandcamp.com/album/museo-de-los-pillos) y [Todo Bailarlo de Zeta](https://joinzeta.bandcamp.com/album/todo-bailarlo) contienen créditos que justifican su prioridad. El sitio de [Jorge Glem](https://www.jorgeglem.com/) enumera sus proyectos con Sam Reider, César Orozco y C4 Trío, aunque la ruta específica `/proyectos/` falló en reintentos posteriores. La [biografía de Simón Díaz](https://simondiaz.com/biografia/) fue legible; su discografía quedó pendiente por fallos de lectura.

Hay precisiones que el informe original necesita:

- **Lectura y descubrimiento:** encontrar una URL en un buscador no demuestra acceso directo ni lectura completa. `page_read` indica texto recuperado e inspeccionado; no certifica que el lector recuperara todas las secciones, scripts o imágenes. La cobertura real se registra cuando CRV captura y procesa cada documento.
- **Oficialidad:** `self_identified` describe la presentación del propio sitio, sin certificar titularidad administrativa. Los 17 perfiles o lanzamientos de Bandcamp quedan con `authorityStatus=unverified`, incluso cuando su contexto coincide con el proyecto venezolano. Se pueden investigar como candidatos, sin convertirlos por eso en redes oficiales confirmadas.
- **Acceso:** Sentimiento Muerto, Luz Verde, Yordano y la tienda de XL Recordings para Arca no pudieron leerse directamente. Arca devolvió HTTP 403; las otras lecturas agotaron el tiempo. Se conservan como pistas, excluidas de las entradas automáticas. La portada de Danny Ocean redirige a `/new/` y aporta muy poco texto; se añadió como alternativa la [página de su sello](https://www.warnermusic.com.mx/artistas/danny-ocean).
- **Identidad:** se excluyeron resultados de ZETA británico, Arcángel urbano, Elena Rose/Ellen Rozsa y Joaquina de Bolivia. El nombre parecido no establece identidad.
- **Cobertura:** no se localizó la cronología específica descrita para Dudamel; se registraron su biografía y un índice discográfico del sello. El perfil de Viniloversus solo entrega una presentación, sin un catálogo de lanzamientos visible.
- **Géneros:** `genreHints` conserva orientaciones del informe y de esta investigación como no verificadas. No se importan como géneros del artista o de sus álbumes.
- **Fechas:** `checkedAt` es el día de esta comprobación y `accessedAt` registra el día de lectura cuando ocurrió, sin inventar una hora por URL. `capturedAt` queda nulo porque el lector web y el índice pueden usar copias de fecha desconocida. El broker de CRV registra la fecha y hora reales de sus propias capturas.

El [directorio de MúsicaVenezuela](https://www.musicavenezuela.com/artistas) se conserva como fuente secundaria para descubrir proyectos. La [página de Nuevas Bandas/Cusica](https://store.cusica.com/nuevasbandas) procede del organizador para la historia del festival, pero su lista de bandas no demuestra por sí sola el año de participación, un concierto realizado o un premio.

## Integración implementada

`src/verification/source-inventory.ts` valida el archivo con Zod y selecciona URL finitas por nombre completo o variante explícita. `researchVerification()` añade esas URL a las de la ficha y elimina duplicados antes de crear tareas. Las páginas pasan por el broker, capturas, controles de identidad, lectura por fragmentos, citas y estados de revisión que CRV ya utiliza.

Para un álbum se busca su artista y se excluyen las fichas de otros lanzamientos; para una pista se utiliza el artista y el álbum de su contexto. Una organización no recibe fuentes de un intérprete. Los alias generales de la ficha no se usan para incorporar páginas de proyectos relacionados. Si el perfil declara un país incompatible con Venezuela, se omiten estas entradas y continúa el flujo normal de investigación. Un perfil con residencia extranjera requiere revisar cómo se ha registrado su país antes de depender de esta selección.

Las URL de índices, fallidas, promocionales o secundarias no entran en la selección automática. Si una página admitida falla en una investigación posterior, el ledger conserva el fallo y permite reintentar; la comprobación del inventario no sustituye la captura actual. Reanudar usa las tareas guardadas; reevaluar evidencia conservada no hace red.

El inventario no sirve de evidencia musical al modelo: solo sus URL dirigen la lectura. Los extractos del inventario documentan esta revisión, mientras que cada hallazgo necesita una cita de la captura usada por CRV. Ningún registro del JSON se convierte automáticamente en artista, disco, crédito, membresía o medio público.

Esta integración corresponde a la autorización del usuario de preparar el inventario, integrarlo y revisar el plan. Es una ampliación de las entradas de investigación puntual; el registro cerrado de adapters para scraping masivo, los seeds XLSX y `ingest.sources` conservan su proceso de incorporación descrito en [ADDING_A_SOURCE.md](ADDING_A_SOURCE.md). No se crearon adapters ni se habilitaron filas de scraping, por lo que sus pruebas de ingesta masiva no son criterios de aceptación de este cambio.

## Plan de enriquecimiento

| Orden | Proyecto y página inicial | Resultado buscado |
| --- | --- | --- |
| 1 | C4 Trío · Tiempo al Tiempo | Créditos por instrumento/pista, productores, estudios, sello y colaboradores |
| 2 | Paul Gillman · Biografía | Personas y períodos de participación; separar persona, banda y nombres históricos |
| 3 | Zapato 3 · Biografía | Formaciones históricas y relaciones con Un Perfecto Extraño y otros proyectos documentados |
| 4 | La Vida Bohème · Tierra de Nadie | Lista de pistas y créditos diferenciados de producción, mezcla, ingeniería y arte |
| 5 | Los Mentas · Museo de Los Pillos | Créditos, estudios y candidatos a relaciones de versión con evidencia de cada obra |
| 6 | Zeta · Todo Bailarlo | Discografía y créditos sin incorporar reseñas de compradores ni recomendaciones de otros artistas |
| 7 | Simón Díaz · Biografía | Cronología y composiciones; recuperar la discografía antes de declarar cobertura de álbumes |
| 8 | Jorge Glem · Portada y discografía | Proyecto solista, dúos y C4 Trío como entidades distintas |

La preparación inicial del inventario no lanzó llamadas pagadas. Después Brian autorizó la campaña sin límite de gasto: ahora se recorren las fuentes y se preparan propuestas nativas, ampliando el descubrimiento al resto del catálogo. El proceso y su recuperación se documentan en [OFFICIAL_ENRICHMENT_CAMPAIGN.md](OFFICIAL_ENRICHMENT_CAMPAIGN.md), con seguimiento en [RESULTADOS.md](../reports/official-enrichment-2026-10-13/RESULTADOS.md).

| Evidencia encontrada | Destino o tratamiento en CRV |
| --- | --- |
| Historia, fechas y formaciones | Afirmaciones separadas, cronología y biografía con citas |
| Integrante, rol y período | Candidato a membresía; ser músico invitado no prueba membresía |
| Disco y lista de canciones | Álbum y pistas de la misma edición y soporte |
| Producción, ingeniería, mezcla y masterización | Créditos por disco o pista, conservando el alcance documentado |
| Estudios, sellos y productoras | Organizaciones con relaciones respaldadas por créditos |
| Proyectos paralelos o anteriores | Hallazgos de relación; no fusionar las entidades automáticamente |
| Versiones y composiciones | Conservar el hallazgo y la evidencia; revisar la representación de obra/grabación antes de materializar relaciones |
| Conciertos y giras | Distinguir anuncio de evento realizado y registrar evidencia histórica; no crear fechas de actuación sin respaldo |
| Imágenes y textos protegidos | Candidatos con atribución y revisión de derechos antes de reutilización pública |

La segunda pasada amplía la cobertura a las fuentes de prioridad alta. Las páginas fallidas y la titularidad de Bandcamp forman una cola de comprobación separada. El desarrollo de adapters masivos requiere una propuesta de alcance concreta y las comprobaciones de acceso, fixtures e idempotencia establecidas por CRV.

## Validación del cambio

Las pruebas del inventario cubren validación, conteos derivados, identidad, selección por lanzamiento, deduplicación, procedencia, pausa/reanudación y ausencia de red en reevaluación conservada. Se ejecutan junto con las pruebas existentes de recuperación, lectura de fuentes e identidad. No utilizan páginas vivas ni llamadas a modelos; la comprobación externa queda documentada en cada URL del JSON.

Resultado del 2026-10-13: `npm run test:unit` pasó **907 pruebas en 98 archivos**; `npm run typecheck` y ESLint sobre los archivos TypeScript modificados también pasaron. El resumen del inventario validó 36 entradas para 30 proyectos; Arca, Sentimiento Muerto, Luz Verde y Yordano quedaron sin entradas automáticas por fallos de acceso. La discografía de Los Amigos Invisibles se contrastó además con una lectura HTTP pública que devolvió 200 y una lista textual de lanzamientos, después de fallos intermitentes del lector web.
