# Campaña de extracción 2026-10-16 — informe

Sesión de datos sobre el catálogo CRV. Tres bloques: **A** captura RYM del «resto» de artistas,
**B** portadas y fotos por APIs públicas, **C** redes sociales desde Discogs/Wikidata.
Toda escritura va en run del operador (`withOperatorRun`) → reversible desde Historial.

Tablero vivo (refresco 5 s, sin LLM): `file:///tmp/crv-recon/extraccion-2026-10-16.html`
Lo escribe la unidad `crv-extraccion-tablero` (`ops/campana-2026-10-16/tablero.sh`); mide en vivo
disco, logs y BD, con el ritmo de captura y la ETA calculados de los tramos reales del log.

---

## A · Captura RYM «resto» (cola de 5.476 fichas de artista) — EN CURSO

- Unidad `crv-scrapling-rym-resto` (sobrevive al cierre de la sesión; reanudable por `estado.json`).
- **Arrancó bloqueada por el muro de Cloudflare** (403 «Un momento…»): la `cf_clearance` del Firefox
  del dueño seguía en disco pero el servidor ya no la aceptaba. Se destrabó sola cuando el dueño
  abrió rateyourmusic.com en su Firefox (avisos automáticos por Telegram a las 13:01). El motor
  esperó en modo paciente (sondas cada ~20 min) sin quemar la cola: **nada se perdió**.
- Ritmo medido a las 16:16: **mediana 7 s por ficha** (p75 12 s; la media sube a 22 s por los
  timeouts puntuales) → la cola completa ≈ 10-34 h de captura. Al corte: **135 hechas · 35 páginas**.
- La cadena de procesamiento quedó parametrizable (commit `469b8aee`): `--dir/--v4/--informe/--paginas`
  en `00/02/03/04/05/06/10` + orquestador `ops/rym-resto/procesar.sh`
  (`reparse → cruce → enlaces → aplicar`, ensayo obligatorio antes de `--confirm`).
  Validada de punta a punta en esta sesión: reparse ✓, cruce ✓, enlaces ✓, `06-artista` en ensayo ✓
  (con 6 fichas: 1 con campos que aplicar). **La aplicación de A queda pendiente** de que haya
  volumen (fase 1 en curso; la fase 2 de discos arranca al terminar la 1).

## B · Portadas y fotos (APIs públicas) — COMPLETO salvo el residual de Commons

Discoverers terminados (unidad de lanzamiento: `ops/media-2026-10-16/lanzar.sh --estado`):

| Discoverer | Candidatas | Resultado |
|---|---:|---|
| Deezer portadas | 232 | aplicadas |
| Deezer fotos de artista | 237 | en el lote aplicado (491 dudosos + 209 ambiguos no se publican) |
| iTunes portadas | 80 | en el lote aplicado |
| Wikidata/Commons | 158 | 140 fallaron por HTTP 429 de Wikimedia (ver residual) |
| Discogs fotos | 0 | las 30 identidades Discogs sin foto no tienen imagen en Discogs (30 rechazadas) |

**Aplicado a disco y al catálogo** (`localize-images.ts`, runs reversibles):

| run | qué hizo |
|---|---|
| 20136-20138 | 232 carátulas Deezer descargadas y asociadas |
| 20148-20150 | 266 imágenes del lote de 3 fuentes (468 candidatas deduplicadas) |
| 20151 | 62 candidatas en conflicto → Curaduría · Imágenes (la ficha ya tenía imagen: no se pisa) |

Huecos medidos (antes → después): **discos sin carátula 1.333 → 1.079** (‑254) y
**artistas sin foto 3.386 → 3.136** (‑250).

Residual: **140 descargas de Commons fallaron con 429** (Wikimedia rate-limita tras cientos de
descargas seguidas). Reintento con 1 hilo y 1,2 s de espera: seguía en 429 → quedan para más tarde
(lista en `/tmp/wikidata-429-reintento.jsonl`, regenerable desde el manifiesto).

Pitfalls medidos y corregidos:
- `systemd-run --user` con rutas ABSOLUTAS que llevan espacios parte el argumento → los candidatos
  acabaron en `home/brian/apps/Coleccionistas` (dentro del repo). Ahora van relativas al repo; el
  pitfall quedó escrito en `docs/EXTRACCION.md` §4.
- `discover-wikidata-images.ts` moría con el timeout de 60 s de Wikidata → reintento (4 intentos,
  espera creciente, 150 s).
