# Series de compilados

Solicitud de Brian (2026-10-27): las series públicas agrupan exclusivamente
discos de **Various Artists** (ver «Solo Various Artists» al final). Cada disco conserva su ficha; una colección tiene una página
`/series/:id`, aparece agrupada en `/series` y en `/discos?vista=series`.

## Comportamiento publicado

- `/series` (API y web) lista colecciones, con búsqueda por nombre de serie o
  título de una entrega, paginación y orden por nombre o año.
- La vista Series de Discos conserva búsqueda, categorías, género, década y
  orden en la URL. Cambiar de vista o filtro reinicia la paginación.
- Los filtros de categorías se combinan con Y sobre **un mismo disco**.
  La tarjeta representa toda la colección aunque sólo una entrega cumpla el
  filtro. Se muestran todas sus carátulas distintas disponibles.
- Cada tarjeta rota cada cinco segundos cuando está visible. Se pausa con
  hover, foco, pestaña oculta y el botón general. Movimiento reducido inicia
  la vista pausada. No es una selección diaria ni usa un reloj editorial.
- Imágenes fallidas se retiran de la rotación; sin imágenes se muestra un
  icono. No se fabrican portadas.
- El índice, las páginas de serie y la navegación entre discos usan la misma
  condición: todas las fichas visibles del grupo deben ser compilados por
  tipo o por la característica documentada `Compilation Album`.
- Los grupos históricos de estudio y directo sin característica de
  compilado conservan su evidencia en la base, fuera de las series públicas.
- Una caja o edición de varios CD permanece en una ficha. No se crean
  entregas por CD ni números de volumen ausentes de la fuente.

Implementación: `src/api/repositories/compilation-series.ts`,
`listSeries` en `src/api/repositories/albums.ts`,
`web/src/components/SeriesCard.tsx` y `AlbumsListPage.tsx`.

## Edición por la administración (2026-10-27)

Las cuentas administradoras crean, leen, corrigen y borran series desde la web.
Las reglas de publicación no cambian: `compilationSeriesSql` sigue decidiendo
qué serie es pública, y el editor muestra también las ocultas con su motivo
(`few_entries`: menos de dos entregas visibles; `not_various_artists`: alguna
entrega no es de Various Artists y la serie no es de sesiones).

- `/series` (y la vista Series de Discos): botón «+ Nueva serie» y panel
  «Series ocultas (N)» con el motivo de cada una.
- `/series/:id`: la administración la lee desde el editor, así que también abre
  las series ocultas. «Editar» corrige título, tipo (compilados o sesiones),
  descripción pública, notas internas, artista y sello; «Más → Retirar del
  catálogo» borra la serie y sus vínculos de entrega, nunca los discos. La
  sección «Entregas» añade discos, corrige número y etiqueta de volumen
  («Vol. IV» como lo escribe la fuente) y los retira. Cada entrega avisa si su
  ficha está oculta, si no es de Various Artists o si no es compilado.
- Ficha del disco, «En esta serie»: lista todas sus series, públicas u ocultas,
  y permite añadir el disco a una serie, corregir su volumen o retirarlo.

API (solo administración, bajo `/catalog-editor`): `GET/POST /series`,
`GET/PATCH/DELETE /series/:id`, `POST /series/:id/entries`,
`PATCH/DELETE /series/:id/entries/:entryId` y `GET /album/:albumId/series`.
Implementación: `src/catalog/series.ts` y `src/api/routes/series-editor.ts`;
interfaz en `web/src/components/SeriesEditor.tsx`.

Cada escritura exige motivo y es un run del operador. `ingest.series` y
`ingest.series_albums` tienen diario estricto: «Deshacer» desde el aviso o el
historial restaura la serie y sus entregas, y la página se vuelve a leer sola.
Un título repetido (sin distinguir mayúsculas) se rechaza para no partir una
colección en dos fichas; un disco no puede repetirse en la misma serie. Una
entrega conserva su disco: para cambiarlo se retira y se añade el correcto.

