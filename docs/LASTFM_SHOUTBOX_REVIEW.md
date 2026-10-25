# Revisión de `+shoutbox` de Last.fm

## Retiro de esta vía (Brian, 2026-10-16)

Brian retiró `+shoutbox` por ruido y mezcla de homónimos. La captura y sus cachés
quedan como archivo histórico excluido de clasificación y curaduría. Las reglas de
publicación que siguen documentan el intento anterior y **ya no autorizan ejecutarlo**.

La comprobación actual, solo con `BEGIN READ ONLY`, encontró cero filas en
`entity_shouts`, cero en `entity_emotions` y cero identidades Last.fm verificadas.
No fue necesario escribir ni borrar datos. Se conservan los respaldos anteriores.

Se retiraron carga y clasificación de comentarios de `09-refresco-emocional.sh`.
La captura y el clasificador de shouts terminan antes de importar dependencias,
conectarse o leer cachés; `03-cargar-tablas.py --shouts-only` también termina sin
operaciones. El importador ya no contiene escrituras a `entity_shouts`.
Las lecturas emocionales excluyen `basis='shouts'` y artistas sin verificación.
Curaduría conserva el vocabulario crudo, pero oculta los vínculos de artista sin
identidad revisada. Los conteos de etiquetas no acreditan atribución musical.
Una identidad de página revisada tampoco resuelve por sí sola la mezcla de tags
de varios homónimos: cada futura atribución a una obra requiere evidencia propia.

Propuesta posterior, sin importación ni clasificación de canciones:
[Intenciones humanas 0.1.0](INTENCIONES_HUMANAS_0.1.0.md).

## Antecedente archivado: revisión individual propuesta anteriormente

La URL `/music/<nombre>/+shoutbox` se obtiene por nombre y puede reunir comentarios
de artistas homónimos. Ni el título de la página ni un MBID devuelto por la API
demuestran que **cada** comentario se refiere al artista venezolano. La captura
anterior quedó como evidencia cruda, fuera de la búsqueda.

## Estado y evidencia

- Captura cruda: `reports/lastfm-shouts-2026-10-16/shouts.jsonl` y `crudo/`.
- Cola de revisión: `reports/lastfm-shouts-2026-10-16/identity-review-queue.csv`.
  Se regenera con `scripts/lastfm-2026-10-16/16-shoutbox-review-queue.py` e incluye
  solapamiento de títulos con el catálogo como pista para investigar, nunca como
  aprobación automática: incluso 41 identidades extranjeras tienen dos o más
  títulos coincidentes.
- Respaldo de lo retirado de la base: `quarantine-entity-shouts.jsonl` y
  `quarantine-entity-emotions.jsonl` en la misma carpeta.
- Identidades Last.fm dudosas: `reports/lastfm-identity-review-2026-10-16.json`.
  Métricas y tags retirados: `reports/lastfm-identity-quarantine-2026-10-16/`.

## Regla de publicación

1. Acreditar la identidad del artista con fuentes que vinculen **esa ficha** con
   la URL exacta de Last.fm. Guardar `artist_id`, `lastfm_url`, evidencia y revisor en
   `ingest.lastfm_artist_verifications`. Una coincidencia de nombre no sirve.
2. Capturar solo las URLs aprobadas con
   `scripts/lastfm-shouts-capture-2026-10-16.py --verified-only`. El resultado
   `shouts-verified-source.jsonl` sigue siendo **crudo**: la página puede mezclar
   opiniones de homónimos.
3. Revisar cada comentario por separado. Solo los comentarios con evidencia de
   pertenecer al artista entran a `verified-shouts.jsonl`, una línea por comentario:

   ```json
   {"kind":"artistas","id":123,"url":"https://www.last.fm/music/Ejemplo/+shoutbox","reviewed_by":"Brian","reviewed_at":"2026-10-16T16:00:00-04:00","evidence":"Menciona el disco documentado X del artista 123","shouts":[{"author":"usuario","when":"16 Oct 2026, 4:00PM","text":"Comentario pertinente"}]}
   ```

4. `03-cargar-tablas.py --shouts-only --confirm` exige tanto la identidad de artista
   verificada como revisión y evidencia individual. El refresco emocional semanal
   usa esta misma carga. Los comentarios sin aprobar no llegan a `entity_shouts` ni
   a `entity_emotions`.

La captura por nombre solo se permite explícitamente con
`--capture-unverified-for-review` y jamás se carga directamente al catálogo.
