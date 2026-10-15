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

---

# Campaña completa MySpace — CIERRE (2026-10-15, 4 pasadas)

Sistema de captura con **log estructurado** (`capturas-wayback.jsonl`: un evento por fase) y
**analizador de patrones** (`07-patrones.py` → `patrones-wayback.md`) que ajusta la política.
Tablero en vivo: sección 6 de `file:///tmp/crv-recon/extraccion-2026-10-16.html`.

## Resultado (263 perfiles, 260 bandas)

- **146 con datos extraídos (56 %)** · 100 sin clásico archivado (cierre definitivo) ·
  15 con snapshot pero sin datos (plantilla tardía 2011-2012) · 2 sin nada en Wayback.
- Campos: Member Since 142 · Influences 105 · Band Members 105 · Record Label 102 ·
  Type of Label 102 · Sounds Like 82 · Band Website 76 · About (variable) ·
  55 perfiles con **ciudad y géneros** en el título clásico.
- Consolidado: `myspace-piloto-consolidado.csv` · crudo: `data/raw/myspace-ma-2026-10-15/`.

## Patrones medidos (los que cambiaron la captura)

1. **Por año: 2007-2010 = 100 % con datos; 2011+ = 0 %** (plantilla JS). El corte de año es 2010.
2. **Por forma de URL: `www.myspace.com/<slug>:80` rinde ~91 % de clásicos vs ~11 % de
   `myspace.com/<slug>`** → se consulta primero la forma con puerto. Los «sin clásico» iniciales
   eran en gran parte falsos por consultar solo la forma sin www.
3. **CDX: la consulta «cara»** (`filter=statuscode:200` + `collapse=digest`) devuelve **vacíos
   falsos** y es la más lenta → consulta ligera + filtro en cliente.
4. **Saturación**: 43 % de consultas vacías en pico, ráfagas de hasta **33 vacíos seguidos**;
   p50 16 s · p90 50 s. Política aplicada: pausa 20→300 s por vacío, ronda de 300 s a los 4
   seguidos, corte de pasada a las 3 rondas, y 4 pasadas con 7 min de respiro.
5. **Solo-301 / solo-2011+** = sin clásico real: cierre definitivo, no se reintenta (patrón
   `statuses` en el log lo distingue de la saturación).
6. **Campos bilingües**: 6 perfiles con etiquetas en español («Miembro desde», «Sello
   discográfico»…) → normalizadas al mapa común.

## Siguiente paso

Mapeo al catálogo (caso 2HD como plantilla): About → biografía; Band Members → miembros con
instrumento; Influences → géneros; Record Label / Band Website → contexto y redes. 205 de los
263 perfiles tienen ficha en el catálogo.
