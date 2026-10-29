"""Cierra el lote documental sin presentar las sugerencias como hechos nuevos."""
import os, json, pathlib, collections, datetime, shutil, hashlib

out = pathlib.Path(os.environ['WAYBACK_OUT'])
before = json.loads((out / 'antes.json').read_text())
plan = json.loads((out / 'biografias-aprobadas.json').read_text())
verification = json.loads((out / 'verificacion.json').read_text())
assert not verification['failures']

# Una decisión por cada sugerencia original, en su orden original.
# I=integrado, C=cubierto, F=conflicto, R=relativo sin fecha, A=anuncio,
# P=parcial, D=identidad, U=atribución ambigua, V=contexto vago preservado.
codes = {
 55:'ICC',7001:'C',1946:'CCCCIIIF',7024:'C',574:'IIIIPIIIIII',7037:'C',2091:'III',
 7064:'R',7066:'C',1243:'II',7076:'C',67:'IA',1226:'FII',7146:'C',1662:'I',507:'III',
 7171:'C',3057:'P',571:'IIIIIFII',3058:'RDDDRD',121:'I',7229:'C',7231:'C',1589:'II',
 131:'FF',3066:'I',466:'II',599:'C',1456:'F',4578:'IIIII',7259:'CC',7284:'C',7293:'C',
 7294:'C',224:'I',1247:'FP',237:'FU',7380:'R',1047:'IIP',1393:'C',1089:'A',7421:'IF',
 1210:'UI',7434:'C',7457:'I',7343:'C',1529:'VII'
}
labels = {'I':'integrado-biografia','C':'ya-cubierto','F':'conflicto-pendiente',
          'R':'fecha-relativa-preservada','A':'anuncio-preservado',
          'P':'integracion-parcial','D':'identidad-pendiente',
          'U':'atribucion-ambigua','V':'contexto-vago-preservado'}
reasons = {
 'I':'Incorporado con la formación o etapa documentada, sin crear vínculos de personas por coincidencia de nombres.',
 'C':'El dato ya estaba en la biografía o en los campos de origen; la clasificación histórica permanece en su documento.',
 'F':'Hay versiones incompatibles o falta identificar la edición; se conservan las fuentes y no se elige una por mayoría.',
 'R':'La edad de la banda o del cambio es relativa a una redacción sin fecha: la captura no demuestra la fecha de escritura.',
 'A':'La fuente acredita un anuncio o invitación, sin demostrar celebración, participación ni publicación efectiva.',
 'P':'La sugerencia reúne datos de distinto alcance: se conserva lo respaldado y se registra lo que aún requiere contraste.',
 'D':'Los nombres parciales, la ubicación o la formación requieren corroborar la identidad antes de ampliar o fusionar la ficha.',
 'U':'La formulación automática interpreta un nombre o crédito ambiguo como identificación comprobada; se conserva el literal.',
 'V':'La fuente no identifica los disturbios ni proporciona fecha: el contexto literal queda en el documento sin inventar un acontecimiento.'
}
specific = {
 (55,0):'Corregido Frank Pulgar: guitarra, no teclados; coinciden la ficha histórica y la nota de prensa de 2008.',
 (1946,7):'La fuente histórica da Stress por terminado, mientras la biografía lo describe inconcluso; el cómic anunciado no prueba su publicación.',
 (574,4):'Se integraron los sellos del EP de 2000. Creados en la fuente frente a Creadores en la biografía sigue pendiente; no se cambió el título del disco.',
 (67,1):'La noticia anuncia un miércoles 20 de junio en Zaro’s Pub. Se conserva como anuncio, sin convertirlo en concierto confirmado ni asignar año por calendario.',
 (1226,0):'La fuente primaria afirma formación formal en diciembre de 2001 y debut en 2002; Sincopa da 2002. Se conserva el campo hasta contrastar el alcance.',
 (3057,0):'Se integraron Iron Maiden, Stratovarius y Rata Blanca. La variante Sonata artica se conserva literalmente en el documento, pendiente de normalización.',
 (571,5):'La crónica dice tercer puesto en la cuarta edición; la biografía dice cuarto puesto. Pendiente de corroboración independiente.',
 (571,6):'Renacer se integró como proyecto anunciado de ocho temas; no se creó un disco publicado.',
 (466,1):'Se eliminó la limitación falsa a 2010–2012. El anuncio para 2003 se distingue de Mil Estaciones (2011); no se calculó un año a partir de tres años y medio.',
 (1247,1):'Las influencias siguen en el documento y aún requieren incorporación editorial: el literal contiene abreviaturas y errores, sin vínculos de artista inferidos.',
 (237,1):'Craights Brothers permanece como literal; no se reemplazó automáticamente por Craig’s Brother.',
 (1047,2):'Se integró la participación en Alma Mater Rock; viernes 6 de junio queda conservado sin asignar año por la fecha de captura.',
 (1089,0):'Se integró expresamente como invitación de Pepedote Records, no como participación confirmada en una edición.',
 (7421,1):'La clasificación Caracas del archivo contradice el origen merideño descrito en su propio texto. No se sustituyó el origen.',
 (1210,0):'Ex-PDVSA no demuestra pertenencia a una banda llamada PDVSA. No se creó relación musical ni se añadió esa afirmación a la biografía.',
}
facts = []
for candidate in before['candidates']:
    aid = candidate['artistId']
    if not candidate['missingFacts']:
        continue
    states = codes[aid]
    assert len(states) == len(candidate['missingFacts']), aid
    for index, (fact, state) in enumerate(zip(candidate['missingFacts'], states)):
        facts.append(dict(artistId=aid, name=candidate['name'], index=index, **fact,
                          disposition=labels[state], reason=specific.get((aid,index), reasons[state])))
