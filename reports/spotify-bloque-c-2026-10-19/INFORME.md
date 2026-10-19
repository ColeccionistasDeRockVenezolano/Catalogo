# Bloque C — muestreo sin sesión y reintento con sesión (2026-10-19)

Pregunta: de los artistas del **bloque C** que el Spotify diario no había tocado (322 de la cola del
13 oct: con discos, sin perfil Spotify verificado y sin perfil de ninguna otra plataforma), ¿cuántos
están de verdad en Spotify y cuántos se pueden confirmar?

## Fase 1 — muestreo sin sesión (50 artistas)

Chrome anónimo + `searchDesktop` (token anónimo). Resultado: 74 % con perfil por nombre, pero solo
**14 % confirmable por repertorio**, porque la web anónima ya no sirve discografías completas y solo
expone 40 álbumes/pistas de búsqueda. Umbral acordado (<20 %) ⇒ no hacer la campaña por esa vía.

## Fase 2 — reintento CON sesión (306 artistas: los 50 + 256 restantes)

Copia del perfil del dueño en Chrome propio (`:9333`). Con sesión:

- La búsqueda interna cambia de operación (`searchTopResultsList`), pero el DOM de
  `/search/<nombre>` sí lista artistas (enlaces `/intl-XX/artist/<id>`).
- `queryArtistOverview` (hash capturado en vivo) deja de venir vacío: devuelve nombre, oyentes,
  álbumes y **los 10 top tracks**. La ruta `/artist/<id>/discography/*` sigue rota con sesión
  («Algo deu errado»), y la API oficial seguía devolviendo 429 incluso con el token de usuario.
- Identidad confirmada si una **pista del catálogo** está entre los top tracks (los títulos de
  canción sobreviven a las reediciones) o si un disco coincide por título y año ±1.

### Resultado (306 artistas)

| grupo | n | % |
| --- | --- | --- |
| confirmados por repertorio | 57 | 18 % |
| perfil único sin repertorio en común (dudosos) | 160 | 52 % |
| sin perfil con nombre exacto | 89 | 29 % |
| con perfil localizado | 217 | 70 % |

Confirmación: 53 por pista y 4 por disco. Nombres con audiencia real y evidencia clara: Amilcar
Boscan (1,27 M oyentes), Nelson Henriquez (499 k), Freddy Salcedo (30 k), Convenezuela (10 k),
Quinteto Cantaclaro (8 pistas en común), Desensamblados (8), Agni Mogollón (7), Bolívar Caribano (7).

### Aplicado

- **Run 21189: 56 perfiles** de artista con `platform='spotify'`, `verified=true`,
  `method='exact'`, `source='spotify-web-sesion'` y nota con la evidencia (pistas en común,
  oyentes, nombre del perfil). Reversible desde Historial.
- 1 saltado por nombre incompatible: Conjunto Santa Anita → perfil «Santanita» (va a
  `dudosos-revision.csv`).
- Artistas con perfil Spotify verificado: 1.125 → **1.181**.

### Dudosos (160) — no se aplican

`dudosos-revision.csv`: artista, candidato de Spotify, oyentes, álbumes visibles, discos y pistas
del catálogo. Son perfiles con nombre exacto pero sin repertorio en común en los 10 top tracks:
pueden ser homónimos o artistas con catálogo antiguo y top tracks de reediciones. Requieren revisión
humana; el diario por API los seguirá intentando.

## Límites medidos (para futuras campañas)

- **Web anónima**: no sirve discografías. El hash `5e07d323…` hoy es `queryArtistDiscographyOverview`
  e invocado como `DiscographyAll` devuelve 200 con lista vacía (falla en silencio).
- **Con sesión**: `queryArtistOverview` funciona (nombre, oyentes, topTracks, álbumes); la ruta de
  discografía completa sigue rota.
- **API oficial**: 429 «API rate limit exceeded» incluso con el token de la web; la cuota de la
  cuenta sigue siendo el cuello.
- Chrome acumula memoria: la pestaña crashea cada ~40-90 navegaciones; hay que reciclarla cada 25 y
  reiniciar el navegador si el CDP deja de aceptar conexiones.

## Archivos

- `resultados-sesion.jsonl` — 306 filas (una por artista: candidatos, perfiles, top tracks, motivo).
- `confirmados.jsonl` · `dudosos-revision.csv` · `sin-perfil.txt`
- `aplicar-enlaces.ts` (run reversible; dry-run por defecto) · `muestreo6.py` · `gen-todos.py` · `cierre.py`
- `aplicacion-ensayo.json` · `aplicacion-run21189.json`
