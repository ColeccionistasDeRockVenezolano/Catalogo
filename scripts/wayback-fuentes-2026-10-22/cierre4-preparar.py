"""Contrasta atribuciones de cronologías con el HTML local; no modifica la base."""
import os, json, pathlib, re, unicodedata, hashlib, collections
from urllib.parse import urlsplit
from bs4 import BeautifulSoup

out=pathlib.Path(os.environ['WAYBACK_OUT'])
data=json.loads((out/'antes.json').read_text())
artists={int(a['id']):a for a in data['artists']}
def normalize(text):
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD',text).encode('ascii','ignore').decode().lower())
cache={}
def source_file(url):
    match=re.search(r'web\.archive\.org/web/\d{14}(?:[a-z_]+)?/(https?://.+)',url)
    original=match[1] if match else url
    parsed=urlsplit(original)
    if parsed.hostname in ('www.musica.com.ve','musica.com.ve') and parsed.path.startswith('/bandas/'):
        p=pathlib.Path('data/raw/wayback-fuentes-2026-10-22/musica-bandas')/parsed.path.lstrip('/')
        if p.is_file():return p
    for d in data['documents']:
        e=d['metadata'].get('evidence',{})
        if url in (d.get('archive_url'),d.get('source_url'),e.get('wayback'),e.get('url')) or original==e.get('url'):
            p=e.get('archivo')
            if p and pathlib.Path(p).is_file():return pathlib.Path(p)
    return None

audit=[];plan=[]
for event in data['events']:
    changed=False;new_sources=[]
    for source in event['sources']:
        url=source.get('url','');match=re.search(r'web\.archive\.org/web/(\d{4})\d{10}',url)
        path=source_file(url);original=None
        if path:
            key=str(path)
            if key not in cache:
                raw=path.read_bytes();soup=BeautifulSoup(raw,'html.parser')
                for t in soup(['script','style']):t.decompose()
                text=re.sub(r'\s+',' ',soup.get_text(' ',strip=True))
                cache[key]={'path':key,'sha256':hashlib.sha256(raw).hexdigest(),'text':text}
            original=cache[key]
        quote=source.get('quote','');nq=normalize(quote)
        in_raw=bool(nq and original and nq in normalize(original['text']))
        artist=artists.get(int(event['original_artist_id']))
        in_bio=bool(nq and artist and nq in normalize(artist['biography'] or ''))
        temporal=bool(match and event.get('event_year') and int(event['event_year'])>int(match[1])+1)
        # Sólo corrige el conjunto con tres evidencias: anacronismo, HTML disponible y cita ausente.
        correction=temporal and bool(original) and not in_raw and bool(artist)
        decision='atribucion-anacronica-confirmada' if correction else 'literal-local-localizado' if in_raw else 'requiere-revision'
        audit.append({'eventId':int(event['id']),'artistId':int(event['original_artist_id']),
                      'source':source,'snapshotYear':int(match[1]) if match else None,
                      'eventYear':event.get('event_year'),'quoteInOriginal':in_raw,'quoteInCurrentBiography':in_bio,
                      'sourcePath':str(path) if path else None,'sourceSha256':original['sha256'] if original else None,
                      'decision':decision})
        if correction:
            assert event['status']=='pending' and event['event_date'] is None, event['id']
            changed=True
            new_sources.append({'url':'/crv/artistas/'+str(event['original_artist_id']),
              'title':'Ficha previa del catálogo; año sin corroboración en el archivo citado',
              'verificationStatus':'unverified-catalog-only',
              'verificationReason':'La cita no aparece en el HTML conservado y el año del hecho es posterior al de la captura. No se declara falso el hecho: se corrige su procedencia.',
              'previousAttribution':source,
              'attributionReview':{'campaign':'wayback-finalizacion-4-2026-10-25','sourcePath':original['path'],
                'sourceSha256':original['sha256'],'quoteInCurrentBiography':in_bio}})
        else:new_sources.append(source)
    if changed:
        note=event['date_note'] or ''
        if note=='El archivo documenta el año; no se asigna día ni mes.':
            note='Año conservado de la ficha previa del catálogo; sin corroboración en la captura citada. Día y mes sin confirmar.'
        else:note+=' Atribución histórica corregida: el archivo citado no respalda esta cita; año pendiente de corroboración externa.'
        plan.append({'eventId':int(event['id']),'artistId':int(event['original_artist_id']),
                     'previous':event,'sources':new_sources,'dateNote':note})
(out/'auditoria-procedencia.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
(out/'plan-procedencia.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
(out/'originales-procedencia.json').write_text(json.dumps(list(cache.values()),ensure_ascii=False,indent=2))
print(json.dumps({'events':len(data['events']),'sourceDispositions':dict(collections.Counter(a['decision'] for a in audit)),
                  'plannedCorrections':len(plan),'artists':len(set(p['artistId'] for p in plan))},ensure_ascii=False))
