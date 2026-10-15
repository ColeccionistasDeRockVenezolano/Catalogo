# Campaña RYM 2026-10-15 — aprovechar las fichas ya capturadas (offline)

Encargo de Brian: «implementa todas [las fases] y deja registro en el proyecto, que sean reversibles;
e investiga si hay redes sociales (X, YouTube, FB, Threads, otras)» y «aprovecha fechas,
fallecimientos, Also Known As como alias, todos los que se puedan».

Todo sale de lo YA capturado en disco (`data/raw/fuentes-web-2026-10-01/rym-nuevos/`, 7.328 fichas de
disco y 1.591 de artista) y del re-parseo offline `reports/rym-v4-2026-10-04/`. Cero red salvo la
verificación de enlaces. Todas las escrituras van en un run del operador (`withOperatorRun`), o sea
**reversibles desde Historial** y con su fila de auditoría.

## 1. Cruce ficha ↔ disco del catálogo (`01-cruce.py`)

**3.937 fichas casadas** (923 artistas) de 7.328. Reglas: artista por nombre o alias exacto
(normalizado), título por título normalizado, desempate por año; lo ambiguo se descarta.
Descartes: 1.903 fichas de artistas que no están en el catálogo, 676 sin título que case, 487 sin
meta legible, y 325 de tipos que no son discos (vídeo, mixtape, «additional release»).
Salida: `reports/rym-2026-10-15/cruce.jsonl`.

## 2. Enlaces de escucha de cada disco (`00-extraer-data-links.py` + `02-enlaces-lote.py` + `03-apply-enlaces.ts`)

Las fichas de RYM traen `data-links` con los reproductores de cada disco. Extraídos **10.482
enlaces**; de las fichas casadas quedan **2.891** (Spotify 928 · Apple Music 606 · Bandcamp 495 ·
YouTube 397 · SoundCloud 273 · Deezer 107 · Tidal 85). Los 63 de Qobuz se descartan: no exponen
ficha pública por id y el catálogo no tiene su icono.

Verificación por plataforma antes de escribir (nada entra sin comprobar): Spotify oEmbed, iTunes
lookup, `api.deezer.com`, API oficial de Tidal (credenciales del `.env`), la propia página de
Bandcamp (og:title) y oEmbed de YouTube; el título de la plataforma se compara con el del disco.
Coincide → `verified=true`; existe y no coincide → candidato (`verified=false`, no se publica).
SoundCloud va por su verificador propio (`scripts/apply-soundcloud-chatgpt.ts`, lotes en
`lotes-soundcloud/`, 107 lotes / 273 enlaces).

**Resultado medido — run 20084: 2.108 enlaces nuevos** (+10 actualizados):

| plataforma | verificados | candidatos | descartados |
| --- | --- | --- | --- |
| Spotify | 859 | 44 | 0 |
| Bandcamp | 317 | 85 | 45 (404) |
| Apple Music | 294 | 83 | 146 (id inexistente en el catálogo de Apple) |
| Deezer | 72 | 2 | 1 |
| Tidal | 4 | 2 | 1 |
| YouTube | 91 | 281 | 25 (vídeo caído) |

**SoundCloud — run 20085: 209 enlaces** (125 verificados · 84 candidatos · 54 descartados por set
inexistente: los enlaces de RYM envejecen). Se afinó el verificador: una PISTA del propio artista
cuyo título CONTIENE el del disco («Arca - Airdoll» para «Airdoll») ahora vale como verificada.

## 3. Campos del disco (`04-campos.mts`) — run **20081**

2.071 discos, solo huecos (nunca pisa nada):

| campo | discos |
| --- | --- |
| `release_date_text` (fecha completa: «5 de junio de 2026») | 1.429 |
| `media_format` (Vinyl LP, CD, Cassette, Digital File…) | 1.036 |
| `catalog_id` (n.º de catálogo del sello) | 773 |
| `release_year` (donde faltaba) | incluidos arriba |

## 4. Créditos de disco (`05-creditos.mts`) — run **20082**

11.282 créditos leídos en las fichas casadas → **1.286 créditos nuevos** (agrupados por disco +
persona + tipo). El tipo lo clasifica el motor (`creditTypeForRole`). Se aplican SOLO cuando la
persona ya existe (nombre o alias exacto, sin ambigüedad): 5.400 créditos sin ficha de persona y
1.378 de artistas (bandas, no personas) quedaron en `creditos-sin-persona.json` para otra pasada.
Tipos: musician 3.150 · writer 476 · composer 284 · producer 188 · mixing 50 · mastering 22 ·
recording 16 · artwork 2.

