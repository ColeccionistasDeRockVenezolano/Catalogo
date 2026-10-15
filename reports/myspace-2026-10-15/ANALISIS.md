# MySpace (Wayback) como fuente — análisis con 2HD (2026-10-15)

Encargo de Brian: «hay muchas informaciones que no se extrajeron de MA como las discografías y me
gustaría que buscara las informaciones de myspace y la analizaras para ver si le sacamos
informaciones para alimentar los campos» — con tres URLs de muestra:
ficha CRV `/crv/artistas/2288`, MA `bands/2hd/115777`, MySpace archivado `20100825075735/myspace.com/2hd`.

## 1. Estado del caso 2HD (medido, no asumido)

| Dónde | Qué hay |
|---|---|
| Catálogo CRV | ficha 2288 `2HD`, banda, Margarita, formada 2002, géneros Death metal melódico (principal) + Thrash metal, **6 integrantes**, **bio de 59 caracteres** («2HD es una banda venezolana de death metal formada en 2002.»), **0 discos** |
| Captura MA (`data/raw/metal-archives-ve-2026-10-01/`) | demo **«Dos humanidades diferentes»** (Demo, 2005, CD, Independent, «Recorded at R&M Studios (Caracas-Venezuela)») con **4 pistas con duración** (Hiel 1:41 · Gotas de alma 3:56 · Fantasmas apostólicas avernales 4:54 · No necesito morir 4:39); lineup 5 actuales + 1 pasado; years_active 2002-?; bio de 44 caracteres **en inglés** («2HD stands for "Dos Humanidades Diferentes"») |
| MySpace 2010-08-25 (Wayback) | **About de 1.195 caracteres en español** (historia completa), **5 miembros con instrumentos**, influencias, sello «Independiente», web `www.2-hd.tk`, miembro desde 30/11/2005 |

O sea: de MA se aplicaron las membresías (6 en el core) pero **no la discografía** ni una bio decente;
y el MySpace aporta justo lo que falta.

## 2. Qué aporta el MySpace, campo por campo

| Sección MySpace | Valor en 2HD | Destino en CRV |
|---|---|---|
| **About** | Historia en español: fundación a finales de 2002 en Margarita (Fernando Mendoza, Igor Hurtado, Omar Rodríguez, Ademir Arias); primera presentación en Puerto Ordaz (marzo 2003); entra el tecladista Pedro Laprea; julio 2003 sale Igor Hurtado y entra Francisco Laprea; 2004 toca en el Petróleo Bar de Valencia («única banda margariteña en tocar allí»); sale Pedro Laprea, entra Jonathan González; 2005 graba el demo «Dos Humanidades Diferentes» en R&M (Caracas) con los temas Hiel, Gotas de Alma, Fantasmas Apostólicas Avernales y No Necesito Morir | `artists.biography` (vía síntesis en español, ver guardas) |
| **Band Members** | Omar Rodriguez (Vocal), Francisco Laprea (Guitarra Rítmica), Jonathan Gonzalez (Guitarra Melódica), Fernando Mendoza (Bajo), Ademir Arias (Batería) | `public.artist_members` (role = instrumento) + personas; cotejable con MA (coinciden las 5 personas; MA escribe «Ademar», MySpace «Ademir») |
| **Influences** | Metal, Heavy Metal, Death Metal, Trash Metal, Metalcore, HxC, Grindcore | candidatos a `artist_genres` secundarios (con el vocabulario canónico y guardas) |
| **Record Label** | Independiente | coherente con el disco MA («Independent»/«Unsigned»): autoproducción, no sello-organización |
| **Band Website** | www.2-hd.tk | **sin campo en el core**: era un frameset a `geocities.com/doshdweb` (Geocities, cerrado) → dato histórico, iría en notas; hoy no es enlace vivo |
| **Member Since** | 30/11/2005 | histórico, fuera del core |
| **Reproductor / widgets** | En ESTE perfil los widgets incrustados son **de CORTEX** (vídeo `boVWfle_HTg` = «CORTEX ALIENTO NOCTURNO»; Jamendo álbum 55447 = CORTEX «La dignidad de los avasallados») | nada para 2HD: **no atribuir widgets de terceros** |
| **Amigos** | ~20 perfiles de bandas de la escena (`distrust`, `dischordccs`, `catarsisve`, `cortexmetalband`, `lenguajexcaustico`, `coleramorbus`, `bloodyburp`, `heimdallrwar`, `neurosisinc`, `losvandersrocks`, `lautimapalabradedios`…) | mina de descubrimiento (grafo de la escena), no un campo directo |

## 3. El hueco de Metal Archives (medido contra el catálogo vivo)

- Captura MA VE: **1.824 discos** → **705 discos no están en el catálogo** (cruce por título
  normalizado dentro de la banda; 123 de ellos son de **72 bandas sin ficha**).
- **Los 705 traen pistas capturadas: 4.245 pistas con duración** (todas entran con tracklist).
- Por tipo: Single 189 · Demo 177 · Full-length 109 · EP 107 · Split 49 · Compilation 42 ·
  Live 19 · Video 12 · Collaboration 1.