assert len(facts) == 102
counts = dict(collections.Counter(f['disposition'] for f in facts))
(out/'revision-102-sugerencias.json').write_text(json.dumps(facts,ensure_ascii=False,indent=2))

pending = before['ledger']
pending['phase'] = 'wayback-finalizacion-3-2026-10-25'
pending['status'] = 'active'
pending['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
pending['biographyAudit'] = {
 'originalCandidateArtists':len(before['candidates']),
 'artistsWithSuggestedMissingFacts':len(codes),'suggestedMissingFacts':len(facts),
 'manualFactDispositions':counts,'updatedArtistsThisPhase':len(plan),
 'note':'Las 102 sugerencias se revisaron por su alcance. La revisión de las contradicciones de los 94 candidatos sigue abierta; actualizar una biografía no cierra todos sus conflictos.',
 'file':'revision-102-sugerencias.json',
 'originalCandidatesFile':'biografias-candidatas-conservadas.json'
}
pending['additionalCasesFoundInPhase3'] = [
 {'artistId':1226,'case':'Embas: formación formal diciembre de 2001 frente a 2002; debut en Alma Mater 2002 es un dato distinto.'},
 {'artistId':1662,'case':'Exilio: demo Durmiendo entre ausentes ya descrito en captura de 2004 frente a disco catalogado en 2006; falta distinguir grabación y edición.'},
 {'artistId':571,'case':'Incendiario: tercer puesto de la cuarta edición frente a cuarto puesto en biografía.'},
 {'artistId':574,'case':'@patia No: Creados / Creadores para la paz; título exacto de edición pendiente.'},
 {'artistId':1247,'case':'Skatz: nacimiento 2000 en ficha histórica frente a 2001 en biografía.'},
 {'artistId':7421,'case':'V’lis: cuerpo de texto Mérida frente a clasificación Caracas; inicios de los noventa frente a campo 1996.'},
 {'artistId':1946,'case':'Fractaler: Stress terminado en fuente histórica frente a inconcluso en biografía.'},
 {'artistId':131,'case':'La Hermandad: álbum sin título grabado en 2000 con Leonardo Small; no asignarlo arbitrariamente a Jai ni Criminal Love.'}
]
(out/'PENDIENTES.json').write_text(json.dumps(pending,ensure_ascii=False,indent=2))
(out/'biografias-candidatas-conservadas.json').write_text(json.dumps(before['candidates'],ensure_ascii=False,indent=2))
summary = {'updatedArtists':len(plan),'newArtists':0,'factDispositions':counts,
           'checks':verification,'remainingOriginalYears':len(pending['pendingOriginalYears']),
           'remainingHistoricalAudiovisuals':len(pending['pendingHistoricalAudiovisuals']),
           'originalSourceConflictsStillOpen':len(pending['sourceConflictDocuments'])}
(out/'RESUMEN.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
lines = ['# Continuación de Wayback: biografías, 25 de octubre de 2026','',
 'Se actualizaron **23 artistas existentes** mediante operaciones nativas auditadas (runs 33740–33762). No se crearon artistas en este lote.',
 '', 'Las 102 sugerencias de información faltante se revisaron por alcance; no equivalen a 102 omisiones probadas. Las decisiones individuales, sus razones y las citas originales están en `revision-102-sugerencias.json`.', '']
lines += ['- '+k+': '+str(v) for k,v in counts.items()]
lines += ['', '## Cambios', '',
 'Se corrigió el instrumento de Frank Pulgar en Candy 66 y la limitación de actividad de Languidez a 2010–2012. Se completaron formaciones históricas, estudios de grabación, giras y actividades. Cerouno conserva la distinción entre el trío documentado en 2004 y el dúo posterior. Los nombres parciales se incorporaron como créditos literales de época, sin fusionar personas.',
 '', 'Los anuncios de Renacer y del primer disco de Languidez se describen como anuncios. La invitación de Pepedote Records se distingue de una participación confirmada. No se convirtieron esos textos en discos publicados ni en efemérides verificadas.', '',
 'Artistas modificados: '+', '.join(r['name']+' ('+str(r['artistId'])+')' for r in plan)+'.', '',
 '## Verificación', '',
 'Sin fallos en la comparación de 108 artistas y 424 documentos. Los 439 discos, 646 vínculos de integrantes y 350 efemérides de la instantánea conservaron su contenido. Las 23 fichas respondieron HTTP 200 con la biografía esperada y el documento visible en la API pública. `verificacion.json` conserva el detalle.', '',
 'TypeScript pasó (`npm run typecheck`). Se corrigieron dos accesos a propiedades de un Record en `scripts/rhv-directorio-absorb.mts` mediante notación de corchetes; no se ejecutó ese importador.', '',
 '## Pendientes', '',
 'El encargo global sigue abierto. Permanecen los 22 casos de año original, 4 audiovisuales históricos sin reproducción confirmada, 29 avisos originales de conflicto, créditos ambiguos y la auditoría de procedencia de cronologías. Además se registraron las discrepancias detectadas en este lote. Los 94 candidatos biográficos originales se conservan: revisar los hechos faltantes no implica haber resuelto todas sus contradicciones.', '',
 'Las capturas bloqueadas y la página actual de MusicaVenezuela que devuelve la portada se conservaron como resultados de consulta, sin usarlas como prueba histórica. Las biografías aprobadas guardan hashes del HTML original y evidencia adicional cuando se utilizó.', '']
(out/'INFORME.md').write_text('\n'.join(lines))
code=out/'scripts';code.mkdir(exist_ok=True)
for source in pathlib.Path('scripts/wayback-fuentes-2026-10-22').glob('cierre3-*'):
    shutil.copy2(source,code/source.name)
manifest=[]
for file in sorted(out.rglob('*')):
    if file.is_file() and file.name!='manifest-sha256.json':
        manifest.append({'path':str(file.relative_to(out)),'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'bytes':file.stat().st_size})
(out/'manifest-sha256.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'updatedArtists':len(plan),'factDispositions':counts,'files':len(manifest)},ensure_ascii=False))
