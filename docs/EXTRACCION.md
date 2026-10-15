# Extracción de datos para el catálogo — runbook (2026-10-16)

Cómo se saca cada dato, con qué herramienta, con qué reglas y con qué rendimiento **medido**. Es el
manual para una sesión nueva: léelo entero antes de tocar nada.

## 0. Reglas de oro (no negociables)

1. **Nada entra sin verificar.** Cada enlace o dato se comprueba contra su fuente (página canónica,
   API oficial, oEmbed) antes de escribirse. Lo que no se puede verificar queda como candidato
   (`verified=false`) y no se publica.
2. **Todo se escribe en un run del operador** (`withOperatorRun`), reversible desde Historial, con su
   informe en `reports/`. Ningún `UPDATE`/`INSERT` suelto.
3. **Nunca pisar lo ya verificado ni lo escrito a mano** (`source='crv-operador'`).
4. **Ritmo humano y sin evasión**: las capturas de RYM van con Scrapling + las cookies del Firefox
   del dueño, pausas de 5-7 s, y si RYM pone el muro se avisa por Telegram y se reintenta — no se
   resuelven captchas. En las APIs públicas, pausas de 300-400 ms.
5. **Sin exportaciones masivas a la conversación**: los datos pesados se procesan en scripts y solo
   sale el resumen.

## 1. Lo que falta (medido el 2026-10-15)

| Necesidad | Falta | Fuente que lo trae | Herramienta |
|---|---:|---|---|
| n.º de catálogo del sello | 15.418 | RYM (33 % de las fichas) | captura RYM |
| formato (vinilo/CD/casete) | 13.674 | RYM (45 %) | captura RYM |
| fecha completa (día/mes/año) | 13.254 | RYM (64 %) | captura RYM |
| sello | 12.154 | RYM (50 %) | captura RYM |
| reproductor verificado (discos) | 8.591 | RYM data-links + APIs | captura RYM / API |
| género | 6.609 | RYM (55 %) | captura RYM |
| pistas sin duración | 46.596 | RYM (59 %), **Deezer/iTunes** | captura RYM / API |
| discos sin pistas | 1.317 | RYM (86 %), Deezer | captura RYM / API |
| carátula | 1.336 | RYM (100 %), Deezer/iTunes/Discogs/MB/Wikidata | `discover-*` + `localize-images.ts` |
| año de formación del artista | 3.479 | RYM (12 %) | captura RYM |
| ciudad del artista | 2.878 | RYM (20 %) | captura RYM |
| foto del artista | 3.400 | Deezer/Spotify/Discogs/Wikidata/RYM | `discover-deezer-artist-photos.ts`, `discogs-artist-photos.mts` |
| miembros de banda | 1.908 artistas sin ninguno | RYM (19 %), Discogs, Metal Archives | captura RYM |
| redes sociales | 3.970 artistas sin ninguna | Discogs `urls[]`, Wikidata, capturas | `harvest-discogs-evidence.ts`, `harvest-wikidata-artist-evidence.ts` |
| fechas de nacimiento/fallecimiento | 30.979 personas | RYM (69 % de sus fichas de artista) | captura RYM |
| fichas de artista por capturar | ~2.978 de 4.791 | RYM | **cola nueva** (ver §3) |
| discos con ficha RYM por capturar | ~75 % del catálogo | RYM | captura RYM (fase 2) |
| letras | 740 pistas con letra (de 124.190) | musicavenezuela.com (agotada) + fuentes nuevas | **pendiente de decidir fuente** |

## 2. Pipeline RYM (el que funcionó el 2026-10-15)

```
# 1) captura (navegador stealth, ritmo humano; ver §3 para la cola nueva)
bash ops/rym-resto/lanzar.sh                 # deja la unidad crv-scrapling-rym-resto corriendo
bash ops/rym-resto/estado.sh                 # salud, páginas capturadas, últimas líneas del log

# 2) cadena completa con el orquestador (reparse → cruce → enlaces); se puede correr con la
#    captura viva. Las etapas ya aceptan --dir/--v4/--informe para apuntar a esta campaña.
bash ops/rym-resto/procesar.sh todo          # re-parseo + cruce + lote de enlaces

# 3) aplicar, fase por fase: primero SIEMPRE el ensayo (sin --confirm) y luego --confirm
bash ops/rym-resto/procesar.sh aplicar              # ensayo de las 6 fases
bash ops/rym-resto/procesar.sh aplicar --confirm    # en firme (run del operador, reversible)

# 6) SoundCloud de las fichas (lotes → verificador con og:type/og:title)
./scripts/with-node22.sh npx tsx scripts/apply-soundcloud-chatgpt.ts <carpeta-de-lotes> [--confirm]
```

