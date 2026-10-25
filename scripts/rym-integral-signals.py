#!/usr/bin/env python3
"""Recover scoped genres, media and listening links from selected source bytes."""
import argparse
import multiprocessing
import json
import os
from pathlib import Path
from lxml import html


def extract(record):
    source=next(p['path'] for p in record['capturePins'] if p['path'].endswith('.html'))
    tree=html.fromstring(Path(source).read_text(encoding='utf-8'))
    literal=tree.xpath('//meta[@itemprop="name"]/@content')
    if literal and literal[0].strip():
        record['extractedTitle']=record.get('titulo')
        record['titulo']=' '.join(literal[0].split())
    for field,css in [('primaryGenres','release_pri_genres'),('secondaryGenres','release_sec_genres')]:
        record[field]=list(dict.fromkeys(' '.join(n.text_content().split()) for n in tree.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," '+css+' ")]//a[contains(@href,"/genre/")]')))
    record['imageUrl']=next(iter(tree.xpath('//meta[@property="og:image"]/@content')),None)
    links=tree.xpath('//*[@id="media_link_button_container_top"]/@data-links')
    record['listeningLinks']=json.loads(links[0]) if links else {}
    return record


def extract_titles(record):
    source=next(p['path'] for p in record['capturePins'] if p['path'].endswith('.html'))
    tree=html.fromstring(Path(source).read_text(encoding='utf-8'))
    literal=tree.xpath('//meta[@itemprop="name"]/@content')
    if literal and literal[0].strip():
        record['extractedTitle']=record.get('extractedTitle',record.get('titulo'))
        record['titulo']=' '.join(literal[0].split())
    return record


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--corpus',required=True);ap.add_argument('--titles-only',action='store_true');args=ap.parse_args()
    p=Path(args.corpus)/'albumes.jsonl';records=[json.loads(l) for l in p.read_text().splitlines() if l.strip()]
    temporary=p.with_suffix('.signals.tmp')
    with temporary.open('w') as handle,multiprocessing.Pool(processes=3,maxtasksperchild=100) as pool:
        for i,result in enumerate(pool.imap(extract_titles if args.titles_only else extract,records,chunksize=8),1):
            handle.write(json.dumps(result,ensure_ascii=False)+'\n')
            if i%1000==0:print(i,len(records),flush=True)
    os.replace(temporary,p)


if __name__=='__main__':main()
