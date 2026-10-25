# Caché de lecturas del catálogo

Las consultas públicas comparten cargas simultáneas y conservan los resultados
en memoria. No se guardan errores. Cada proceso y cada navegador mantienen
como máximo 256 entradas; una carga invalidada no puede volver a poblar la caché.
La vigencia empieza cuando termina la carga. Al vencer, la siguiente petición
recalcula el dato; no hay consultas periódicas para renovarlo.

| Superficie | Vigencia |
| --- | --- |
| Menú, géneros y filtros de artistas, discos, personas y organizaciones | 30 minutos |
| Portada | 15 minutos, separada por fecha editorial |
| Fichas y listados públicos, lugares y series | 10 minutos |
| Efemérides | 1 hora, separadas por fecha editorial |
| Resultados de búsqueda global | 60 segundos en el servidor |
| Identificadores del sitemap | 1 hora en el servidor |

La política está en `src/shared/catalog-cache-policy.ts`. El navegador reutiliza
estas lecturas al navegar y separa todas las combinaciones de filtros y páginas.
Una cancelación solo retira a su consumidor; si ya no queda nadie esperando,
se cancela la petición compartida y un reintento puede iniciar una carga nueva.
«Reintentar» y las recargas explícitas descartan primero la caché del navegador.

## Invalidación automática y manual

- Una escritura exitosa de la API invalida las lecturas antes de responder.
  Las métricas y la autenticación no invalidan el catálogo.
- Las ediciones con `withOperatorRun`, también desde CLI, publican el cambio
  después del commit. Un ensayo con rollback no modifica la caché.
- Importadores o SQL que no pasen por ese mecanismo se reflejan al vencer
  el TTL. Para hacerlos visibles inmediatamente, ejecutar `npm run cache:clear`.
- `npm run deploy` y `npm run deploy:api` ejecutan esa misma invalidación y
  verifican su recepción. El deploy de frontend no reinicia la API ni cierra sesiones.

`npm run cache:clear` escribe de forma atómica un UUID en
`data/.catalog-cache-revision`, en el SSD. La siguiente lectura de la API
detecta el marcador y descarta las respuestas públicas y los resultados de
búsqueda; también solicita el refresco del índice de búsqueda existente.
No se borra ningún dato del catálogo y no se necesita contraseña ni un endpoint
de escritura público. Es una invalidación: la siguiente petición carga los datos.

Las respuestas HTTP se revalidan (`private, no-cache`), para que una caché HTTP
independiente no conserve datos anteriores a la invalidación. La reutilización
sin red la realiza la caché en memoria de la aplicación. El marcador se consulta
al iniciar la web y al recuperar foco o visibilidad, sin temporizador. Si cambió,
se vacía la caché local y se recargan las vistas abiertas. Una pestaña que permanece
en primer plano conserva lo ya mostrado hasta una nueva lectura o recarga.

Las cabeceras `X-CRV-Cache: HIT|MISS`, `X-CRV-Cache-TTL` (segundos) y
`X-CRV-Cache-Version` permiten comprobar el comportamiento en la API.

## Día editorial y sesiones

La portada, las efemérides y el video diario del perfil se separan por la fecha
del ciclo común de `America/Caracas`. React sigue usando `DailyCycleProvider`
y `useDailyAsync`; no se muestra una selección de ayer al cambiar el día.
`/daily-cycle` conserva `no-store` y nunca entra en la caché.

Las respuestas administrativas no se cachean con este mecanismo. Las fichas y
listas que incluyen datos de trabajo de una sesión no se comparten en el servidor.
El navegador conserva únicamente lecturas de la lista pública permitida y limpia
su memoria al cambiar o expirar la sesión. Los filtros y demás respuestas comunes
sí se pueden compartir entre visitantes y usuarios con sesión.

## Consulta de personas

Los filtros calculan una sola vez el conjunto de participaciones únicas por
persona y rol. Ese conjunto sirve tanto para los conteos por rol como para
«Sin créditos», evitando volver a recorrer créditos por cada persona. Una persona
con el mismo rol en varios discos o pistas cuenta una sola vez para ese rol;
las membresías siguen contando como `band_member`.
