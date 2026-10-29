"""Agrupa revisiones sin fusionar identidades ni cambiar sus estados en la BD."""
import collections
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata

DATA=Path(os.environ['ALTER_DATA']);REPORT=Path(os.environ['ALTER_REPORT'])


def norm(s):
    return re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(s or '')).encode('ascii','ignore').decode().lower()).strip()


def urls(value):
    result=set()
    if isinstance(value,dict):
        for key,item in value.items():
            if key.lower().endswith(('url','source')) and isinstance(item,str) and item.startswith(('https://','http://')):result.add(item)
            elif key not in ['biography','content','text','quote','proofs']:result.update(urls(item))
    elif isinstance(value,list):
        for item in value:result.update(urls(item))
    return result


def source_key(record):
    if record.get('captureKey'):return record['captureKey']
    data=record.get('data')or{}
    if isinstance(data,dict)and data.get('artistKey'):return data['artistKey']
    ref=record.get('artistRef','')or''
    if ref.startswith('source:'):return ref[7:]
    key=record.get('key','')
    if key.startswith('artists:'):return key[8:]
    source=record.get('sourceRecord')or{}
    if source.get('page'):return 'mp3com:'+source['page']
    match=re.search(r'((?:venezuelademo|mp3com|tumblr|barraezo):[^:]+)',key)
    if match:return match.group(1)
    return None


def kind(record,note):
    key=record.get('key','')
    if 'homonym'in key or 'homónimo'in note.lower() or 'identidad caraqueña'in note.lower():return 'identidad'
    if record.get('withdrawKind')=='video' or 'audiovisual'in note.lower():return 'audiovisual'
    if record.get('withdrawKind')=='link' or 'audio histórico'in note.lower():return 'audio'
    if key.startswith(('artists:','identity:'))or 'identidad no confirmada'in note.lower():return 'identidad'
    if 'persona'in note.lower()or key.startswith(('members:','person:')):return 'integrante'
    if 'galer'in note.lower()or record.get('sha256'):return 'imagen'
    if 'pista'in note.lower()or key.startswith('tracks:'):return 'pista'
    if record.get('tracks')is not None or key.startswith('attribution:') or 'edici'in note.lower():return 'edición'
    if 'cita'in note.lower()or 'fragmento'in note.lower():return 'evidencia'
    if key.startswith('songs:'):return 'canción documental'
    return 'otros'


NEEDED={
 'identidad':'Nombre/alias y un segundo eje específico: integrantes con rol, edición con sello/año o vínculo oficial; al menos una fuente primaria.',
 'integrante':'Nombre o alias de la persona, función y pertenencia expresa a esta banda; distinguir miembro, invitado, técnico y homónimo.',
 'edición':'Titularidad, título, año y sello o número de catálogo de esta edición; distinguir participación, recopilación y reedición.',
 'pista':'Lista de la edición concreta con título y posición explícitos; no deducir orden o duración.',
 'canción documental':'Título literal y dueño documentado; para convertirla en pista hace falta además edición y orden.',
 'audiovisual':'Identidad del artista en la pieza concreta y estado public/unlisted + embeddable confirmado por la API de YouTube.',
 'audio':'Intérprete y publicación de la grabación concreta mediante créditos, etiquetas, presentación o fuente primaria; un título de post no basta.',
 'imagen':'Pie, crédito o contexto primario que identifique al dueño; distinguir imagen relacionada, retrato y portada.',
 'evidencia':'Cita literal localizada en página/fragmento y sujeto inequívoco; comprobar la imagen original si el OCR es dudoso.',
 'otros':'Consultar motivo original y evidencia enlazada; una coincidencia de nombre no aprueba la relación.'}


