# Dossier — rellenar los huecos de CRV con lo que tiene Aqustico (E0 + E1)

**Fecha:** 2026-10-12 · **Plan:** `~/Desktop/PLAN_AQUSTICO_2026-10-12.md` (v2)
**Decisiones:** D1 decidida por Brian (no se borra nada del bucket; Brian avisa a Ichamo).
D2–D7 sin respuesta → valor por defecto: sin alias nuevos, sin artistas nuevos, discos de
varias canciones solo con el orden de otra fuente, sin enlaces a Aqustico, sin similares,
sin alta formal de la fuente.
**Respaldo previo:** `/mnt/datos/backups/crv/crv-20261012T082020Z`.

## Cotejo fino (E0, solo lectura)

Script `scripts/aqustico/cotejo-fino.mts` con `compactSecondaryKey` del repo, solo exacto.

| | Cifra |
|---|---|
| Artistas de Aqustico | 1.387 |
| … con una sola ficha en CRV por nombre o alias | 285 |
| … **probados** (además comparten al menos un disco) | **154** |
| Discos de Aqustico (artista + título) | 2.604 |
| … cruzados con un disco de CRV | 441 |
| Pistas cruzadas (título único dentro del disco) | 2.841 (13 títulos ambiguos excluidos) |
| Orden de Aqustico igual al del disco | 14 de 270: **no sirve como número de pista** |

Solo los 154 artistas probados reciben foto, invitados o discos nuevos. Un nombre igual sin
disco en común no basta, por los homónimos.

## Huecos medidos y lo que se rellena

| # | Hueco | Medido | Se rellena | Queda fuera (motivo) |
|---|---|---|---|---|
| H1 | Disco sin género | 184 | **118** (ensayo, run 19021) | 66 sin término en la taxonomía: Alternativa 43, Fusion Tropical 12, Urbana 5, Tradicional Venezolana 3, Fusion 2, Del Mundo 1 (D2) |
| H2 | Artista probado sin género | 3 | los 3, derivados de sus discos | — |
| H3 | Pista sin duración | 614 en 85 discos | **614** (ensayo, run 19022) | ningún disco con señales de otra edición |
| H4 | Disco sin portada | 16 | **16** | 11 son miniaturas de 160 px (la tienda vieja de Ichamo no tenía más) |
| H5 | Artista sin foto | 7 | **7** | — |
| H6 | Invitado («featuring») | 110 | **20** (ensayo, run 19023) | 23 ya acreditados · 19 nombre en CRV sin segunda prueba · 48 sin ficha (no se crean personas) |
| H7 | Disco que falta | 313 | **162 discos nuevos** (ensayo, runs 19024–19028) | 29 variantes de discos que ya están o títulos de relleno · 23 el ER ve parecido · 37 la canción ya es pista de otro disco del artista · 72 sin orden de pistas · 2 incompletos en la API |
| H8 | Disco de CRV sin pistas | 15 | **3** (sencillos: La energía, De hierro, Reloj ingrato) | 12 sin orden fiable o con pista parecida |
| H9 | Enlace a Aqustico | 154 artistas | 0 | D5 = no |

**Lo que Aqustico no tiene y no se intenta:** año, número de pista, sello, tipo, créditos de
músicos, miembros, origen, biografías.

## Discrepancias (informativas, no se escriben)

`discrepancias.tsv`: 133 discos donde el género principal de CRV difiere del de Aqustico.
Hay contradicciones reales, no solo de granularidad (p. ej. Trabuco Contrapunto Rock/Pop,
Bolívar Pop Latino/Rock alternativo, Movida Acústica Urbana Tradicional Venezolana/Jazz).
También hay 51 duraciones que difieren en más de 15 s. CRV manda en todas.

## Muestra de 20 altas (E5, ensayo)

| Artista CRV | Disco nuevo | Pistas | Género de Aqustico |
|---|---|---|---|
| 6215 Junior Caldera | MEIMPOLTA | 1 | — |
| 156 | Los Caracas | 1 | Pop |
| 6794 | Bonita Coincidencia | 1 | Fusion Tropical |
| 6787 Eliezer Boyer | Pequeña Traviesa | 1 | Pop |
| 6787 Eliezer Boyer | La Unica | 1 | Pop |
| 6010 | Jeva Like Me | 1 | Urbana |
| 1837 | La Trampa | 1 | Pop |
| 6788 Gus | Una Luz | 1 | — |
| 6720 | El Rey del Down Town | 1 | Gangsta rap |
| 6787 Eliezer Boyer | Gloria Al Padre Gloria Al Hijo | 1 | Pop |
| 6729 | Se Presta | 1 | Pop Latino |
| 5861 Briella | Es Un 10 | 1 | — |
| 1131 Trabuco Contrapunto | Sensation | 1 | Ska |
| 1829 | La Ultima Noche | 1 | Urbana |
| 2061 José y El Toro | Tu Aprendiz | 1 | Bolero |
| 4541 | Multiverso | 1 | Pop |
| 6787 Eliezer Boyer | Perdiendo Altura | 1 | Pop |
| 6215 Junior Caldera | Ponte Como El Conejito Remix | 1 | — |
| 1829 | El Favorito | 1 | Urbana |
| 4258 | Lo Que Tu Quieras | 1 | Hip Hop |

Casi todo son sencillos de artistas actuales; entran como `single`, sin año, con su pista 1
y duración. Los títulos se copian tal como los publica Aqustico.

## Archivos

`cruces-{artistas,discos,pistas}.tsv` · `huecos.tsv` · `tabla-maestra.json` ·
`discrepancias.tsv` · `orden-pistas.json` · `e*-dry-run*.json` · `resumen-e0.json`.
