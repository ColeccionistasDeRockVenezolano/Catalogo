# Emociones de la música (tags y opiniones de los oyentes)

**Estado 2026-10-16:** Brian retiró la vía `+shoutbox`. Captura, carga y clasificación
de esos comentarios están desactivadas, incluso con los antiguos flags de revisión.
Las menciones a comentarios aprobados más abajo son antecedentes, no instrucciones
vigentes. No reimportar los respaldos. Véase [el retiro](LASTFM_SHOUTBOX_REVIEW.md).
Curaduría conserva el vocabulario sin atribuirlo a artistas sin identidad revisada;
las lecturas públicas excluyen shouts y agregados de artistas sin verificación.
La [propuesta de intenciones 0.1.0](INTENCIONES_HUMANAS_0.1.0.md) analiza y separa
estas categorías; todavía no modifica la ontología almacenada ni clasifica canciones.

Encargo de Brian (2026-10-16): «puedo hacer una clasificación de emociones por música
con Laya y analizar tags y comentarios… así cuando se busque algo como música para
tener sexo hay categorización buena». Taxonomía: `no_expresa_emocion` · `emocion` ·
`tristeza` · `enfocado` · `libertad` · `cachonda` · `aumenta_mi_aura`.

## Flujo (de la cosecha a la búsqueda)

1. **Cosecha** (API oficial de Last.fm): métricas y tags de usuario. La captura de
   comentarios usa `scripts/lastfm-shouts-capture-2026-10-16.py` y queda cruda hasta
   la revisión descrita en [LASTFM_SHOUTBOX_REVIEW.md](LASTFM_SHOUTBOX_REVIEW.md).
2. **Carga a la base**: `public.entity_user_tags`, `public.entity_metrics` y, solo
   tras aprobación individual, `public.entity_shouts` (migración 0081). Las métricas
   guardan fotos con fecha; los tags conservan el valor actualizado.
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
de Brian). La revisión humana está en **Curaduría → Emociones** (`/curaduria/emociones`).
Permite buscar una etiqueta, ver artistas que la usan, elegir una categoría o descartarla
y añadir una nota. Las decisiones quedan en `ingest.emotion_tag_decisions` (migración
0082), se aplican de inmediato al agregado de artistas con identidad verificada y prevalecen en las siguientes
ejecuciones de Laya. La decisión clasifica la etiqueta, no cada obra del artista.

## Cadena y actualización semanal

`scripts/lastfm-2026-10-16/07-cadena-laya.sh` = clasificar pendientes → léxico v3 →
aplicar decisiones editoriales. El timer `crv-lastfm-semanal` (lunes 04:00,
`America/Caracas`, con hasta 30 minutos de demora aleatoria) refresca las métricas de
artistas, discos y pistas con coincidencia única, además de los tags de artistas.
`ExecStartPost` ejecuta `09-refresco-emocional.sh`, que clasifica esos tags y carga
únicamente los comentarios aprobados en `verified-shouts.jsonl`. La captura cruda de
`+shoutbox` permanece fuera de la búsqueda: Last.fm agrupa homónimos bajo el mismo
nombre y una coincidencia de URL o MBID de la página no acredita cada comentario.
La captura automática está detenida hasta revisar identidad y evidencia.
Las métricas, tags y emociones de Last.fm solo se vuelven a publicar para artistas
registrados con evidencia en `ingest.lastfm_artist_verifications` (migración 0084).
La tabla empieza vacía; el refresco semanal omite los artistas aún sin verificar.

## Pendientes de evidencia

- Los nombres iguales de artistas distintos siguen requiriendo cotejo de identidad;
  el informe `reports/lastfm-identity-review-2026-10-16.json` retiene 685 coincidencias
  con identidad extranjera documentada y 525 sin país concluyente. La sincronización
  semanal omite las 1.210. Se respaldaron y retiraron 6.719 métricas, 7.856 tags y
  9 emociones asociadas, en `reports/lastfm-identity-quarantine-2026-10-16/`.
- La captura cruda de `+shoutbox` queda sin publicar; se respaldaron y retiraron
  20.521 comentarios y 8 agregados emocionales. Solo se carga
  `verified-shouts.jsonl`, con una decisión documentada por comentario.
- Las otras 11 emociones basadas en tags, de artistas sin verificación, también se
  respaldaron y retiraron. La búsqueda emocional queda sin resultados Last.fm hasta
  que la identidad de los artistas y sus evidencias se revisen.
- Las métricas de pistas con varias ediciones homónimas quedaron respaldadas en
  `reports/lastfm-track-metrics-quarantined-2026-10-16.jsonl` y retiradas del catálogo.
  `11-cargar-tracks.py` ahora salta esas coincidencias. La asignación a una edición
  concreta requiere evidencia adicional.

## Reglas

- Los tags crudos se guardan **sin filtro** (ahí está la señal); el filtro vive en la
  decisión, con su motivo (`motivo_v3`) para poder auditar cada descarte.
- Los `dudoso` no se publican: quedan con su probabilidad y su categoría candidata para
  la revisión humana.
- Cero estimación: si un tag no expresa emoción, no se inventa; la evidencia
  (`detail.tags`) siempre acompaña a cada emoción publicada.
