"""Lectura pública de todas las fichas de las dos campañas; nunca escribe al catálogo."""
import concurrent.futures
import json
import os
import pathlib
import time
import urllib.request

out = pathlib.Path(os.environ['WAYBACK_OUT'])
audit = json.loads((out / 'auditoria-base.json').read_text())
hidden = {int(d['id']) for d in audit['documents']['hidden']}

def check(artist_id):
    started = time.monotonic()
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:8080/artists/{artist_id}', timeout=35) as response:
            body = json.load(response)
            docs = body.get('documents', [])
            gallery = body.get('gallery', [])
            expected_docs = audit['docCounts'][str(artist_id)]
            expected_gallery = audit['galleryCounts'][str(artist_id)]
            return dict(id=artist_id, status=response.status, name=body.get('name'),
                        documents=len(docs), gallery=len(gallery),
                        missingCampaignDocuments=max(0, expected_docs-len(docs)),
                        missingCampaignGallery=max(0, expected_gallery-len(gallery)),
                        hiddenDocumentsLeaked=[d['id'] for d in docs if int(d['id']) in hidden],
                        invalidPublicPlayers=[v['id'] for v in body.get('audiovisuals', []) if not v.get('playable') or not v.get('videoId')],
                        seconds=round(time.monotonic()-started, 3))
    except Exception as exc:
        return dict(id=artist_id, error=str(exc), seconds=round(time.monotonic()-started, 3))

rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    for row in executor.map(check, audit['artistIds']):
        rows.append(row)
        if len(rows)%100==0:
            print(f'{len(rows)}/{len(audit["artistIds"])} fichas', flush=True)
# Reintentar fallos transitorios una sola vez y conservar su evidencia.
initial_errors=[r for r in rows if r.get('error')]
retries={r['id']:check(r['id']) for r in initial_errors}
rows=[retries.get(r['id'],r) for r in rows]
issues=[r for r in rows if r.get('error') or r.get('status')!=200 or r.get('missingCampaignDocuments') or r.get('missingCampaignGallery') or r.get('hiddenDocumentsLeaked') or r.get('invalidPublicPlayers')]
result=dict(checkedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),total=len(rows),initialErrors=initial_errors,issues=issues,rows=rows)
(out/'auditoria-http.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(dict(total=len(rows),initialErrors=len(initial_errors),issues=issues),ensure_ascii=False,indent=2))