- `discogs-artist-photos.mts` resolvía la raíz como `../..` (vive en `scripts/`): escribía FUERA del
  repo. Corregido a `..` (commit `c975b753`) y limpiados los restos.

## C · Redes sociales (Discogs `urls[]` + Wikidata anclada) — COMPLETO y APLICADO

El runbook citaba como recolectores dos scripts que son de evidencia de GÉNERO
(`harvest-discogs-evidence.ts`, `harvest-wikidata-artist-evidence.ts`): nunca hubo recolector de
redes. Construidos de cero (commit `f76a6954`) y documentado el error en `docs/EXTRACCION.md` §5.

### Cosecha (terminada)

- `scripts/discogs-bio-index.py` — índice offline del pozo `data/raw/discogs-bio/` (13.950 respuestas
  guardadas con nombre hash): **2.038 fichas de artista con `urls[]`** + **18.373 resultados de
  búsqueda** nombre→id, ya pagados en su día y hasta hoy ilegibles.
- `scripts/harvest-social-discogs.mts` — **3.950 artistas procesados · 6.721 pedidos a la API** →
  **373 evidencias** (301 por «disco en común», 72 por «nombre único + perfil de Venezuela») y
  1.987 descartes con motivo (sin guarda) + 1.590 sin candidato Discogs.
- `scripts/harvest-social-wikidata.mts` — Wikidata anclada por P1953/P434 (143 artistas con ancla):
  6 evidencias (Pablo Manavello, Ilan Chester, Laberinto…).

### Aplicación (run **20153**, reversible desde Historial)

| destino | filas nuevas | verificadas de las nuevas |
|---|---:|---:|
| `social_links` facebook | 77 | 57 |
| `social_links` instagram | 41 | 26 |
| `social_links` x | 31 | 24 |
| `streaming_links` bandcamp (perfil) | 9 | 9 |
| `streaming_links` youtube (canal) | 21 | 19 |
| **total** | **179** | **135** |

Resultado: **178 filas nuevas + 1 actualizada**, **2 filas protegidas** que NO se pisaron
(verified/`crv-operador`, la regla dura se cumplió). `public.social_links` pasa de **1.446 a 1.595**.

Reglas aplicadas (medidas, no negociables):
- Identidad de la ficha Discogs probada por **disco en común** (release con título de un disco del
  catálogo) o **nombre único en el pozo + perfil de Venezuela**; sin guarda → descarte.
- `verified` solo cuando el **usuario** de la red coincide con el nombre del artista (con variante
  «aplastada», que es lo que destrabó casos como «El Viaje de los Antiguos» →
  `/elviajedelosantiguos`); el resto queda candidato (`verified=false`, no se publica).
- YouTube/Bandcamp (perfiles de escucha) se ABREN y se les lee el `og:title`.
- 546 URLs del pozo no son de una red soportada (webs propias, MySpace, blogs) → al informe.

Pitfall grande documentado: en SPARQL de Wikidata, `?item ?prop ?valor . VALUES ?prop { … }`
devuelve **cero filas** (el predicado no se filtra por `VALUES`); hay que usar `UNION` explícito.

## D · Decisiones pendientes del dueño (sin tocar)

1. Personas: 5.400 créditos y 832 miembros de banda esperan ficha de persona.
2. Descriptores de RYM (666 discos): no hay campo en el core.
3. Tipos DJ Mix (298) y Mixtape (101): `album_type` no los tiene.
4. Fuente de letras (740 pistas con letra; musicavenezuela.com agotada).

## Reversibilidad

Todos los runs de esta jornada son del operador y se deshacen desde Historial:
20136-20138 (carátulas), 20148-20151 (imágenes 3 fuentes + conflictos), 20153 (redes).
La captura RYM no escribe el catálogo: solo deja páginas en disco (pendiente de procesar).

## Qué queda

- **A**: captura en curso (~10-34 h). Cuando haya volumen: `bash ops/rym-resto/procesar.sh todo`
  → ensayo → `aplicar --confirm` (fase 1 = fichas de artista; fase 2 = discos, con enlaces, campos,
  créditos y pistas).
- **B**: 140 imágenes de Commons en 429 → reintentar más tarde con 1 hilo.
- **C**: 44 candidatos quedaron en Curaduría (no se publican); el pozo Discogs permitiría una
  segunda pasada con guardas más finas (1.590 artistas sin candidato Discogs y 1.987 descartes).
- Los `data-links` de las fichas nuevas traerán enlaces de escucha + lotes de SoundCloud por la
  misma cadena (`02-enlaces-lote.py` ya deja los lotes para `apply-soundcloud-chatgpt.ts`).
