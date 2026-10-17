# Insumos para Laya y para la búsqueda contextual del catálogo (medido 2026-10-16)

Todo lo de aquí está **comprobado en los ficheros y en la BD viva** (no de memoria). Se separa por
fuente y por tipo: **APIs oficiales · webs scrapeadas · fuentes propias (audio/prensa) · señales ya
aplicadas al catálogo**. Cada bloque dice *qué campos hay*, *cuánto*, *dónde vive* y *para qué sirve*
(alimentar a Laya como etiqueta tipada, y/o como faceta de búsqueda contextual humana).

Regla de lectura del «estado»:
- **aplicado** = ya está en la base (`public.*`, `ingest.*`, `media.*`) y se puede consultar/usar hoy.
- **crudo** = capturado y parseado en `data/raw/**` o `reports/**`, listo para extraer (nadie lo ha escrito aún).

---

## 1. RYM (rateyourmusic.com) — la fuente más rica en señales humanas

Capturas: `data/raw/fuentes-web-2026-10-01/rym-nuevos/pages` (7.328 discos), `…/rym-etapa3/pages`
(779), `data/raw/fuentes-web-2026-10-16/rym-resto/pages` (2.532 fichas de artista en curso),
`data/raw/rateyourmusic` (caché del pipeline, 571), y **`data/raw/rym-reviews-2026-10-16/` (nuevo)**.

| Dato | Volumen | Dónde | Estado |
|---|---|---|---|
| Géneros por disco (vocabulario RYM, ej. «Cloud Rap, Ambient Plugg») | 7.328 fichas | `rel_*.json` campo `rec.genres` → claims | aplicado (claims/vocabulario) |
| **Descriptors** (tags de comunidad, ej. calm, melancholic, atmospheric) | **7.328/7.328 (100 %)** | HTML `release_pri_descriptors`; también dentro del texto `info` del .json | **crudo** |
| **RYM Rating + nº de votos** por disco | 4.462 fichas (61 %) | HTML `avg_rating` + `num_ratings` | **crudo** |
| Ratings por disco en la ficha de artista (rating + votos + nº reviews, fila a fila) | 16.068 filas (de 2.532 fichas) | HTML `disco_avg_rating` / `disco_ratings` / `disco_reviews` | **crudo** |
| **Reviews completas** (usuario, fecha, estrellas, votos, título, texto) | **1.004 reviews / 145 páginas / 39 discos** | `data/raw/rym-reviews-2026-10-16/reviews.jsonl` | **crudo** |
| Rating por pista dentro de reviews | 258 reviews → 3.129 pistas calificadas | ídem (`reviews[].tracks`) | **crudo** |
| Idioma(s) del disco (ej. «Spanish, English») | 347 fichas | HTML `info_hdr">Languages` | **crudo** |
| Bio de artista | 774 + lote bios | `rym-bios/`, `rym-nuevos` | aplicado (biografías sintetizadas) |
| Ubicación actual / origen / formación | 572 artistas «Currently» | `artists.current_city/current_country` (migr. 0083) | aplicado |
| Discografía por artista (título, año, tipo) | 25.310 filas | `estado.json` `rows` {h,t,y,ty} | aplicado (altas/enlaces por otras campañas) |
| Portadas / fotos | miles | `og` + imágenes | aplicado (`media:*` + 1.336 pendientes de carátula) |
| Tracklists + créditos (persona/rol) | 3.554 discos con pistas | `rec.tracks`, `rec.creditLinks` | aplicado (créditos/personas) |
| Enlaces de escucha de la ficha | 2.110 | `public.streaming_links` source `rym-data-links` | aplicado |
| Tipos DJ Mix / Mixtape | 596 + 371 fichas | `rec.kind` | **pendiente de decisión editorial** |

**Para Laya**: los *descriptors* son la señal `community_tag` más directa que hay (comunidad pura,
sin conteo de votos → exige fijar umbral por posición). Los géneros RYM ya entran como
`editorial_genre`. El rating numérico NO es género: es métrica de calidad/contexto (leerlo como
faceta, no como claim). Las reviews son texto libre: material para mood/temática con el mismo
modelo de Laya que ya clasifica tags (ver §6).
**Para la búsqueda contextual**: mood («melancólico», «atmosférico»), calidad (rating + nº votos),
idioma, era (año), popularidad (nº ratings), y «reseñas de la comunidad» como contenido.

