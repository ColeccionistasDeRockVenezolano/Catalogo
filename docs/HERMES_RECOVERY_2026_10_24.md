# Recuperación posterior a la auditoría de Hermes — 24-10-2026

Encargo: reparar Venezuela Demo, revisar los conteos e identidades publicados por
MP3.com y preparar la incorporación de Tumblr/fanzines. La preparación de estos dos
corpus no publica atribuciones nuevas ni convierte menciones en afirmaciones biográficas.

## Resultados conservados

- Datos, fuentes y planes: `data/research/hermes-recuperacion-2026-10-24/`.
- Informe, preview, resultado del run y verificación: `reports/hermes-recuperacion-2026-10-24/`.
- Capturas originales: permanecen en sus campañas de `data/raw` y `data/research`.

Las rutas son enlaces al almacén compartido. Todo resultado nuevo se generó en SSD y
se publicó al cierre. No reconstruir los antiguos directorios `reports/*` desde Git.

## Venezuela Demo

`scripts/venezuelademo-extract.py` lee por defecto la captura publicada y escribe en SSD;
`CRV_CAMPAIGN_ROOT` cambia la entrada y `CRV_EXTRACT_OUT` la salida. El parser textual
está en `scripts/venezuelademo_parser.py`.

La versión 2 conserva el texto original, delimita encabezados en línea y columnas,
separa discografía de fichas promocionales y recupera contacto, producción, músicos,
créditos y CD declarado. Las tablas asignan palabras antes de unir celdas, con página,
coordenada y columnas originales como evidencia. Un año «Inédito» o «1999 / 2002» se
conserva en `anio_texto` sin elegir una fecha. Las direcciones editoriales se distinguen
de los contactos declarados del artista, todos con vigencia sin comprobar.

Salida: `venezuelademo/extracted/{artists,discs,tracks}.jsonl`, `vista.html`, `pages.json`
y `provenance.json`. La vista contiene las fichas promocionales completas.

## MP3.com

`scripts/lib/mp3com-discography.ts` comparte el conteo y renderizado entre el importador
y `scripts/mp3com-repair-documents.mts`. Un grupo sin título conserva sus pistas pero no
cuenta como disco. La metadata distingue `albums`, `albumGroups`, `untitledGroups`,
`distinctAlbumTitles`, `tracks`, `unassignedTracks` y `countVersion=2`.

La reparación usa preview, bloqueo de filas, comprobación de versión, transacción
serializable y run reversible. `--probe` ejecuta todas las escrituras y las revierte;
`--apply` aplica. El run aplicado es **31660**. Conserva documentos, canciones y URLs;
retira la verificación de webs basada sólo en HTTP y registra los casos de identidad
para revisión. Rechaza el claim derivado incorrecto de solista para Doppler.

Variables: `CRV_RECOVERY_DATA` apunta a los planes y `CRV_RECOVERY_REPORT` a la salida
SSD. Una nueva ejecución de comprobación debe usar otra carpeta de salida para no
sobrescribir el preview histórico. No ejecutar `--apply` para comprobar integridad.

Las decisiones de identidad y las fuentes consultadas están en
`mp3com/identidades-decisiones.md`; los enlaces documentales se comparan en
`mp3com/identidades-publicadas-revision.jsonl`. Las discrepancias de ubicación se
mantienen separadas del lugar de origen: no son por sí mismas evidencia de homónimos.

## Tumblr y fanzines

`scripts/hermes-recovery-snapshot.mts` exporta el contexto del catálogo dentro de una
transacción de sólo lectura. `scripts/hermes_recovery_plan.py --out <SSD>` prepara los
planes sin escribir en PostgreSQL. Con `--youtube` consulta `videos.list` en lotes de
50 y conserva los payloads oficiales sin claves ni cabeceras de autenticación.

Tumblr: se siguen redirecciones registradas por ID, se deduplican relaciones, se
separan vínculos existentes y se respetan exclusiones editoriales. «Reproducible» sólo
significa API oficial con `public/unlisted` y `embeddable=true`. Cada propuesta nueva
mantiene pendiente revisar identidad y tipo de obra. Vimeo/Tumblr/Vevo quedan fuera
de la publicación audiovisual actual. Las imágenes y los audios también llevan IDs
canónicos; un candidato por nombre no autoriza un alta.

Fanzines: se deduplican nombre/alias por artista y página, se citan fragmentos literales
del corpus con offsets, documento y URL de origen, se apartan personas y OCR débil y
se elimina el falso positivo «recopilación de textos». Una mención o un año en una
página no se transforma en fecha o ciudad de la banda. Los expedientes requieren
corroborar la afirmación del campo antes de generar un claim.

## Comprobaciones

```bash
python3 -m unittest discover -s test/python -p test_venezuelademo_parser.py
python3 -m unittest discover -s test/python -p test_hermes_recovery_plan.py
npm run typecheck
```

El test TypeScript específico es `test/unit/mp3com-discography.test.ts`. La corrida de
cierre usó una configuración con `include` explícito para evitar recorrer los enlaces
del almacén al descubrir tests. Los logs y la configuración están en el informe.
La verificación final contrasta el diario de cambios, los recuentos, la idempotencia
y la ficha de Arnaly devuelta por la API real.