- Por banda, la captura guardó además: 611 `years_active`, **595 lineups actuales**,
  **592 discografías**, 375 bios, 367 lineups pasados → campos de banda por aplicar en las que
  ya existen (2HD es el caso típico: 6 miembros aplicados, 0 discos).
- Detalle por disco: `ma-discos-faltantes.jsonl` (band, title, type, year, label, format, pistas, url).
- Top bandas con discos faltantes: Mantra (15), Brooken (13), Raw Oath (12), Tinieblas (11),
  Atiko (10), Morghduet (9), Demise (8), Stratuz (8), Nemesis (8), Malevolencia (8).

## 4. Guardas medidas (lo que NO se puede hacer)

1. **El snapshot de 2010 perdió tildes y ñ**: «finales del ao 2002», «Rodrguez», «presentacion».
   Los bytes ya no están en el archivo → NO copiar literal al catálogo; el texto sirve como
   **evidencia** para una síntesis en español bien escrita (patrón de bios ya existente).
2. **Widgets de terceros en el perfil** (el caso CORTEX): verificar autoría antes de atribuir.
3. **El MySpace moderno (2014/2025) es un cascarón JS**: sin datos parseables; solo sirve el
   snapshot clásico.
4. **Slug real ≠ nombre**: `catarsisve`, `cortexmetalband`, `lenguajexcaustico`… Probado: buscar
   por «nombre sin espacios» da falsos negativos; los slugs buenos salen del grafo de amigos y de
   la ficha de cada perfil.
5. **Wayback se satura**: pasadas ~40 consultas al CDX empieza a devolver vacío (rate-limit) y todo
   parece «sin perfil» — hay que espaciar las consultas y re-verificar antes de concluir ausencia.
6. **Dos plantillas distintas**: el MySpace clásico (≈2005-2010) lleva los datos en
   `<td id="Profile<Label>">VALOR</td>` y en el `<title>` (ciudad, país, géneros, web — p.ej.
   Los Vanders 2008: «Puerto Ordaz, VE - Alternative / Rock / Metal - losvanders.com.ve»); la
   versión 2013+ es una plantilla JS sin datos en HTML (`distrust` 2013 = shell). El extractor
   `extraer-v3.py` cubre la plantilla clásica.
7. **MySpace/Wayback como fuente nueva** exigiría `sources:add` + aprobación (lista de fuentes
   cerrada); las capturas irían a `data/raw/myspace-<fecha>/`.

## 4.bis Cobertura medida (muestra, con la salvedad del rate-limit)

- Del grafo de amigos de 2hd (16 slugs): **con perfil clásico 200** → `distrust` (2013 → shell),
  `losvandersrocks` (2008, 183 KB, con Member Since, web propia y «Sounds Like»),
  `neurosisinc` (2008, 31 KB), `blasphemybanda` (2016, 27 KB), `aleisterpgd` (2009),
  `faustband2`, `aplaceforim`.
- Por nombre de banda del catálogo (20 slugs): `distrust`, `arkangel` (2007, 19 KB), `cortex` (2011).
- Los «sin perfil» incluyen falsos negativos por rate-limit: la proporción real hay que medirla en
  una campaña con pausas (1 consulta cada 2-4 s + reintentos).

## 5. Plan propuesto

1. **Piloto 2HD** (inmediato): crear el demo con sus 4 pistas y duraciones + portada de MA, escribir
   la bio (historia del About, cotejada con MA, con tildes correctas), revisar las 5 membresías
   (instrumentos en español) y dejar anotado el sello independiente. Todo con runs reversibles.
2. **Cerrar el hueco de discografías MA**: aplicar los **705 discos / 4.245 pistas** capturados que
   faltan (incluye 72 bandas sin ficha y 36 bandas con 5+ discos) + los campos de banda capturados
   (lineup, years_active), con el motor de altas existente y revisión previa.
3. **Campaña MySpace** (si el piloto convence): barrido con pausas de los perfiles clásicos
   archivados → bios en español, miembros con instrumento, headers (ciudad/géneros/web propia) y
   descubrimiento por el grafo de amigos. Alta de la fuente `myspace-wayback` con `sources:add`.

## Archivos de este análisis

- `2hd/perfil-2010.html` — snapshot completo (115 KB) · crudos también en `data/raw/myspace-2026-10-15/`.
- `2hd/about.txt`, `2hd/perfil-2010.json` — About y secciones extraídas.
- `2hd/demo-ma.json` — disco MA (ficha + tracklist con duraciones).
- `ma-discos-faltantes.jsonl` — 705 discos MA sin match (banda, título, tipo, año, sello, formato,
  pistas, url).
- `hueco-ma-pistas.py`, `hueco-ma.py`, `sondear-myspace.py`, `sondear-slugs.py`,
  `cobertura.py`, `cobertura-clasica.py`, `extraer-v3.py` — mediciones y extractor re-ejecutables.
