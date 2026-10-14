# Resumen — rellenar los huecos de CRV con lo que tiene Aqustico

**Fecha:** 2026-10-12 · **Plan:** `~/Desktop/PLAN_AQUSTICO_2026-10-12.md` (v2) · **Dossier:** `DOSSIER.md`
**Pedido de Brian:** «D1 no se borra nada y yo le aviso. Implementa todo lo demás del plan».
D3–D7 con su valor por defecto (sin artistas nuevos, discos de varias
canciones solo con el orden de otra fuente, sin enlaces a Aqustico, sin similares, sin alta
formal de la fuente). **D2 aprobada después por Brian** («aprueba los alias de D2 y rellena
esos 83 discos»): ver «Segunda pasada».

**Respaldo previo:** `/mnt/datos/backups/crv/crv-20261012T082020Z`, comprobado con
`db:restore-check` (111 tablas y 20.890.376 filas idénticas; crudo sin faltantes). La primera
comprobación falló porque el crudo no cabe en `/tmp` (tmpfs de 9,8 GB); se repitió con
`TMPDIR=/mnt/datos/tmp`.

## Qué se hizo

| Etapa | Hueco | Rellenado | Run(s) |
|---|---|---|---|
| E2 | H1 género de disco cruzado | **118** discos | 19029 |
| E2 | H2 género de artista | 2 artistas, derivado solo de sus discos (el tercero, 4726, sigue sin género) | disparador 0036 |
| E2 | registro de fuente de géneros | `aqustico` en `genre_external_sources` (evaluating, sin importación) | 19031 |
| E3 | H3 duración de pista | **614** pistas en 85 discos | 19032 |
| E3 | H4 portada + H5 foto | **16** portadas + **7** fotos, con copia local | 19033 |
| E4 | H6 invitado («featuring») | **20** + 3 (en pistas recién creadas) = **23** créditos «Invitado» | 19034, 19049 |
| E5 | H7 discos que faltan | **161** discos nuevos (sencillos casi todos; 3 de varias canciones con el orden de Deezer) | 19037–19041 |
| E5 | H8 disco de CRV sin pistas | **3** sencillos completados (La energía, De hierro, Reloj ingrato) | 19037–19041 |
| E5 | géneros de los discos nuevos | **94** | 19043 |
| E5 | portadas de los discos nuevos | **161** (todas), con copia local | 19044–19047 |
| — | prueba de reversibilidad | primer lote de altas (run 19035) deshecho por el run 19036; conteos de vuelta a 15.442/120.935; luego se rehízo entero | 19035/19036 |

## Antes y después en el catálogo

| | Antes | Después |
|---|---|---|
| Discos / pistas | 15.442 / 120.935 | 15.603 / 121.122 |
| Discos sin portada | 1.267 | 1.251 (los 161 nuevos entran con portada) |
| Artistas sin foto | 3.442 | 3.435 |
| Pistas sin duración | 46.527 | 45.935 (−614 rellenadas; +22 pistas nuevas sin duración válida en la fuente) |
| Valores previos modificados por Aqustico | — | **0** (solo vacíos; ningún principal confirmado tocado) |
| Elementos nuevos en la cola de revisión | — | 0 (las dudas se apartan al reporte, no se fuerzan) |
| `npm run doctor` | 1 aviso previo (3 auditorías sin claim) | el mismo aviso, sin cambios |

Las portadas de la tienda vieja de Ichamo (que no responde desde el 2026-10-12) se tomaron
de la copia ya bajada en `/mnt/1tb/Shared/aqustico-assets/_raw/v1-plano/caratulas/` (archivado el 2026-10-14; lo vigente es el árbol organizado en `/mnt/1tb/Shared/aqustico-assets/`). Se sembraron en el manifiesto
con su URL original y `media:localize` las asoció por su camino normal. No se usó nada del
bucket `ichamo-bucket` (D1: se conserva entero).

## Lo que quedó abierto a propósito (estado final en `final/`)

