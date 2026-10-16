# Emociones de la música (tags y opiniones de los oyentes)

Encargo de Brian (2026-10-16): «puedo hacer una clasificación de emociones por música
con Laya y analizar tags y comentarios… así cuando se busque algo como música para
tener sexo hay categorización buena». Taxonomía: `no_expresa_emocion` · `emocion` ·
`tristeza` · `enfocado` · `libertad` · `cachonda` · `aumenta_mi_aura`.

## Flujo (de la cosecha a la búsqueda)

1. **Cosecha** (API oficial de Last.fm, sin evasión): tags de usuario por artista
   (`scripts/lastfm-tags-fetch-2026-10-16.py`) y comentarios (shouts) con la sesión real
   del dueño (`scripts/lastfm-shouts-capture-2026-10-16.py`, Chrome copiado: la API no
   expone shouts).
2. **Carga a la base**: `public.entity_user_tags`, `public.entity_shouts`,
   `public.entity_metrics` (migración 0081, décima excepción del core; snapshots con
   fecha, nunca se pisa).
3. **Clasificación con Laya** (GPU, venv `~/.venvs/laya`): 6 preguntas binarias `noul`
   en inglés, umbral 0.5 sobre el léxico emocional elegido en la medición 12/16.
   Caché reanudable: `reports/laya-2026-10-16/tags-clasificados.jsonl`.
4. **Re-decisión con el léxico** (`08-reclasificar-v3.py`, sin GPU): la regla que evitó
   el ruido medido (Laya puntuaba «angola», «malalma», «sex pistols» como emociones):
   - `filtros` — género (tabla `ingest.genres`/`genre_aliases`), país, ciudad, idioma,
     año → `no_expresa_emocion`;
   - `fuerzas` — palabra que por sí sola determina emoción (sexo→cachonda, amor→emocion,
     triste→tristeza…), exige p≥0.50 de Laya para forzar;
   - `candidatas` — decide Laya: ≥0.80 emoción, 0.50–0.80 `dudoso` (revisión, no se publica);
   - sin raíz → `no_expresa_emocion`.
5. **Agregado y publicación**: `public.entity_emotions` (artist/album/track × emoción,
   `score` = suma de pesos de los tags, `detail` con la evidencia). La API sirve
   `/emotions/:emotion/artists` y el bloque `emotion` de `/search`: la consulta
   «música para tener sexo» detecta la intención (léxico ES con plurales) y devuelve
   los artistas con esa emoción clara, ordenados por peso × oyentes.

## Léxico calibrable

`scripts/lastfm-2026-10-16/lexico-emocional.json` es el archivo editable (fuerzas,
candidatas, exactas y filtros; ciudades venezolanas separadas de países por indicación
de Brian). El tablero de calibración se regenera con `python3 /tmp/crv-laya-tablero.py`
(→ `/tmp/crv-recon/crv-laya-calibracion.html`, servido en `:8920`): muestra los claros,
los dudosos, los descartados y las muestras de control, con los artistas reales que usan
cada tag, y exporta el JSON de correcciones. Con el JSON de vuelta: ajustar el léxico,
re-ejecutar `08`, y `05 --apply-only`.

## Cadena y actualización semanal

`scripts/lastfm-2026-10-16/07-cadena-laya.sh` = clasificar pendientes → léxico v3 →
aplicar. El timer `crv-lastfm-semanal` (lunes 04:00, `America/Caracas`) refresca las
métricas de escucha y, con `ExecStartPost` → `09-refresco-emocional.sh`, recarga tags
nuevos y cierra la cadena emocional. Todo idempotente y reanudable.

## Reglas

- Los tags crudos se guardan **sin filtro** (ahí está la señal); el filtro vive en la
  decisión, con su motivo (`motivo_v3`) para poder auditar cada descarte.
- Los `dudoso` no se publican: quedan con su probabilidad y su categoría candidata para
  la revisión humana.
- Cero estimación: si un tag no expresa emoción, no se inventa; la evidencia
  (`detail.tags`) siempre acompaña a cada emoción publicada.