---

## 2. Last.fm — tags de comunidad, popularidad y similitud (API oficial)

Capturas: `data/raw/lastfm/` (33 MB), `data/raw/lastfm-bio/` (132 MB, 23.520 fichas),
`reports/lastfm-shouts-2026-10-16/` (322 MB).

| Dato | Volumen | Dónde | Estado |
|---|---|---|---|
| **Tags de artista + peso (nº de usuarios)** | **6.564 filas · 1.280 artistas · 1.750 tags** | `public.entity_user_tags` (source=lastfm) | **aplicado** |
| **Tags de álbum** | **4.812 álbumes · 1.115 tags distintos** (top: venezuela 3.078, latin 1.656, venezuelan 746, salsa 606, pop 582, rock 506, spanish 424, folk 408…) | `data/raw/lastfm-bio/**` → `album.tags.tag[]` | **crudo** |
| Listeners / playcount | **25.119 filas** → 5.952 artistas + 1.048 álbumes + 18.119 pistas | `public.entity_metrics` (source=lastfm) | aplicado |
| Artistas similares | 1.236 artistas con `similar.artist[]` (5 cada uno ≈ 6.000 pares) | `data/raw/lastfm/**` | **crudo** |
| Tracklists por álbum | 6.880 fichas | `lastfm-bio` `album.tracks` | crudo |
| Bio de artista | 163 textos (campaña 2026-10-05) | `lastfm-bio` | aplicado (síntesis de bios) |
| **Comentarios (shouts)** de la comunidad | **20.521 filas en cuarentena** (2.083 entidades, 715 con comentarios) | `reports/lastfm-shouts-2026-10-16/quarantine-entity-shouts.jsonl` | **crudo/no aplicado** |
| Emociones derivadas de shouts | 8 filas (`aumenta_mi_aura`, `tristeza`…) | `reports/lastfm-shouts-2026-10-16/quarantine-entity-emotions.jsonl` | **en cuarentena** |

**Para Laya**: los tags de artista YA entran como `community_tag` con weight y **ya están clasificados
con emociones** por el modelo de Laya (§6). Los tags de álbum (4.812) son el gran lote pendiente del
mismo tipo: «venezuela», «salsa», «latin pop», «depressive black metal»… — mismo canal
(`community_tag` con `minTagCount`).
**Para la búsqueda contextual**: popularidad real (listeners/playcount) por artista/álbum/pista,
similitud artista→artista (grafo «suena como»), y comentarios humanos como contenido/ambiente.

---

## 3. MusicBrainz — identidad, país, relaciones y tags editoriales (API oficial)

`data/raw/musicbrainz/` (8,9 MB), `musicbrainz-bio/` (21 MB), unidad `crv-mb-rels`.

| Dato | Volumen | Dónde | Estado |
|---|---|---|---|
| Artista: país, área, tipo, vida (inicio/fin de actividad) | 632 búsquedas con artistas | `musicbrainz-bio/**` (`country: VE`, `area.name`, `type`, `life-span`) | crudo (aplicado parcialmente vía campañas) |
| Release-groups: fecha primera edición, tipo, **tags y géneros** | 78 con datos (2.160 ficheros) | `musicbrainz/**` | crudo |
| Relaciones (miembros, períodos, ciudad) | unidad `crv-mb-rels` | (ver skill: miembros/períodos/ciudad van por MB) | parcial |
| MBID (identidad externa) | 1.666 MBID ya en la BD (sin columna propia) | `ingest.genre_external_identities` (545) + claims | parcial |

**Para Laya**: MB es la fuente `authorized` de géneros/tags con `tagPolicy` (editorial vs comunidad);
hoy `import_enabled=false` (solo 1 import) — es la vía “oficial” más limpia para contrastar.
**Búsqueda contextual**: país/área (facetas geográficas), años de actividad, identidad estable (MBID).

---

## 4. Discogs — estilos, perfiles e imágenes (API oficial; `authorized`)

`data/raw/discogs-bio/` (70 MB, 13.950 ficheros), `reports/redes-2026-10-16/cache-discogs`.

