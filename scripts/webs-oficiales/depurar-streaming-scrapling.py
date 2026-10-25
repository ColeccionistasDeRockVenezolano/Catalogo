#!/usr/bin/env python3
"""Los enlaces de la página solo corroboran identidad si coinciden con el catálogo verificado."""
import json,re
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'reports/webs-oficiales-2026-10-18'
def identity(raw):
 try:
  u=urlsplit(raw);h=u.hostname.removeprefix('www.');p=[x for x in u.path.split('/') if x]
  if h in ['open.spotify.com','deezer.com','music.apple.com','tidal.com']:
   platform={'open.spotify.com':'spotify','deezer.com':'deezer','music.apple.com':'apple','tidal.com':'tidal'}[h]
   for i,x in enumerate(p[:-1]):
    if x in ['artist','album','track']:
     ident=next((x for x in p[i+1:] if x.isdigit()),None) if h=='music.apple.com' else p[i+1]
     return f'{platform}:{x}:{ident}' if ident else None
  if h=='youtube.com' and len(p)>1 and p[0]=='channel':return f'youtube:{p[1]}'
  if h=='youtube.com' and p and p[0].startswith('@'):return f'youtube:{p[0].lower()}'
  if h.endswith('.bandcamp.com'):return f'bandcamp:{h}'
  if h=='soundcloud.com' and p:return f'soundcloud:{p[0].lower()}'
 except (ValueError,AttributeError):pass
 return None
catalog={a['id']:a for a in json.loads((BASE/'catalogo-990.json').read_text())};changes=[]
for f in (BASE/'revision-990/scrapling/evaluacion/casos').glob('*.json'):
 d=json.loads(f.read_text())
 if d['status']!='matched':continue
 trusted={identity(l['url']) for l in catalog[d['artistId']]['streaming'] if l.get('verified')};trusted.discard(None)
 kept=[];removed=[]
 for e in d.get('evidence',[]):
  ids={identity(u.rstrip('.,);')) for u in re.findall(r'https?://[^\s<>]+',e['quote'])};ids.discard(None)
  if e['basis']=='streaming' and not trusted.intersection(ids):removed.append(e)
  else:kept.append(e)
 if not removed:continue
 f.with_suffix('.json.antes-depurar-streaming').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
 d.update(evidence=kept,unsupportedStreamingEvidence=removed,originalReason=d['reason'],reason='La coincidencia se sostiene en las citas conservadas de nombre y contexto musical, biografía o discografía. Los enlaces que no constan verificados y coincidentes en el catálogo no se usan como corroboración de identidad.')
 if not kept:d.update(status='uncertain',reason='Los enlaces citados no coinciden con streaming verificado del catálogo; no queda otra evidencia suficiente.')
 f.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');changes.append({'artistId':d['artistId'],'name':d['name'],'url':d['url'],'status':d['status'],'removedClaims':len(removed)})
print(json.dumps(changes,ensure_ascii=False))