def main():
    state=json.loads(Path(os.environ.get('ALTER_SNAPSHOT',str(DATA/'snapshot.json'))).read_text())
    repaired=os.environ.get('ALTER_REPAIRED')=='1'
    captures={}
    for campaign in ['hermes-importacion-integral-2026-10-24','hermes-agotamiento-adicional-2026-10-24','hermes-cierre-profundo-2026-10-24']:
        file=Path('data/research')/campaign/'captures.jsonl'
        if file.exists():captures.update({c['key']:c for c in map(json.loads,file.read_text().splitlines())})
    artists={str(a['id']):a for a in state['allArtists']}
    excluded_ids={str(a['artist_id'])for a in state.get('excluded',[])}
    excluded_names={norm(a['name'])for a in state.get('excludedNames',[])}
    names=collections.defaultdict(set)
    for a in artists.values():names[norm(a['name'])].add(str(a['id']))
    for a in state['aliases']:names[norm(a['alias'])].add(str(a['artist_id']))
    bound=collections.defaultdict(set)
    for b in state['bindings']:bound[b['source_key']].add(str(b['artist_id']))
    groups={};reverse=[]
    for review in state['reviews']:
        payload=review['payload'];record=payload.get('record')or{};source=source_key(record)
        explicit=set()
        for item in [review.get('artist_a_id'),record.get('artistId'),record.get('existingId')]:
            if item is not None and str(item)in artists:explicit.add(str(item))
        ref=record.get('artistRef')or''
        if ref.startswith('id:')and ref[3:]in artists:explicit.add(ref[3:])
        if source and len(bound[source])==1:explicit.update(bound[source])
        profiles=payload.get('profiles')or[]
        explicit.update(str(p['artist_id'])for p in profiles if str(p.get('artist_id'))in artists)
        candidate_name=record.get('name')or(record.get('sourceRecord')or{}).get('name')
        source_title=(captures.get(source)or{}).get('title')
        candidate_ids=names[norm(candidate_name)]if candidate_name else set()
        # Los nombres sólo generan candidatos: jamás asignan el expediente.
        if len(explicit)==1:
            aid=next(iter(explicit));root='artist:'+aid;label=artists[aid]['name']+' #'+aid
        elif len(explicit)>1:
            root='identity-conflict:'+','.join(sorted(explicit));label='Identidad en conflicto: '+', '.join(artists[i]['name']+' #'+i for i in sorted(explicit))
        elif source:
            root='source:'+source;label=source_title or candidate_name or source
        else:
            key=record.get('key')or payload.get('recoveryKey')or 'review:'+review['id']
            match=re.search(r'((?:venezuelademo|mp3com|tumblr|barraezo):[^:]+)',key)
            root='source:'+match.group(1)if match else 'unresolved:'+key
            label=candidate_name or source or key
        group=groups.setdefault(root,{'id':'EXP-'+hashlib.sha256(root.encode()).hexdigest()[:12],'rootKey':root,'label':label,
                                     'artistIds':sorted(explicit),'candidateArtistIds':set(),'sourceKeys':set(),
                                     'sourceUrls':set(),'reviews':[],'works':{}})
        group['candidateArtistIds'].update(candidate_ids-explicit)
        if explicit&excluded_ids or norm(source_title or candidate_name)in excluded_names:group['editoriallyBlocked']=True
        if source:
            group['sourceKeys'].add(source)
            if source in captures:group['sourceUrls'].add(captures[source]['url'])
        group['sourceUrls'].update(urls(record));group['sourceUrls'].update(urls(profiles))
        category=kind(record,review.get('notes')or'')
        work=record.get('albumId')or record.get('albumRef')or record.get('videoId')or record.get('originalKey')or record.get('claimKey')
        if not work:work=(record.get('data')or{}).get('albumId')if isinstance(record.get('data'),dict)else None
        if not work:work=record.get('title')or record.get('name')or record.get('key')or review['id']
        work_key=category+':'+str(work)
        group['works'].setdefault(work_key,{'type':category,'reference':str(work),'reviewIds':[]})['reviewIds'].append(review['id'])
        group['reviews'].append({'id':review['id'],'type':category,'reason':review.get('notes'),'sourceRecordKey':record.get('key')})
        reverse.append({'reviewId':review['id'],'expedienteId':group['id'],'rootKey':root,'type':category})
    result=[]
    for group in groups.values():
        group['candidateArtistIds']=sorted(group['candidateArtistIds']);group['sourceKeys']=sorted(group['sourceKeys']);group['sourceUrls']=sorted(group['sourceUrls'])
        group['works']=list(group['works'].values());group['counts']=dict(collections.Counter(r['type']for r in group['reviews']))
        identity='identidad'in group['counts']or group['rootKey'].startswith(('source:','identity-conflict:'))
        group['priority']='P4'if group.get('editoriallyBlocked')else'P0'if '1686'in group['artistIds']and not repaired else'P1'if identity and len(group['reviews'])>=3 else'P2'if identity or any(k in group['counts']for k in ['integrante','edición','pista'])else'P3'
        group['unlockScope']={'proposedRelations':len(group['reviews']),'distinctWorkCases':len(group['works']),'byType':group['counts'],
                              'automaticPublication':False,'note':'Resolver la identidad habilita evaluar los derivados; cada edición, pista y audiovisual conserva sus propias comprobaciones.'}
        group['missingEvidence']=[NEEDED[k]for k in sorted(group['counts'])]
        group['nextAction']='Revisar el sujeto y contrastar los ejes de identidad antes de evaluar sus derivados.'if identity else'Revisar cada obra o relación con su evidencia específica; conservar las discrepancias documentadas.'
        if repaired and '1686'in group['artistIds']:
            group['nextAction']='Confirmar la titularidad de las ediciones retiradas de publicación y contrastar el posible integrante duplicado; conservar discos, pistas y personas hasta contar con evidencia específica.'
        if group.get('editoriallyBlocked'):
            group['missingEvidence']=['Decisión editorial vigente: conservar como referencia sin alta, importación de discografía ni fusión de artista.']
            group['nextAction']='Conciliar las propuestas con la exclusión editorial vigente; no investigar para eludirla.'
            group['unlockScope']['proposedRelations']=0
        group['score']=len(group['reviews'])+4*len(group['works'])+15*identity
        result.append(group)
    result.sort(key=lambda g:(g['priority'],-g['score'],g['label'].casefold()))
    ids=[row['reviewId']for row in reverse]
    assert len(ids)==len(set(ids))==len(state['reviews'])
    assert sum(len(g['reviews'])for g in result)==len(ids)
    summary={'snapshotAt':state['capturedAt'],'reviews':len(ids),'expedientes':len(result),'workCases':sum(len(g['works'])for g in result),
             'priorities':dict(collections.Counter(g['priority']for g in result)),
             'groupingRule':'Sólo IDs explícitos o bindings documentales confirmados; nombres sin binding conservan expedientes separados.',
             'databaseStatusesChanged':0,'reviewIdsCoverage':'exactly_once'}
    (REPORT/'cola-agrupada.json').write_text(json.dumps({'summary':summary,'expedientes':result},ensure_ascii=False,indent=2))
    (REPORT/'cola-cobertura.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    with (REPORT/'cola-revisiones.csv').open('w',newline='')as handle:
        writer=csv.DictWriter(handle,fieldnames=['reviewId','expedienteId','rootKey','type']);writer.writeheader();writer.writerows(reverse)
    md=['# Cola agrupada de expedientes Hermes','',f'Corte: {state["capturedAt"]}. **{len(ids)} filas → {len(result)} expedientes → {summary["workCases"]} casos de obra/relación**.','',
        'Agrupar no aprueba ni fusiona identidades. Cada fila aparece exactamente una vez. Un nombre igual sólo genera candidatos; el agrupado utiliza IDs explícitos o vínculos confirmados. Los datos que puede desbloquear un expediente son propuestas pendientes, no altas garantizadas.','',
        'P0: mezcla publicada conocida. P1: identidad que bloquea varios derivados. P2: identidad, personas o ediciones concretas. P3: atribución de medios y contexto. P4: exclusión editorial vigente, conservar como referencia sin importar. Dentro de cada prioridad se ordena por volumen de relaciones y obras que permitiría revisar.','',
        'La reparación de Alter Ego se documenta en INFORME.md. Este es el corte posterior a la reparación.'if repaired else'La reparación de Alter Ego se documenta en INFORME.md; esta cola conserva el corte inicial.','',
        '| Orden | Expediente | Prioridad | Filas | Casos de obra/relación |','| ---: | --- | --- | ---: | ---: |']
    for i,g in enumerate(result,1):md.append(f'| {i} | [{g["label"].replace("|","/")}](#{g["id"].lower()}) | {g["priority"]} | {len(g["reviews"])} | {len(g["works"])} |')
    for group in result:
        md+=['',f'## {group["id"]}','',str(group['label']),f'Prioridad: **{group["priority"]}**. Revisiones: '+', '.join(r['id']for r in group['reviews'])+'.','',
             'Datos que desbloquearía para revisión: '+', '.join(f'{count} {key}'for key,count in sorted(group['counts'].items()))+'.','',
             'Evidencia que falta:','']+['- '+s for s in group['missingEvidence']]
        md+=['','Siguiente acción: '+group['nextAction'],'']
        if group['sourceUrls']:md+=['Fuentes conservadas:','']+['- '+url for url in group['sourceUrls']]
        if group['sourceKeys']:md+=['','Claves de fuente: '+', '.join(group['sourceKeys'])+'.']
        if group['candidateArtistIds']:md+=['','Candidatos por nombre, sin confirmar: '+', '.join(group['candidateArtistIds'])+'.']
    (REPORT/'COLA_PRIORIZADA.md').write_text('\n'.join(md)+'\n')
    print(json.dumps(summary,ensure_ascii=False))


if __name__=='__main__':main()