Los comandos sueltos de cada etapa (si hay que correr una sola) están en `procesar.sh`: el
re-parseo (`scripts/rym-v4-reparse.py --pages/--out`), el cruce (`01-cruce.py --paginas/--v4/--dest`),
los enlaces (`00-extraer-data-links.py <tsv> --paginas`, `02-enlaces-lote.py --dest --tsv`) y los
appliers `03-apply-enlaces.ts`, `04-campos.mts`, `05-creditos.mts`, `06-artista.mts`,
`10-revisar-youtube.mts` (todos con `--dir`/`--v4`/`--informe`).

**Rendimiento medido** (campos de las 1.816 fichas de artista + 8.107 de disco capturadas el 1-2 de
octubre): 3.937 discos casados · 2.108 enlaces de escucha verificados · 2.071 campos de disco
(fecha/formato/n.º catálogo) · 1.286 créditos · 1.053 alias · 335 membresías · 334 personas con
fechas · 307 redes. Por cada 100 fichas de disco que casen: ~45 formatos, 33 n.º de catálogo,
64 fechas completas, 50 sellos, 55 géneros, 41 créditos, 86 listas de pistas, ~54 enlaces.

## 3. Campaña «resto»: lo que falta del catálogo (cola ya generada)

`scripts/campana-2026-10-16/01-cola-artistas.py` arma la cola y deja tres cosas:

| Salida | Qué es |
|---|---|
| `data/raw/fuentes-web-2026-10-16/rym-resto/cola-artistas.jsonl` | **5.476 URLs = 3.635 artistas distintos** (no son 5.476 artistas: a 1.841 se les da DOS slugs candidatos porque RYM usa guiones y guiones bajos — el capturador tira la que no existe). 565 URLs con existencia confirmada + 4.911 inferidas del nombre; todas atribuibles a artistas del catálogo |
| `…/prioridad-catalogo.txt` | esos mismos hrefs, para que los discos de artistas del catálogo se capturen primero |
| `reports/campana-2026-10-16/rym-artistas-fuera-del-catalogo.txt` | **21.782** slugs de RYM vistos en lo capturado que NO están en el catálogo → insumo para «el resto de artistas venezolanos» (filtrar por Venezuela antes de dar de alta) |

Lanzar: `bash ops/rym-resto/lanzar.sh` (unidad `crv-scrapling-rym-resto`, sobrevive al cierre de la
sesión). A ~6 s por página, las 5.476 fichas de artista son ~9 h de captura, y la fase 2 arrastra
~4,5 discos por artista. **La captura NO está lanzada**: queda para quien retome.

## 4. Portadas y fotos (APIs públicas, sin captura)

```
bash ops/media-2026-10-16/lanzar.sh          # los cinco discoverers, como unidades systemd --user
bash ops/media-2026-10-16/lanzar.sh --estado # salud y última línea de cada uno

./scripts/with-node22.sh npm run media:localize -- \
    --candidates reports/fotos-portadas-2026-10-16/<archivo>.jsonl --only-candidates
```
Los discoverers son: `discover-deezer-covers.ts` (portadas), `discover-deezer-artist-photos.ts`
(fotos, con guarda de disco en común), `discover-itunes-album-images.ts` (portadas; Apple da 403
por encima de ~20 req/min → 3 s por consulta), `discover-wikidata-images.ts` (Commons, anclaje
Venezuela) y `discogs-artist-photos.mts` (solo identidades Discogs ya aceptadas). `localize-images.ts`
descarga a `web/public/media/` y asocia en un run del operador; si la ficha ya tenía imagen, la
candidata va a Curaduría · Imágenes (no se pisa).

**Pitfall medido:** las salidas van en rutas RELATIVAS al repo — con ruta absoluta, los espacios de
«Coleccionistas De Rock Venezolano» parten el argumento de `systemd-run` y los candidatos acaban en
un camino inventado (`home/brian/apps/Coleccionistas`).

Regla: los candidatos se verifican por nombre exacto + disco compartido antes de asociarse; la imagen
siempre se descarga a disco (`localize-images.ts`), nunca se deja la URL remota.

## 5. Redes sociales

Fuentes, en orden de fiabilidad: (1) capturas propias ya en disco
(`scripts/rym-2026-10-15/07-redes.py` — regla clave: el **usuario** de la red debe coincidir con el
nombre del artista), (2) MusicBrainz url-rels (campaña 2026-10-04, `scripts/streaming-colector.py`),
(3) **Discogs `urls[]`** y (4) **Wikidata** — estos dos, cosechados y aplicados por la campaña
2026-10-16. OJO: los `harvest-*` que citaba este runbook (`harvest-discogs-evidence.ts`,
`harvest-wikidata-artist-evidence.ts`) son de evidencia de GÉNERO, no de redes: nunca lo fueron.

