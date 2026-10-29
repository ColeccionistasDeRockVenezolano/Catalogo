#!/usr/bin/env python3
"""Informe legible y mapa de cobertura de la auditoría, sin tocar el catálogo."""
import collections
import csv
import json
import sys
from datetime import datetime,timezone
from pathlib import Path
out=Path(sys.argv[1]);root=Path('/mnt/1tb/Shared')
if '/crv-staging/' not in str(out.resolve()):raise SystemExit('Usar SSD')
def read(name):return json.loads((out/name).read_text())
def rows(name):
 with (out/name).open() as f:
  for l in f:
   if l.strip():yield json.loads(l)
def n(v):return f'{v:,}'.replace(',','.')
inv=read('inventario-resumen.json');db=read('db-instantanea.json');c=read('contraste-resumen.json');p=read('prioridades-resumen.json');m=read('media-resumen.json');e=read('evidencia-resumen.json');s=read('estructurados-resumen.json');a=read('archivos-historicos-resumen.json');ac=read('archivos-historicos-contraste-resumen.json');oc=read('expedientes-oficiales-resumen.json');of=read('hechos-oficiales-resumen.json');dist=read('distribuidor-resumen.json');lyrics=read('letras-resumen.json')
final=root/'coleccionistas-rock-venezolano/reports'/out.name
def link(name,label=None):return f'[{label or name}](<{final/name}>)'
total_groups=collections.defaultdict(lambda:{'files':0,'bytes':0})
for group,data in inv['groups'].items():
 key=group.split('/')[0]
 total_groups[key]['files']+=data['files'];total_groups[key]['bytes']+=data['bytes']
coverage=[]
for group,data in inv['groups'].items():
 if group.startswith('crv-ic'):
  method='Índice nominal completo; CSV/XLSX y XML musicales leídos; audio e imágenes inventariados, sin interpretar cada binario.'
 elif group.startswith('aqustico-assets'):
  method='Índices completos de artistas, discos, canciones e imágenes; biografías/letras copiadas de CRV no se cuentan como fuente nueva.'
 elif '/data/raw/' in group:
  method='JSON/JSONL leído o excluido por alcance/cabeceras; adaptadores locales y lectores de perfiles donde existen. Binarios conservados e inventariados.'
 elif '/data/research/' in group or '/reports/' in group or '/tmp-analysis/' in group:
  method='JSON/JSONL leído, deduplicado o excluido; hechos, planes y expedientes cotejados. Texto libre y binarios requieren lectura editorial cuando no hay extractor.'
 elif '/web/' in group:method='Manifiestos y procedencia contrastados; referencias de imágenes y archivos inventariados.'
 else:method='Inventario de soporte y migración; sin contenido musical nuevo afirmado.'
 coverage.append({'group':group,'files':data['files'],'bytes':data['bytes'],'method':method})
with (out/'COBERTURA.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=['group','files','bytes','method']);w.writeheader();w.writerows(coverage)
with (out/'TITULOS_POR_REVISAR.csv').open('w') as f:
 cols=['artist','title','state','artistCandidates','years','sourceRows','sourceCount','sourceReferences','completeEvidence']
 w=csv.DictWriter(f,fieldnames=cols);w.writeheader()
 for r in rows('titulos-y-ediciones-agrupados.jsonl'):
  refs=sorted({str(s.get('url') or s.get('file')) for s in r['sources']});row={k:r[k] for k in ['artist','title','state','artistCandidates','years','sourceRows']}
  row.update({'sourceCount':len(refs),'sourceReferences':refs[:16],'completeEvidence':'titulos-y-ediciones-agrupados.jsonl · '+r['artist']+' · '+r['title']})
  w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in row.items()})