| Dato | Volumen | Dónde | Estado |
|---|---|---|---|
| Artista: nombre real, perfil (bio), URLs, imágenes | **3.641 con imágenes** / 13.950 fichas | `discogs-bio/**` (`realname`, `profile`, `images[]`, `urls[]`) | crudo (fotos aplicadas por campañas) |
| Géneros/estilos como tags externos | 168 imports `authorized` + 545 identidades | `ingest.genre_external_imports/identities` | aplicado (parcial, con `tagPolicy`: «Latin» se ignora por decisión editorial) |
| Enlaces de redes | 30 (`discogs-urls`) | `public.streaming_links`, `social_links` | aplicado |

**Para Laya**: canal `community_tag`/`editorial` ya autorizado y con política de cajones
(«Rock» de Discogs cubre rock+metal+punk).
**Búsqueda contextual**: perfiles con biografía en inglés/es, imágenes adicionales (portadas/fotos),
sellos vía release.

---

## 5. Spotify · Deezer · iTunes · TheAudioDB · Wikidata · Wikipedia (APIs de metadatos)

| Fuente | Dato útil | Volumen | Dónde | Estado |
|---|---|---|---|---|
| **Spotify** | Portadas, tracklist con `duration_ms`, `explicit`, `release_date`, copyright | 1.113 álbumes con imagen / 1.011 con tracklist (de 2.304 del lote sin foto) + `spotify-lote` (195 MB) | `data/raw/spotify-lote-2026-10-03/{id-artista}/album-*.json` | aplicado (portadas/fotos) |
| **Deezer** | Discografías: `genres{data[]}`, `label`, `release_date`, `upc`, portadas x5 tamaños | 6.329 ficheros (89 MB) | `data/raw/etapa3-discografias/deezer-*.json` | aplicado (portadas) / crudo (géneros, sellos) |
| **iTunes** | Portadas por álbum, género | `discover-itunes-album-images.ts` + streaming_links `itunes-albums` 3.115 | repo | aplicado (imágenes) |
| **TheAudioDB** | Ficha de artista: sello, año de formación, país, estilo, bios ES/EN | 256 fichas (17 con biografía) | `data/raw/theaudiodb-bio/` | crudo |
| **Wikidata** | Imágenes, identificadores externos | campaña `official-enrichment` | `discover-wikidata-images.ts` | aplicado (imágenes) |
| **Wikipedia (es/en)** | Biografías (texto) | **442 (es) + 468 (en)** páginas con contenido | `data/raw/wikipedia-bio-es|en/` | aplicado (síntesis de bios: 12+21) |

**Para Laya**: Deezer/iTunes aportan género como `editorial_genre` de plataforma (útil pero gruesa);
TheAudioDB estilo; Wikidata no aporta género musical tipado.
**Búsqueda contextual**: sello discográfico, fecha de edición exacta, duración, «explícito»,
popularidad, imágenes.

---

## 6. Emociones y etiquetas tipadas — lo que YA está en la base (Laya)

| Tabla | Filas | Contenido |
|---|---|---|
| `public.entity_user_tags` | **6.564** | tag + `weight` + **`emotions`**: `{p, probs{ninguna, cachonda, enfocado, libertad, tristeza, aumenta_mi_aura}, modelo: laya-multilingual-noul-en-v3-lexico, categoria}` |
| `public.entity_metrics` | **25.119** | listeners/playcount (lastfm) por artista/álbum/pista |
| `public.entity_emotions` | **0 (vacía)** | emoción por entidad (score, basis, evidence) — tabla creada, sin datos |
| `public.entity_shouts` | **0 (vacía)** | comentarios (author, text, emotions, url) — los 20.521 están en cuarentena (§2) |
| `ingest.emotion_tag_decisions` | — | decisiones humanas sobre tags emocionales |

O sea: **la cadena de emociones ya funciona con tags** (cada tag de Last.fm llevaba su clasificación
Laya) y **está lista para textos** (shouts/reviews) — los shouts están capturados y en cuarentena
esperando aplicación; las 1.004 reviews de RYM son texto equivalente del mismo tipo.

---

## 7. Webs scrapeadas (sin API) — biografías, imágenes, discografías y prensa