Pruebas: `test/contract/series-editor.test.ts` (contrato y deshacer) y
`npm run test:visual-series` (recorrido completo en Chromium contra un
contenedor, con comprobación en la base y en móvil).

## Investigación: primera publicación, objetivo todavía activo

Campaña: `reports/series-compilados-2026-10-27` (almacén compartido).
Se analizaron 1.929 candidatos del catálogo y se preservaron 417 páginas con
URL, fecha y HTML. La extracción de Sincopa distingue la sección explícita
`Compilations`; no convierte automáticamente `Special Editions` en compilados.

Se registraron 34 series nuevas y 185 asociaciones nuevas en los runs 36059,
36066 y 36070. Los runs 36061 y 36064 añadieron la característica de compilado a
62 fichas identificadas por URL exacta en la sección Compilations, sin quitar
sus demás categorías. Los planes y las escrituras pasan por
`withOperatorRun`, con revalidación, ensayo previo y diario de cambios.

El run 36068 añadió dos clasificaciones de compilado explícitas en las etiquetas de las fuentes de El Delicado Sonido del Rock.

La primera publicación reúne 60 series y 306 asociaciones públicas. Incluye
VenezuelaDemo, Metalkinesia, Venezuela Electrónica, Borrachos y Bolingas,
Venezuelan Pop Rockers, Rock: El Compilado y colecciones editoriales como
Serie 32, Serie Lo Máximo y Serie Premium.

### Trabajo restante

- Resolver los 41 casos de clasificación pendientes del plan de agrupación.
- Revisar las familias numeradas con una sola entrega conocida y comprobar
  si son series reales, CD de una caja o fichas parciales de participaciones.
- Contrastar duplicados y atribuciones de compilados a un intérprete
  participante (por ejemplo, fichas parciales de Metalkinesia y Melomaniac).
- Profundizar en series históricas donde la fuente mezcla recopilaciones y
  ediciones especiales; no basta el nombre «Colección» para clasificarlas.

La investigación no se considera terminada por haber publicado la interfaz.
No se crean series ficticias para hacer desaparecer la cola de revisión.

## Revisión y cierre (Claude, 2026-10-27)

La sesión de Codex se detuvo por límite de uso tras el run 36085. Revisión:

- **Una serie pública necesita al menos dos entregas catalogadas.** El run
  36085 había creado 11 series de una sola ficha (A Coñazo!, Araguarock, Dance
  Venezuela, La Canción Necesaria…), que no agrupaban nada. Conservan su
  registro y su número de volumen documentado; `compilationSeriesSql` las deja
  fuera de `/series`, de `/series/:id` y de «En esta serie» hasta que entre
  otra entrega. No se buscaron ni inventaron volúmenes ausentes del catálogo.
