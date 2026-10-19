# Bloque C sin API — muestreo de 50 (2026-10-19)

Pregunta que responde: de los artistas del **bloque C** que el Spotify diario aún no ha tocado
(322 de la cola del 13 oct: con discos, sin perfil Spotify verificado y sin perfil de ninguna otra
plataforma), ¿cuántos están de verdad en Spotify? Se hace para decidir si vale la pena una campaña
por navegador (sin API) o si basta con que el diario los termine por API.

Muestra: 50 artistas al azar (semilla 42) de los 322 pendientes · 112 discos de catálogo.

## Resultado

| grupo | n | % | confirmados por repertorio |
| --- | --- | --- | --- |
| perfil único con nombre exacto | 22 | 44 % | 5 (22 %) |
| perfil con homónimos exactos (2-4) | 15 | 30 % | 2 (13 %) |
| sin perfil con nombre exacto | 13 | 26 % | — |
| **total con perfil localizado** | **37** | **74 %** | **7 (14 %)** |

- **74 % tiene perfil en Spotify** con el nombre exacto (o alias).
- **14 % se confirma por repertorio** (un disco o una pista del catálogo aparece en lo que la
  búsqueda expone del perfil). El resto son homónimos o reediciones con otro título.
- Proyección a los 322 pendientes: ~238 perfiles localizables, ~45 confirmables solos y ~190 a
  revisión humana. Con el umbral acordado (<20 % de confirmación ⇒ no hacer), **no se hace la
  campaña sin API para C**: el diario por API los termina en 2-3 noches a coste de cuota ya pagada.

## Metodología (sin API oficial)

Chrome propio headless (`:9333`, perfil copiado) + la consulta interna que la propia web emite,
`searchDesktop` (token de la sesión anónima, hash capturado en vivo). Por artista:

1. `searchDesktop(nombre)` → artistas con nombre exacto/alias, y sus álbumes (`albumsV2`) y pistas
   (`tracksV2`) con el artista creditado.
2. Identidad: al menos un disco del catálogo con el mismo título normalizado (año ±1) o una pista
   del catálogo presente entre las pistas visibles del perfil.

Nada se escribe en la base. Reanudable; un JSONL por artista.

## Límites medidos (importante para futuras campañas sin API)

- **La web anónima de Spotify ya no sirve discografías.** El hash que usaba la campaña del 18 oct
  (`5e07d323…`) hoy corresponde a `queryArtistDiscographyOverview`; invocarlo como
  `queryArtistDiscographyAll` devuelve 200 con lista vacía — falla en silencio. `queryArtistOverview`
  responde pero con **todas** las secciones de discografía vacías (`albums`, `singles`, `topTracks`…)
  y `monthlyListeners` null. `/artist/<id>/discography/all` no emite consultas de discografía.
- Lo que sí entrega a un visitante: `searchDesktop` (artistas + `albumsV2` + `tracksV2`) y el nombre
  del perfil. Con eso se mide existencia y una parte del repertorio (máx. 40 álbumes/pistas).
- Consecuencia: para verificar discografías completas sin API hace falta **sesión iniciada** (el
  Chrome del dueño, solo lectura de pestañas) o la API oficial. El navegador anónimo no alcanza.

## Archivos

- `resultados.jsonl` — una fila por artista (perfil, candidatos, álbumes/pistas visibles, motivo).
- `muestra.json` — los 50 artistas con sus discos de catálogo.
- `gen.py` · `muestreo4.py` · `analiza2.py` — generación de la muestra, captura y análisis.
