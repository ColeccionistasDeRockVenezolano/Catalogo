#!/usr/bin/env python3
import argparse,collections,concurrent.futures,csv,hashlib,json,pathlib,subprocess,tempfile,time
from PIL import Image

ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=pathlib.Path.home()/'crv-staging/data/research/hermes-importacion-integral-2026-10-24'
MEDIA=pathlib.Path.home()/'crv-staging/web/public/media/hermes-importacion-integral-2026-10-24'

def records(path):return [json.loads(l)for l in path.read_text().splitlines()if l.strip()]if path.exists()else[]
def append(path,row):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a')as f:f.write(json.dumps(row,ensure_ascii=False)+'\n')
def asset(p):
    digest=hashlib.file_digest(p.open('rb'),'sha256').hexdigest();suffix=p.suffix.lower()
    dest=MEDIA/digest[:2]/(digest+suffix);dest.parent.mkdir(parents=True,exist_ok=True)
    if not dest.exists():dest.write_bytes(p.read_bytes())
    with Image.open(dest)as im:w,h=im.size
    return {'sha256':digest,'file':str(dest.relative_to(MEDIA)),'width':w,'height':h,
            'url':'/crv/media/hermes-importacion-integral-2026-10-24/'+str(dest.relative_to(MEDIA))}

def ocr():
    out=DATA/'barraezo/ocr.jsonl';seen={r['sha256']for r in records(out)}
    source=ROOT/'web/public/media/barraezo-blogspot'
    rows=[r for r in records(ROOT/'data/raw/barraezo-blogspot/images.jsonl')if r.get('status')=='ok'and r['sha256']not in seen]
    def read(r):
        p=source/r['file'];result=subprocess.run(['tesseract',str(p),'stdout','-l','spa+eng','--psm','11','tsv'],capture_output=True,text=True,timeout=90,env={**__import__('os').environ,'OMP_THREAD_LIMIT':'1'})
        words=[];lines=collections.defaultdict(list)
        for w in csv.DictReader(result.stdout.splitlines(),delimiter='\t'):
            if not w.get('text','').strip():continue
            words.append(w);lines[(w['block_num'],w['par_num'],w['line_num'])].append(w['text'])
        return {'sha256':r['sha256'],'source_file':str(p),'source_url':r['key'],'posts':r['posts'],
                'text':'\n'.join(' '.join(v)for v in lines.values()),'words':words,'exit':result.returncode}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5)as pool:
        for i,future in enumerate(pool.map(read,rows),1):
            append(out,future)
            if i%25==0:print(f'OCR {i}/{len(rows)}',flush=True)

def pdf_images():
    out=DATA/'venezuelademo/images.jsonl';seen={r['slug']for r in records(out)}
    for i,p in enumerate(sorted((ROOT/'data/raw/venezuelademo-2026-10-23/raw/pdf_artistas').glob('*.pdf')),1):
        if p.stem in seen:continue
        with tempfile.TemporaryDirectory(dir=DATA)as tmp:
            subprocess.run(['pdfimages','-j',str(p),tmp+'/image'],capture_output=True,check=True)
            images=[]
            for q in sorted(pathlib.Path(tmp).iterdir()):
                try:
                    with Image.open(q)as im:
                        if min(im.size)<120:continue
                        if q.suffix.lower()not in('.jpg','.jpeg','.png'):
                            converted=q.with_suffix('.png');im.save(converted);q=converted
                    images.append(asset(q))
                except Exception:continue
            append(out,{'slug':p.stem,'source_pdf':str(p),'images':images})
        if i%25==0:print(f'PDF imágenes {i}/310',flush=True)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('phase',choices=['ocr','pdf']);a=ap.parse_args();DATA.mkdir(exist_ok=True,parents=True)
    ocr()if a.phase=='ocr'else pdf_images()
if __name__=='__main__':main()
