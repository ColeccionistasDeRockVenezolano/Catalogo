# Datos scrapeados: disco de 1 TB (Codex, Hermes, Synapse y Claude Code)

El almacén local de capturas, investigación, resultados e imágenes descargadas
es **`/mnt/1tb/Shared/coleccionistas-rock-venezolano`** (`Shared` con mayúscula).
Leer [docs/SHARED_STORAGE.md](docs/SHARED_STORAGE.md) antes de trabajar con estos datos.
`data/raw`, `data/research`, `reports`, `web/public/media` y `tmp-analysis`
se conservan como enlaces locales al almacén y se usan para **leer** y para el
pipeline.

**Las capturas nuevas se escriben primero en el SSD**
(`$HOME/crv-staging/<ruta>/<campaña>`) **y se publican al almacén al cerrar**;
no escribir capturas directamente en los enlaces del HDD. Herramienta:
`python3 scripts/staging.py new|status|list|publish` (ver
[docs/SHARED_STORAGE.md](docs/SHARED_STORAGE.md) §«Capturas nuevas: staging en SSD»).

Antes de capturar o iniciar procesos que escriben datos, ejecutar
`python3 scripts/shared-storage.py status`. Si falla, detenerse y resolver el
montaje/enlace; no recrear las carpetas en el SSD ni eliminar sus enlaces.
Toda campaña nueva debe terminar publicada en el disco de 1 TB.
Brian autorizó expresamente trasladar **también los informes versionados**
(«quiero que muevas esos 24GB no importa git»). Las bajas de `reports/*` en
Git son consecuencia del traslado; no restaurar esos archivos encima del
enlace ni interpretar las bajas como pérdida de las capturas.
No mover PostgreSQL, secretos ni dependencias a este almacén.

# Rotaciones y recomendaciones diarias

Toda selección diaria, actual o futura, debe usar el reloj editorial común de
[src/shared/daily-cycle.ts](src/shared/daily-cycle.ts): cambia a las 00:00 de
`America/Caracas`. No introducir otro huso horario, fecha local del navegador,
temporizador de cambio de día o sorteo aleatorio por visita para una selección diaria.

En React, usar `DailyCycleProvider`, `useDailyCycle` y `useDailyAsync`. Las APIs
diarias reciben la fecha del ciclo y devuelven `dailyCycle`; nunca mostrar una
selección del ciclo anterior mientras se carga la nueva. El servidor es la
autoridad horaria. Ver [docs/DAILY_CYCLE.md](docs/DAILY_CYCLE.md).

# Audiovisuales y discografía

Documentales, conciertos, sesiones, videoclips, entrevistas, Shorts y otras
piezas editoriales van a `media.artist_audiovisuals` y a la pestaña
«Audiovisuales» del artista. No crear discos ni pistas musicales por la sola
existencia de un video o de sus marcas de tiempo. Un tipo compuesto que
incluya audiovisual también sigue esta regla.

Excepción expresa de Brian (2026-10-15): **Gasolina — Blues Criollo** permanece
como disco (video `bePwD424LvA`). No generalizar esta excepción.
Su documental también aparece en Audiovisuales, por indicación posterior de Brian.

Una edición musical documentada puede conservar su disco y tener su video
en Audiovisuales. Resolver artistas por identidad exacta, alias o vínculos
documentados; las ambigüedades van a revisión. **Todo audiovisual publicado
en la pestaña debe ser reproducible:** sólo un video `public` o `unlisted`
con `status.embeddable = true` confirmado por la API de YouTube puede
aparecer allí. Conservar obras y evidencia aunque el video esté bloqueado,
no disponible o no permita incrustación, pero mantenerlas fuera de la
pestaña pública hasta verificarlas. Ver `docs/AUDIOVISUALS.md`.

# Tipos y características de discos

Los tipos y características musicales pueden combinarse: sencillo + remix,
EP + remix, sencillo + instrumental + remix, demo + en vivo, B-Sides +
sencillo/compilado/en vivo, etc. Conservar el tipo de publicación documentado
y sus características; una categoría no debe ocultar las demás en fichas,
filtros o discografías. Deluxe, remasterizado y reedición pertenecen a la
versión y también pueden combinarse.

Los selectores del catálogo de discos y de la discografía permiten varias
categorías combinadas con **Y**: cada resultado debe cumplirlas todas.
Conservar la selección en la URL y reiniciar la paginación al cambiarla;
quitar una categoría debe mantener las demás.

Remix, acústico o instrumental por sí solos no determinan si una publicación
es álbum, EP o sencillo. No deducirlo solo del número de pistas, ni trasladar
las características de una pista a todo el disco. Los títulos que reúnen
material distinto requieren revisar su contenido antes de dividir fichas o
reclasificarlas. Los compuestos audiovisuales siguen la regla anterior.

# Tiempos y reproducción de YouTube

Las marcas de tiempo pertenecen a un video concreto. La ficha lee las de
`media.video_tracks` para el video seleccionado del álbum o del CD/lado;
no mezclar marcas de un videoclip, otro concierto u otro CD. Cero es un
inicio válido. Vincular capítulos a pistas existentes por título o alias
exacto; conservar sin asignar las repeticiones ambiguas y enviar las marcas
fuera de la duración a revisión. No estimar marcas sumando duraciones ni crear pistas por este
proceso. Ver [docs/YOUTUBE_TRACK_PLAYBACK.md](docs/YOUTUBE_TRACK_PLAYBACK.md).

# Productos del chat

Los nombres solo usan efectos sobre el texto y estilos. Las badges o placas
son un producto independiente (`badge`) y se muestran a la derecha del nombre.
Pueden ser estáticas o animadas; las animadas incluyen alternativa estática.
No mezclar placas, sprites ni personajes con el producto de efectos del nombre.
El catálogo anterior fue eliminado por Brian; no resembrar efectos antiguos.

# Cuentas y sesiones

CRV y la instancia Herra de CRV usan la misma base PostgreSQL, esquema `auth`.
Herra administra las cuentas; API, chat y Mesa de Cotejo consultan esas mismas
filas. No sincronizar ni reactivar la SQLite histórica como fuente de cuentas.
Las sesiones son persistentes y las versiones se revocan desde PostgreSQL.
Ver [docs/UNIFIED_AUTH.md](docs/UNIFIED_AUTH.md) para operación y recuperación.