| Web | Dato útil | Volumen | Dónde |
|---|---|---|---|
| **Musicavenezuela.com** | Bio markdown, géneros, álbumes (título/año/tipo/sello/carátula), **letras con créditos Letra:/Música:**, videos | 112 artistas (100 % bio) · 508 álbumes · 164 letras (`letras-v2.json`) · 579 imágenes | `data/raw/musicavenezuela-2026-10-13/data/` |
| **Aqustico** | Canciones con duración, featurings, carátula; discos con tipo; **14.988 pares de similitud**; 232 playlists curadas; géneros por canción | 1.387 artistas · 14.196 canciones · 2.273 discos | `data/raw/aqustico-2026-10-11/*.tsv` + JSON |
| **Metal Archives (VE)** | Bandas, discos (sello, fecha, formato, tracklist con duración, lineup), personas, géneros, imágenes | 611 bandas · 1.824 discos · 3.017 personas | `data/raw/metal-archives-ve-2026-10-01/*.jsonl` |
| **Sincopa.com** | Claims de fichas históricas: tracklists, géneros, sellos, encabezados | 11.544 + 1.500 ficheros | `data/raw/sincopa/`, `sincopa-extra/` → claims |
| **Blogs** (rockdevzla, lobotoradio, hippito, RHV, rockzuela, coleccionistas WP, descargas-metal) | Posts (título, categorías, HTML), bios, fotos con procedencia | 8 blogs · ~400 MB | `data/raw/<blog>/` (feeds Atom) |
| **Fotos de blogs** | Foto → artista → página de origen | 2.136 imágenes + `mentions.jsonl` (963 MB) | `data/raw/fotos-blogs-2026-10-01/` |
| **Venciclopedia** | Artículos (wikitexto) | 1.058 páginas, 242 con wikitexto | `data/raw/venciclopedia-bio/` |
| **Bandcamp** | Perfiles/labels con ubicación, catálogo | 2.770 ficheros (27 MB) | `data/raw/bandcamp/` |
| **MySpace** | Perfiles, artistas, imágenes | 252 + 4 ficheros (25,5 MB) | `data/raw/myspace*/` |
| **SoundCloud** | Perfil principal + set por disco (verificados) | 406 enlaces aplicados | `public.streaming_links` source `soundcloud-chatgpt` |
| **YouTube (canal)** | 662 videos, **6.749 marcas de tiempo**, 2.433 secciones de descripción, 6.909 entradas de tracklist, 641 video→álbum, 52 audiovisuales, créditos | `media.youtube_*`, `media.video_*` | aplicado |

**Para Laya**: blogs, MA y Sincopa son texto (contexto biográfico/género en prosa); MA tiene género
por banda (vocabulario propio → mapear). Aqustico aporta género por canción (ya usado como relleno).
**Búsqueda contextual**: prensa escaneada (972 `media_links` tipo `scan`), fotos con procedencia,
videos con capítulos, letras, sello/ciudad/era, «suena como» (Aqustico + Last.fm).

---

## 8. Audio y contenido propio (nube privada CRV-IC) — no scrapeo, pero es la materia prima

`/mnt/1tb/Shared/crv-ic` (246 GB, 46.831 archivos) + `aqustico-assets` (2,1 GB):
- `tracks/` 15.881 masters · `demos/` 15.677 previews · `song_covers/` 14.287 · `onerpm/` (28 GB),
  `livewire-tmp/` (85 GB) y `migracion/` (ledger de 11.998 filas: 714 artistas, 1.764 álbumes,
  406 sellos, 41 géneros).
- Explorer propio: `~/apps/crv-bucket-explorer` (:8920).
Sirve para: verificar duraciones reales, detectar versiones, portadas de canción, y como materia de
entrenamiento/contexto («qué suena»).

---

## 9. Resumen de lo que falta por explotar (crudo → aplicación)

Ordenado por valor para Laya y para la búsqueda contextual:
1. **Descriptors de RYM** (7.328 discos, 100 %) → `community_tag` (sin votos; umbral por posición).
2. **Tags de álbum de Last.fm** (4.812 álbumes, 1.115 tags) → `community_tag` con peso real.
3. **Shouts de Last.fm** (20.521) → `entity_shouts` + emociones (texto humano, ya capturado).
4. **Reviews de RYM** (1.004, recién capturadas) → texto humano por disco/artista (mood/temática).
5. **Ratings RYM** (4.462 discos + 16.068 filas de artista) → métrica de entidad (calidad/popularidad).
6. Similitud de Last.fm/Aqustico (≈6.000 + 14.988 pares) → faceta «suena como».
7. Deezer/Discogs géneros y sellos crudos por aplicar; idioma del disco (347 RYM); tipo DJ Mix/Mixtape.

Cierre medido de los archivos: `data/` 10,2 GB (raw 5,67 GB) + `reports/` 4,7 GB.
