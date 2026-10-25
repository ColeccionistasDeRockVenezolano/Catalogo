"""Construye el informe del cierre desde el corte final y su diario de cambios."""
import collections
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REPORT = Path(os.environ['HERMES_DEEP_REPORT'])
DATA = ROOT / 'data/research/hermes-cierre-profundo-2026-10-24'


def load(path):
    return json.loads(path.read_text())


def lines(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def clean(value):
    # No reproducir cédulas que aparezcan incidentalmente en textos históricos.
    return re.sub(r'\b[VEve][- .]?\d{1,3}(?:[. ]\d{3}){2}\b', '[documento personal omitido]', str(value))


def cell(value):
    return clean(value if value is not None else 'Sin dato').replace('|', '\\|').replace('\n', ' ')


def group_journal(journal):
    return {(row['table_name'], row['op']): row['n'] for row in journal}


def main():
    v = load(REPORT / 'verificacion-final.json')
    state = load(REPORT / 'artistas-estado-final.json')
    checks = {key: len(value) for key, value in v['checks'].items()}
    if any(checks.values()):
        raise ValueError(f'Invariantes incumplidas: {checks}')
    reading_check = load(REPORT / 'verificacion-lecturas.json')
    if reading_check['failures']:
        raise ValueError('Lecturas con hashes incorrectos')
    operations = {}
    for file in REPORT.glob('*-applied.jsonl'):
        operations[file.name.replace('-applied.jsonl', '')] = [
            item for row in lines(file) if row.get('applied') for item in row['results']
        ]
    journal = group_journal(v['journal'])
    number = lambda table, op='I': journal.get((table, op), 0)
    closed = sum(bool(row.get('closed')) for row in operations['deepclosures'])
    claims_inserted = sum(bool(row.get('created')) for row in operations['songs'])
    claims_removed = sum(bool(row.get('removedDuplicateId')) for row in operations['songreconcile'])
    identities = {row['key'] for row in operations['identityfactclosures'] if row.get('applied')}
    reviews = load(REPORT / 'revisiones-abiertas-final.json')
    package = load(DATA / 'package-summary.json')
    counts = v['counts']
    initial = load(DATA / 'catalogue.json')
    persons = {str(row['id']): row['name'] for row in initial['persons']}
    by_artist = collections.defaultdict(list)
    for change in state['changes']:
        record = change['new_data'] or change['old_data']
        if change['table_name'] == 'public.artists':
            aid = str(change['row_pk']['id'])
        else:
            aid = str((record or {}).get('artist_id', ''))
        if aid:
            by_artist[aid].append(change)
    docs = collections.defaultdict(list)
    for document in state['documents']:
        docs[str(document['artist_id'])].append(document)
    bindings = collections.defaultdict(list)
    for binding in state['bindings']:
        bindings[str(binding['artist_id'])].append(binding)
    dossier = [
        '# Artistas, datos y procedencia del cierre profundo de Hermes', '',
        f'Corte PostgreSQL: **{v["checkedAt"]}**. {len(state["artists"])} artistas afectados por esta campaña.', '',
        'Cada ficha distingue los campos actuales del catálogo de los cambios hechos en este cierre. '
        'Una fuente enlazada no acredita por sí sola todos los campos actuales. Las referencias MP3.com son históricas; '
        'la ubicación de un perfil no se convierte en ciudad de origen. Las fuentes con una identidad pendiente no se añaden como identidad confirmada.', '',
        'El lote anterior de 88 altas tiene su propio [archivo de artistas y fuentes](../hermes-artistas-fuentes-2026-10-24/ARTISTAS_Y_FUENTES.md). '
        'Este documento cubre los artistas afectados por el cierre posterior, incluidas las dos bandas nuevas.', '',
    ]
    field_names = {'origin_city': 'Ciudad de origen', 'origin_country': 'País de origen',
                   'formed_year': 'Año de formación', 'artist_type': 'Tipo', 'biography': 'Biografía'}
    for artist in state['artists']:
        aid = str(artist['id'])
        changes = by_artist[aid]
        dossier += [f'## {clean(artist["name"])} — #{aid}', '',
                    '| Campo actual | Valor |', '| --- | --- |']
        for field in ['artist_type', 'origin_city', 'origin_country', 'formed_year']:
            dossier.append(f'| {field_names[field]} | {cell(artist.get(field))} |')
        dossier.append('')
        if artist.get('biography'):
            dossier += ['Biografía actual del catálogo:', '', clean(artist['biography']), '']
        actions = []
        for change in changes:
            table, op = change['table_name'], change['op']
            record = change['new_data'] or change['old_data']
            if table == 'public.artists' and op == 'I':
                actions.append('Alta de artista, con distinción expresa frente a los candidatos de nombre parecido.')
            elif table == 'public.artists' and op == 'U':
                old, new = change['old_data'], change['new_data']
                for field, label in field_names.items():
                    if old.get(field) != new.get(field):
                        if field == 'biography':
                            actions.append('Biografía incorporada desde el perfil histórico; texto reproducido arriba.')
                        else:
                            actions.append(f'{label}: {cell(old.get(field))} → {cell(new.get(field))}.')
            elif table == 'public.albums' and op in ['I', 'D']:
                verb = 'Disco incorporado' if op == 'I' else 'Disco inválido retirado tras comprobar el PDF'
                actions.append(f'{verb}: «{clean(record["title"])}» (#{record["id"]}; año: {cell(record.get("release_year"))}).')
            elif table == 'public.albums' and op == 'U':
                for field, label in [('release_year', 'Año'), ('album_type', 'Tipo')]:
                    old, new = change['old_data'], change['new_data']
                    if old.get(field) != new.get(field):
                        actions.append(f'{label} del disco «{clean(new["title"])}» #{new["id"]}: {cell(old.get(field))} → {cell(new.get(field))}.')
            elif table == 'public.artist_members' and op == 'I':
                person_id = str(record['person_id'])
                actions.append(f'Membresía histórica: {clean(persons.get(person_id, "Persona #"+person_id))} (persona #{person_id}), {clean(record.get("role") or "rol no especificado")}. Vigencia actual sin afirmar.')
        new_gallery = sum(c['table_name'] == 'media.artist_gallery' and c['op'] == 'I' for c in changes)
        new_docs = sum(c['table_name'] == 'media.artist_documents' and c['op'] == 'I' for c in changes)
        if new_gallery:
            actions.append(f'{new_gallery} imágenes incorporadas a la galería, sin inferir retratos ni portadas por proximidad.')
        if new_docs:
            actions.append(f'{new_docs} documentos de procedencia incorporados.')
        if bindings[aid]:
            actions.append('Continuidad de identidad documentada: ' + '; '.join(sorted({b['source_key'] for b in bindings[aid]})) + '.')
        dossier += ['Cambios y vínculos de este cierre:', '']
        dossier += ['- ' + action for action in dict.fromkeys(actions)] or ['- Referencias documentales conciliadas; consultar el diario para la disposición de los hechos.']
        dossier += ['', 'Fuentes y alcance registrado:', '']
        sources = collections.defaultdict(set)
        for doc in docs[aid]:
            if doc.get('source_url'):
                sources[doc['source_url']].add(doc['title'])
        for change in changes:
            rec = change['new_data'] or {}
            if change['table_name'] == 'media.artist_gallery' and rec.get('source_url'):
                sources[rec['source_url']].add('Procedencia de imagen de galería')
        if not sources:
            dossier.append('- Véase la evidencia y el diario de la campaña; no se añade una URL no registrada.')
        for url, titles in sorted(sources.items()):
            dossier.append('- [' + cell('; '.join(sorted(titles))) + '](' + url + ')')
        dossier.append('')
    (REPORT / 'ARTISTAS_Y_FUENTES.md').write_text('\n'.join(dossier) + '\n')

    pending = collections.Counter(row.get('notes') or 'Sin nota' for row in reviews)
    pending_md = ['# Revisiones que siguen abiertas', '',
                  f'Corte: {v["checkedAt"]}. {len(reviews)} filas abiertas en las dos campañas auditadas. '
                  'Una fila puede cubrir una obra o relación, y varias filas pueden pertenecer al mismo expediente. '
                  'Este total no equivale a artistas pendientes ni a fuentes no capturadas.', '',
                  '| Motivo conservado | Filas abiertas |', '| --- | ---: |']
    for reason, n in pending.most_common():
        pending_md.append(f'| {cell(reason)} | {n} |')
    pending_md += ['', 'Los identificadores y payloads completos están en [revisiones-abiertas-final.json](revisiones-abiertas-final.json).', '']
    (REPORT / 'PENDIENTES_REALES.md').write_text('\n'.join(pending_md))

    report = f'''# Cierre profundo de las sesiones de Hermes

Corte de PostgreSQL y disco: **{v['checkedAt']}**. Trabajo autorizado por Brian. Se auditó primero la evidencia y después se aplicaron cambios con runs de operador identificables.

Se cerraron **{closed} revisiones concretas**. La campaña incorporó **{number('public.artists')} bandas, {number('public.albums')} discos, {number('public.artist_members')} membresías históricas, {number('media.artist_documents')} documentos de artista y {number('media.artist_gallery')} imágenes de galería**. Se retiraron **{number('public.albums','D')} discos inválidos**, por lo que el crecimiento neto propio fue de **{number('public.albums')-number('public.albums','D')} discos**. No se crearon personas ni pistas musicales en este cierre.

Quedan expedientes que la evidencia disponible no permite aplicar. Se enumeran con sus motivos y referencias; no se aprobaron para hacer desaparecer la cola. El estado abierto real se documenta en [PENDIENTES_REALES.md](PENDIENTES_REALES.md).

## Alcance y hallazgos adicionales

Se inventariaron **1.029 sesiones** del proyecto y se leyeron completas las **ocho conversaciones relevantes: 2.471 mensajes y 3.265.787 caracteres**, incluidos resultados de herramientas. Son las seis campañas musicales, la reparación de imágenes y la auditoría posterior. No se enviaron órdenes a las terminales de Hermes. Los resúmenes de agentes no se tomaron como prueba de cambios en la base.

El [análisis previo](ANALISIS_PREVIO.md) y [registro de sesiones](SESIONES.md) documentan lo que apareció además del listado recibido: títulos recuperables en otras tablas, continuidad de identidades no aplicada, imágenes omitidas, un libro completo sin descargar, audios directos pendientes, más páginas OCR débiles, índices de comentarios/enlaces y alertas antiguas que ya podían conciliarse.

## Cambios propios comprobados

| Operación de esta campaña | Resultado |
| --- | ---: |
| Revisiones cerradas con resolución | {closed} |
| Artistas nuevos | {number('public.artists')} |
| Identidades de fuente conciliadas con su vínculo nativo | {len(identities)} |
| Discos nuevos / discos inválidos retirados | {number('public.albums')} / {number('public.albums','D')} |
| Membresías históricas con personas ya existentes | {number('public.artist_members')} |
| Documentos nuevos de artista | {number('media.artist_documents')} |
| Imágenes nuevas de galería | {number('media.artist_gallery')} |
| Referencias de canción insertadas, antes de consolidar | {claims_inserted} |
| Copias auxiliares consolidadas conservando el original y evidencia | {claims_removed} |
| Referencias de canción nuevas netas | {claims_inserted-claims_removed} |
| Originales nuevos registrados / originales anteriores reutilizados | 560 / 36 |
| Unidades nuevas de lectura documental | 197 |

El núcleo derivó además `is_venezuelan=true` para tres personas sin dato previo al añadir membresías. Es la regla existente de `src/merge/venezuelan.ts`, solicitada anteriormente por Brian; no procede de inferir nacionalidad en estos PDF. Las ediciones y el detalle de los cambios de campos están en el diario.

La deduplicación de canciones detectó un fallo del escritor al repetir un registro con metadatos distintos: ya existía su identidad, pero cambiaba el hash. Se consolidaron únicamente las 137 copias creadas en este cierre, conservando los claims anteriores y reuniendo su evidencia. El escritor ahora comprueba y bloquea por identidad documental. La comparación final de metadatos ignora el orden de claves JSON.

### Venezuela Demo

Se corrigió un segundo fallo del parser: dos columnas de discografía se unían en un título. La relectura de 310 fichas pasó de **790 a 838 referencias discográficas**, con ocho perfiles afectados. Se retiraron seis títulos compuestos falsos de Dionisio Bolívar y Serenata Guayanesa, conservando su historia y ocultando los documentos públicos inválidos; las referencias correctas se incorporaron o conciliaron individualmente.

El parser conserva por separado título promocional, créditos, producción, grabación y contactos. Una fecha de grabación en prosa no se convierte en año de edición. La última revisión corrigió también la continuación de instrumentos de José Diego «El Picure» Boscán: «bongó, güira, güiro, campana, bombak» pertenece a su rol y no es otra persona. Se conservaron las 310 relecturas de integrantes en [vd-integrantes-relectura.jsonl](vd-integrantes-relectura.jsonl).

Se confirmaron **39 identidades adicionales de Venezuela Demo**, reutilizando fichas existentes mediante repertorio o alineaciones concretas. Se añadieron **54 membresías históricas** con personas ya acreditadas en grabaciones del mismo artista; se excluyeron invitados y acompañamientos que no acreditaban pertenencia. Se conservaron contactos y créditos como hechos documentales pendientes de valoración, sin convertir cada correo en un contacto vigente.

Los límites de recuperación anteriores siguen documentados: 132 PDF del índice sin copia utilizable y 477 clips no recuperados del archivo. No se inventaron documentos ni audio para llenar esos huecos.

### MP3.com

Se reutilizó inicialmente la continuidad de **175 perfiles** con páginas históricas ya documentadas. La última conciliación resolvió otros diez perfiles por integrantes o repertorio: The Art of Jor, Skandalo Trivial, Dralion, Verona, HojillaBeat, ResistCode, Yaguar, Iv2000, Lunatenebra y Andreazulado. Sus ubicaciones en MP3.com no sustituyeron los orígenes del catálogo.

Se recuperaron los **49 títulos** vacíos del derivado de canciones desde las referencias primarias de discografía: las 951 filas del derivado corregido tienen título. Eso no recupera las **51 fichas de canción ausentes** del archivo; son problemas diferentes. Las referencias sin orden de edición permanecen como claims y no crean pistas.

Los **92 casos históricos** tienen decisión individual en [MP3_92_CASOS.md](MP3_92_CASOS.md): dos bandas distintas creadas, 24 casos vinculados a fichas existentes, 33 menciones contextuales que no prueban origen, dos propuestas de artista descartadas y **31 casos que siguen necesitando evidencia de identidad**.

Las nuevas bandas son **Boston Rex and The Fairlanes #7977**, diferenciada del proyecto solista Boston Rex, y **Son Boulevard #7978**, diferenciada de Boulevard de Mérida. Sus músicos, historia y grabaciones están documentados en los perfiles. **BIOTECH #7652 se corrigió a banda**; su posible fusión con Bio Tech #7649 sigue sin prueba suficiente.

Las 617 rutas de imágenes representan 479 hashes distintos. Se recorrieron los archivos completos y se incorporaron imágenes identificadas que faltaban, con deduplicación por artista y hash. La revisión final de las diez identidades desbloqueó otras cuatro imágenes: **355 hashes distintos están representados en galería; 124 quedan sin identidad confirmada**. La cobertura y los recibos están en `mp3-galeria-cobertura.json` y `gallery-applied.jsonl`. Las 43 webs antes marcadas `verified` indebidamente ya quedaron sin esa afirmación en la reparación anterior; no se restauró esa marca por haber una URL. Los grupos discográficos sin título siguen como agrupaciones documentales, sin contarlos como discos.

### Fanzines y libro completo

Las **224 filas son 220 artistas**, no 224 fichas con ciudad/año explícitos. Se resolvieron los **329 campos propuestos**: cuatro ciudades aplicables, 206 sin afirmación suficiente, 111 correspondientes a otro sujeto y ocho excluidos. No se rellenaron años con fechas de conciertos o publicaciones. Las decisiones por artista están en [FANZINES.md](FANZINES.md).

Se revisaron **86 hechos sobre integrantes**: 60 concordaban con relaciones existentes, nueve se rechazaron por no acreditar membresía y 17 siguen pendientes. Tres hechos escalares ya coincidían con el catálogo y se conciliaron sin modificar valores. Sentimiento Muerto 1981 permanece en conflicto con el año nativo y la referencia a proyectos predecesores.

Se descargó completo **Educación Anterior** (52.672.319 bytes; 127 páginas, MAC de MEGA validado) y la copia del coeditor PROVEA (30.863.026 bytes). Son dos copias de la misma obra, no dos corroboraciones independientes. Se añadieron **22 documentos con 37 referencias discográficas literales** del libro y un documento sobre la reseña de Víctimas de la Democracia.

El libro y la identidad/repertorio ya documentados permitieron completar dos ciudades más: **Holocausto → Caracas** y **Disentir → Mérida**. Las dos biografías nativas ya situaban su formación en esas ciudades; la ciudad de una entrada discográfica aislada no se tomó como fecha o lugar de formación. En total se completaron seis ciudades, todas antes vacías.

Se reprocesaron **66 páginas débiles distintas**, procedentes de 80 filas con repeticiones, a 300 dpi con Tesseract español/inglés y dos modos de segmentación. Se conservaron alternativas y confianza; una portada, página vacía o texto OCR plausible no se convirtió automáticamente en un dato verificado.

### Recuperaciones nuevas de audio y contexto

| Fuente | Recuperación comprobada |
| --- | --- |
| Tumblr directo | 76 MP3 distintos, 428.207.187 bytes; 125 URL intentadas |
| SoundCloud | 93 audios distintos, 360.859.437 bytes; 431 URL incluyendo 43 pistas de cinco conjuntos |
| Bandcamp + streams directos de Barraezo | 357 recuperaciones por URL, 341 MP3 distintos por hash, 2.273.773.788 bytes |
| Víctimas de la Democracia, Julius Pub | RAR de 56.695.692 bytes, CRC correcto; 16 MP3 válidos, 3.571,8 segundos |
| Otras referencias Mediafire de Barraezo | Cuatro RAR íntegros recuperados; conservados como contexto, sin dar de alta artistas extranjeros como venezolanos |

Las sumas por proveedor no se presentan como un total global de archivos únicos: el mismo audio puede estar en más de una fuente. Los archivos de Víctimas tienen numeración original 1–8 y 12–19; no se inventaron 9–11, títulos de canciones ni año exacto. La fuente es una **reseña** de concierto de Exilio Interior, no una entrevista.

Los resultados de descarga separan recuperación, error HTTP, bloqueo y contenido que no era audio. Un 502 o una espera agotada no se declaró desaparición permanente. Se intentaron las pistas expandidas de los cinco conjuntos SoundCloud detectados; no quedaron pistas de esos conjuntos sin intentar.

Se indexaron los **1.299 comentarios de Barraezo** y **1.037 enlaces externos de Tumblr** como contexto, con correo redactado en el índice legible de comentarios. Los comentarios no se trataron como hechos verificados. Las recopilaciones de Barraezo y los reproductores repetidos siguen necesitando atribución por contenido; la URL de un reproductor reutilizado no acredita al artista del título del post.

Goear tiene 364 embeds, 362 URL distintas y 361 rutas canónicas. Su DNS directo falló. El CDX de Wayback devolvió 4.176 registros de playlists, con 165 coincidencias de origen; la primera reproducción devolvió **429 y un bloqueo explícito de tráfico automatizado**. Se conservó el recibo y se detuvo la reproducción: 165 coincidencias del índice no equivalen a 165 audios recuperados.

## Límites pendientes de evidencia

- MP3.com: 31 de los 92 expedientes siguen sin segundo eje suficiente; las decisiones conservan las razones y las citas descartadas por no ser literales. No se duplicaron fichas para sortear las dudas.
- Bio Tech/BIOTECH: el tipo de BIOTECH está corregido, pero dos páginas, una ciudad y títulos parecidos no prueban que ambas fichas sean la misma banda.
- Alter Ego #1686 conserva una mezcla previa de biografía venezolana y discografías homónimas extranjeras. El dossier primario de Roman Flügel documenta uno de esos homónimos, pero no identifica por sí solo cada edición mezclada. No se hizo una separación masiva sin fuente por lanzamiento.
- Suei es un artista moderno real; una coincidencia OCR no acredita su participación en la escena punk histórica. La mención política de Nicolás Maduro tampoco acredita una actividad musical en ese fanzine; su ficha musical preexistente no se eliminó por esa mención.
- Fanzines: 17 hechos de membresía siguen pendientes. Fechas de actividad, conciertos, ediciones, contactos o citas sobre otra banda no rellenan formación o ciudad.
- Tumblr/audiovisuales: las asociaciones ambiguas y los vídeos sin confirmación API reproducible permanecen en revisión. Se comprobaron los bloqueos previos: **77 audiovisuales y 29 enlaces retirados no se restauraron**.
- RadioLAE: el contraste previo de 1.059 filas solo confirmó cinco coincidencias por identidad y repertorio; 621 candidatos siguen sin identificación suficiente. No se inventó el episodio 007.
- Descargas y archivo: quedan respuestas no disponibles o bloqueadas, los huecos documentados de Venezuela Demo y el bloqueo de Wayback para Goear. Sus recibos están conservados.

La cola actual de estas campañas tiene **{len(reviews)} filas abiertas**. Incluye pistas, ediciones, personas, imágenes, vínculos y atribuciones; no son {len(reviews)} artistas sin importar. Se cerró lo probado y se mantuvieron las restricciones sobre el resto. Hay campañas de otros procesos que no pertenecen a este cierre; no se publicaron ni se eliminaron sus archivos de staging.

## Estado actual del catálogo

| Tabla / contenido | Filas al corte |
| --- | ---: |
| Artistas | {counts['artists']} |
| Discos | {counts['albums']} |
| Pistas | {counts['tracks']} |
| Personas | {counts['persons']} |
| Membresías | {counts['members']} |
| Documentos de artista | {counts['documents']} |
| Galería | {counts['gallery']} |
| Audiovisuales | {counts['audiovisuals']} |
| Redes sociales | {counts['socials']} |
| Enlaces de medios | {counts['mediaLinks']} |

Estos son conteos globales en un instante. Otros procesos pueden modificar el catálogo; la diferencia global entre dos cortes no se atribuye automáticamente a esta campaña. Sus efectos propios se calculan con los **{len(v['runIds'])} runs confirmados** y los resultados de cada operación. Los INSERT de claims se contabilizan desde los recibos del escritor porque su diario no registra esos INSERT como registra las bajas y actualizaciones.

## Conservación y verificación

La campaña de datos se publicó desde SSD al almacén de 1 TB: **1.263 archivos, 3.559.517.166 bytes, todos comprobados por SHA-256**. El manifiesto lógico contiene {package['originalCaptures']} referencias a originales, {package['distinctOriginalHashes']} hashes de original distintos y {package['readings']} unidades de lectura. De esas referencias se registraron 560 capturas nuevas y se reutilizaron 36 anteriores cuyo archivo y hash se comprobaron. El número de referencias, los archivos físicos y los documentos nativos son medidas diferentes.

Ruta de datos: `data/research/hermes-cierre-profundo-2026-10-24`. Publicación documentada en [publicacion-datos.log](publicacion-datos.log). Los informes se preparan igualmente en SSD y se publican al cerrar.

La verificación final encontró **cero** duplicados nuevos de artistas/discos, identidades documentales de canción o imágenes por artista/hash; cero exclusiones editoriales tocadas; cero restauraciones de vínculos retirados; cero discos inválidos todavía presentes o documentos inválidos públicos; cero citas nuevas que no existan literalmente en su evidencia. Las **197 lecturas** conservan archivo, tamaño y hash correctos. Pasaron **ocho pruebas del parser, TypeScript y ESLint**. Se comprobaron los archivos de las {number('media.artist_gallery')} imágenes nuevas y seis muestras HTTP respondieron 200 con el contenido y hash esperados. La repetición final de la conciliación de canciones produjo cero cambios. Los resultados están en [validacion-codigo.json](validacion-codigo.json), [galeria-verificacion.json](galeria-verificacion.json) y [api-verificacion.json](api-verificacion.json).

## Archivos de consulta

- [Artistas, datos actuales, cambios y fuentes](ARTISTAS_Y_FUENTES.md).
- [Sesiones leídas y alcance](SESIONES.md) y [hallazgos antes de aplicar](ANALISIS_PREVIO.md).
- [92 decisiones MP3.com](MP3_92_CASOS.md) y [220 expedientes de fanzines](FANZINES.md).
- [Pendientes reales agrupados](PENDIENTES_REALES.md) y [filas abiertas](revisiones-abiertas-final.json).
- [Verificación PostgreSQL, runs e invariantes](verificacion-final.json) y [hashes de lecturas](verificacion-lecturas.json).
- [Corte de artistas y cambios usados para el MD](artistas-estado-final.json).
- [Informe de la importación integral anterior](../hermes-importacion-integral-2026-10-24/INFORME.md).

Cada `*-applied.jsonl` conserva run, clave documental, IDs y resultado real. Las propuestas automáticas y los probes no se cuentan como aplicación. El código del parser y de los escritores permanece en el repositorio para repetir la extracción sin crear duplicados.
'''
    (REPORT / 'INFORME.md').write_text(report)
    print(json.dumps({'artists': len(state['artists']), 'reviewsClosed': closed,
                      'nativeAlbumsInserted': number('public.albums'), 'nativeAlbumsRemoved': number('public.albums', 'D'),
                      'nativeDocuments': number('media.artist_documents'), 'identityDecisions': len(identities),
                      'pendingReviews': len(reviews), 'checks': checks}, ensure_ascii=False))


if __name__ == '__main__':
    main()
