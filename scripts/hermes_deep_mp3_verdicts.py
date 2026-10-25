"""Conciliación individual de los 92 casos, con auditoría de citas y límites explícitos."""
import collections
import json
import os
import pathlib
import re
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ['HERMES_DEEP_DATA']);REPORT=pathlib.Path(os.environ['HERMES_DEEP_REPORT'])
def read(p):return list(map(json.loads,p.read_text().splitlines()))
tasks={r['key']:r for r in read(OUT/'mp3-92-tasks.jsonl')};proposals={r['key']:r for r in read(OUT/'mp3-92-proposals.jsonl')}
bindings={r['source_key']:r['artist_id']for r in json.loads((OUT/'relationships.json').read_text())['bindings']}
manual={r['key']:r for r in read(OUT/'plan-mp3-manual-artists.jsonl')}
assert len(tasks)==len(proposals)==92
rows=[]
for key,task in tasks.items():
    p=proposals[key];text=task['primary']['text'];quotes=[q for q in [p['originQuote'],p['relationQuote'],*[q['quote']for q in p['identityProofs']]]if q]
    audit=[{'quote':q,'literal':q in text}for q in quotes]
    status='needs_identity_evidence';reason='El perfil no ofrece ejes suficientes para atribuirlo a otra ficha, y el parecido de nombre no permite crear ni fusionar automáticamente.'
    if key in bindings:
        status='bound_existing';reason='La página está vinculada a una ficha nativa. Se conserva la identidad y la procedencia; ubicación actual, giras e influencias no sustituyen origen.'
        if key in manual and manual[key]['decision']=='new':status='distinct_group_created';reason=manual[key]['editorialDistinctArtist']['reason']
    elif p['entityKind'] in ['label','historical_person']:
        status='reject_artist_proposal';reason='La fuente describe un sello o personaje histórico y no identifica un intérprete musical verificable para darlo de alta como artista. Conservar archivo y contexto.'
    elif task['tier']=='C' and p['venezuelaRelation']in ['performance','influence','publication','incidental']:
        origin=re.search(r'(?i)(?:born|native|naci[oó]|nacida|founded|formad[ao]|cread[ao]|started)[^\n.]{0,100}(?:Venezuela|Caracas|Maracaibo|M[eé]rida|Barquisimeto)',text)
        if not origin and p['relationQuote'] and p['relationQuote']in text:
            status='context_only_no_origin_assertion';reason='La mención venezolana es una gira, influencia, edición, nombre o contexto. La captura no afirma origen venezolano del sujeto; se cierra la propuesta de alta derivada de esa mención y se conserva el documento.'
    rows.append({'sourceKey':key,'name':task['name'],'tier':task['tier'],'artistId':bindings.get(key),'decision':status,'reason':reason,'sourceUrl':task['primary']['url'],'relation':p['venezuelaRelation'],'quoteAudit':audit,'proposal':p})
(OUT/'mp3-92-decisions.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n'for r in rows))
summary={'cases':len(rows),'decisions':dict(collections.Counter(r['decision']for r in rows)),'quotesChecked':sum(len(r['quoteAudit'])for r in rows),'nonliteralQuotes':sum(not q['literal']for r in rows for q in r['quoteAudit'])}
(OUT/'mp3-92-summary.json').write_text(json.dumps(summary,indent=2))
lines=['# Decisiones de los 92 expedientes históricos de MP3.com','',json.dumps(summary,ensure_ascii=False),'','Una decisión de contexto no afirma que el artista sea extranjero: afirma que esta captura no demuestra origen venezolano. Las citas no literales del modelo no se aplican. No se confunde localización con origen.','','| Nombre | Decisión | Ficha | Fuente |','| --- | --- | ---: | --- |']
for r in rows:lines.append('| '+r['name'].replace('|','/')+' | '+r['decision']+' | '+str(r['artistId']or'—')+' | [perfil]('+r['sourceUrl']+') |')
(REPORT/'MP3_92_CASOS.md').write_text('\n'.join(lines)+'\n')
print(json.dumps(summary))
