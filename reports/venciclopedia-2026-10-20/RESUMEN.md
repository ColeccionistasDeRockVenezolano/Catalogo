# Venciclopedia absorbida — 2026-10-20

Fuente dada de alta por instrucción de Brian: absorberla y tratarla como verdad
de alto nivel. Ficha y límites en `docs/SOURCES.md` §7.1.

## Qué se capturó

| Concepto | Medido |
|---|---|
| Páginas del universo musical | **528** (27 lotes de la API MediaWiki) |
| Errores HTTP en el barrido | **0** |
| Fichas de disco (`{{record}}` + `{{disco}}`) | 275 |
| Tracklists (`{{pistas}}`) | 123 páginas · 1.183 pistas con título, autor y duración |
| Fichas de agrupación (`{{grupo musical}}`) | 88 |
| Bloques de créditos de sesión | 116 (1.105 músicos con instrumento) — **no aplicados**, ver «abierto» |
| Claims persistidos con evidencia | **11.592** (`ingest.claims`, source 31650, confidence high) |

Canal: `api.php` en lotes de 20 títulos con `prop=revisions|categories`, que
trae wikitexto y categorías en la misma respuesta. `robots.txt` permite la API
y declara `Crawl-delay: 10`, que `politeFetch` respeta.

## Cómo se decide cada dato (sin adivinar)

- **Artista**: de las categorías `Discos de <X>`, descartando años, sellos,
  tipos y géneros. Si no queda exactamente uno, se prueban las variantes
  previsibles del nombre («Oscar D' León» ≡ «Oscar D'León») y, si la ficha
  acredita varios artistas, solo se acepta cuando **uno** existe en el catálogo.
  Con dos existentes (colaboración) no se elige: el disco va a propuestos.
- **Sello**: del campo `sello` de la plantilla, resuelto contra `organizations`
  existentes. Nunca se crea una organización desde aquí.
- **Formato**: se normaliza al vocabulario del catálogo (`Vinyl LP`, `Vinyl 7"`,
  `CD`, `Cassette`, `Digital`); el texto exacto queda en la evidencia.
- **Cara B de un LP**: es el mismo disco. Solo el campo `discos=N` abre discos
  distintos.
- Un dato que la fuente no declara no se emite.

## Aplicado al catálogo

Contadores medidos antes/después (el «después» incluye el efecto de otra sesión
que trabajó en paralelo, ver incidentes):

| Columna | Antes | Después | Δ |
|---|---|---|---|
| `albums.catalog_id` | 1.344 | **1.456** | +112 |
| `albums.media_format` | 3.112 | **3.235** | +123 |
| `albums.label_id` | 4.229 | **4.243** | +14 |
| `albums.album_type` (desde `other`) | — | — | +14 |
| `tracks.duration_seconds` | 92.023 | **92.224** | +201 |
| `artists.formed_year` | 1.500 | **1.507** | +7 |
| `artists.disbanded_year` | 110 | **135** | +25 |
| `artists.origin_city` | 2.523 | **2.531** | +8 |

Altas creadas: **2**, ambas con catálogo, año y artista existente.

- Oscar D' León — *2 sets con Oscar* (1977), THS-1195, Vinyl LP
- Dimensión Latina — *Solamente... Rodrigo con... Dimensión* (1980), LPV-1828, Vinyl LP

Regla de alta: el artista debe existir, el disco traer año y **no** parecerse a
ningún otro disco del artista (similitud < 0,60). Todo lo demás queda propuesto.

## Resolución de la última pasada

- Artistas: 77 de 88 fichas casadas · 11 sin ficha en el catálogo.
- Discos: 175 casados · 8 ambiguos · 28 sin match · 44 sin artista resoluble.
- Pistas: 32 duraciones rellenadas en la última pasada · 2 ambiguas.

## Abierto a propósito

1. **26 altas propuestas** (título parecido a otro disco del artista, o sin año).
   Están en `reports/venciclopedia-2026-10-20/aplicacion.json`. No se crean
   porque un duplicado cuesta más que un hueco.
2. **160 pistas** de la fuente sin pista correspondiente en el álbum (título
   distinto o álbum ausente) y **194** cuyo álbum no se resolvió.
3. **11 artistas sin ficha**: Xulio Formoso, Teenrock, Lila Morillo, Paché
   Vargas, Marlene, Canto del Cisne, Coro de Niños EDUCATEL… Dar de alta un
   artista es otra decisión editorial.
4. **Créditos de sesión** (1.105 músicos con instrumento): exigen crear
   personas y resolver roles; es una campaña propia, no un relleno.
5. **Depósito legal** (71 fichas): no hay columna en el core. No se propone
   excepción por un dato de 71 filas.

## Incidentes y reparación (honesto)

1. **El primer «dry-run» escribía de verdad.** `apply()` abría su propia
   conexión, así que la transacción del modo seco no lo cubría: 245 UPDATE y 18
   INSERT quedaron commiteados. Los UPDATE eran el relleno que se buscaba; los
   18 INSERT no: cinco tenían `Various Artists` como artista y el nombre de una
   banda como título («Spiteri», «Melissa», «The Love Depression»…). Se
   retiraron por id (33274-33291) y una segunda tanda creada por una ejecución
   intermedia (33310-33327). Corregido: el modo seco comparte la conexión y
   siempre revierte (verificado: `catalog_id` 1.432 → 1.432 tras una pasada).
2. **El motor de fusión se abandonó a propósito.** Resolvía 6 claims/minuto;
   11.680 claims son 32 h. La evidencia se persistió igual como claims y la
   escritura fue por run de operador, que es lo que hacen las campañas masivas
   de este repo.
3. **Otra sesión trabajó en paralelo** en el mismo catálogo durante la campaña
   (runs `manual`, 77 `entity_redirects`, fusiones que explican los −5/-7
   álbumes de los conteos globales). Los deltas de esta tabla se atribuyen por
   columna y por la coincidencia con los conteos del modo seco.
4. **Reversibilidad**: los cambios del run 21294 están en el diario
   (`change_journal`), pero `runs undo` responde «13 filas del catálogo
   cambiaron después de este cambio» porque los borrados de reparación y la
   sesión paralela tocaron las mismas filas. La red de seguridad efectiva es el
   respaldo previo verificado:
   `/mnt/datos/backups/crv/pre-venciclopedia-2026-10-20/crv-pre-venc.dump`
   (1,51 GB, `pg_dump -Fc`, excluye la tabla ER de 19 GB).

## Reproducible

```bash
npm run cli -- scrape venciclopedia --observe                  # captura el crudo
./scripts/with-node22.sh npx tsx scripts/venciclopedia-listas.mts   # sellos conocidos
./scripts/with-node22.sh npx tsx scripts/venciclopedia-absorb.mts           # seco
./scripts/with-node22.sh npx tsx scripts/venciclopedia-absorb.mts --confirm # aplica
```
