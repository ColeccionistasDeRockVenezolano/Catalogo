# Cuentas de CRV y Herra en PostgreSQL

## Diseño

`DATABASE_URL` identifica la misma base PostgreSQL para catálogo, ingesta,
multimedia, chat y cuentas. El esquema `auth` contiene las tablas de Herra
(proyecto, personas, usuarios, administradores y permisos), las cuentas que
antes estaban en `CRV_COLLABORATORS_JSON`, y las sesiones.

Herra administra las cuentas compartidas. CRV y la Mesa consultan esas mismas
filas: no se sincronizan bases ni se mantienen copias activas en SQLite.
`auth.local_accounts` conserva las credenciales locales de CRV por separado
para respetar su prioridad y su codificación scrypt anterior. Se administran
con `npm run auth:set-collaborator`; en modo PostgreSQL el comando actualiza
la base y revoca las sesiones anteriores sin reiniciar el servidor.

Los identificadores, hashes scrypt, versiones de sesión, perfiles, permisos,
binarios y relaciones se conservan al importar. No se fusionan nombres que
coincidan. Usuarios aprobados leen; administradores del proyecto administran;
las cuentas de otros proyectos no obtienen acceso. Una cuenta local conserva
la prioridad que tenía sobre un homónimo de Herra. Las decisiones de la Mesa
conservan la procedencia: `herra:<usuario>` o `crv:<usuario>` para cuentas locales.

`auth.sessions` guarda las sesiones de CRV y la Mesa con audiencias distintas.
`auth.herra_sessions` guarda las de Herra y sus preautenticaciones MFA.
Se persisten hashes SHA-256 de los tokens, nunca el token de acceso completo.
Las cookies conservan HttpOnly, SameSite y sus controles CSRF y de origen.
Las cuentas se revalidan en cada petición; los cambios de credencial, estado,
rol o alcance incrementan versiones desde PostgreSQL. Borrar al usuario
elimina la credencial administrativa nacida de su promoción.

Herra usa el rol `crv_herra`, limitado a `auth`: no tiene permisos sobre el
catálogo ni privilegios de superusuario, creación de bases o creación de roles.
Su conexión vive en `secrets/instance.env`, con permisos 0600.

## Migración

1. Ejecutar `python3 scripts/shared-storage.py status` y respaldar configuración,
   cron, PostgreSQL y una instantánea SQLite consistente. Los secretos y las
   bases permanecen fuera del almacén compartido de capturas.
2. Ensayar con una copia privada en una base PostgreSQL desechable. La migración
   `0112_unified_auth` crea únicamente el esquema auxiliar y su extensión citext.
3. Detener el escritor de Herra, obtener la instantánea final y ejecutar:

   ```sh
   npm run db:migrate
   npm run auth:import-herra -- /ruta/privada/herra-final.db
   npm run auth:provision-herra -- /ruta/privada/conexion-nueva.env
   ```

   El importador abre SQLite en lectura, valida integridad y referencias,
   compara el contenido completo de cada tabla y sus binarios, conserva los
   contadores de identificadores y valida las claves foráneas antes del commit.
   Registra recuentos y huellas en `auth.import_receipts`. Rechaza esquemas
   inesperados y destinos ocupados; repetir la misma importación no sobrescribe
   las modificaciones posteriores.
4. Configurar `CRV_AUTH_BACKEND=postgres`, retirar del entorno las cuentas
   migradas y la ruta SQLite. Instalar la conexión privada de Herra y definir
   `HERRA_PG_TOOLS_CONTAINER=crv-postgres` para las herramientas de respaldo.
5. Actualizar el motor fijado y el bloque cron de **herra-crv**, reiniciar Herra,
   API, chat y Mesa, y verificar autenticación, permisos, radio y salud.
   Las sesiones anteriores al cambio requieren un nuevo inicio de sesión;
   las sesiones PostgreSQL sobreviven a reinicios posteriores.

El motor adaptado vive en `/home/brian/apps/herra-postgres`, una copia de trabajo
aislada basada en el commit `25c48be` de Herra 1.1.8 que ejecutaba CRV.
Su versión local es 1.1.11. No modifica la instancia central de Herra ni su motor.
Los servicios síncronos mantienen su interfaz: una conexión PostgreSQL en un
worker ejecuta las consultas parametrizadas y las transacciones, incluidos
savepoints. Las operaciones tienen tiempos máximos y no se reintentan
automáticamente tras una respuesta ambigua.

## Respaldo y recuperación

`npm run db:backup` incluye la base completa. El inventario de filas incluye
`public`, `ingest`, `media`, `chat` y `auth`; los nuevos respaldos son privados.
El job de Herra produce `herra-crv-<fecha>.pgdump.gpg`: incluye todo `auth` y
citext, cifra el archivo y compara el descifrado con el original. Mantiene el
espejo cifrado y su retención sin eliminar los respaldos SQLite históricos.

La restauración de Herra requiere detener su servidor y aportar una conexión
administradora a **la misma base** mediante `HERRA_RESTORE_DATABASE_URL`.
La cuenta limitada de la aplicación no puede restaurar.

```sh
npm --prefix /home/brian/apps/herra-postgres run db:restore -- --instance-home /ruta/instancia \
  --file /ruta/respaldo.pgdump.gpg --dry-run
```

El ensayo descifra en un directorio privado, restaura en una base temporal,
comprueba el dueño, el recibo y las restricciones, y elimina la base temporal.
Sin `--dry-run`, además cifra el estado anterior y restaura `auth` en una
transacción, conservando los permisos de la aplicación. El catálogo no forma
parte de este respaldo parcial. Para una recuperación completa usar el dump
completo de CRV y su procedimiento documentado. La restauración completa crea
`crv_herra` sin login en un host nuevo para recuperar sus ACL sin copiar
contraseñas. Después, `auth:provision-herra -- <archivo-privado-nuevo> --rotate`
genera una conexión nueva; instalarla en los secretos de Herra antes de arrancar.

`CRV_AUTH_BACKEND=legacy` se conserva para volver al software anterior durante
el corte, **antes de aceptar nuevas escrituras**. Una SQLite histórica no
contiene los cambios posteriores de PostgreSQL: nunca activarla como si
estuviera sincronizada. Después del corte, recuperar desde los respaldos de
PostgreSQL.

Las utilidades antiguas de portabilidad por archivos SQLite se bloquean cuando
la instancia usa PostgreSQL, para impedir operaciones sobre una copia histórica.
Los respaldos y la restauración de PostgreSQL son la vía de recuperación.

## Verificación

- CRV: `npm test -- --dir test/unit auth.test.ts auth-herra.test.ts`.
- Integración: `npm test -- --dir test/contract unified-auth.test.ts genres-curation.test.ts chat-safety.test.ts`.
- Herra: su batería habitual y `dist/db/postgres*.test.js` contra una instancia
  de ensayo aislada. La prueba HTTP inicia otro proceso, entra por el formulario,
  reinicia el servidor y comprueba logout y cambio de contraseña.
- Restauración real del respaldo cifrado en una base de ensayo, validación de
  permisos del rol y `instance:verify --http`.

Los informes sin credenciales se publican al cerrar la campaña en
`reports/auth-unification-2026-10-29`. Los respaldos privados y configuraciones
anteriores se conservan en `/home/brian/crv-backups/auth-unification-20261029`;
el dump completo anterior está en
`/mnt/datos/backups/crv/auth-unification-20261029/crv-before-auth.dump`.
