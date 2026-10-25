#!/usr/bin/env python3
"""Recover layout-only citations from intact captures; independently re-review."""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
from pathlib import Path
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('closing',ROOT/'scripts/rym-verificacion-cierre.py')
closing=importlib.util.module_from_spec(spec);spec.loader.exec_module(closing)
deep=closing.deep


def prepare(out,source):
    target=out/'contexto-citas'/source.name
    if (target/'lote.json').exists():return target
    rows=json.loads((source/'resultados.json').read_text())
    assert len(rows)==1
    row=rows[0]
    if row['allCitationsVerified']:return None
    versions=deep.source_versions(source);changes=[]
    for i,evidence in enumerate(row['evidence']):
        if row['citationChecks'][i]['quoteFound']:continue
        fixed=None
        for captured in versions.get(deep.canon(evidence['url']),[]):
            raw=Path(captured['sourcePath'])
            if not raw.is_file() or hashlib.sha256(raw.read_bytes()).hexdigest()!=captured['sha256']:continue
            fixed=closing.literal_span(captured['text'],evidence['quote'])
            if fixed:
                changes.append({'evidenceIndex':i,'originalQuote':evidence['quote'],'literalSourceSpan':fixed,
                                'sourcePath':str(raw),'sha256':captured['sha256']})
                evidence['quote']=fixed;break
        if not fixed:return None
    target.mkdir(parents=True,exist_ok=True)
    deep.dump(target/'lote.json',{'id':target.name,'cases':deep.expanded_cases(source)})
    deep.dump(target/'evidencia-local.json',[s for captured in versions.values() for s in captured])
    deep.dump(target/'investigacion.json',rows)
    deep.dump(target/'reparacion.json',{'sourceBatch':str(source),'method':'Identical contiguous tokens; whitespace only',
                                      'quoteChanges':changes,'catalogWrites':0,'externalFactsInvented':0})
    return target


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',required=True,type=Path)
    p.add_argument('--workers',type=int,default=4);args=p.parse_args();out=args.out.resolve()
    assert out.parent==Path.home()/'crv-staging/reports'
    expected=len(json.loads((out/'asignaciones-contexto-personas.json').read_text())['cases'])
    invoke=deep.invoke
    def bounded(folder,prompt,prefix,**kwargs):
        kwargs.update(turns=12,searches=2,fetches=6)
        return invoke(folder,prompt,prefix,**kwargs)
    deep.invoke=bounded;examined=set();futures={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        while True:
            complete=0
            for state in (out/'contexto-personas').glob('*/estado.json'):
                if json.loads(state.read_text()).get('status')!='complete':continue
                complete+=1
                if state.parent in examined:continue
                target=prepare(out,state.parent);examined.add(state.parent)
                if target:futures[pool.submit(deep.run_batch,out,{'id':target.name},folder=target)]=target
            for future in list(futures):
                if not future.done():continue
                future.result();folder=futures.pop(future)
                print(json.dumps({'folder':folder.name,'state':json.loads((folder/'estado.json').read_text())}),flush=True)
            if complete==expected and not futures:break
            time.sleep(10)


if __name__=='__main__':main()
