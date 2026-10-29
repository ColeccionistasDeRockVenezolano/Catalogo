import os,json,pathlib,datetime,collections,shutil,hashlib
out=pathlib.Path(os.environ['WAYBACK_OUT'])
read=lambda name:json.loads((out/name).read_text())
before=read('antes.json');audit=read('auditoria-procedencia.json');applied=read('aplicado.json');v=read('verificacion.json')
assert not v['failures']
pending=json.loads(pathlib.Path('reports/wayback-finalizacion-3-2026-10-25/PENDIENTES.json').read_text())
pending.update(phase='wayback-finalizacion-4-2026-10-25',updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),status='active')
counts=dict(collections.Counter(a['decision'] for a in audit))
existing={int(a['id']) for a in before['artists']}
orphan=[int(e['id']) for e in before['events'] if int(e['original_artist_id']) not in existing]
pending['chronologySourceAudit']={
 'checkedEvents':len(before['events']),'checkedSourceReferences':len(audit),
 'dispositions':counts,'correctedAnachronisticAttributions':170,'correctedChronologies':75,
 'note':'La coincidencia literal no verifica automáticamente el año ni el hecho. Las 170 atribuciones se corrigieron, pero sus hechos siguen pendientes de corroboración externa. Las restantes 457 referencias sin coincidencia local requieren revisión; no equivalen a 457 errores probados.',
 'details':'auditoria-procedencia.json',
 'previousArtistIdsToResolve':{'2229':orphan},
 'previousArtistIdsNote':'Tres hitos de Rafael L. Garnica apuntan al identificador 2229, ausente de public.artists y con API 404. Falta resolver su identidad de destino mediante evidencia; no se reasignaron automáticamente a Submarino.'}
pending['provenanceAuditNext']='Revisar las 457 referencias restantes sin coincidencia literal local; corroborar externamente los hechos de las 170 atribuciones corregidas y resolver los tres hitos vinculados al antiguo artista 2229.'
(out/'PENDIENTES.json').write_text(json.dumps(pending,ensure_ascii=False,indent=2))
summary={'eventsReviewed':len(before['events']),'sourceReferencesReviewed':len(audit),'dispositions':counts,
         'correctedAttributions':170,'chronologiesCorrected':75,'affectedArtists':75,
         'newArtists':0,'changedBiographies':0,'runId':applied['runId'],
         'verificationFailures':v['failures'],'apiChecks':len(v['http']),
         'previousArtistReferencesStillPending':orphan}
(out/'RESUMEN.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
text='''# Corrección de procedencia de cronologías — 25 de octubre de 2026

Se revisaron 1.138 hitos y 1.139 referencias a fuentes de la campaña Wayback. Se corrigieron **170 atribuciones anacrónicas**, reflejadas también en las cronologías de **75 artistas**, mediante la operación nativa auditada 33764.

La decisión exigió simultáneamente una captura al menos dos años anterior al hecho descrito, disponer del HTML original local y comprobar que la cita no aparece en ese HTML. En 168 de los 170 casos, la frase atribuida al archivo sí aparece en la biografía actual del catálogo. Los otros dos casos se mantienen como afirmaciones del registro previo, sin convertir su procedencia en evidencia externa.

No se declara falso el hecho por fallar la atribución: se conservan sus títulos, descripciones, identidades, años y estado pendiente. La referencia ahora indica que procede de la ficha previa y que requiere corroboración externa. La atribución anterior, el hash del original y el motivo se conservan en la fuente y en las revisiones de los documentos.

Ejemplos corregidos: una captura de Arkangel de 2005 no acredita publicaciones de 2008, 2019 y 2021; una captura de Candy 66 de 2004 no acredita Evolutio (2009) ni Nueva Guerra (2013). La corrección afecta a la atribución y no modifica los discos.

## Alcance de la auditoría

- 512 referencias contienen una cita localizada literalmente, tras normalizar espacios, signos y acentos, en el HTML disponible. Esto no convierte automáticamente sus hechos en verificados.
- 170 referencias tenían la atribución anacrónica descrita y fueron corregidas.
- 457 referencias requieren revisión adicional: no se halló una coincidencia literal local o no se dispone del original correspondiente. No son 457 errores confirmados.

Se detectaron además tres hitos (1030–1032) vinculados al antiguo artista 2229, Rafael L. Garnica, cuya API devuelve 404. Su descripción menciona a Submarino, pero eso no basta para reasignarlos automáticamente a la banda. Quedan en la lista de resolución de identidad.

## Verificación

Sin fallos al cotejar los 1.138 hitos, 1.406 documentos y las identidades y biografías de 424 artistas de la instantánea. Las 75 fichas afectadas respondieron HTTP 200 y mostraron sus cronologías actualizadas. Los hitos fuera del lote permanecieron iguales; las cronologías conservaron todos sus hitos.

TypeScript pasó con `npm run typecheck`; el registro está en `typecheck.log`.

La tarea global sigue abierta. `PENDIENTES.json` continúa el registro del lote anterior e incluye los casos aún pendientes y el alcance preciso de esta revisión.
'''
(out/'INFORME.md').write_text(text)
code=out/'scripts';code.mkdir(exist_ok=True)
for file in pathlib.Path('scripts/wayback-fuentes-2026-10-22').glob('cierre4-*'):shutil.copy2(file,code/file.name)
manifest=[{'path':str(f.relative_to(out)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'bytes':f.stat().st_size}
          for f in sorted(out.rglob('*')) if f.is_file() and f.name!='manifest-sha256.json']
(out/'manifest-sha256.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps(summary,ensure_ascii=False))