fields=[('Duración de pista','track.duration_seconds'),('Fecha literal/precisión de edición','album.release_date_text'),('Sello / autoedición','album.label_name'),('Portada de disco','album.cover_url'),('Foto de artista','artist.picture_url'),('Año de publicación','album.release_year'),('Número de catálogo','album.catalog_id'),('Biografía de artista','artist.biography'),('Biografía de persona','person.biography'),('Letra de pista','track.lyrics'),('Formato','album.media_format'),('Ciudad de origen','artist.origin_city'),('Año de formación','artist.formed_year')]
table='\n'.join(f'| {label} | {n(p["slotsByField"].get(key,0))} |' for label,key in fields)
source_table='\n'.join(f'| `{k}` | {n(v["files"])} | {v["bytes"]/1e9:.2f} |' for k,v in total_groups.items())
text=f'''# Auditoría profunda de Shared contra el catálogo — 2026-10-25

**Queda información aprovechable y quedan propuestas que no deben incorporarse sin revisión.** El censo completo cubre **{n(inv['files'])} archivos, {inv['bytes']/1e9:.2f} GB**, sin errores de recorrido. El contraste es de solo lectura. No se ejecutaron importadores ni se modificó PostgreSQL.

El resultado principal es una lista de **{n(p['candidateEmptySlots'])} campos vacíos con candidatos locales**, en **{n(p['candidateEntities'])} entidades**, más colas separadas para discrepancias, títulos, créditos, documentos, imágenes y propuestas antiguas. Un candidato no es una incorporación aprobada. Las distintas colas se solapan y **no se suman** como entidades o datos nuevos.

Se excluyeron reviews musicales, calificaciones y artistas similares/recomendaciones. Sí se incluyen integrantes, créditos, sellos, discografía, documentos y audiovisuales. “Revisión” en los archivos significa revisión editorial, no una review musical.

Abrir primero {link('PRIORIDADES.csv','la tabla de campos vacíos')} y {link('TITULOS_POR_REVISAR.csv','la tabla de títulos y ediciones')}. Cada fila conserva el destino, el valor propuesto y su evidencia.

El CSV de prioridades muestra hasta 16 referencias únicas por fila para facilitar su lectura; el total está en `sourceCount` y **todas las citas y referencias** quedan íntegramente en {link('huecos-con-candidatos-agrupados.jsonl')}, localizables por entidad y campo. Los valores propuestos no se recortan.

## Corte y cobertura comprobada

PostgreSQL: **{db['captured_at']}**, transacción `REPEATABLE READ READ ONLY`, snapshot `{db['snapshot']}`. Incluye {n(c['counts']['artist'])} artistas, {n(c['counts']['album'])} discos, {n(c['counts']['track'])} pistas, {n(c['counts']['person'])} personas, {n(db['counts']['media.artist_documents'])} documentos de artista y {n(db['counts']['media.artist_gallery'])} imágenes de galería. Una lectura posterior confirmó los mismos conteos de artistas, discos, pistas, documentos y galería.

| Almacén | Archivos | GB decimales |
| --- | ---: | ---: |
{source_table}

Trabajo realizado:

- {n(sum(s['counts'].values()))} archivos JSON/JSONL crudos y planes clasificados: {n(s['counts']['ok'])} leídos sin duplicación, {n(s['counts']['contenido_duplicado'])} copias por contenido, {n(s['counts']['excluido_cabeceras'])} cabeceras y {n(s['counts']['excluido_alcance'])} exclusiones de alcance. {len(s['errors'])} errores de parseo.
- {n(sum(a['counts'].values()))} archivos de investigación, informes y análisis históricos clasificados, con sus errores y exclusiones en {link('archivos-historicos-resumen.json')}.
- 15.393 páginas locales releídas con los adaptadores del proyecto, sin errores: 826.788 registros emitidos, con repeticiones identificadas antes del cotejo. El adaptador genérico de RHV no cubre sus fichas del directorio: también se contrastaron las **511 fichas del parser específico**, que conserva pestañas, soportes, créditos y lados/CD.
- 2.770 respuestas Bandcamp, 8.541 HTML de Lobotoradio, 4.360 archivos de perfiles RYM, los cuatro índices de Aqustico y las 34.823 filas del índice nominal del bucket.
- {n(dist['stats']['tabular_rows'])} filas tabulares del distribuidor tras descontar archivos idénticos, {dist['stats']['ddex_releases']} XML de entregas DDEX y los manifiestos de medios. Se excluyeron archivos contables.
- {n(db['counts']['ingest.claims'])} claims inspeccionadas con filtro de campos ajenos al alcance; {n(db['counts']['ingest.catalog_facts'])} hechos documentales y sus vinculaciones cotejados.

El detalle por colección está en {link('COBERTURA.csv')}. Cada lectura estructurada tiene ruta, SHA-256 y estado en sus archivos `*-lecturas.jsonl`.

Los 163 avisos de formato históricos se concentran en 12 archivos que mezclan logs con JSON o usan JSON multilínea bajo extensión JSONL. Se recuperaron 9.639 objetos en un derivado, sin modificar originales: {link('archivos-historicos-recuperacion-resumen.json')}. No son capturas perdidas.

## Campos vacíos con respaldo candidato

Estos conteos agrupan por **entidad + campo**. Dos años incompatibles son un hueco con dos propuestas, no dos datos aprobados.

| Dato candidato | Campos vacíos |
| --- | ---: |
{table}

Hay además géneros, logos, actividad, temas y notas en la tabla completa. De los {n(p['candidateEmptySlots'])} huecos, **{n(p['slotStates']['varios_valores_para_revisar'])} tienen varios valores alternativos**, {n(p['slotStates']['imagen_candidata_requiere_identidad_y_disponibilidad'])} son imágenes candidatas y **{n(p['slotStates']['autoedicion_documentada_no_crear_sello_ficticio'])} documentan autoedición**. En este último grupo no corresponde crear una organización ficticia llamada “Independiente”.

Ejemplos concretos para revisar:

- Moriturio: el campo de formación está vacío y Metal Archives conserva 2007, con coincidencia de nombre y discografía. Fuente y registro: {link('huecos-con-candidatos-agrupados.jsonl')}.
- Sibelíus — *Legacy*: hay una propuesta de 2023 para el año vacío. Verificar la edición antes de aplicar.
- Mattels: la copia de AllMyLinks conserva “Fundada en Madrid en el año 2002…”; WAG: Bandcamp conserva “WAG es una banda de pop rock en español que se creo en Venezuela en el año 1986.” Ambos campos están vacíos. Son los **dos huecos adicionales** encontrados al revisar expedientes antiguos; ya están incluidos en el total, no se suman otra vez. Evidencia: {link('campos-oficiales-con-cita-literal.jsonl')}.

El catálogo completo tiene carencias mucho mayores: 1.440 artistas sin biografía, 3.702 sin foto, 1.912 discos sin portada, 894 sin año, 1.914 sin pistas y 52.479 pistas sin duración. **No se afirma que todos esos vacíos puedan completarse con lo guardado.** Ver {link('carencias-estructurales.jsonl')}.

También se contrastó el formato nativo de MusicaVenezuela: sus 164 letras limpias encuentran 686 pistas cuya letra ya coincide y **27 pistas con letra vacía**; 49 letras no tienen identidad o pista exacta. Las 27 son candidatas, con revisión de versión antes de trasladar texto. Las 112 biografías no aportan otro campo vacío confirmado por coincidencia nominal. De 508 entradas discográficas, 396 coinciden de forma única y 112 quedan por revisar. Los datos adicionales de sello y portada se integraron sin duplicar huecos. {link('letras-cotejo.jsonl')}, {link('musicavenezuela-ediciones-revisar.jsonl')} y {link('musicavenezuela-campos-candidatos.jsonl')}.

## Discos, ediciones y tipos

Las 90.851 ocurrencias sin coincidencia exacta se reducen a **{n(p['releaseGroups'])} grupos de título/artista**. La reconciliación por enlaces ya identifica **{n(p['releaseGroupStates'].get('edicion_presente_por_enlace_revisar_titulo',0))} grupos correspondientes a discos existentes**, aunque cambie el título; otros {n(p['releaseGroupStates'].get('posible_variante_de_titulo_o_edicion_existente',0))} son posibles variantes de título y {n(p['releaseGroupStates'].get('sin_identidad_unica',0))} no tienen identidad única. Los restantes son una cola de contraste, **no un conteo de discos faltantes verificados**.

Se deben comprobar identidad, alias, edición original frente a reedición, créditos y alcance de recopilaciones o apariciones. Los tipos compuestos y características no se reducen a una categoría exclusiva. No se deduce EP/álbum/sencillo del número de pistas. Las referencias identificadas como videos se conservaron aparte en {link('audiovisuales-candidatos.jsonl')}; no crean discos ni pistas.

También hay **{n(c['genres']['candidates'])} propuestas de género**: {n(c['genres']['states'].get('genero_sin_asignacion',0))} sin asignaciones y {n(c['genres']['states'].get('revisar_alias_taxonomia_y_alcance',0))} pendientes de comparar alias, taxonomía y ámbito. Ver {link('generos-por-contrastar.jsonl')}.

## Créditos, integrantes, documentos y expedientes antiguos

El cotejo reconoce créditos ya presentes en lugar de proponerlos de nuevo. En RHV, 13.537 menciones encuentran a la persona acreditada y 2.557 no encuentran coincidencia nominal en ese ámbito; estas últimas requieren comprobar alias, edición y rol, no altas automáticas. Ver {link('rhv-creditos-contexto.jsonl')}.

Los **{n(oc['latestCases'])} expedientes oficiales más recientes por artista** contienen {n(oc['facts'])} propuestas tipadas; tras deduplicación quedan **{n(of['uniqueFacts'])}**. El contraste distingue discos y pistas existentes, créditos ya presentes, otros proyectos, citas y síntesis pendientes:

- {n(of['states'].get('edicion_ya_presente',0))} hechos de edición y {n(of['states'].get('pista_ya_presente',0))} de pista encuentran el destino existente.
- {n(of['states'].get('credito_presente_revisar_rol_y_alcance',0))} créditos y {n(of['states'].get('integrante_presente_revisar_rol_periodo_y_condicion',0))} menciones de integrante encuentran relaciones existentes; aún puede faltar precisión de rol o período.
- {n(of['states'].get('credito_sin_coincidencia_en_ambito_documentado',0))} propuestas de crédito y {n(of['states'].get('integrante_sin_coincidencia_nominal',0))} de integrante no encuentran coincidencia nominal/contextual. Se conservan las citas, no se aprueban como relaciones nuevas.
- {n(of['states'].get('cita_no_validada_en_copia_del_expediente',0))} propuestas no pasan la comprobación literal en la copia de **ese expediente**. Esto no prueba falsedad del dato: exige localizar la copia correcta o corregir la cita.
- {n(of['states'].get('otro_proyecto_o_ambito_por_revisar',0))} propuestas pertenecen a otro proyecto o necesitan aclarar su ámbito. Fechas de grabación o del inicio de otra banda no rellenan el año de formación del artista.
- {n(oc['pagesWithoutFactsInLatestCase'])} páginas no tienen hechos extraídos en la última versión de su expediente. Eso tampoco demuestra falta de uso por otras rutas.

Archivos: {link('hechos-oficiales-cotejo.jsonl')}, {link('expedientes-oficiales-ultimos.jsonl')}, {link('hechos-documentales-pendientes.jsonl')}, {link('planes-destino-pendiente.jsonl')} y {link('archivos-historicos-candidatos-contrastados.jsonl')}.

El barrido histórico separa {n(ac['states'].get('propuesta_historica_por_revisar',0))} propuestas antiguas por revisar de {n(ac['states'].get('preservado_como_hecho',0))} que ya están preservadas como hechos. Además hay {n(ac['states'].get('edicion_historica_por_revisar',0))} títulos históricos por revisar; no se suman a la tabla principal porque pueden solaparse con otras fuentes.

Reconciliación de campañas anteriores:

- **Fanzines:** 220 artistas contrastados. {n(e['fanzines']['decisions'].get('sin_afirmacion_respaldada',0))} decisiones no tienen una afirmación respaldada del campo; {n(e['fanzines']['decisions'].get('coincide_catalogo',0))} coinciden y {n(e['fanzines']['decisions'].get('contrastar_campo',0))} siguen requiriendo contraste. Una ciudad de concierto o del editor del fanzine no demuestra origen de la banda. {link('fanzines-reconciliacion.jsonl')}.
- **92 expedientes MP3.com históricos:** 26 decisiones enlazan una ficha actual; 66 requieren reconciliación o tuvieron decisiones de contexto/rechazo. No son 92 artistas nuevos pendientes. {link('mp3-92-reconciliacion.jsonl')}.
- **Wayback:** persisten 21 diferencias de año de los 22 casos históricos revisados; el otro coincide con una variante, con edición aún por precisar. {link('wayback-anios-reconciliacion.jsonl')}.
- **Distribuidor:** {n(c['distributor']['metadataToCompare'])} filas con metadatos de sello, créditos o identificadores relacionadas nominalmente con candidatos del catálogo. Son filas, no entidades nuevas. UPC/ISRC y créditos quedan conservados con su fila y origen en {link('distribuidor-metadatos-por-contrastar.jsonl')}.

## Imágenes y audiovisuales

Se comprobaron **17.370 entradas del manifiesto** y **27.563 archivos de medios**. No aparecieron imágenes locales ya atribuidas en ese manifiesto que permitan rellenar automáticamente un campo vacío. Las 137 entradas sin archivo corresponden a descargas fallidas registradas, no a 137 imágenes recuperadas. Hay **5.348 archivos sin referencia directa en las tablas consultadas**: incluyen originales sustituidos, versiones y material documental; no se declaran todos aprovechables ni se recomienda borrarlos. {link('imagenes-sin-referencia-directa.jsonl')}.

Las obras audiovisuales conservadas suman 690. **81 no tienen video enlazado y otras dos tienen estado no elegible** en la evidencia conservada. Los filtros actuales del repositorio las excluyen de la pestaña pública. No se consultó de nuevo YouTube: este es un contraste de las respuestas API archivadas. Hay que verificar identidad y `public`/`unlisted` + `embeddable=true` antes de publicarlas. {link('audiovisuales-elegibilidad-conservada.jsonl')}.

Se detectó **una marca fuera de duración**: video `ofSoz89ybB4`, vínculo `media.video_tracks.id=18529`, pista `5533`; final guardado **44.073 s**, duración del video **8.984 s**. No se corrigió ni se estimó otro final. {link('marcas-tiempo-revisar.jsonl')}.

## Orden de aprovechamiento

1. Revisar la marca fuera de duración y los campos vacíos con fuente identificable, empezando por duraciones y años con edición coincidente. Resolver las propuestas incompatibles antes de aplicar.
2. Revisar portadas y fotografías con atribución exacta, y registrar autoedición sin inventar sellos. No confundir una URL candidata con un archivo disponible.
3. Resolver los grupos de títulos por ID/enlace, alias y edición; incorporar solamente publicaciones musicales documentadas.
4. Completar roles, períodos y ámbitos de integrantes/créditos existentes; después revisar los que no tienen coincidencia.
5. Aprovechar documentos y hechos para biografías, cronologías y fichas, preservando citas. Mantener fuera de la pestaña pública los audiovisuales no verificables.

## Qué se agotó y qué queda abierto

Se completaron el censo de todo Shared, el recorrido de los archivos estructurados descritos, la reextracción local disponible y el contraste de sus propuestas contra una instantánea coherente. Las colas restantes quedan enumeradas con fuente y destino; no se dejaron como un “pendiente” genérico.

**No se certifica que cada audio, imagen o PDF esté semánticamente agotado.** No se transcribieron todos los audios ni se repitió OCR sobre cada imagen/PDF; se contrastaron sus índices, textos derivados, planes y evidencia existente. Las capturas sin hechos, fuentes incompletas, texto libre sin extractor, identidades ambiguas y diferencias de edición requieren trabajo editorial o nueva evidencia. Inventariar, procesar o conservar no equivale a aceptar o aprovechar íntegramente.

Entre los 21.075 documentos de evidencia, {n(e['documentUsage'].get('con_hechos',0))} tienen hechos vinculados, {n(e['documentUsage'].get('pagina_ingestada_sin_hechos',0))} coinciden con páginas de ingesta sin hechos, {n(e['documentUsage'].get('documento_publicado_sin_hechos',0))} con documentos publicados sin hechos y {n(e['documentUsage'].get('sin_vinculacion_en_estos_destinos',0))} no encuentran vinculación en esos destinos. Puede existir uso por otras rutas; no se equipara esta última cifra con documentos “no usados”. Hay {n(e['documentUsage'].get('extraccion_incompleta',0))} extracciones marcadas como incompletas. {link('evidencia-uso-documental.jsonl')}.

## Integridad y reproducción

37 conteos de tablas coinciden con la instantánea exportada. Las dos instantáneas mayores se conservaron en gzip tras comprobar que la descompresión produce exactamente el mismo SHA-256. {link('validacion.json')} y {link('compresion-verificada.json')}.

La sintaxis de Python y el lint de los nuevos lectores JavaScript/TypeScript pasaron. El typecheck global detectó un error previo ajeno a esta tarea en `test/unit/plan-scope.test.ts:188` (TS2322); los scripts nuevos no presentan errores de TypeScript. No se modificó ese test.

Los lectores reproducibles están en `scripts/audit-shared-*` y se copian también dentro de esta campaña. Las copias archivadas que importan módulos del repositorio se ejecutan desde el proyecto, no directamente desde el HDD. Los argumentos de salida exigen staging SSD. Para repetir sobre la misma instantánea, usar los JSONL conservados (los lectores Python principales admiten los dos gzip); para una nueva campaña, ejecutar de nuevo el inventario y el lector PostgreSQL. La ausencia de un extractor en una colección no debe interpretarse como ausencia de información.

El manifiesto final de resultados es {link('MANIFEST-SHA256.json')}. Campaña creada en SSD y publicada al almacén mediante `scripts/staging.py publish --hash`; los originales de Shared se mantuvieron intactos.
'''
(out/'INFORME.md').write_text(text)
summary={'createdAt':datetime.now(timezone.utc).isoformat(),'inventory':{'files':inv['files'],'bytes':inv['bytes']},'databaseSnapshot':db['captured_at'],'candidateEmptyFields':p['candidateEmptySlots'],'candidateEntities':p['candidateEntities'],'priorityFile':'PRIORIDADES.csv','report':'INFORME.md','excluded':c['excluded'],'catalogueModified':False,'semanticExhaustionOfEveryBinaryClaimed':False}
(out/'RESULTADO.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(summary)