```
# cosecha de evidencia (unidades systemd --user; NO escriben el catálogo)
bash ops/redes-2026-10-16/lanzar.sh            # Discogs (urls[]) + Wikidata (anclada)
python3 scripts/discogs-bio-index.py           # índice del pozo crudo data/raw/discogs-bio/ (offline)

# aplicación (un run del operador, reversible desde Historial)
./scripts/with-node22.sh npx tsx scripts/apply-social-links.ts            # ensayo
./scripts/with-node22.sh npx tsx scripts/apply-social-links.ts --confirm  # en firme
```

Piezas y reglas:

| Pieza | Qué hace |
|---|---|
| `scripts/discogs-bio-index.py` | Índice offline del pozo `data/raw/discogs-bio/` (13.950 respuestas: 2.038 fichas de artista con `urls[]` + 18.373 resultados de búsqueda). Hoy son archivos con nombre hash: sin índice no se pueden cruzar. |
| `scripts/harvest-social-discogs.mts` | Evidencia de los artistas SIN ninguna red (3.957). Offline primero; la API solo para la guarda. Identidad probada por **disco en común** (un release de Discogs con el título de un disco del catálogo) o por **nombre único en el pozo + perfil de Venezuela**. Reanudable. |
| `scripts/harvest-social-wikidata.mts` | Wikidata anclada por la identidad Discogs/MusicBrainz ya aceptada (P1953/P434): P2002 X · P2013 Facebook · P2003 Instagram · P7085 TikTok · P2397 YouTube · P3283 Bandcamp. **Sin anclaje no emite nada** (fin de los homónimos). |
| `scripts/apply-social-links.ts` | Mapea URL→red por dominio, marca `verified` solo si el usuario coincide con el nombre del artista (YouTube/Bandcamp se abren y se les lee el `og:title`), escribe en UN run del operador y **nunca pisa** filas `verified` ni `source='crv-operador'`. |

Pitfall de Wikidata SPARQL (medido): `?item ?prop ?valor . VALUES ?prop { wd:P2002 … }` devuelve
**cero filas** — el predicado no se filtra por `VALUES`. Hay que usar `UNION` de predicados explícitos.

## 6. Letras

Hoy: columna `tracks.lyrics` (excepción 0073 del core), **740 pistas con letra**, alimentadas por
musicavenezuela.com — esa fuente ya se agotó. No hay recolector nuevo.

Para continuar hay que **elegir fuente** y respetar sus condiciones: la letra es obra con derechos, así
que la vía limpia es (a) las letras que el propio artista publica (Bandcamp, descripción de YouTube,
sus redes, hojas de prensa del sello), (b) sitios venezolanos de letras con robots permisivo previa
revisión, (c) pedir permiso. Cualquier recolector debe guardar la fuente por pista y el aviso de
autoría. **No inventar letras ni reescribirlas.**

## 7. Descubrimiento: el resto de artistas venezolanos

Fuentes: (1) los 21.782 slugs de RYM de §3, filtrados por localidad/país = Venezuela al capturarlos;
(2) MusicBrainz (`area=Venezuela`), (3) Discogs (`country=Venezuela`), (4) Wikidata, (5) el canal de
YouTube de CRV (`crv-youtube-watch`). El alta de artistas pasa por el motor de merge con su informe —
nunca a mano.

## 8. Decisiones pendientes del core (necesitan tu OK)

1. **Personas**: 5.400 créditos y 832 miembros de banda esperan a que exista la ficha de persona
   (crear personas es alta de entidad, con guardas de homónimos).
2. **Descriptores de RYM** (666 discos): no hay campo; ¿van a `themes` del artista, a una columna
   nueva de `albums`, o se quedan fuera?
3. **Tipos DJ Mix (298) y Mixtape (101)**: el enum `album_type` no los tiene (valores actuales:
   `studio_album, live_album, compilation, ep, single, demo, remix, soundtrack, collaboration_album,
   other`). ¿Se mapean a `other`/`compilation` o se añade el valor?
4. **Ratings de RYM**: existen en la fuente, el catálogo no los usa. Se quedan fuera salvo indicación.

## 9. Salud y tableros

| Para… | Comando |
|---|---|
| Estado de la captura nueva | `bash ops/rym-resto/estado.sh` |
| Procesar lo capturado (cadena RYM) | `bash ops/rym-resto/procesar.sh {reparse\|cruce\|enlaces\|aplicar\|todo}` |
| Portadas y fotos (discoverers) | `bash ops/media-2026-10-16/lanzar.sh [--estado]` |
| Redes sociales (cosecha + aplicación) | `bash ops/redes-2026-10-16/lanzar.sh [--estado]` · `scripts/apply-social-links.ts` |
| Capturas de la campaña «nuevos» (referencia) | `bash ops/rym-nuevos/estado.sh` |
| Tablero de la captura | `file:///tmp/crv-recon/rym-nuevos-tablero.html` |
| Pruebas de la campaña RYM | `npm run test:rym-nuevos` |
| Typecheck / lint antes de commitear | `npm run typecheck` · `npx eslint <archivos>` |