## 5. Ficha de artista, membresías y personas (`06-artista.mts`) — run **20083**

1.042 fichas con algo que aplicar:

- **1.053 alias** nuevos («Also Known As» y «Currently», tipo `name_variant`) — 878 fichas de RYM los traen.
- **335 membresías** con rol y años (`artist_members`): «Karen M. González (guitar, synthesizer, lead vocals)», con `from_year`/`to_year`/`is_current` cuando la ficha lo dice.
- **334 personas** con fechas: nacimiento, fallecimiento, ciudad de nacimiento y marca de fallecido (solo huecos; fechas parciales descartadas y reportadas).
- **256 fichas** con año de formación y/o ciudad (desde «Formed»).

Pendiente aquí (a propósito, no aplicado): **832 miembros de banda que NO tienen ficha de persona**
en el catálogo (crear personas es otra decisión, con sus guardas de homónimos), 205 artistas sin
persona homónima para colgarles las fechas, 77 miembros ambiguos (varias personas con ese nombre) y
93 fichas con fechas incompletas (solo año). Listados completos en `artista-ensayo.json`.

## 6. Redes sociales en lo capturado (`redes-extraer.sh` + `07-redes.py` + `08-redes.mts`) — run **20086**

RYM **no** trae redes del artista (los `facebook/twitter/instagram` de sus páginas son el pie del
propio sitio: están en las 1.591 fichas de artista y en las 7.328 de disco, apuntan a
`sonemic.network`, `sharer.php`, `intent`…).

El pozo son las capturas anteriores (`data/raw`): 4.241 URLs sociales únicas, 115.351 apariciones.
Dos intentos que NO sirven, medidos: (a) atribuir por el artista del archivo — cada blog presta sus
propias cuentas y cada artista heredaba las mismas URLs; (b) descartar por frecuencia — se lleva por
delante los casos reales. **La señal buena es el usuario de la red: si el handle coincide con el
nombre de un artista del catálogo (normalizado, sin adornos `official`/`music`/`band`), es su cuenta.**

Resultado: **536 parejas artista-plataforma** (354 artistas) → aplicadas 307 nuevas (`capturas-redes`):
Facebook 126 (125 verificadas) · Instagram 79 (78) · X 69 (68) · YouTube 31 (31, van a
`streaming_links` como perfil) · TikTok 1 · Threads 1. `public.social_links` pasa a **1.446 filas de
829 artistas**.

## Reversibilidad y registro

Todos los runs de esta campaña son del operador y se deshacen desde Historial:

| run | qué hizo |
| --- | --- |
| 20081 | campos de disco (2.071) |
| 20082 | créditos de disco (1.286) |
| 20083 | fichas de artista (256), alias (1.053), membresías (335), personas (334) |
| 20084 | enlaces de escucha verificados (2.118) |
| 20085 | enlaces de SoundCloud de las fichas de RYM (209) |
| `redes-run*` | redes sociales atribuidas |

Runs anteriores relacionados (misma jornada, SoundCloud): 20076 (prueba), 20077 (primer paquete de
ChatGPT), 20078 (pistas de cloudy), 20079 (cosecha de perfiles), 20080 (tanda 574-5843).

## Estado del catálogo al cerrar (medido)

- `public.streaming_links`: **31.742 filas · 27.727 verificadas**; con reproductor verificado en
  **7.772 discos** (tidal 6.507 · youtube_music 6.072 · deezer 4.314 · apple_music 3.423 ·
  spotify 2.003 · bandcamp 741 · youtube 367 · soundcloud 260).
- `public.album_credits`: 69.692 filas en 5.734 discos.
- `public.artist_members`: 10.817 filas (eran 10.482).
- Discos con fecha completa, formato o n.º de catálogo: 2.071 más que al empezar.

## Lo que queda sin hacer (y por qué)

- 63 enlaces de Qobuz (sin verificación posible: su ficha es una SPA y el catálogo no tiene su icono).
- 5.400 créditos de personas que no están en el catálogo + 832 miembros sin ficha: crear personas.
- 676 fichas de disco que no casaron por título (revisar a mano; probablemente variantes del título).
- 1.903 fichas de artistas fuera del catálogo (no aplican a CRV).
- Fotos de las fichas de artista (532 sin foto en el volcado): no aplicadas en esta campaña.
- Redes sociales que no se pueden deducir del disco: la vía que queda es la API de
  **Discogs (`urls[]`)** y **Wikidata**, ya probadas en el piloto de redes (`redes-sociales-fuentes.md`);
  el `DISCOGS_TOKEN` está en el `.env`. Son ~4.785 artistas a 60 req/min ≈ 1,5 h de barrido.
