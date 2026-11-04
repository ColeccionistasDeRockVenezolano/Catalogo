# CRV · Respaldo y restauración de la base de datos

Guía operativa de E11 (PHASES §E11). Un respaldo del CRV son **dos cosas que
solo valen juntas**: la base PostgreSQL completa (core `public` + `ingest` +
`media`) y el crudo `data/raw`. Cada claim apunta a su snapshot en
`ingest.raw_pages.stored_path`; una base sin su crudo conserva los datos pero
pierde la evidencia que los respalda.

| Comando | Script | Qué hace | Toca datos |
|---|---|---|---|
| `npm run db:backup` | `scripts/db-backup.sh [destino]` | Crea `<destino>/crv-<UTC>/` (por defecto `/mnt/datos/backups/crv`) | Solo lee |
| `npm run db:restore-check -- <backup>` | `scripts/db-restore-check.sh` | Restaura en un PostgreSQL desechable y verifica | No toca la base ni `data/raw` |
| `npm run db:restore -- <backup> [opciones]` | `scripts/db-restore.sh` | Restauración real | Crea una base y un `data/raw` **nuevos**; nunca sobrescribe |

Los tres usan `docker exec` contra el contenedor (no hace falta `psql` ni
`pg_dump` en el host).

El respaldo **programado** es otro script: `~/apps/crv-respaldo-catalogo/scripts/catalogo-respaldo.sh`,
con el timer `crv-respaldo-catalogo.timer` (01:30 America/Caracas). Ejecuta
`db-backup.sh` con `CRV_BACKUP_RAW=no`, cifra el resultado con AES-256 y lo
publica en el disco de 1 TB, con retención de 7 diarios y 4 semanales. **No
incluye `data/raw`**: la base se respalda a diario; el crudo se respalda aparte
con `db:backup` cuando se decida. Detalle en §1.1.

## 1. Hacer un respaldo

```bash
npm run db:up           # si crv-postgres no está corriendo
npm run db:backup       # → /mnt/datos/backups/crv/crv-<UTC>/  (disco de datos, por defecto)
npm run db:backup -- /otro/destino/crv   # destino explícito (excepción)
```

Variables opcionales: `CRV_PG_CONTAINER` (por defecto `crv-postgres`),
`CRV_PG_USER` y `CRV_PG_DB` (por defecto `crv`), `CRV_DATA_DIR` (por defecto
`./data`), `CRV_BACKUP_ROOT` (destino por defecto del respaldo; si no se
define, `/mnt/datos/backups/crv`; un argumento explícito manda sobre ella).

**El catálogo debe estar quieto.** El script cuenta las filas exactas de cada
tabla antes y después del `pg_dump`; si difieren (una ingestión, un
`--confirm` o una escritura de la API en curso) borra el respaldo a medias y
termina con error. `pg_dump` ya es consistente por sí mismo, pero sin conteos
estables no habría con qué verificar la restauración.

Cuándo sacarlo, como mínimo:

- antes de `npm run db:migrate` sobre la base real;
- antes de cualquier operación masiva con `--confirm` (`review … --confirm`,
  `ambiguity:apply`, `yt:link --confirm`);
- antes de reinstalar la máquina o mover el volumen de Docker.

### Contenido

| Archivo | Contenido |
|---|---|
| `crv.dump` | `pg_dump --format=custom --compress=zstd:3` de la base completa |
| `crv.dump.toc` | Índice del dump (`pg_restore --list`); prueba de que el archivo se lee |
| `raw.tar.gz` | `data/raw` completo |
| `counts.tsv` | Filas exactas por tabla (`scripts/sql/table-counts.sql`) |
| `manifest.txt` | Formato `crv-backup-1`, commit, hash del core, codificación y locale, versión del servidor, migraciones, totales, estado del crudo, tamaños |
| `SHA256SUMS` | Sumas de `crv.dump`, `raw.tar.gz`, `counts.tsv` y `manifest.txt` |

El manifest registra `raw_missing`: filas de `raw_pages` cuyo archivo ya no
estaba en disco al respaldar. La prueba de restauración exige que ese número no
crezca.

