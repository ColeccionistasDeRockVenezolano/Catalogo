#!/usr/bin/env python3
"""Reassess complete external evidence with fuller existing person metadata.

Read-only catalogue context; no claims, native reviews or catalogue writes.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('closing',ROOT/'scripts/rym-verificacion-cierre.py')
closing=importlib.util.module_from_spec(spec)
spec.loader.exec_module(closing)
deep=closing.deep


def run(out,item,people,section='contexto-personas'):
    href=item['rymHref']
    folder=out/section/('caso-'+hashlib.sha256(href.encode()).hexdigest()[:12])
    state=folder/'estado.json'
    if state.exists() and json.loads(state.read_text()).get('status')=='complete':return
    source=Path(item['sourceBatch'])
    if not (folder/'lote.json').exists():
        case=next(c for c in deep.expanded_cases(source) if c['rymHref']==href)
        row=next(r for r in json.loads((source/'resultados.json').read_text()) if r['rymHref']==href)
        existing={p['id']:p for p in case['candidatePeople']}
        for pid in item['personIds']:
            extra=people[pid]
            existing[pid]={**existing.get(pid,{}),**extra,'biography':(extra.get('biography') or '')[:2800],
                'contextSource':'Existing local person record; NOT external independent evidence'}
        case['candidatePeople']=list(existing.values())
        case['latestVerification']={k:row.get(k) for k in ('reason','evidence','identityAxes','semanticReview','nextCheck','citationChecks')}
        folder.mkdir(parents=True,exist_ok=True)
        deep.dump(folder/'lote.json',{'id':folder.name,'cases':[case]})
        versions=deep.source_versions(source)
        urls={case['rymUrl'],*(e['url'] for e in row.get('evidence',[])),*(s['url'] for s in case.get('availableLocalSources',[]))}
        urls.update(l['url'] for a in case['candidates'] for l in a.get('verifiedLinks',[]))
        inherited=[];seen=set()
        for url in urls:
            for s in versions.get(deep.canon(url),[]):
                key=(url,s['sourcePath'],s['sha256'])
                if key in seen:continue
                seen.add(key)
                inherited.append({'url':url,'title':s.get('title') or url,'sourcePath':s['sourcePath'],
                    'sha256':s['sha256'],'text':s['text'],'provenance':'verified_existing_capture',
                    'originalCapturedUrl':s['url']})
        deep.dump(folder/'evidencia-local.json',inherited)
        instructions='''CONTRASTE CON CONTEXTO LOCAL AMPLIADO. La instantánea anterior omitía biografía, nombre real y ciudad de personas ya existentes. Ahora se proporcionan, junto con la evidencia externa conservada. NO son fuentes externas ni independientes, pueden contener errores y no deben citarse como tales. Úsalos para comparar la identidad/obras/roles del ID concreto. No uses solo nombre/país/género. Reutiliza las capturas y citas válidas; no repitas búsquedas si ya prueban los hechos. Si una cita suplementaria fallida es innecesaria, puedes sustituirla por una cita literal que sí esté en los originales, o excluirla conservando solo ejes demostrados. Nunca inventes palabras ni uses el catálogo como corroboración externa.
Una mención a otro músico dentro de la biografía no convierte al dueño del registro en ese músico. No equipares persona con banda/orquesta. Si se acredita una referencia editorial existente pero no el ID de persona, puedes proponer SOLO el ID de referencia, preservándolo fuera del catálogo público. Si falta conexión al ID o evidencia primaria independiente, conserva la carencia. Mantén las contradicciones de campo y las posibles mezclas de homónimos; no las resuelvas por intuición. La persona y su proyecto pueden seguir separados.
Máximo cuatro búsquedas nuevas y doce páginas; prioriza resolver la conexión concreta, sin repetir toda la investigación.
'''
        (folder/'encargo.txt').write_text(instructions+item.get('targetInstructions','')+deep.PROMPT+json.dumps([case],ensure_ascii=False,separators=(',',':')))
        deep.dump(folder/'contexto.json',{'rymHref':href,'sourceBatch':str(source),'personIds':item['personIds'],
            'localMetadataOnly':True,'externalEvidenceReused':True,'catalogWrites':0})
    try:
        researched=folder/'investigacion.json'
        if not researched.exists():
            data,_=deep.invoke(folder,folder/'encargo.txt','investigacion',turns=20,searches=4,fetches=12,
                validator=lambda data:deep.validate(folder,data))
            deep.dump(researched,deep.validate(folder,data))
        deep.run_batch(out,{'id':folder.name},folder=folder)
    except Exception as e:
        deep.dump(state,{'status':'failed','errorType':type(e).__name__,'error':str(e)[:300]})
    print(json.dumps({'rymHref':href,'state':json.loads(state.read_text())}),flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',required=True,type=Path)
    p.add_argument('--workers',type=int,default=8)
    args=p.parse_args();out=args.out.resolve()
    if not out.is_relative_to(Path.home()/'crv-staging/reports') or not (out/'asignaciones.json').exists():
        raise SystemExit('Use an existing SSD campaign')
    people={p['id']:p for p in json.loads((out/'catalogo-personas-ampliado.json').read_text())['persons']}
    items=json.loads((out/'asignaciones-contexto-personas.json').read_text())['cases']
    assert len(items)==len({c['rymHref'] for c in items})
    original_invoke=deep.invoke
    def bounded_review(folder,prompt,prefix,**kwargs):
        if prefix.startswith('revision'):
            kwargs.update(turns=12,searches=2,fetches=6)
        return original_invoke(folder,prompt,prefix,**kwargs)
    deep.invoke=bounded_review
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for _ in pool.map(lambda item:run(out,item,people),items):pass


if __name__=='__main__':main()
