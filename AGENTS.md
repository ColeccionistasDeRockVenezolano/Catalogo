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
Brian autorizó expresamente los cambios de almacenamiento, incluido el
traslado de **los informes versionados** y su reflejo en Git. Las bajas de `reports/*` en
Git son consecuencia del traslado; no restaurar esos archivos encima del
enlace ni interpretar las bajas como pérdida de las capturas.
No mover PostgreSQL, secretos ni dependencias a este almacén.

# Puerta temporal del dominio (Fase 2B)

Decisión de Brian (2026-11-02): mientras el catálogo no se publique, el dominio
sirve desde CRV el recorrido del equipo de Herra (`/`, `/colaborar`, `/login`,
`/registro`, `/activar`, `/account`, `/admin`) y **ninguna ruta lleva al
catálogo**. Es temporal: al publicar el catálogo se retira con los pasos de
[docs/independencia/PUERTA-TEMPORAL.md](docs/independencia/PUERTA-TEMPORAL.md).
El código lleva la marca `TEMPORAL-PORTADA`. Ruta nueva en la portada = añadirla
a ese documento y a `scripts/checks/fase2b-whitelist.mjs`.

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
documentados; las ambigüedades van a revisión. Desde el 2026-11-01 la pestaña
muestra también los videos que no se pueden reproducir, como tarjeta «no
disponible» (ver la sección siguiente). Ver `docs/AUDIOVISUALS.md`.

# Videos de YouTube en el sitio: manda la base

Regla de Brian (2026-10-31), para **todo** video de YouTube (fichas de disco,
CD/lado, artista, Audiovisuales, portada; CRV u otro canal): las páginas
**nunca consultan a YouTube al cargar**. Leen el registro de
`media.youtube_videos` (estado + respuesta de la API en `metadata`) con la
regla única de `src/youtube/playable-crv.ts` (`playableVideoSql`).
**Se muestra todo video registrado, sea cual sea su estado** (Brian,
2026-11-01): no listado, privado, borrado, rechazado/copyright, con restricción
de edad, estreno o veto regional. Las páginas usan `shownVideoSql` /
`shownVideoIds`; si YouTube no deja verlo, el reproductor lo dice. Un ID sin
fila en la base no se muestra. Audiovisuales marca `playable` con la regla
estricta (no listado cuenta como reproducible) y pinta la tarjeta como no
disponible en vez de abrir el reproductor.
La regla estricta `playableVideoSql` (público, procesado, incrustable) solo la
usa el verificador diario (`ops/youtube-canal/canal.ts availability`, timer
`crv-youtube-availability`) para elegir otro principal cuando uno cae y para
abrir un aviso `manual_review` (`payload.via = youtube-disponibilidad`,
«no se puede reproducir en el sitio») por video vinculado; lo cierra si vuelve
y no reabre los descartados. Ese mismo verificador diario (04:30
`America/Caracas`) compara la descripción recibida con la guardada y rehidrata
los videos del canal que cambiaron, en un run `youtube-descripciones`: las
marcas corregidas en YouTube Studio llegan así al catálogo (que lee la base) y,
tras la exportación que el paso dispara, a la radio (decisión de Brian,
2026-11-06). Si una corrección humana registrada deja de coincidir con una
descripción que cambió y esta trae otro tiempo válido para el mismo capítulo,
el claim se retira solo (`superseded`) y queda un aviso
`youtube-descripcion-cambio` en revisión: manda la edición más reciente.

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

# Géneros de un disco sin fuente: herencia del artista

Regla de Brian (2026-10-31). Orden para dar género a un disco:
1. Fuentes (cualquier web que nombre el género de ESE disco basta).
2. La IA del catálogo, con evidencia citada.
3. **Si la IA no encuentra el género del disco, lo hereda de su artista**:
   el principal confirmado del artista pasa a principal del disco y sus
   secundarios confirmados, a secundarios.
4. **Disco con más de un artista distinto** (colaboración, split, recopilatorio,
   VA…): la IA **promedia los géneros de esos artistas**. Cada artista pesa lo
   mismo: su principal vale 2 y cada secundario 1, divididos entre la suma de
   su ficha; se suman los aportes de todos y se divide entre el número de
   artistas con géneros. El de mayor promedio es el principal; los siguientes
   (hasta 3) con al menos la mitad del promedio del principal son secundarios.
   Empate: el que aparece en más artistas y luego el más específico.
   En un recopilatorio cuentan los artistas de sus pistas; «Various Artists»
   no es un artista. Los artistas sin géneros confirmados no cuentan; si
   ninguno los tiene, el disco va a revisión.

La herencia se registra en un run propio, con el motivo «heredado del
artista» o «promedio de N artistas» y los artistas usados, y es reversible.
Una fuente posterior que nombre el género del disco la sustituye. Las pistas
siguen heredando del disco, nunca directamente del artista. Primer caso:
«Sonó Así» de 1ra Edición (disco 2330, run 36487).

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
CRV administra las cuentas desde su panel (`/curaduria/roadmap`); la instancia
Herra de CRV está retirada desde el 2026-11-04 y su motor no se reinicia. API,
chat y Mesa de Cotejo consultan esas mismas filas. No sincronizar ni reactivar la
SQLite histórica como fuente de cuentas.
Las sesiones son persistentes y las versiones se revocan desde PostgreSQL.
Ver [docs/UNIFIED_AUTH.md](docs/UNIFIED_AUTH.md) para operación y recuperación.
