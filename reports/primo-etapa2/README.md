# Plan del primo — etapa 2: modelo discográfico y presentación (2026-10-12)

Plan: `~/Desktop/Plan primo/PLAN_POR_ETAPAS.md`, etapa 2 (puntos 7, 8, 9, 11, 12, 13).
Toda escritura va ligada a un run y se deshace con `runs undo <id>`.
Respaldos tomados antes de cada tanda que tocó el núcleo:
- `crv-20261012T140620Z`: antes de la migración.
- `crv-20261012T143531Z`: antes de separar los volúmenes.
- `crv-20261012T150403Z`: antes de cargar fundadores y periodos.

## 2A · Migración 0068 (solo tablas nuevas en `ingest`)

`migrations/0068_discografia_versiones_series_lugares.{up,down}.sql`:
- `album_versions` y `album_labels` (sello con rol: sello, distribuidor o licenciatario).
- `organization_relations` (sucesión; exige fuente).
- `series` y `series_albums`.
- `places`, `place_aliases` y `organization_places`.
- `credit_statements` y `credit_statement_parts`.
- `membership_details` (fundador con cita e instrumentos normalizados).

Todas las tablas están en el diario (0028), y cada FK tiene su índice. La vuelta atrás se probó en un contenedor desechable: up → down → up deja el mismo esquema.
`album_versions.release_date` no lleva CHECK con `ingest.crv_date_value_valid`: ese CHECK impedía que el down de 0060 borrara la función (test/contract/fact-inventory). Se quitó del up y de la base en vivo; la fecha la validan los scripts que escriben ahí (`parseDateValue`).

## 2B · Tandas de datos

| Tanda | Run(s) | Resultado |
|---|---|---|
| Versión inicial de cada disco (catálogo, soporte, sello del núcleo) | 19062, 19144 | una versión principal por disco con esos datos |
| Reediciones que juntó la run 18980 → versiones | 19063 | 20 versiones en 19 obras |
| Sellos compuestos partidos con rol (`scripts/primo-etapa2-sellos.ts`) | 19145 (19064 deshecha por 19065; 19066 deshecha por 19068 para separar antes los volúmenes) | 84 compuestos partidos, 36 sellos nuevos, 446 filas con rol; 3 nombres con barra son un solo sello (M/Saves, Sony/BMG, LOV/RECS) |
| Sucesión de Rodven con fuente (`primo-etapa2-sucesion.ts`) | 19067 | Sono-Rodven → Rodven (1995 a PolyGram Venezuela → 1999 Universal Music Venezuela); TH-Rodven y Líderes como divisiones; cada relación con su cita y URL |
| Volúmenes publicados por separado vuelven a su página (`primo-etapa2-series.ts --stage=separar`) | 19070–19141 (70 runs, uno por grupo) | 70 de los 71 grupos de la run 18980 separados con un deshacer acotado del diario (`undoRunWithJournal` con `scope`); Torrealba «Valses Venezolanos» (8752) queda junto porque lo fusionó Brian a mano (19007) |
| «Antología Vol. 10 (Reissue)» de Sevillano como versión del Vol. 10 | 19142 | |
| Series de los volúmenes | 19143 | 69 series, 189 discos con su número |
| Series del plan | 19146 | «Venezuela Electrónica» (6 discos, Vol. 1–3 con sus colores) y «Borrachos y Bolingas» (Vol. 1–4) |
| Versiones de «Flor de Fuego» según el máster de Discogs 1149840 | 19147 | 6 versiones con sello, país, año y URL |
| Créditos en frase del canal (`primo-etapa2-frases.ts`) | 19148 | 6.043 líneas de 608 videos, 15.364 tramos, 84 lugares canónicos con 124 escrituras (4 dudosas a revisión), 412 estudios ligados a su lugar |
| Instrumentos normalizados (`primo-etapa2-integrantes.mts --stage=instrumentos`) | 19153 | 8.740 de 10.234 membresías |
| Fundadores y periodos desde las biografías (DeepSeek flash propone, una llamada por banda; el código valida la cita) | 19175 | 1.567 bandas leídas; 2.919 marcas de fundador / no fundador con cita; 1.350 membresías con años nuevos (solo donde faltaban) |
| Periodos de Sincopa releídos de las páginas guardadas | 19176 | «(1985-)» bajo «Group Members» = actual (66); «(2011)» o «(2004/2013)» de exintegrante = año de salida (31) |