### Espacio en disco

El dump custom se transmite desde `pg_dump` en el contenedor directamente al
archivo del host. No se crea una segunda copia temporal dentro de Docker. Aun
así, el destino necesita espacio para el dump comprimido completo y la prueba
de restauración necesita, mientras corre, espacio en Docker equivalente a la
base restaurada.

`backups/` está en `.gitignore`: los respaldos contienen el catálogo entero y
nunca van a Git.

### Dónde viven los respaldos

En esta máquina los respaldos grandes viven en el **disco de datos**:
`/mnt/datos/backups/crv/` (ext4, 465 GB, montado por `fstab` con `nofail`).
El 2026-09-16 se mudaron allí los 14,7 GB existentes (`crv-20260915T011708Z/`,
`crv-20260915T063612Z/` y el dirigido `crv-20260916-cierre.dump`) para liberar
el disco raíz. **Es el destino por defecto de `db:backup`** (un argumento
explícito o `CRV_BACKUP_ROOT` manda sobre él). El script comprueba que el
disco esté montado antes de escribir (`mountpoint -q /mnt/datos`): si no lo
está, **aborta** en vez de crear un directorio «sombra» en el disco raíz.

Mientras corre se usa `<destino>/.crv-<UTC>.partial`. Solo después de crear y
comprobar el TOC, el crudo, el manifest y las sumas se renombra al directorio
final visible. Si el proceso falla o recibe una interrupción, el trap elimina
esa salida parcial.

### 1.1 Respaldo programado del catálogo (cifrado, sin crudo)

```bash
~/apps/crv-respaldo-catalogo/scripts/catalogo-respaldo.sh crear       # dump → cifra → verifica → publica → retención
~/apps/crv-respaldo-catalogo/scripts/catalogo-respaldo.sh verificar   # restaura el último en PostgreSQL desechable
~/apps/crv-respaldo-catalogo/scripts/catalogo-respaldo.sh estado      # falla si el último tiene más de 36 h
```

- Timer: `crv-respaldo-catalogo.timer` (usuario, 01:30 America/Caracas, `Persistent=true`).
- Destino: `/mnt/1tb/Shared/coleccionistas-rock-venezolano/respaldos-catalogo` (`crv-<UTC>.tar.gpg` + `.sha256` + `.manifest.txt`).
- Cifrado: AES-256 simétrico con la clave `~/.config/crv/respaldo-catalogo.key` (0600).
  **Sin esa clave los respaldos no se pueden abrir.** Debe conservarse una copia
  fuera de esta máquina y fuera del disco de 1 TB.
- Retención: 7 diarios + 4 semanales (~1,5 GB por copia). El script nunca borra
  archivos que no sigan el patrón `crv-YYYYMMDDTHHMMSSZ.tar.gpg`.
- Contenido: la base entera (incluye `auth`, por eso se cifra), **sin `data/raw`**.
  El crudo sigue el camino manual de `db:backup`.
- Aborta si `/mnt/1tb` o `/mnt/datos` no están montados, o si quedan menos de 10 GB.
- **El paso `doctor` de la prueba de restauración no está en verde por deuda de la
  base viva** (12 FK sin índice, `merge_audit.coverage`, géneros desfasados), no
  por el respaldo. Mientras siga así, la prueba de restauración se ejecuta con
  `CRV_RESTORE_DOCTOR=no`; los pasos 1–4 (sumas, encoding/locale, 207 tablas y
  23,5 M filas idénticas, migraciones) son la prueba válida. Cuando el doctor de
  producción esté verde, quitar esa variable.
- Para ejecutar el `doctor` desde el árbol fijado hacen falta dependencias y datos:
  `node_modules` (enlazar al del checkout principal) y `data/research` (enlazar a
  `/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/research`). Sin ellos el
  doctor falla por `tsx` o por el inventario de fuentes, no por la restauración.
