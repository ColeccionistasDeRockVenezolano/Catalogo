#!/usr/bin/env python3
"""Conserva revisiones humanas de homónimos sin corroboración del catálogo."""
import json
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
CASES=ROOT/'reports/webs-oficiales-2026-10-18/revision-990/scrapling/evaluacion/casos'
reviews={
 (2256,'https://muteband.wixsite.com/mutebandofficial/biografia'):"Mute es un nombre compartido. La página de M.U.T.E. describe una banda de cinco integrantes, pero no coincide con ningún miembro, obra o vínculo verificado del catálogo. No menciona Como Llora una Estrella, Antonio Carrillo ni Arnoldo Vivas. Tener una banda y una biografía musical solo en la página no acredita la identidad venezolana de la ficha; pendiente de corroboración.",
 (2536,'https://www.ravnmusic.com/'):"El catálogo de Ravn no tiene biografía, discos ni enlaces verificados que permitan corroborar esta web. Los Spotify/Apple de la página difieren de los no verificados del catálogo. El repertorio y la biografía de dark folk eslavo proceden solo de la web, por lo que no constituyen una coincidencia independiente. Nombre compartido: identidad pendiente.",
 (2873,'https://hidra.bigcartel.com/products'):"El catálogo de Hidra no tiene biografía ni discos para corroborar CRÓNICA o EL ÚLTIMO ENGRANAJE. Las redes hidranumetal1/hidra3c provienen solo de la tienda y no son evidencia verificada del catálogo. Al ser Hidra un nombre compartido, nombre y venta de música no bastan para atribuir la tienda a esta ficha. Identidad pendiente."
}
changed=[]
for f in CASES.glob('*.json'):
 d=json.loads(f.read_text());reason=reviews.get((d['artistId'],d['url']))
 if not reason or d.get('manualReview'):continue
 backup=f.with_suffix('.json.antes-revision-manual');backup.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
 d.update(status='uncertain',reason=reason,manualReview={'reviewer':'Codex','checkedAt':datetime.now(timezone.utc).isoformat(),'originalStatus':d['status'],'backup':str(backup.relative_to(ROOT))})
 f.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');changed.append({'artistId':d['artistId'],'url':d['url'],'status':d['status']})
print(json.dumps(changed,ensure_ascii=False))
# Dos rechazos persistentes del contrato de clasificación se resuelven leyendo su DOM Scrapling.
from bs4 import BeautifulSoup
negative={
 4550:('FakBoi.org Pinay Sex Scandal and Best Pinay Porn Site','La URL contiene un portal de contenido adulto y reproductores de video; no la banda venezolana Fakboi ni sus obras.'),
 3157:('Biocodex to międzynarodowa firma farmaceutyczna posiadająca 16 spółek zależnych i 100 partnerów','La URL es la web polaca de una empresa farmacéutica, con investigación y productos de salud; no el artista Biocodex.')
}
for f in CASES.glob('*.json'):
 d=json.loads(f.read_text());entry=negative.get(d['artistId'])
 if not entry or d['status']!='read_failed':continue
 vp=CASES.parents[1]/'visitas'/f.name;v=json.loads(vp.read_text());html=(ROOT/v['capture']).read_text()
 soup=BeautifulSoup(html,'html.parser')
 for el in soup(['script','style','noscript','svg']):el.decompose()
 content=soup.get_text(' ',strip=True);quote,reason=entry
 if quote not in content:raise ValueError('No se encuentra la cita de revisión manual')
 backup=f.with_suffix('.json.antes-revision-manual');backup.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
 d.update(status='unrelated',siteType='other',reason=reason,evidence=[{'quote':quote,'basis':'different_identity','catalogValue':d['name']}],pages=[{'url':v['finalUrl'],'status':v['httpStatus'],'complete':v['complete'],'method':'scrapling_stealth','capturedAt':v['capturedAt'],'capture':v['capture'],'sha256':v['sha256'],'title':v['title'],'content':content}],manualReview={'reviewer':'Codex','originalStatus':'read_failed','backup':str(backup.relative_to(ROOT)),'checkedAt':datetime.now(timezone.utc).isoformat()})
 f.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'artistId':d['artistId'],'status':d['status']}))
# Un agregador puede documentar al artista según el criterio de Brian; no se exige web propia.
for f in CASES.glob('2571-*.json'):
 d=json.loads(f.read_text())
 if d['status']!='unrelated':continue
 quote='Gianko y su Sonido La Limpia Caseroloops - Contigo (Sonido La Limpia Rebajado/Rejalado/Remixeado)'
 if not any(quote in p['content'] for p in d.get('pages',[])):continue
 backup=f.with_suffix('.json.antes-revision-manual');backup.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
 d.update(status='matched',siteType='third_party',reason='El nombre compuesto distintivo Gianko y Su Sonido La Limpia figura como intérprete de remezclas en contexto musical, coherente con el proyecto de guaracha y remezclas del catálogo. La abundancia de otros artistas en el agregador no borra esta atribución explícita. Es una referencia de terceros, sin atribuir propiedad u oficialidad.',evidence=[{'quote':quote,'basis':'name_and_music','catalogValue':'Gianko y Su Sonido La Limpia: proyecto asociado a guaracha y remezclas'}],manualReview={'reviewer':'Codex','originalStatus':'unrelated','backup':str(backup.relative_to(ROOT)),'checkedAt':datetime.now(timezone.utc).isoformat()})
 f.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'artistId':2571,'status':'matched'}))
