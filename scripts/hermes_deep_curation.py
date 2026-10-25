"""Decisiones revisadas: separa el texto de la fuente de propuestas automáticas."""
import collections
import json
import os
import pathlib
import re
import unicodedata

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ['HERMES_DEEP_DATA'])
REPORT=pathlib.Path(os.environ['HERMES_DEEP_REPORT'])
def read(p):return list(map(json.loads,p.read_text().splitlines()))
def write(name,rows):(OUT/name).write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in rows))
def norm(s):return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
db=json.loads((OUT/'catalogue.json').read_text());ctx=json.loads((OUT/'review-context.json').read_text())
tasks={r['artistId']:r for r in read(OUT/'fanzine-tasks.jsonl')}
proposals=read(OUT/'fanzine-proposals.jsonl')
captures={r['key']:r for r in read(ROOT/'data/research/hermes-importacion-integral-2026-10-24/captures.jsonl')}
# Lista revisada por Codex. Las otras propuestas explícitas no permiten aplicar un campo.
accepted={1537:('Caracas','fanzines:cap06_PDFs_Sub-suelo_Insurgente_Zine_2000_No7-RestoDelPais.pdf:3','11011 (Caracas)'),
317:('Cúa','fanzines:cap06_PDFs_Sub-suelo_Insurgente_Zine_1996_No2-RestoDelPais.pdf:5','D.H.D. (Cúa)'),
1067:('Caracas','fanzines:Cap.10_Neopunk-sin-vocacion-heroica_AV.docx:1','Por un lado de Caracas estaba Más quejas, Flat 72 y Kermit. Por otro, 7 Feet, The Go Go Punkers y Cricket 27.')}
vic=captures['fanzines:Cap.09_Sicario.-Cuando-el-hardcore-se-hizo-banda-sonora_AV.docx:1']['text']
hit=re.search(r'[^.\n]*conjunto punk hardcore caraqueño Víctimas de la Democracia[^.\n]*',vic)
if hit:accepted[1308]=('Caracas','fanzines:Cap.09_Sicario.-Cuando-el-hardcore-se-hizo-banda-sonora_AV.docx:1',hit.group())
overrides={1043:'La cita reproduce la biografía local y atribuye 2006 al proyecto precursor Mariapurizima; no hay evidencia de fanzine para la fundación de Vertigo.',
2463:'Solo biografía local: no es una nueva fuente independiente.',1866:'Solo biografía local: no es una nueva fuente independiente.',3370:'Solo biografía local: no es una nueva fuente independiente.',
1310:'Ciudad documentada en la discografía del libro; se incorpora con la captura nueva y no con la cita narrativa incompleta.',
1038:'La fuente dice Valles del Tuy, una región. Se conserva literal como contexto geográfico, sin convertirla en una ciudad.',
1631:'Ciudad documentada en la discografía del libro; se incorpora con la captura nueva, verificando repertorio.'}
verdicts=[];facts=[]
for proposal in proposals:
    task=tasks[proposal['artistId']];decisions=[]
    for field in task['missingFields']:
        proposed=next((d for d in proposal['decisions']if d['field']==field),None)
        proof=[]
        for d in (proposed or {}).get('proof',[]):
            source=next((e for e in task['evidence'] if e['key']==d['sourceKey']),None)
            literal=bool(source and any(d['quote'] in s['text']for s in source['snippets']))
            proof.append({**d,'literal':literal,'sourceExists':bool(source)})
        result={'field':field,'proposal':proposed,'proofAudit':proof,'disposition':'no_supported_assertion','reason':'Las capturas revisadas no afirman este campo para la identidad de la ficha; no se rellena con concierto, publicación, residencia ni coocurrencia.'}
        if task['excluded']:result.update(disposition='excluded',reason='Exclusión editorial vigente; ficha conservada sin modificaciones.')
        elif task['artistId'] in accepted and field=='origin_city':
            value,key,quote=accepted[task['artistId']]
            if quote not in captures[key]['text']:raise ValueError('Cita revisada no literal')
            facts.append({'key':'fanzine-deep:'+str(task['artistId'])+':'+field,'artistRef':'id:'+str(task['artistId']),'captureKey':key,'field':field,'value':value,'quote':quote,'apply':True})
            result.update(disposition='apply',value=value,proof=[{'sourceKey':key,'quote':quote}],reason='Ciudad afirmada para la banda en la fuente histórica; identidad coherente con la banda y su repertorio ya documentados.')
        elif task['artistId'] in overrides:result['reason']=overrides[task['artistId']]
        elif proposal['subjectVerdict']=='wrong_subject':result.update(disposition='wrong_subject',reason='La mención pertenece a otro sujeto o a prosa incidental; no autoriza datos musicales para la ficha.')
        decisions.append(result)
    verdicts.append({'key':task['key'],'artistId':task['artistId'],'name':task['name'],'evidenceDocuments':task['evidenceTotal'],'omittedEvidence':task['evidenceOmitted'],'decisions':decisions,
        'additionalProposals':proposal['additional'],'additionalDisposition':'Propuestas conservadas para contraste; no se importan sin revisión literal de sujeto, fecha y tipo de relación.'})