- **Series ocultas con evidencia de compilado.** Se consultaron Discogs y
  MusicBrainz para las 112 fichas de las series ocultas
  (`scripts/series-compilados-evidencia-externa.py`). Solo se añadió
  `Compilation Album` (sin quitar categorías) cuando la fuente lo dice para el
  mismo volumen o para la misma familia de títulos sin contradicción: 26 fichas
  de 12 series, run 36087 (Impactos de Billo, La Época de Oro de Billo,
  4 Colosos de Billo's, Colección de Oro: Lo Brillante…, Mis Éxitos y Más,
  Festival Torrealbero, Recordando a Los Melódicos, Sólo Éxitos y cuatro
  colecciones de Oscar D'León). Cada nota cita la URL usada.
- **Duplicados dentro de series**, run 36089: Venezuela 70 (400 ← 4690, mismo
  repertorio; título corregido a «Venezuela 70: Cosmic Visions of a Latin
  American Earth») y Venezuela Electrónica Vol. 2 «Blanco» (651 ← 2618; Discogs
  2231361 confirma la pista 6 «Canción Para Ti», «Frank King» era un error).

Resultado: 80 series públicas; 34 grupos siguen ocultos y 11 de una entrega.

### Pendiente

- Sin evidencia externa (quedan ocultas): colecciones digitales de Billo's de
  2020 (Ayer, Hoy y Siempre; La Gran Colección; Esta Noche… Billo; Mis
  Canciones Favoritas; Lo Brillante… sin «Colección de Oro»), Época de Oro de
  Los Melódicos, Colección de Oro y Cinco Estrellas de Dimensión Latina,
  50 Aniversario, Billos vs. Sonora, Serie de Autores, Colores de Venezuela,
  Aguinaldos de la Schola Cantorum.
- Evidencia contradictoria (ediciones álbum y compilado): Muy Venezolano,
  Cantos de Venezuela, Concierto en la Llanura, Super Super Supersónicos,
  ¡Oye… a Billo's!.
- Las restantes ocultas son obras de estudio o en vivo según la fuente y
  quedan fuera por la regla de Brian.
- Atribución errónea: la ficha 2364 «Ruidos Violentos Vol.1» tiene como
  artista «Ruidos Violentos Vol.1» en lugar de Various Artists.
- La prueba de lugares (`GROUP BY`) sigue fallando; es ajena a series.
- Evidencia: `reports/series-compilados-revision-2026-10-27/claude-ocultas`.

## Verificación

- Contrato de series: cinco casos relevantes pasan, incluyendo índice,
  paginación, filtros Y, grupos mixtos excluidos y características combinadas.
- Suite discográfica completa: 21 casos pasan; persiste un error previo en
  la consulta de lugares (`GROUP BY` de título), ajeno a series.
- TypeScript de backend y web, ESLint de los archivos modificados y build
  público correctos.
- Playwright: escritorio 1280px y móvil 390/320px; agrupación de VenezuelaDemo,
  rotación real, pausa, movimiento reducido, enlaces e índice; sin overflow
  ni errores JavaScript.
- El detector visual avisa de imágenes sin `src` literal en SeriesPage:
  `mediaImage` proporciona el atributo; el navegador confirma su carga.

Los scripts `scripts/series-compilados-*` separan inventario, captura,
extracción, planes, ensayo y aplicación. Sus salidas deben apuntar al staging
SSD y publicarse al HDD al cerrar la campaña, según SHARED_STORAGE.md.

## Solo Various Artists (Claude, 2026-10-27, run 36092)

Regla de Brian: «Las series deben ser sólo de various artists, no de artistas
que tienen vol 1, vol 2… de sus propias músicas». Ejemplo correcto: VenezuelaDemo.

- `compilationSeriesSql` exige que **todas** las entregas sean de Various
  Artists (por nombre, como «Aparece en») y que haya al menos dos. Ya no exige
  el tipo compilado: un festival en directo de VA (Festival Nuevas Bandas,
  W.T.Fest) es entrega de su serie.
- Decisiones de Brian: las colecciones de sello con un artista por volumen
  (Serie 32, Lo Máximo, Premium, Colección 20/20, Constelación de Éxitos,
  Colección Lo Mejor, Los Número 1, Millennium 21, Platinum, Yo Soy Venezuela)
  quedan registradas pero fuera de `/series`; igual «Rock Clásicos de
  Venezuela» de Hippito (un volumen por banda: Syma, Los Bonnevilles).
- Compilados a nombre de un pseudoartista pasados a Various Artists con
  `updateEntity` (auditoría en `merge_audit`): Compilado Zuliano I–III
  («Cabimas La Cuna Del Rock»), El Delicado Sonido del Rock I–V («Maracaibo»),
  Venezuela Ska I–II, Ciudad Ojeda es Rock 01–02, Venezuela Rock y Metal
  Vol. 1 («Rompiendo Muros») y W.T.Fest I–III. Los pseudoartistas quedan sin discos.
- Festival Nuevas Bandas (solo ediciones del festival): 5.º 1995, IX 1999,
  X 2000, Dosmiluno 2001, 20 Años en Vivo 2010 y Compilado 2015. IX, X y
  Dosmiluno salen de «Fundación Nuevas Bandas», que conserva los demás discos.
- Series nuevas halladas por título, sello y fuente entre los 276 discos de VA:
  W.T.Fest, Rock — Kandra, En la Onda (Mucer/Juke Box 1987), Páramo Pictures,
  Experiencia Psicotomimética, Gente en Ambiente, Escenario Juvenil,
  Guaicaipuro de Oro, Los Campeones, CD Manía — El Nacional.
- Resultado: 35 series públicas, todas de VA. Script `scripts/series-va-apply.mts`;
  evidencia en `reports/series-va-2026-10-27`.

### Ampliación de Gente en Ambiente y Metalkinesia (Codex, 2026-10-28)

Por indicación de Brian, Gente en Ambiente (201) incorpora El Alucinante
Mundo del Soul (379), Segunda Experiencia Psicotomimética (395) y Viva Una
Experiencia Psicotomimética (401): cinco entregas en total. Se conserva
también su pertenencia a Experiencia Psicotomimética. El Alucinante se
fecha en 1968, contrastado con la ficha 41025 y su referencia Souvenir
SLP 1347; Segunda conserva 1969 como publicación, distinto del concierto de 1968.

Metalkinesia (116) se amplía de 15 a 25 entregas únicas de la playlist
oficial `PLL10rKUIU0CUyL8xK5LcWCTMlnwtunykh`: se vincula Power Baladas
(1185) y se incorporan Táchira, Migración II, Bolívar, Migración III,
Miranda, Migración IV, Los Inicios, Guárico y Tributo al Rock Hecho en
Venezuela. El sello documenta ediciones musicales descargables en las
descripciones oficiales; no se generan pistas ni capítulos desde los videos.
Los años no contrastados quedan vacíos. Tributo conserva su etiqueta sin
número: el canal no lo numera. Los videos repetidos de Migración IV y Los
Inicios no producen entregas adicionales. Se vinculan los 25 videos
seleccionados, confirmados públicos e incrustables por la API de YouTube.

Script con ensayo transaccional: `scripts/series-gente-metalkinesia-2026-10-28.mts`.
Respaldo de vínculos previos, respuestas completas de YouTube, capturas,
errores 502 del sitio del sello y recibos de aplicación en
`reports/series-gente-playlist-2026-10-28`.

### Duplicados detectados (sin fusionar)

Mismo repertorio en dos fichas: Festival Nuevas Bandas 2001 (9993) ↔ Dosmiluno
(583); Rock I (2369, artista «Rock I») ↔ Rock (15726); Bands Vol.1 (3332) ↔ Ska &
Punk Venezuelan Bands Vol. 1 (641); Pop And Op Musical (392, 1969) ↔ (5038, 1968);
1967 Caracas 400 (4666, reedición 2005) ↔ 579; El Alucinante Mundo del Soul
379 ↔ 41025; Pide Más 391 ↔ 2832; Zona de Obras 402 ↔ 34050; Lo-Fi SM 3544 ↔
Tributo Lo-Fi 588; Borrachos y Bolingas 2209 (sin pistas) ↔ Vol. 2 577;
Venezuela Subterránea 591 ↔ 3277; Venezuela Electrónica 41639/41779 ↔ 650/652;
Compilado Vaginal 843 ↔ 835. Rock II de Industria Nacional (40663) e Irus (40666)
son mitades del VA 9968. Las fichas de participación sin pistas en el festival
(34251, 34253, 34255, 34272, 34408) no se tocaron.

## Caracas Sangrante y Sonó Así (Claude, 2026-10-27, run 36097)

Brian señaló dos series que faltaban. Script `scripts/series-sesiones-apply.mts`;
evidencia y portadas en `reports/series-sesiones-2026-10-27` y
`web/public/media/series-sesiones-2026-10-27`.

- **Caracas Sangrante** (serie 212): los dos recopilatorios de Humano Derecho
  (mayo de 2016, Bandcamp) **no estaban en el catálogo**; solo los citaban las
  páginas de RYM de 4to Reich y Apatía No, que nunca se convertían en fichas.
  Se crearon como compilados de Various Artists (fichas 42130 y 42131, sello
  Humano Derecho Records 351), con 13 pistas cada uno, duración e intérprete
  por pista. Cada intérprete se contrastó con una pista suya ya catalogada o
  con su alias («Guarapo» = Guarapo 69, «La Seguridad Nacional» = Seguridad Nacional).
- **Sonó Así** (serie 213): sesiones acústicas de UrbeVisión (Urbe), 2009–2010,
  tres temas por banda. Caso especial autorizado por Brian: **serie de
  sesiones** (`ingest.series.kind = 'sessions'`, migración 0104), que se
  publica aunque cada entrega sea de una banda. No vale para colecciones de
  sello con un artista por volumen. Las 17 entregas estaban a nombre del
  pseudoartista «Sonó Así» (1331) con el nombre de la banda como título; pasaron
  a su banda con el título «Sonó Así». Cuatro repetían una ficha del canal y se
  unieron a ella (66 Famasloop, 556 La Vida Bohème, 563 Nana Cadavieco,
  592 Viniloversus). Se creó la banda Randall's Project (8917). La serie tiene 18 entregas.
- **Pendiente de Brian:** Pzoom/Salpachino. El canal (ficha 567, video
  dIoTE9e2510) dice «Ya No Más / 30000 Pies / Son De Paz» y el blog (ficha
  3105, aún en el pseudoartista 1331) «Ya No Más / Resplandor / 30 Mil Pies».
  La fusión emparejaba por posición «Resplandor» con «30000 Pies»; no se fusionó.

### Por qué faltaban y casos iguales

1. Compilado ausente del catálogo, visible solo como «aparece en» de RYM: hay
   3.094 compilados de VA citados en las capturas de RYM y casi ninguno es ficha.
   Con señal venezolana destacan Comida para llevar (1.ª–3.ª Season), All-You-Can-Eat
   Vol. 1–3, Así se bonchaba Vol. 1–3, Color de Trópico 1–3, Música por medicinas
   Vol. 02 (la 1544 no indica volumen), ¿Quién quiere Tuki?, Bolero Primitivo,
   Nuestros sueños… sus pesadillas. Listas en `reports/rym-compilados-va-faltantes-2026-10-27`
   (166 candidatos con señal venezolana), extraídas de `rec.rows` en
   `data/raw/fuentes-web-2026-10-16/rym-resto/pages` y `rym-nuevos`/`rym-etapa3`.
2. Entregas de una serie a nombre de un pseudoartista con la serie por nombre:
   1331 «Sonó Así» era el único con muchas; otros compilados de un solo disco a
   nombre de su propio título: «Tributo Aldemaro Romero», «Tratándose de Colina
   Tributo», «Tributo Lo Fi», «Ruidos Violentos Vol.1», «Venezuela Dark Side»
   (Volumen 1), «Venezuela Subterránea».
3. Compilados de VA atribuidos a una banda participante: Predator T (Thrash
   Invasion Vol.1, V.A Latinoamérica Thrashing the World), Forgotten Moon (Black
   Metal Agenda Vol.18), The Silent of Death (Kimera's Memorial IV), Trance (Rock
   Total Magazine Nº1).
4. Misma sesión repartida en fichas de cada artista: «Boiler Room: Caracas» (2024),
   seis sets (Arca, Cardopusher, DJ Babatr, DJ Yirvin, MPeach, Safety Trance).
