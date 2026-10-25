# Alcance editorial y memoria histórica

Decisión de Brian, 21 de octubre de 2026: retirar del catálogo las referencias
extranjeras que no cumplen el alcance venezolano, conservar personas y hechos
históricos, e impedir que importadores vuelvan a convertirlas en artistas.
Los proyectos de venezolanos también son venezolanos aunque se formen o residan
fuera del país. Analog Circl8, proyecto de Daniel Maal, está incluido expresamente.

## Identidad, geografía y admisión

El país de origen sigue describiendo geografía. No se sustituye por Venezuela
para admitir una agrupación de la diáspora. Se consideran sus integrantes,
trayectoria y evidencia. Un crédito en un compilado venezolano no basta para
importar toda la discografía extranjera. `is_venezuelan` inferido de créditos
tampoco prueba por sí solo la nacionalidad de una persona.

Las 18 admisiones del inventario revisado están documentadas en
[la decisión por identidad](decisions/2026-10-21-editorial-admissions.json).
Incluyen proyectos con integrantes venezolanos y casos previamente admitidos
por arraigo. Always War se mantiene mientras se amplía la evidencia del
guitarrista Rod; no excluirlo automáticamente por su país de formación.

## Archivo y protección

Las migraciones 0096 y 0097 añaden tablas auxiliares en `ingest`; no alteran las
columnas canónicas. `artist_editorial_policy` retira una identidad del catálogo
público y conserva una instantánea de su ficha, discos, integrantes y criterio.
No se borran artistas, discos, pistas ni créditos originales.

Toda lectura pública de artistas, discos y pistas utiliza `ingest.catalog_artists`,
`catalog_albums` y `catalog_tracks`. Créditos utilizan `catalog_credit_artists`,
`catalog_album_credits` y `catalog_track_credits`: mantienen el nombre del
colaborador extranjero y, para solistas identificados, su persona. Las bandas
se conservan como referencias colectivas; una banda no se convierte en una
persona ficticia. Las fichas retiradas y sus discos responden 404 públicamente.

Los disparadores protegen identidades excluidas por ID, nombres y alias exactos
normalizados, personas vinculadas e identificadores externos conocidos. El
motor de merge y el resolver persona/artista consultan la decisión antes de
escribir. SQLSTATE `PCE01` indica exclusión editorial. Las afirmaciones de fuentes
pueden conservarse como candidatos para revisión sin recrear la ficha pública.
Esto protege las identidades conocidas; un alias nuevo sin evidencia de vínculo
requiere resolución de identidad, no una prohibición indiscriminada por país.

Solo una decisión editorial explícita levanta una exclusión mediante
`admitArtist`. `artist_editorial_admissions` guarda motivo, evidencia y la
exclusión anterior completa. `PCE02` impide volver a excluir automáticamente un
proyecto admitido. Las tablas tienen diario de cambios asociado a un run.
Las migraciones inversas rechazan borrar decisiones pobladas.

## Efemérides

`ingest.ephemerides` conserva hechos independientemente de que exista una ficha
pública de artista. Estados: `verified`, `pending`, `contradicted`. Cada hecho
conserva fuentes y procedencia. Solo `verified`, con fecha exacta y año coherente,
se publica en `/ephemerides` y en la página Efemérides.

El aniversario utiliza el ciclo editorial de `America/Caracas` del servidor.
La página usa `useDailyAsync` y `useDailyCycle`. No calcula un segundo reloj.
Las fechas futuras respecto al ciclo seleccionado no se muestran.

La API administrativa autenticada permite consultar y guardar hechos mediante
`GET /curation/ephemerides` y `POST /curation/ephemerides`; la escritura exige
motivo y se ejecuta con `withOperatorRun`. La publicación no depende de importar
una banda extranjera como artista.

Se publicaron los conciertos de Metallica del 4 de mayo de 1999 y del 12 de
marzo de 2010, respaldados por su archivo oficial. Por indicación expresa de
Brian («coloca que fue el 8», 2026-10-21), Sepultura se publica con fecha
8 de mayo de 1994, coincidente con el testimonio de Johnny Castro en
*Educación Anterior*. La nota editorial conserva la discrepancia con el
9 de mayo del título del bootleg y la inconsistencia de la narración del libro.

## Operación reproducible

`scripts/retire-international-artists.ts` genera vista previa e instantáneas y
aplica con `--write`. `scripts/admit-venezuelan-projects.ts` aplica la decisión
por identidad. `scripts/verify-editorial-scope.ts` verifica el cierre y prueba
bloqueos en una transacción que revierte. Los tres reciben una campaña en
`$HOME/crv-staging/reports`; publicarla mediante `scripts/staging.py` al cerrar.

El cierre del lote es 237 referencias retiradas, 18 admisiones, 395 discos
conservados internamente y 39 personas protegidas contra reconversión.
