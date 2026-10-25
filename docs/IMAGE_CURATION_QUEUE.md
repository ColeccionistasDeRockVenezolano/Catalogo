# Cola persistente de portadas y fotos

`/crv/curaduria/imagenes` envía decisiones y mediciones a PostgreSQL mediante
`POST /curation/images/jobs`. Una respuesta **202** confirma que la solicitud ya
está guardada. El trabajador de `crv-api` sigue procesándola aunque se cierre la
pestaña, se cierre sesión o se apague el navegador. Al volver a entrar, la
actividad se recupera de `GET /curation/images/jobs`.

Mientras aparece **Enviando al servidor**, la solicitud aún no está confirmada;
se protege la salida de la página. Al aparecer **En cola en el servidor** o
**Procesando en el servidor**, se puede cerrar la pestaña. Un error de conexión
al recibir la confirmación se puede reintentar con el mismo UUID, sin crear una
segunda tarea. La consulta de actividad también recupera las solicitudes que
el servidor aceptó aunque su respuesta se perdiera.

## Ejecución y recuperación

La migración `0100_image_curation_jobs` añade `ingest.image_curation_jobs`.
Guarda la solicitud, el operador autenticado, la ficha, el estado, el número de
intentos, los errores, la copia preparada y el run del resultado. La API exige
administración y CSRF, también para reintentar o retirar un error de la vista.
La identidad de la ficha se lee en el servidor; el cliente no suministra el
nombre ni el operador.

- Se ejecutan hasta **tres tareas globales**, incluso con varios procesos de
  API. Las decisiones tienen prioridad sobre las mediciones en espera.
- Las tareas de una misma ficha se ejecutan por turno. Una restricción impide
  dos decisiones activas o dos mediciones activas de la misma ficha.
- Cada tarea obtiene un permiso de 120 segundos, renovado cada 30 segundos.
  Tras una caída de la API o del servidor, otro trabajador puede recuperar las
  tareas cuyo permiso haya vencido. La recuperación puede tardar hasta dos
  minutos desde la última renovación.
- El cambio del catálogo, su auditoría y el estado `done` de la tarea se
  confirman en **una misma transacción**. Un trabajador que haya perdido su
  permiso no puede confirmar: se revierte su intento completo. Así, recuperar
  una tarea no vuelve a aplicar una decisión que ya terminó.
- Las candidatas y la imagen actual se validan de nuevo al aplicar. Un
  conflicto exige revisar la ficha; un fallo recuperable conserva Reintentar.
  Una medición que esperó detrás de una decisión omite candidatas ya cerradas.

Los originales elegidos se escriben primero en una campaña SSD
`~/crv-staging/web/public/media/curated-image-<uuid>` y se publican mediante
`scripts/staging.py ... --hash`. Se comprueban antes el montaje y los enlaces.
La copia verificada queda registrada en la tarea antes de aplicar el cambio;
un reintento la reutiliza incluso si la fuente deja de responder. Los archivos
permanecen como evidencia al deshacer.

La API conserva los endpoints síncronos anteriores para automatizaciones
existentes. La interfaz utiliza exclusivamente los nuevos trabajos para las
decisiones y las mediciones. «Dejar las actuales» crea una tarea y un run por
ficha, por lo que cada decisión se puede reintentar y deshacer por separado.

## Actividad y operación

La página consulta cada segundo mientras hay tareas activas y cada quince
segundos cuando la cola está en reposo; también al recuperar el foco. El
trabajador no depende de esas consultas. La actividad presenta todas las
pendientes y los errores sin retirar, además de las últimas 50 completadas;
el detalle inicial muestra cinco completadas. Los runs siguen disponibles en
el historial completo y en Deshacer al volver. Retirar un error de la vista no
borra su registro de PostgreSQL.

El trabajador arranca con la API y se detiene al cerrarla. No necesita Redis ni
un servicio adicional. Publicar exige aplicar las migraciones antes de
reiniciar `crv-api` (`scripts/deploy.sh --api`); ese reinicio cierra las sesiones
HTTP y puede requerir iniciar sesión de nuevo. PostgreSQL y sus secretos
permanecen en sus ubicaciones habituales. El down de 0100 se niega a retirar
la tabla mientras queden trabajos en cola o en proceso.

## Pruebas

```bash
./scripts/with-node22.sh npx vitest run --dir test/contract \
  image-curation-jobs.test.ts image-candidates.test.ts \
  --pool=forks --poolOptions.forks.singleFork

# Crear una campaña SSD y asignar su ruta a CRV_QA_OUT antes de capturar.
./scripts/with-node22.sh npx tsx web/tests/visual/image-curation-qa.mjs
./scripts/with-node22.sh node web/tests/visual/image-curation-published-qa.mjs
```

El contrato usa PostgreSQL desechable y comprueba autenticación, idempotencia,
recuperación tras cierre de conexiones, concurrencia entre trabajadores,
permiso vencido con un trabajador antiguo aún vivo, rollback en el commit,
reutilización de originales, reintentos y deshacer. Playwright usa una API,
sesiones con CSRF y PostgreSQL reales de prueba: cierra todos los contextos del
navegador con cuatro trabajos pendientes, espera sus resultados y vuelve a
entrar para deshacer y recuperar errores. También simula la pérdida de una
confirmación y una lectura antigua. La prueba del bundle publicado intercepta
todas las escrituras y no modifica el catálogo real.
