# Revisión posterior a la migración — 2026-10-30

Superficie revisada: https://coleccionistasderockvenezolano.com/ y motor local
Herra PostgreSQL 1.1.15. Revisión posterior a la reparación del contador y la
marca. No se modificaron cuentas, datos del catálogo ni servicios en producción.

## Hallazgos

1. **Alta: poco espacio en el disco del sistema.** `df -h /` muestra 94 % de
   ocupación: 189 GiB usados y unos 14 GiB disponibles. La tarea de alertas de
   la instancia confirma `fail disk:data` (6.2 % libre). Todavía no es un fallo
   de escritura, pero el agotamiento puede impedir respaldos y otras escrituras.
   No hay evidencia de que la migración sea la causa de esta ocupación. No se
   borraron archivos ni se trasladaron PostgreSQL, secretos o dependencias.

2. **Media: instrucciones de recuperación obsoletas.**
   `/home/brian/apps/herra-instances/herra-crv/service/README.md` conserva el
   motor 1.1.6 y ejemplos de importar/restaurar archivos SQLite. `compose.yml`
   todavía selecciona `herra:1.1.6`. Producción corre mediante PM2 con 1.1.15 y
   PostgreSQL/auth. Seguir esos ejemplos podría intentar arrancar un motor
   incompatible o usar la base histórica. No se observó su ejecución: PM2 y
   cron actuales apuntan correctamente a 1.1.15. Para recuperar debe seguirse
   `docs/UNIFIED_AUTH.md`, conservando PostgreSQL como autoridad. Ese documento
   también conserva una referencia descriptiva antigua a 1.1.11.

3. **Media: las comprobaciones de publicación no prueban PostgreSQL.**
   En `/home/brian/apps/herra-postgres/package.json`, `npm test` enumera pruebas
   que no incluyen `postgres*.test.js`. El workflow CI ejecuta `check`,
   `security:smoke` y ciclos de portabilidad; `bin/release.mjs` tampoco ejecuta
   el ensayo PostgreSQL. `test:postgres` existe como paso separado y exige una
   instancia aislada. Por tanto, las 86 pruebas y 81 comprobaciones de la
   reparación anterior no constituyen validación integral de PostgreSQL. El
   contador sí fue comprobado adicionalmente con transacción y rollback sobre
   PostgreSQL, además de la respuesta pública. Falta incorporar el ensayo
   aislado como requisito de publicación para evitar futuras regresiones SQL.

4. **Baja: la imagen de marca carece de versión en la URL.**
   `src/views/partials/project-mark.ejs` usa `/static/crv-logo.jpg` sin sufijo de
   versión; el servidor responde `Cache-Control: public, max-age=31536000,
   immutable`. Un navegador que ya tenga esa imagen puede conservarla hasta
   un año cuando cambie el archivo. Es un riesgo reproducible por configuración,
   no una discrepancia visual observada en esta sesión. CSS y favicon sí llevan
   versión. Conviene versionar también la URL del logo.

## Comprobaciones satisfactorias y límites

- Portada, login, colaboración, registro, robots, sitemap, API del mapa de
  trabajo y API de radio: HTTP 200.
- `/account` sin sesión redirige al login; `/cuenta` no es una ruta definida.
- Las anclas de navegación apuntan a elementos existentes. No hay imágenes
  rotas tras completar su carga; las banderas usan carga diferida.
- Cambio EN → ES correcto; formulario de colaboración incluye token CSRF y
  no presenta desbordamiento horizontal en la ventana usada.
- Radio: catálogo de 5493 entradas, respuesta de programación válida y
  reproductor YouTube reproduciendo en el navegador; activación del modo cine
  cambia correctamente el estado y `aria-pressed`.
- PM2 de `herra-crv`: online, cero reinicios desde la reparación. No aparecen
  errores nuevos de PostgreSQL en el registro desde su arranque de las 13:11 UTC.
- No se enviaron candidaturas ni se crearon usuarios de prueba en producción.
  No se verificó un login válido ni una recuperación de contraseña con cuentas
  reales durante esta revisión. No se auditó el catálogo privado completo.

Los fallos antiguos de dependencias y de versiones del motor presentes en los
logs no se clasifican como fallos actuales: las tareas recientes sí se ejecutan
y el único fallo que informa el monitor actual es el espacio libre.
