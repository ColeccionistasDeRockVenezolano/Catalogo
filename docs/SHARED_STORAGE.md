# Almacén de datos scrapeados en el disco de 1 TB

Decisión de Brian del 2026-10-20: trasladar todos los datos scrapeados al
disco de 1 TB, incluidos los resultados versionados. Confirmación expresa:
«quiero que muevas esos 24GB no importa git».

Traslado completado el **2026-10-21 a las 02:01:24 UTC** (2026-10-20 en
Caracas): 377.290 archivos, 23.866.481.707 bytes, con inventario y SHA-256
comparados antes de retirar los originales. Las cinco rutas se comprobaron
en lectura y escritura; API, proxy, web pública e imágenes respondieron
correctamente y Vite sirvió la imagen original a través del enlace.
El SSD quedó con aproximadamente **29 GiB disponibles** (antes unos 6,7 GiB).

## Ubicación y alcance

**Raíz física: `/mnt/1tb/Shared/coleccionistas-rock-venezolano`.**
Se utiliza la carpeta `Shared` existente; no crear otra llamada `shared`.
La carpeta `Shared/crv-ic` y sus aproximadamente 247 GiB de archivos previos
son otro almacén y no se reorganizan con este traslado.

| Ruta usada desde el proyecto | Ubicación física bajo la raíz del almacén | Contenido |
| --- | --- | --- |
| `data/raw` | `data/raw` | HTML, JSON, imágenes, índices y estados de scrapers |
| `data/research` | `data/research` | Originales documentales, recibos de captura y caché OCR |
| `reports` | `reports` | Todos los informes, evidencias y resultados, incluidos los antes versionados |
| `web/public/media` | `web/public/media` | Imágenes originales descargadas y sus manifiestos |
| `tmp-analysis` | `tmp-analysis` | Resultados temporales de investigación y cotejo |

Las cinco rutas del proyecto son enlaces simbólicos absolutos. Mantener
`DATA_DIR=./data` en `.env`; las referencias relativas de la base, incluidas
`ingest.raw_pages.stored_path`, no cambian. Los scripts con rutas absolutas
al antiguo `data/raw` también llegan al mismo contenido mediante el enlace.
Las nuevas campañas **no** se escriben directamente en el HDD: se capturan en el staging del
SSD y se publican al cerrar (ver «Capturas nuevas: staging en SSD»).

El inventario del origen contiene **377.290 archivos y 23.866.481.707 bytes**
(23,87 GB decimales; 22,23 GiB). El recibo final registra los totales
comparados con la copia.
El volumen PostgreSQL, `data/genres`, código, `.env`, dependencias, logs de
ejecución y builds del frontend conservan sus ubicaciones. Las copias de
imágenes incluidas en `web/dist*` y las variantes regenerables del frontend
son salidas de build/caché y se mantienen separadas de los originales.

## Capturas nuevas: staging en SSD y publicación en el HDD (2026-10-20)

Decisión de Brian: **los archivos nuevos se bajan primero al SSD y después se mueven a su
carpeta del almacén**. Motivo medido: el almacén es NTFS (`ntfs3`) y una captura típica son
miles de archivos pequeños; escribirlos directos al HDD multiplica el tiempo. El SSD absorbe la
captura y el HDD solo recibe una copia secuencial al cerrar la campaña.

- **Raíz del staging: `$HOME/crv-staging`** (SSD, fuera del repositorio y de Git).
  Se puede cambiar con `CRV_STAGING`. Espeja las cinco rutas del proyecto:
  `$HOME/crv-staging/data/raw/<campaña>`, `.../data/research/<campaña>`,
  `.../reports/<campaña>`, `.../web/public/media/<campaña>`, `.../tmp-analysis/<campaña>`.
- **Las rutas del proyecto siguen siendo enlaces al HDD y se usan para LEER** y para el
  pipeline (API, web, `ingest.raw_pages`). Una captura nueva **no** se escribe en
  `data/raw/...` ni en `reports/...`: se escribe en el staging y se publica.
- Herramienta: `scripts/staging.py`.