- **Prueba real del 2026-11-04** sobre `crv-20261104T140530Z.tar.gpg`:
  `RESTORE VERIFICADO`, 211 tablas y 23.546.634 filas idénticas al manifest,
  `SQL_ASCII` / `C` / `C`, migraciones 0001–0125, `raw_included=no`, sin
  contenedor residual. El `doctor` se omitió por la deuda descrita arriba.

## 2. Probar un respaldo (sin tocar nada)

```bash
npm run db:restore-check -- backups/crv-20260914T234231Z
```

Levanta un PostgreSQL desechable en `127.0.0.1:${CRV_RESTORE_PORT:-55498}` con
la misma imagen que `crv-postgres` (`CRV_RESTORE_IMAGE` para otra), restaura con
`scripts/db-restore.sh` —el mismo camino que una recuperación real— y verifica:

1. las sumas de `SHA256SUMS`;
2. codificación y locale idénticos al origen (`SQL_ASCII` / `C` / `C`);
3. filas exactas por tabla idénticas a `counts.tsv`, y las mismas migraciones
   que el manifest;
4. cada `raw_pages.stored_path` existe en el crudo restaurado y su `sha256`
   coincide con el registrado;
5. `npm run doctor` en verde contra la base restaurada (hash del core, catálogo
   de objetos, migraciones, integridad de claims y auditorías).

Termina con `RESTORE VERIFICADO`. El contenedor y el directorio temporal se
eliminan siempre al salir. La base restaurada ocupa lo mismo que la original
dentro del directorio de datos de Docker mientras dura la prueba.

Un respaldo que no pasó esta prueba no cuenta como respaldo.

## 3. Restaurar

`scripts/db-restore.sh` **nunca borra ni sobrescribe**: se detiene si la base
destino ya existe o si `<data-dir>/raw` existe y no está vacío. Apartar lo
anterior es un paso explícito del operador.

```bash
# 0. Parar todo lo que escriba: API (npm run api), ingestiones, la Mesa.
# 1. Apartar la base actual (no puede tener conexiones abiertas).
docker exec crv-postgres psql -U crv -d postgres \
  -c "ALTER DATABASE crv RENAME TO crv_antes_20260915"
# 2. Apartar el crudo actual.
mv data/raw data/raw.antes-20260915
# 3. Restaurar.
npm run db:restore -- backups/crv-20260914T234231Z
# 4. Verificar.
npm run doctor
```

Opciones de `db:restore`:

| Opción | Uso |
|---|---|
| `--database NOMBRE` | Restaurar con otro nombre (p. ej. `crv_restaurada`) y apuntar `DATABASE_URL` a ella; permite comparar sin apartar la base actual |
| `--data-dir DIR` | Extraer el crudo en otro directorio (queda en `DIR/raw`; `DATA_DIR` debe apuntar a `DIR`) |
| `--container NOMBRE` | Restaurar en otro contenedor PostgreSQL |

La base se crea con la codificación y el locale del manifest. **No restaurar en
una base UTF8:** el core guarda textos en `SQL_ASCII` tal como llegaron de las
fuentes, y una conversión alteraría bytes.

Cuando `doctor` y la aplicación estén bien con la base restaurada, la base y el
crudo apartados se pueden eliminar a mano (`DROP DATABASE crv_antes_20260915`).

### Qué no está en el respaldo

- **Secretos.** `.env` (`YOUTUBE_API_KEY`, `DEEPSEEK_API_KEY`,
  `CRV_OPERATOR_TOKEN`) no se respalda: en una máquina nueva se recrea desde
  `.env.example`. `pg_dump` tampoco copia roles ni contraseñas; el rol dueño lo
  crea el contenedor (`POSTGRES_USER`) antes de restaurar.
- **Artefactos regenerables:** `node_modules`, `dist`, `dist-public`, `web/dist`, `web/dist-public`.
- **Las hojas XLSX de entrada**, que viven en el repositorio.

## 4. Límites conocidos

- No hay respaldo incremental ni recuperación a un instante (PITR): cada
  respaldo es completo. La base se respalda a diario con
  `crv-respaldo-catalogo.timer`; el crudo (`data/raw`) **no** está en esa copia y
  se respalda aparte con `db:backup`.
