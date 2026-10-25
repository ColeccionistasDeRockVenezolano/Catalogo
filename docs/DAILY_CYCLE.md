# Día editorial de CRV

Todas las selecciones diarias cambian a las **00:00 de Venezuela
(`America/Caracas`)**. La definición única está en `src/shared/daily-cycle.ts`,
compartida por Node y React. El módulo calcula la fecha, el número de día y los
instantes de inicio y siguiente cambio, incluidos los cambios de mes y año.

`GET /daily-cycle` devuelve ese ciclo y `serverNow`, con `Cache-Control: no-store`.
`DailyCycleProvider` sincroniza la aplicación una vez, programa el cambio común y
vuelve a sincronizar al recuperar foco o visibilidad. El tiempo transcurrido se
mide con `performance.now()`: adelantar el reloj del dispositivo no adelanta el día
editorial. Tras una sincronización correcta, el ciclo puede avanzar usando ese
reloj aun cuando falle temporalmente la red; las lecturas se reintentan.

## Integrar una selección nueva

- La API usa `dailyDate()` como fecha predeterminada y `dailyCycleForDate(date)`
  como metadatos `dailyCycle`. Validar fechas explícitas con `dailyDateSchema`.
- React usa `useDailyAsync((date, signal) => api.get(signal, date))`. Este hook
  invalida los datos del día anterior al cambiar el contexto compartido, cancela
  solicitudes obsoletas y conserva los mecanismos habituales de error y reintento.
- Para recorrer un conjunto ordenado sin repetir hasta completar una vuelta,
  usar `dailyIndex(date, size)` o el mismo índice de día en SQL.
- Para una muestra o permutación, usar `dailyRandom(date, nombreDeLaSuperficie)`.
  La misma fecha y el mismo conjunto producen la misma selección al recargar y
  entre visitantes. No usar `Math.random()` para escoger el contenido diario.
- Comprobar el milisegundo anterior y el instante del cambio común, páginas
  abiertas, suspensión/reanudación, solicitudes lentas y ausencia de candidatos.

## Superficies integradas

- Portada: artista, discos, épocas, sellos, muro de portadas y recorridos diarios.
- Buscador principal: orden diario reproducible de las sugerencias editoriales.
- Buscadores de artistas, personas, discos y organizaciones: muestras y géneros
  reproducibles que se renuevan al cambiar el mismo ciclo.
- Perfiles: video diario de YouTube · CRV, obtenido exclusivamente de videos
  publicados del canal oficial y vinculados mediante intérprete, protagonista,
  disco o pista. Una sola aparición por video aunque tenga varios vínculos.
  El orden por identificador y el índice de día recorren todos los candidatos;
  con un solo video se conserva ese video. No se escriben enlaces de streaming
  artificiales en el catálogo.

Los carruseles y las transiciones pueden avanzar entre elementos de la selección
vigente. Su animación no cambia el día editorial ni vuelve a sortear la muestra.
Las actualizaciones de datos y publicaciones recientes conservan su refresco y la
fecha común. La validez o retirada de una sugerencia editorial se aplica al
momento. Las métricas históricas, los presupuestos, la retención y las
recomendaciones solicitadas expresamente no son rotaciones de contenido diario.