```bash
python3 scripts/staging.py status                      # espacio en SSD, campañas abiertas, montaje
python3 scripts/staging.py new data/raw mi-campana     # crea $HOME/crv-staging/data/raw/mi-campana
#   ... capturar ahí (p. ej. OUT=$HOME/crv-staging/data/raw/mi-campana) ...
python3 scripts/staging.py list
python3 scripts/staging.py publish data/raw mi-campana --dry-run
python3 scripts/staging.py publish data/raw mi-campana            # copia + verifica + borra staging
python3 scripts/staging.py publish data/raw mi-campana --hash     # además SHA-256 de cada archivo
python3 scripts/staging.py publish data/raw mi-campana --keep     # no borra el staging
```

- `publish` copia a `/mnt/1tb/Shared/coleccionistas-rock-venezolano/<ruta>/<campaña>`,
  comprueba **número de archivos y bytes** (y hashes con `--hash`) y **solo entonces** borra el
  staging. Si la verificación no cuadra, aborta y deja el staging intacto. Nunca escribe encima
  de una campaña ya publicada.
- Umbral de seguridad: con menos de **2 GB libres** en el SSD (`CRV_STAGING_MIN_FREE_GB`),
  `status` avisa y `new` se niega a empezar. Publicar y limpiar antes de seguir.
- Presupuesto de espacio: una campaña se captura y se publica al cerrar; no se acumulan varias
  abiertas. Los borrados de staging los hace `publish` tras verificar, no a mano.

## Comprobación antes de trabajar

Desde la raíz del repositorio:

```bash
python3 scripts/shared-storage.py status
readlink -f data/raw
readlink -f reports
df -h /mnt/1tb
```

El comprobador exige el volumen montado en `/mnt/1tb`, UUID
`9036B43536B41E62`, los cinco enlaces correctos y el recibo de migración
completa. Un error exige resolver el montaje o los enlaces antes de escribir.
No usar `mkdir -p` para reemplazar un enlace roto: podría llenar de nuevo el
SSD o crear una carpeta en el punto de montaje sin el HDD.

Para crear una campaña, basta con comprobar el estado y usar su ruta habitual:

```bash
python3 scripts/shared-storage.py status
mkdir -p reports/nombre-de-la-campana
```

Este diseño es local a esta máquina. En otro checkout/equipo hay que disponer
del mismo almacén y configurar sus enlaces de manera deliberada; clonar Git
no descarga estas capturas. No versionar los enlaces absolutos de esta máquina.

## Conflictos evaluados y resolución

1. **Git:** `reports` contenía más de 20.000 archivos versionados. Un enlace
   de directorio no mantiene el seguimiento de sus descendientes en Git.
   Brian autorizó moverlos igualmente: Git puede mostrar sus bajas y no debe
   usarse para reconstruirlos sobre el enlace. Se conserva el contenido
   actual, incluidas modificaciones sin commit, mediante copia y hashes.
   No se reescribe el historial ni se crea un commit de bajas automáticamente.
2. **Rutas:** cambiar solamente `DATA_DIR` dejaría scripts y servicios con
   rutas antiguas. Los enlaces conservan las rutas de lectura/escritura sin
   modificar las referencias en PostgreSQL.
3. **Respaldos:** `find raw -type f` no sigue un enlace recibido como raíz.
   `scripts/db-backup.sh` ahora usa `find -H raw -type f`, que sigue ese
   argumento pero no enlaces internos. La lista contiene rutas `raw/...` y
   `tar` guarda los archivos reales; la restauración también usa `find -H`
   al contarlos.
4. **NTFS y permisos:** `/dev/sdc3` es NTFS montado mediante `ntfs3`, con
   permisos uniformes. La copia conserva bytes y fechas, no propietarios,
   ACL ni permisos POSIX individuales. No alojar aquí bases de datos activas,
   ejecutables o dependencias que necesiten esos permisos.
5. **Mayúsculas:** se encontraron dos capturas cuyos nombres difieren solo
   en `Catia20la20Mar` / `Catia20La20Mar`. Una prueba real confirmó que este
   montaje conserva ambos como archivos distintos. Preservar esos nombres;
   una copia mediante herramientas de Windows que ignoren mayúsculas podría
   colisionarlos.
6. **Escritores activos:** antes de sustituir las carpetas, se verifica que
   los archivos no hayan cambiado tras su comprobación y que no haya
   descriptores de escritura abiertos ni procesos trabajando dentro de ellas.
   API y web se pausan brevemente durante la sustitución y se reanudan al salir.