- La prueba de restauración crea temporalmente una segunda base completa en un
  volumen Docker desechable; hay que reservar espacio equivalente a la base
  original, además del dump.
- El respaldo exige un catálogo quieto; con una ingestión larga en curso hay
  que esperar a que termine.
- `db-restore.sh` restaura de forma secuencial desde la entrada estándar: un
  único `COPY` por tabla. Con la base actual, `ingest.entity_resolution_decisions`
  (469.292 filas y unos 19 GB en disco, con listas de candidatos que en texto
  superan los 150 GB) domina el tiempo: la prueba de E11 tardó más de 1 h 30 min
  solo en esa tabla, con un núcleo de CPU al 100 % y unos 280 MiB de RAM.

## 5. Evidencia E11 (2026-09-15)

### Respaldo real de la base de desarrollo

| Dato | Valor |
|---|---|
| Directorio | `/mnt/datos/backups/crv/crv-20260915T011708Z/` (6,8 GiB) |
| Duración | `pg_dump` 01:17:08Z → 02:01:17Z (44 min); backup completo 02:02:07Z |
| `crv.dump` | 7.287.751.406 bytes, sha256 `6c92bb78c2d1b8c91a655e6b6434a7d47ee0a21d4f609ee84d22bc209c5b259a` |
| `raw.tar.gz` | 13.454.015 bytes; 3.661 archivos; 1.830 `raw_pages`; `raw_missing=0` |
| Filas | 44 tablas, 2.105.173 filas (conteos estables antes/después del dump) |
| Origen | PostgreSQL 16.14, `SQL_ASCII` / `C` / `C`, migraciones 0001–0012, commit `6610723` con árbol modificado |

El primer intento (versión anterior del script) escribía el dump en `/tmp`
dentro del contenedor para copiarlo después con `docker cp`. El sistema lo
mató por falta de memoria en el paso 2/5, con unos 7,4 GB escritos. Por eso el
script actual transmite `pg_dump` directamente al archivo del host y trabaja en
`backups/.crv-<UTC>.partial` hasta completar. El segundo intento terminó sin
incidencias. Una muestra tomada a mitad del dump mostraba 11 GiB de memoria
disponible y el contenedor usaba unos 630 MiB.

### Prueba de restauración

`npm run db:restore-check -- /mnt/datos/backups/crv/crv-20260915T011708Z`,
en un
PostgreSQL 16 desechable (`crv-restore-check-2969285`, 127.0.0.1:55498):

| Verificación | Resultado |
|---|---|
| `SHA256SUMS` | 4/4 OK |
| `pg_restore` | 00:13:33 → 01:55:54 hora local (1 h 42 min), sin error |
| Codificación / locale | `SQL_ASCII` / `C` / `C`, iguales al origen |
| Filas por tabla | 44 tablas y 2.105.173 filas, idénticas a `counts.tsv` |
| Migraciones | 0001–0012, idénticas al manifest |
| Índices y constraints (control adicional) | `public` 35/38, `ingest` 87/204, `media` 25/45; 0 índices inválidos; 0 constraints sin validar; idénticos al origen |
| Crudo | 3.661 archivos; 1.830 `raw_pages` revisadas, 0 sin archivo, 0 con hash distinto |
| `doctor` contra la copia | TODO VERDE: hash del core, catálogo de 178 objetos, migraciones, cobertura de `merge_audit`, 14 fuentes |
| Limpieza | contenedor y directorio temporal eliminados al salir |

El script lo lanzó Codex y su salida estándar quedaba en un terminal que no
se podía leer. Se pausó `db-restore.sh` mientras terminaba `pg_restore`, se
repitieron los pasos 3/5–5/5 con log (más la comparación de índices y
constraints) y se reanudó el script, que terminó y limpió 20 s después. La
evidencia de la tabla sale de ese log: `RESTORE VERIFICADO (réplica)` a las
01:56:11.

Ver también `docs/FINAL_AUDIT.md` (Known Issues) y `docs/OPERATIONS.md`.
