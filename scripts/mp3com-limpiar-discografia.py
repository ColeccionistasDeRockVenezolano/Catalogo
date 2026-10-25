#!/usr/bin/env python3
"""Limpieza de la discografía recuperada: el bloque de soporte a veces trae
«<phrase>Label</phrase>: <b>sello</b>», que el parser confundía con soporte/disco.
Aquí se corrige: media='Label' → label=sello, album=None, media=None.

También normaliza 'Independiente'/'Independent'/'none' a None en `label`
(no son sellos: son la ausencia de sello) y agrupa pistas sin disco.
"""
import json, os, re

P = '/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/raw/mp3com-2003/discografia-venezolanos.jsonl'
NO_SELLO = re.compile(r'^(independiente|independent|ninguno|none|n/?a|sin sello|-+)$', re.I)


def main():
    rows, fix_media, fix_label = [], 0, 0
    for line in open(P, encoding='utf-8'):
        r = json.loads(line)
        albumes = []
        for a in r['albums']:
            if (a.get('media') or '').lower() == 'label' and a.get('album'):
                a = {'media': None, 'album': None, 'label': a['album'], 'tracks': a['tracks']}
                fix_media += 1
            if a.get('label') and NO_SELLO.match(a['label'].strip()):
                a['label'] = None
                fix_label += 1
            albumes.append(a)
        # fusiona discos con la misma identidad (media, album, label)
        agg = {}
        for a in albumes:
            k = (a['media'], a['album'], a['label'])
            if k not in agg:
                agg[k] = a
            else:
                vistos = {t['song_id'] for t in agg[k]['tracks']}
                agg[k]['tracks'].extend(t for t in a['tracks'] if t['song_id'] not in vistos)
        r['albums'] = list(agg.values())
        rows.append(r)
    with open(P, 'w', encoding='utf-8') as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(json.dumps({'artistas': len(rows), 'soportes_corregidos': fix_media, 'sellos_vacios': fix_label,
                      'discos': sum(len(r['albums']) for r in rows),
                      'pistas': sum(len(a['tracks']) for r in rows for a in r['albums'])}))


if __name__ == '__main__':
    main()
