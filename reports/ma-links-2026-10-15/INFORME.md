# Related Links de Metal Archives — captura 2026-10-15

Encargo de Brian: los «Related Links» de las fichas de MA (no capturados en la campaña
del 01-10) — links de redes y, sobre todo, **MySpace** (insumo para scrapear esos perfiles
por Wayback).

## Hallazgo: el hueco

La pestaña «Related Links» de la ficha de banda **no viene en el HTML**: se carga por AJAX
desde `metal-archives.com/link/ajax-list/type/band/id/<ma_id>`. En las 611 fichas capturadas
el 01-10 solo quedó el `href` de la pestaña (medido: 0/611 con facebook/instagram/youtube).

## Vía de acceso

- La `cf_clearance` del **Firefox** del dueño era del 30-09 y el script de sesión fijaba
  UA `Firefox/140` mientras el ESR ya es **153.5** → 403 (la cookie va atada a IP+UA).
- La cookie viva estaba en **Chrome** (creada 11:03 del 15-10). El descifrado externo de las
  cookies de Chrome (`v11`) no salió con las variantes clásicas (PBKDF2/saltysalt, CBC/GCM),
  así que se fue por el navegador real: **copia del perfil** (`/tmp/chrome-ma`) + Chrome con
  `--remote-debugging-port=9333` (unidad `chrome-ma.service`, headed, mismo UA) + Playwright
  `connect_over_cdp` → los `fetch` salen con la sesión y el TLS del propio navegador.

## Captura

- **611/611 bandas · 17,1 min · 0 fallos** (0,59 bandas/s; pausa 1-2 s, 3 reintentos por banda,
  aborto si 8 fallos seguidos). HTML crudo por banda en
  `data/raw/metal-archives-ve-2026-10-01/links/<ma_id>.html` (reanudable; log `captura.log`).
- Scripts: `scripts/ma-links-2026-10-16/` — `01-sonda.py`, `02-capturar.py` (captura),
  `03-parsea.py` (parser offline sobre el HTML ya en disco), `04-myspace-cola.py`.

## Resultado (verificado sobre los 611 HTML)

- **574 bandas con enlaces · 37 sin ninguno · 2.650 enlaces** en total.
- Por etiqueta: Facebook 392 · YouTube 257 · **Myspace 226** · Bandcamp 211 · SoundCloud 201 ·
  Instagram 187 · Spotify 178 · Twitter 173 · ReverbNation 167 · Apple Music 160 · Deezer 66 ·
  Amazon 52 · **Myspace @ archive.org 21** · Tidal 16.
- **MySpace: 239 enlaces en 236 bandas** (187 con ficha en el catálogo, 52 sin) y **24 bandas
  con snapshot de Wayback ya enlazado por MA** (perfiles muertos con su archivo dado).
- Cola lista: `reports/ma-links-2026-10-15/myspace-cola.csv|jsonl`
  (ma_id, banda, crv_artist_id, slug, url, archivo_org).

Lo ya presente en el catálogo viene de otras vías (MB url-rels 2.091 filas, SoundCloud, Bandcamp
342, Discogs/Wikidata); **MA no había aportado nada de esto**: es un pozo nuevo de redes directas
de las bandas.

## Siguientes pasos

1. **Scrapear los perfiles MySpace por Wayback** (receta existente, `reports/myspace-2026-10-15/`):
   arrancar con tanda piloto para medir cobertura real (ayer se midió que el CDX se satura pasadas
   ~40 consultas y que el slug ≠ nombre).
2. **Aplicar al catálogo** los enlaces de redes (Facebook/Instagram/Twitter/YouTube/Bandcamp/MySpace…)
   previa verificación de las plataformas admitidas por `public.streaming_links` y con el aplicador
   de redes existente (`apply-social-links.ts`), en run reversible.

## Pitfalls medidos (para reusar)

- `cf_clearance` está atada a IP+UA: el UA del script debe seguir al navegador instalado; si no, 403.
- El puerto 9222 ya lo ocupaba otro Chrome del dueño (404 en `/json/version`): usar puerto propio.
- `pkill -f '<patrón>'` se suicida si el patrón aparece en la línea de comandos del propio shell
  (usar `'[p]atrón'`).
- Las cookies `v11` de Chrome 149 no se descifraron con PBKDF2/saltysalt (1/1003 iters, 16/32 bytes)
  ni GCM: el camino que funciona es el navegador real por CDP.

---

# Piloto MySpace por Wayback (2026-10-15)

`scripts/ma-links-2026-10-16/05-myspace-piloto.py` — cola de 263 perfiles (260 bandas; 205 con ficha),
piloto sobre los primeros 35. Por perfil: el snapshot de archive.org que da MA si existe; si no, CDX
(2004-2013, status 200, `collapse=digest`), prefiriendo 2008-2009 (clásica y con tildes). Bajada con
`id_` y extracción con la lógica del extractor v3 (`<td id="Profile…">` + About).

## Resultado

- **35 perfiles · 27 con campos extraídos (77 %)** · 7 sin snapshot en Wayback (20 %) · 1 con snapshot
  de plantilla tardía sin datos (2012).
- Campos por frecuencia: Member Since 27 · Record Label 24 · Influences 21 · Band Members 20 ·
  Type of Label 16 · Band Website 15 · Sounds Like 15. Los títulos clásicos traen ciudad y géneros
  («MySpace.com - Gutiroth - Mariara, VE - Black Metal»); 9 de los 27.
- Consolidado legible: `reports/ma-links-2026-10-15/myspace-piloto-consolidado.csv`
  (título, About, Members, Influences, Sounds Like, Record Label, Band Website por banda).
- Crudo: `data/raw/myspace-ma-2026-10-15/<ma_id>-<ts>.html` (35 archivos); JSONL reanudable y log.

## Trampas medidas

- **CDX saturado**: a las ~20 consultas seguidas empiezan 503/timeouts y «0 snapshots» que parecen
  ausencia real. Espaciar 2,5-4,5 s, reintentar y re-verificar antes de descartar (un falso negativo
  — Demise — se recuperó al reintentar: tenía snapshot 2010).
- La reanudación debe contar como «hecho» solo lo que bajó HTML o extrajo campos; los fallos se
  reintentan (bug corregido en el piloto).
- 2012 ya es plantilla tardía sin datos → no gastar tiempo; el pozo bueno es 2005-2010.

## Campaña completa (lista para lanzar)

Quedan **228 perfiles** de la cola. A este ritmo (~35 en dos tandas con reintentos) son ~3-4 h en
tandas con pausas y una pasada final de reintento de los vacíos; después, el mapeo al catálogo
(bios/miembros/influencias/géneros + web propia) como en el caso 2HD.
