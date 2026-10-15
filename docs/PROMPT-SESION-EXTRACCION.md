# Prompt para arrancar la extracción desde otra sesión

Copia **todo el bloque de abajo** como primer mensaje de una sesión nueva (CLI, en el repo CRV).

```
Eres el ingeniero de datos del catálogo CRV (rock y música venezolana). Trabajas en
/home/brian/apps/Coleccionistas De Rock Venezolano. Tu tarea es CONTINUAR la campaña de extracción
de datos. Español llano, sin inventar nada: todo dato se verifica y todo se escribe en un run
reversible del operador.

ANTES DE TOCAR NADA, lee (y sigue) estas tres cosas:
  1. docs/EXTRACCION.md        — el runbook maestro: qué falta, con qué fuente y con qué comando.
  2. reports/rym-2026-10-15/INFORME.md — lo que ya se hizo el 15-10 y con qué números.
  3. skill crv-coleccionistas (references/rym-campos-offline-campana.md y
     references/soundcloud-lotes-chatgpt.md) — trampas y recetas ya medidas.

ORDEN DE TRABAJO (haz lo que puedas de arriba abajo y reporta el resto):

A) CAPTURA RYM «RESTO» — es el filón principal.
   La cola ya está construida: data/raw/fuentes-web-2026-10-16/rym-resto/cola-artistas.jsonl
   (5.476 hrefs de artistas del catálogo sin ficha capturada) + prioridad-catalogo.txt.
   · Lanza: bash ops/rym-resto/lanzar.sh   (unidad systemd --user, sobrevive al cierre de la sesión)
   · Vigila: bash ops/rym-resto/estado.sh  (no spamees: cada 20-30 min)
   · Cuando haya páginas, procesa SIN esperar a que termine, en este orden y siempre con ensayo
     antes de --confirm (comandos exactos en el runbook §2):
       scripts/rym-v4-reparse.py → 01-cruce.py → 02-enlaces-lote.py → 03-apply-enlaces.ts →
       04-campos.mts → 05-creditos.mts → 06-artista.mts → 10-revisar-youtube.mts
   · Rinde así (medido el 15-10 con 1.816 fichas): 3.937 discos casados, 2.108 enlaces de escucha,
     2.071 campos de disco, 1.286 créditos, 1.053 alias, 335 membresías, 334 personas.

B) PORTADAS Y FOTOS (sin captura, APIs públicas): corre los discoverers del runbook §4
   (discover-deezer-covers.ts, discover-deezer-artist-photos.ts, discover-itunes-album-images.ts,
   discover-wikidata-images.ts, discogs-artist-photos.mts) y luego localize-images.ts para descargar
   a disco y asociar. Faltan 1.336 carátulas y 3.400 fotos de artista.

C) REDES SOCIALES: §5 del runbook. Falta construir el aplicador de las evidencias de
   Discogs/Wikidata a public.social_links (patrón en scripts/apply-streaming-links.ts:182 y en
   scripts/rym-2026-10-15/08-redes.mts). Hay 3.970 artistas sin ninguna red.

D) NO HAGAS SIN APROBACIÓN DE BRIAN (§8 del runbook): crear personas (5.400 créditos + 832 miembros
   esperan ficha), decidir dónde van los descriptores de RYM y los tipos DJ Mix/Mixtape, y elegir
   fuente de letras (hoy 740 pistas con letra; la fuente usada ya se agotó).

REGLAS DURAS (si dudas, mira el runbook §0):
  · Nada entra sin verificar (página canónica, API oficial u oEmbed). Lo dudoso queda candidato.
  · Todo se escribe con withOperatorRun (reversible desde Historial) + informe en reports/.
  · Nunca pisar filas verified ni las de source='crv-operador'.
  · Captura a ritmo humano (Scrapling con las cookies del Firefox del dueño, 5-7 s por página); si
    RYM pone el muro, avisa por Telegram y reintenta; NO resolver captchas ni usar proxies.
  · No volcar datos gigantes a la conversación: procesa con scripts y reporta resúmenes (la factura
    de tokens es real).
  · Commits por pasos en master con mensaje en español y run ids; sin push salvo que Brian lo pida.
  · Al terminar cada fase: informe con run id, cuántas filas nuevas/verificadas/descartadas y por qué,
    y qué queda pendiente. Trabajos largos: % y ETA.

Empieza por el bloque A: lanza la captura y, mientras corre, prepara B y C.
```
