# Reproductores de Bandcamp

Bandcamp incrusta publicaciones, no perfiles de artista. El enlace conserva su URL
original y `external_id` guarda `album=<id>` o `track=<id>`. Un ID de banda (`b` en
la búsqueda de Bandcamp) no sirve como ID de álbum. En un perfil se puede elegir
una publicación del mismo dominio; en una ficha de disco hay que resolver la URL
exacta de esa publicación. Una página de pista usa su propio ID de pista.

`src/shared/streaming-embeds.ts` genera el iframe oficial. Las fichas de artistas
también pueden usar una publicación verificada de su discografía mediante
`artistPlaybackAlbums`. Completar un ID no aprueba la identidad de un enlace:
la reparación conserva `verified`, URL, propietario, procedencia y notas.

## Reparación y evidencia

Primero leer `docs/SHARED_STORAGE.md` y comprobar el almacén:

```bash
python3 scripts/shared-storage.py status
python3 scripts/staging.py new data/research bandcamp-players-FECHA
```

Usar la ruta de SSD que devuelve `staging.py` en los comandos siguientes. El
ejemplo de la campaña inicial usa `/home/brian/crv-staging/data/research/bandcamp-players-2026-10-26`.

1. `scripts/bandcamp-player-links.ts export DIRECTORIO` exporta enlaces actuales
   de artistas, discos y CD/lados. Ejecutar con `scripts/with-node22.sh node --import tsx`.
2. `python3 scripts/bandcamp-player-local.py DIRECTORIO` resuelve primero los
   identificadores de las cosechas conservadas, resultados primarios de búsqueda
   y capturas HTML que ya estén en el staging. Produce `results.json`.
3. Para reutilizar originales documentales, exportar de
   `ingest.research_source_captures` los campos `url`, `final_url`, `stored_path`,
   `captured_at`, `http_status`, `acquisition_complete` correspondientes a URLs
   de Bandcamp en `archive-index.json`. Ejecutar
   `python3 scripts/bandcamp-player-source-archives.py DIRECTORIO`.
4. `python3 scripts/bandcamp-player-browser-results.py DIRECTORIO` combina las
   evidencias y genera `pending.json`. Distingue una cuenta redirigida al registro
   de Bandcamp de un fallo de red. No sustituye una publicación ausente por otro
   disco del mismo sello ni reanima una cuenta eliminada usando una captura vieja.
5. Cuando hagan falta consultas nuevas, ejecutar
   `~/.venvs/scrapling/bin/python scripts/bandcamp-player-browser-capture.py DIRECTORIO`.
   Conserva cada resultado por separado, espacia las consultas y se detiene al
   detectar HTTP 429. Tras el enfriamiento del proveedor puede reanudarse sin
   repetir capturas satisfactorias. Volver a combinar resultados al terminar.
   La alternativa HTTP `bandcamp-player-capture.py` también tiene corte por 429
   y admite `--offline`; no insistir con ella cuando el proveedor la limita.
6. Revisar `results.json` y ejecutar `scripts/bandcamp-player-links.ts apply DIRECTORIO`.
   La aplicación usa un run reversible y no pisa enlaces modificados desde el
   inventario. Conserva una publicación elegida previamente para un perfil.
   `application.json` registra el run y los totales. La invalidación de caché se
   publica mediante el flujo habitual del operador, sin reiniciar la API.
7. Cerrar la campaña con `python3 scripts/staging.py publish data/research NOMBRE --hash`.

`additional-links.json`, si existe, contiene enlaces nuevos revisados por separado
con `albumId`, `title`, `url`, `externalId`. Sólo se insertan cuando coinciden
exactamente la ficha actual y el título revisado y no hay otro enlace Bandcamp.
En la campaña inicial incluye el ejemplo indicado por Brian: «Rajatavla, zona
liberada», disco 34389, `album=3259488170`.

Una captura histórica acredita el identificador, pero no garantiza disponibilidad
actual ni reproducción de todas las pistas. Las cuentas eliminadas, catálogos
vacíos y fallos de red quedan documentados; no se inventa un iframe para ellos.

## Comprobaciones

```bash
python3 -m unittest discover -s test/python -p 'test_bandcamp_player_*.py'
./scripts/with-node22.sh node_modules/.bin/vitest run web/tests/unit/embeds.test.ts
```
