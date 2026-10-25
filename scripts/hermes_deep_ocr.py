"""Relectura reproducible de todas las páginas OCR débiles, sin alterar el corpus previo."""
import concurrent.futures
import csv
import hashlib
import io
import json
import os
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path(os.environ['HERMES_DEEP_DATA']) / 'ocr-relectura'
OUT.mkdir(exist_ok=True)
corpus = [json.loads(l) for l in (ROOT/'data/research/punkenvenezuela-fanzines-2026-10-23/corpus.jsonl').read_text().splitlines()]
pages = {(r['doc'], r['pagina']): r for r in corpus if r['metodo']=='ocr' and r['calidad'] < .65}
files = {p.name:p for p in (ROOT/'data/raw/punkenvenezuela-2026-10-23/media').rglob('*.pdf')}

def process(item):
    (doc, page), old = item
    key = hashlib.sha256((doc+':'+str(page)).encode()).hexdigest()[:20]
    dest = OUT/key
    if dest.with_suffix('.json').exists():
        return json.loads(dest.with_suffix('.json').read_text())
    original = files[doc]
    result = {'document':doc,'page':page,'originalPath':str(original.relative_to(ROOT)),
              'originalSha256':hashlib.sha256(original.read_bytes()).hexdigest(),'oldQuality':old['calidad'],'oldChars':len(old['texto']), 'variants':[]}
    try:
        subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-r','300','-singlefile','-gray','-png',str(original),str(dest)],capture_output=True,timeout=100,check=True)
        for psm in [3,11]:
            run=subprocess.run(['tesseract',str(dest.with_suffix('.png')),'stdout','-l','spa+eng','--psm',str(psm),'tsv'],env={**os.environ,'OMP_THREAD_LIMIT':'1'},capture_output=True,text=True,timeout=150,check=True)
            rows=list(csv.DictReader(io.StringIO(run.stdout),delimiter='\t')); words=[r for r in rows if r.get('text','').strip() and float(r.get('conf',-1))>=0]
            text='';last=None
            for r in words:
                line=tuple(r.get(k) for k in ['page_num','block_num','par_num','line_num'])
                text+= ('\n' if last!=line else ' ') +r['text'];last=line
            name=key+'-psm'+str(psm)
            (OUT/(name+'.txt')).write_text(text.lstrip())
            (OUT/(name+'.tsv')).write_text(run.stdout)
            result['variants'].append({'psm':psm,'chars':len(text),'words':len(words),'meanConfidence':round(sum(float(r['conf']) for r in words)/max(1,len(words)),2),'textPath':name+'.txt','tsvPath':name+'.tsv'})
        result['result']='reprocessed'
    except Exception as e:
        result.update(result='blocked',reason=str(e)[:300])
    finally:
        dest.with_suffix('.png').unlink(missing_ok=True)
    dest.with_suffix('.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(doc,page,result['result'],flush=True)
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
    results=list(ex.map(process,pages.items()))
(OUT/'resultados.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in results))
(OUT/'resumen.json').write_text(json.dumps({'originalWeakRows':sum(r['metodo']=='ocr' and r['calidad']<.65 for r in corpus),'uniquePages':len(pages),'reprocessed':sum(r['result']=='reprocessed' for r in results),'warning':'Confianza del OCR no prueba identidad ni convierte portadas o ilustraciones en texto ausente.'},indent=2))