Después de estas tandas, 97 bandas tienen periodo en todos sus integrantes; entre ellas, Desorden Público (20 de 20).

## 2C · Pantallas

API (`src/api/repositories/discography.ts`, `src/api/routes/discography.ts`):
- La ficha del disco trae `versions`, `labels` (con rol), `series` y `creditStatements` (offsets en code points).
- La ficha de la organización trae `relations` (sucesión con cita y URL), `places`, `roleAlbums` y `studioAlbums`.
- Los integrantes traen `isFounder`, `founderEvidence` e `instruments`.
- Rutas nuevas: `GET /places/:id` y `GET /series/:id`.

Web (`web/src/components/Discography.tsx`, `pages/PlacePage.tsx`, `pages/SeriesPage.tsx`, `styles/discography.css`):
- **Disco:** sellos con su rol, línea «Serie: X – Vol. N» con el volumen anterior y el siguiente, lista sobria de versiones, créditos en bloques por rol con chips (el operador conserva el editor) y créditos del canal en frase con las partes enlazadas.
- **Lugar** (`/lugares/:id`): estudios y discos grabados, mezclados, masterizados o producidos ahí.
- **Serie** (`/series/:id`): volúmenes en orden.
- **Organización:** sucesión, ubicación, «Distribución y licencias» y «Discos hechos aquí».
- **Artista:** integrantes actuales, pasados y fundadores (con la cita). La línea de tiempo solo aparece si todos tienen periodo.

Criterios de salida comprobados en el navegador (API y web de prueba en puertos aparte):
- Plomo Revienta → «Hollywood, CA» abre `/lugares/9` con A&M Studios y sus discos.
- Flor de Fuego muestra 6 versiones.
- `/series/70` muestra Venezuela Electrónica.
- Rodven muestra su sucesión con fuentes.
- Desorden Público muestra su línea de tiempo.

Pruebas: `test/unit/discography.test.ts` y `test/contract/api-discography.test.ts`.

## Despliegue (2026-10-12)

- La web se compiló desde el commit 8bbab8b en una copia limpia, para no arrastrar cambios ajenos sin commit.
- Luego se copió a `web/dist-public` y se reiniciaron crv-api y crv-web. `db:migrate` no tenía nada pendiente.
- Resultado: `/crv/` y `/crv/api/health` responden 200, y los cinco criterios de salida responden en producción.
- Para volver atrás: el bundle anterior está en `/mnt/datos/tmp/crv-dist-public-prev-4bc3077`. Hay que revertir el commit y reiniciar.
- `test:browser` aprueba si la web se compila como en CI (`VITE_API_BASE_URL=/api npm run build`).

## Pendientes y avisos

- **«Los Andes Electrónicos» y «Think! Ok Records»** no tienen ningún disco en el catálogo ni en las fuentes leídas: hace falta ingerirlos para crear su serie.
- **«Borrachos y Bolingas» (#2209, 2006, Rockzuela, sin pistas)** parece ser la misma entrega que el Vol. 2 (#577, 2005, canal). No se fusionó ni se ligó a la serie.
- **Series de dos artistas:** «Super Super Supersónicos» aparece bajo Ivo y bajo Los Supersónicos. Hay dos series, una por artista.
- **Nombres sin enlace en las frases:** 274 distintos. Están en `frases-aplicado.md`; son personas o estudios que no existen en el catálogo o que tienen homónimos.
- **Extracción de fundadores:** 5 bandas quedaron sin propuesta porque la respuesta no cumplió el contrato (`integrantes-extraccion.log`).