7. **Disponibilidad y rendimiento:** la lectura ahora depende del HDD. El
   montaje ya está declarado en `/etc/fstab` con automontaje. Si no está
   disponible, no iniciar capturas; un enlace roto no equivale a datos vacíos.
   El HDD puede ser más lento para muchos archivos pequeños. PostgreSQL
   permanece en su ubicación y no se cambia su configuración.
8. **Sincronización:** `Shared` no implica una subida. En la configuración
   de Syncthing inspeccionada, sus carpetas son `~/Sync` y Obsidian, no esta
   carpeta del disco. No se publica ni se comparte el almacén por esta tarea.
9. **Utilidades archivadas:** algunas herramientas antiguas guardadas dentro
   de `tmp-analysis` o de informes calculan la raíz mediante `__file__.resolve()`
   o `import.meta.url`. Esas expresiones ahora señalan el almacén físico y
   sus imports relativos a `src`/`scripts` pueden fallar. Conservarlas como
   evidencia; para reutilizarlas, llevar una copia de código a `scripts/` y
   ajustar su raíz/imports antes de ejecutarla. Las herramientas operativas
   de `scripts/` y `ops/` conservan su ubicación. No ejecutar aplicadores
   históricos solo para probar el traslado.
10. **Límites de los lectores:** `knowledge-sync`, `genre-source-captures` y
    `resource-field-review` comparaban rutas físicas contra el repositorio y
    rechazarían las carpetas trasladadas. Se adaptaron para resolver las
    cinco raíces documentadas en la tabla, manteniendo
    el rechazo de travesías y enlaces internos que escapen de su raíz física.
    La revisión documental pasa de `0.12.0` a `0.12.1` para conservar las
    huellas del lector y sus pruebas; no cambia disposiciones ni cobertura
    musical. Los cortes anteriores permanecen intactos.
    La API se reinicia después de activar el almacén para cargar estos lectores.

## Evidencia de la migración

Los registros están fuera del repositorio, en la raíz física del almacén:

- `migration-plan.json`: origen, destino, cinco rutas y autorización.
- `copy.log`: resultado de `rsync`.
- `source-files.jsonl` y `source-hashing.log`: hashes SHA-256 del origen antes
  de compararlos con la copia.
- `verified-files.jsonl`: SHA-256 de cada archivo y metadatos usados para
  detectar cambios entre verificación y activación.
- `verification.log`: progreso de comprobación de contenido.
- `migration-state.json`: rutas activadas y originales retirados.
- `migration-complete.json`: recibo final con cantidad de archivos, bytes y fecha.
- `activation.log`: sustitución de carpetas y reanudación de servicios.
- `validation-before.json` / `validation-after.json`: muestras HTTP y hashes
  de imágenes antes y después, cinco pruebas de escritura mediante los enlaces,
  salud de servicios e inventario real de respaldo de 192.995 archivos crudos.
- `validation-vite.json`: lectura HTTP del medio original desde Vite con el
  directorio externo enlazado.
- `inventory-difference.json` y `quarantine.json`: comprobación que detectó
  un temporal huérfano de la primera copia interrumpida. El origen conservaba
  sus 192.995 archivos de `data/raw`; el destino tenía ese temporal adicional
  de 90.112 bytes. Se aisló en `migration-quarantine/`, fuera de las cinco
  carpetas de datos, antes de repetir la verificación.

Primero se copian los archivos sin retirar el origen. Después se comparan
inventarios y SHA-256 de origen y destino. La activación vuelve a comprobar
los metadatos de todos los archivos, cambia cada carpeta por su enlace y
solo entonces retira la copia original del SSD. Los hashes son una evidencia
del instante del traslado: los estados y resultados pueden cambiar después
con el uso normal.

El comprobador de estado verifica montaje y enlaces; no vuelve a calcular
todos los hashes en cada ejecución ni garantiza que los datos sigan siendo
idénticos a aquella instantánea después de nuevas capturas.

La revisión documental operativa `0.12.1` quedó archivada en
`reports/unified-search-stage2/resource-cuts/0.12.1`, con 40 referencias
preservadas. Conserva los 44 recursos y 99 campos de la revisión anterior;
no representa otra aprobación editorial ni una ampliación de cobertura musical.