write('fanzine-verdicts.jsonl',verdicts);write('plan-fanzine-facts.jsonl',facts)
index=collections.defaultdict(set)
for p in db['persons']:index[norm(p['name'])].add(p['id'])
for p in db['personAliases']:index[norm(p['alias'])].add(p['person_id'])
excluded={a['id']for a in db['excluded']}
# Variantes históricas resueltas dentro de una membresía ya existente; no se crean personas.
manual={'18142':'16321','18168':'796','18179':'3280','18180':'16091','18181':'3283','18186':'4707','18219':'174','18226':'174','18207':'16931'}
invalid={'18154','18155','18194','18195','18196','18197','18198','18199','18200'}
member_decisions=[]
for f in ctx['facts']:
    if f['relation']!='documented_member':continue
    row={'factId':int(f['id']),'artistId':int(f['artist_id']),'name':f['value']['name'],'role':f['value']['role'],'disposition':'pending','reason':'Hace falta corroborar persona, sujeto de la cita o nombre incompleto; no crear homónimos.'}
    if f['artist_id'] in excluded:row['reason']='Exclusión editorial: conservar la evidencia sin modificar la ficha.'
    elif f['id'] in invalid:row.update(disposition='rejected',reason='La cita es un crédito editorial, autoría, contacto, participación invitada, metáfora o texto insuficiente; no demuestra pertenencia a la banda.')
    else:
        wanted={manual[f['id']]} if f['id']in manual else index[norm(f['value']['name'])]
        matches=[m for m in db['members']if m['artist_id']==f['artist_id'] and m['person_id']in wanted]
        if len(matches)==1:row.update(disposition='applied',personId=int(matches[0]['person_id']),reason='La relación histórica ya existe con la persona exacta de la banda; cita revisada. Se vincula la evidencia sin duplicar persona ni membresía.')
    member_decisions.append(row)
write('fanzine-member-decisions.jsonl',member_decisions)
summary={'artistsReviewed':len(verdicts),'fieldsReviewed':sum(len(r['decisions'])for r in verdicts),'fieldDecisions':dict(collections.Counter(d['disposition']for r in verdicts for d in r['decisions'])),'memberFactsReviewed':len(member_decisions),'memberDecisions':dict(collections.Counter(r['disposition']for r in member_decisions))}
(OUT/'fanzine-curation-summary.json').write_text(json.dumps(summary,indent=2))
lines=['# Revisión de los 220 expedientes de fanzines','',json.dumps(summary,ensure_ascii=False),'','Cada campo tiene decisión y evidencia en `fanzine-verdicts.jsonl`. Ausencia de afirmación no significa que el dato histórico sea desconocido en todas las fuentes. Las propuestas automáticas se conservaron, pero se descartaron pruebas que no existen literalmente o que solo reproducen la biografía local.','','| Artista | ID | Campos y decisión |','| --- | ---: | --- |']
for r in sorted(verdicts,key=lambda r:r['name'].casefold()):lines.append('| '+r['name'].replace('|','/')+' | '+str(r['artistId'])+' | '+'; '.join(d['field']+': '+d['disposition']+((' → '+str(d['value']))if 'value'in d else '')for d in r['decisions'])+' |')
(REPORT/'FANZINES.md').write_text('\n'.join(lines)+'\n')
print(json.dumps(summary))