| | Queda | Motivo |
|---|---|---|
| H1 | 2 discos | solo dicen «Fusion», que la taxonomía marca como «no es género» (Guaco «¿Qué Pasa Contigo?», Wannamaker «Ojos del mundo») |
| H6 | 160 featurings | ya acreditados, nombre en CRV sin segunda prueba o sin ficha (no se crean personas) |
| H7 | 72 discos de varias canciones | sin orden de pistas en Deezer ni MusicBrainz (D4) |
| H7 | 37 sencillos | la canción ya es pista de otro disco del artista y el ER no deja crear la pista sin revisión |
| H7 | 24 discos | el ER ve un disco parecido del mismo artista (remixes, títulos cortos) |
| H7 | 35 dudas | variantes de discos que ya están (EP, en vivo, Deluxe, feat.) o títulos de relleno («Sencillos») |
| H7 | 2 discos | la API declara más canciones de las que trae |
| H8 | 12 discos de CRV sin pistas | sin orden fiable |
| H9 | 154 artistas | D5 = no |
| — | discrepancias | 133 géneros y 51 duraciones donde Aqustico contradice a CRV: CRV manda (`discrepancias.tsv`) |

## Segunda pasada — D2 aprobada (2026-10-12)

Respaldo previo: `/mnt/datos/backups/crv/crv-20261012T135707Z`.

| Alias (texto de Aqustico) | Género | Run | Discos |
|---|---|---|---|
| alternativa | rock-alternativo | 19055 | 43 |
| fusion tropical | musica-tropical | 19056 | 15 |
| urbana | urbano-latino | 19057 | 19 |
| tradicional venezolana | musica-tradicional | 19058 | 3 |
| del mundo | world-ethnic | 19059 | 1 |

Los alias se ensayaron antes (runs 19050–19054): 0 fichas existentes afectadas. También
quedan en `data/genres/taxonomy.json`, para que un `taxonomy-apply --prune` no los borre.
«Del mundo» no estaba en la lista de D2, pero sigue el alias que ya existía («música del
mundo» → world-ethnic).

Géneros: ensayo run 19060 y aplicación **run 19061**, con **81 discos** confirmados (todos
como principal único). Los discos con principal confirmado pasan de 9.599 a 9.680. Hubo 212
fichas que ya tenían principal y no se tocaron. Quedan 2 discos sin resolver, ambos «Fusion».
Los géneros de artista se recalcularon solos desde sus discos; por ejemplo, Caibo pasa de no
tener género a `musica-tropical`. `npm run doctor`: el mismo aviso previo, sin cambios.

## Corrección de géneros sin sentido (pedido de Brian, 2026-10-12)

Revisión de los 293 discos con género de Aqustico, cruzada con los demás discos de cada
artista en CRV y con la prensa. «Alternativa» resultó ser «música alternativa» en sentido
amplio: los 43 discos que la usaban quedaron mal con `rock-alternativo`.

| Artista | Discos | Antes → después | Prueba |
|---|---|---|---|
| Irepelusa | 19 | rock-alternativo → r-and-b | pop urbano/R&B (El Universal, NTN24); sus otros discos: R&B |
| Motherflowers | 24 + 1 | rock-alternativo / world-ethnic → hip-hop | trío de hip hop con fusión tropical (Indie Hoy); sus otros discos: hip hop |
| Francisco Montoya | 1 | musica-tradicional → joropo | cantante llanero; término más preciso |

**Run 19150** (ensayo en el 19149), a nombre de `brian` y por el camino de la Mesa: el género
correcto se confirma como principal y el de Aqustico queda `rejected`, así que ninguna regla
lo reabre. Los alias se corrigieron en el run 19154 («alternativa» → `not_a_genre`, ahora en
`notAGenre.descriptor`) y en el 19155 («del mundo» eliminado). El resto se revisó y se
mantiene: José y El Toro es bolero (Rolling Stone), Guaco y Frank Lucas son tropical, y
Rummy Olivo es joropo.

## Scripts (`scripts/aqustico/`)

`cotejo-fino.mts` (E0) · `libro-generos.py` (E2/E5) · `rellenar-duraciones.mts` (E3) ·
`imagenes.py` (E3/E5, candidatas y siembra) · `invitados.mts` (E4) · `orden-pistas.py` (D4) ·
`altas-discos.mts` (E5) · `fuente.mts` (procedencia `aqustico`, enabled=false).
Todos ensayan por defecto y solo escriben con `--confirm`; cada run se deshace con
`crv runs undo <run>`.