La adaptación de lectores pasó 37 pruebas unitarias en `project-files`,
`search-knowledge-sync`, `search-genre-source-captures` y
`search-resource-field-review`, además de TypeScript y ESLint de los archivos
modificados. Incluyen raíces externas permitidas, bloqueo de enlaces internos
que escapan del almacén y rechazo de travesías. Una prueba de respaldo/restauración
con `find -H` y `tar` confirmó que se conservan los archivos del enlace raíz,
incluidos los vacíos, sin recorrer enlaces internos.
`scripts/stage1-preserve-files.py application` incluye ahora `.gitignore`,
`AGENTS.md`, `CLAUDE.md` y `SYNAPSE.md`: un ensayo temporal restauró 2.336
archivos y comprobó que esas instrucciones y el comprobador del almacén
estaban presentes. El ensayo no sustituye al respaldo independiente.

## Instrucciones para los cuatro agentes

| Agente | Entrada de instrucciones del proyecto |
| --- | --- |
| Codex | `AGENTS.md`, con enlace a este documento |
| Hermes | `AGENTS.md`, que su instalación reconoce como contexto del proyecto |
| Synapse | `SYNAPSE.md` y `AGENTS.md`; su cargador local reconoce ambos |
| Claude Code | `CLAUDE.md`, que importa `AGENTS.md` y este documento |

Las sesiones ya abiertas deben releer estos archivos antes de continuar con
capturas. La documentación no implica que una sesión antigua se haya recargado
automáticamente ni envía mensajes a otros agentes.

## Escrituras nuevas: SSD primero, después al HDD

Regla de Brian del 2026-10-20: **toda captura nueva se escribe primero en el
SSD y se mueve después a su carpeta definitiva del disco de 1 TB.** El HDD es
correcto para conservar (barato, grande) pero caro para escribir muchos
archivos pequeños: cada página de reviews son dos archivos (HTML + JSON) y una
campaña de 5.500 páginas son ~11.000 escrituras. Escribir directo sobre el HDD
metía esa latencia en el bucle de captura.

Implementación operativa (campaña de reviews, `scripts/rym-reviews-bajar.py`):

- Etapa en SSD: `~/.cache/crv-rym-stage/<campaña>/pages` (se puede cambiar con
  `--ssd` o `CRV_RYM_SSD`). Escritura atómica (`tmp` + `os.replace`).
- Destino final: la carpeta de siempre, p. ej.
  `data/raw/rym-reviews-2026-10-20/pages` (enlace → HDD).
- Un hilo movedor propio hace `shutil.move` de cada par HTML+JSON en cuanto
  están completos, así que la captura nunca espera al HDD.
- Al arrancar, el capturador **drena** lo que quedara en el SSD de una corrida
  anterior: no se deja ninguna captura huérfana fuera de su carpeta definitiva.
- Los archivos pequeños de control (`estado-bajar.json`, `tareas.jsonl`,
  `resumen.json`) y los logs se escriben directo en la campaña del HDD.

Comprobación rápida tras una corrida:

```bash
ls ~/.cache/crv-rym-stage/<campaña>/pages | wc -l   # debe tender a 0
ls data/raw/<campaña>/pages | wc -l                  # aquí están todas
```

El SSD no es un almacén: si falta espacio, se limpia la etapa, nunca la carpeta
definitiva. Un `--force` del navegador (`ops/rym-resto/chrome.sh --force`) no
toca ni la etapa ni el destino.

## Respaldo y recuperación

Un traslado no sustituye al respaldo independiente. `npm run db:backup`
sigue guardando PostgreSQL y `data/raw` en `/mnt/datos/backups/crv`; el ajuste
de `find -H` conserva ese comportamiento cuando `raw` es un enlace.
Ese comando no cubre todo el almacén: respaldar también `data/research`
(originales y recibos), `reports`, `web/public/media` y los resultados de
`tmp-analysis` que se necesiten conservar. No tratar `research` como caché
descartable. Ver [DATABASE_BACKUP_RESTORE.md](DATABASE_BACKUP_RESTORE.md).

Un agente con restricciones de escritura debe tener autorizado también el
destino físico externo al repositorio. Un permiso insuficiente se resuelve
en su entorno de ejecución, sin crear copias alternativas en el SSD.

Para revertir la ubicación se necesita espacio en el SSD, detener los
escritores, copiar cada carpeta física a un directorio temporal local y
verificar su contenido antes de sustituir el enlace. Conservar el HDD hasta
terminar la comprobación. No borrar el destino de un enlace ni ejecutar una
restauración de Git sobre `reports` para revertir el traslado.
