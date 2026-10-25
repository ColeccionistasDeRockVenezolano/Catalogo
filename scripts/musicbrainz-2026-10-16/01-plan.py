#!/usr/bin/env python3
"""Plan de aplicación al catálogo de la cosecha MusicBrainz (2026-10-16). Solo LECTURA.

Genera en reports/musicbrainz-apply-2026-10-16/:
  membresias.jsonl     relaciones member of band con persona YA existente (crear la membresía)
  personas-nuevas.jsonl  nombres de miembros sin ficha de persona (candidatos, NO se crean)
  campos.jsonl         ciudad de formación / año de formación-disolución aplicables (solo vacíos)

Uso: python3 scripts/musicbrainz-2026-10-16/01-plan.py
"""
from __future__ import annotations

import json
import re
import subprocess
import unicodedata
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'musicbrainz-apply-2026-10-16'
MB = ROOT / 'reports' / 'musicbrainz-artist-rels-2026-10-16' / 'relaciones.jsonl'
SEP = chr(31)
OUT.mkdir(parents=True, exist_ok=True)

# instrumento MB -> rol del catálogo (formas más frecuentes; el resto se capitaliza)
ROLES = {
    'guitar': 'Guitars', 'electric guitar': 'Guitars', 'acoustic guitar': 'Guitars', 'guitars': 'Guitars',
    'bass': 'Bass', 'bass guitar': 'Bass',
    'drums (drum set)': 'Drums', 'drums': 'Drums', 'drum machine': 'Drums', 'percussion': 'Percussion',
    'lead vocals': 'Vocals', 'vocals': 'Vocals', 'choir vocals': 'Vocals', 'backing vocals': 'Vocals',
    'piano': 'Keyboards', 'keyboards': 'Keyboards', 'organ': 'Keyboards', 'synthesizer': 'Keyboards',
    'saxophone': 'Sax', 'trumpet': 'Trumpet', 'violin': 'Violin', 'flute': 'Flute', 'cello': 'Cello',
}


def rol(attrs: list[str]) -> str:
    if not attrs:
        return 'integrante'
    vistos, out = set(), []
    for a in attrs:
        r = ROLES.get(a.lower(), a.strip().capitalize())
        if r not in vistos:
            vistos.add(r)
            out.append(r)
    return ' & '.join(out)


def anio(v) -> int | None:
    if isinstance(v, str) and re.match(r'^\d{4}', v):
        return int(v[:4])
    return None


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    return o.stdout.strip()


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def es_venezolano(info: dict) -> bool:
    """Guarda de identidad (guía del proyecto para MusicBrainz): país/área Venezuela."""
    c = (info.get('country') or '').strip().upper()
    if c == 'VE':
        return True
    texto = f"{info.get('area') or ''} {info.get('begin_area') or ''}".lower()
    return 'venezuela' in texto


# --- catálogo ---
cat, personas, ciudades, anios = {}, {}, {}, {}
for l in psql("SELECT id || '|' || name FROM public.artists").split('\n'):
    if '|' in l:
        i, n = l.split('|', 1)
        cat[norm(n)] = int(i)
for l in psql("SELECT id || '|' || name FROM public.persons").split('\n'):
    if '|' in l:
        i, n = l.split('|', 1)
        personas[norm(n)] = int(i)
for l in psql("SELECT id || '|' || coalesce(origin_city,'') || '|' || coalesce(formed_year::text,'') || '|' || coalesce(disbanded_year::text,'') FROM public.artists").split('\n'):
    p = l.split('|')
    if len(p) == 4 and p[0].strip().isdigit():
        ciudades[int(p[0])] = p[1]
        anios[int(p[0])] = (p[2], p[3])
print(f'catálogo: {len(cat)} artistas | {len(personas)} personas')

mb = [json.loads(l) for l in open(MB)]
print('MB:', len(mb), 'artistas')
# vistazo de areas
areas = [(d['name_norm'], (d.get('mb') or {}).get('begin_area'), (d.get('mb') or {}).get('area'), (d.get('mb') or {}).get('life_span')) for d in mb if (d.get('mb') or {}).get('begin_area')][:6]
print('muestra areas MB (name | begin_area | area | life_span):')
for a in areas:
    print('  ', a)

membresias, nuevas, campos, descartes = [], {}, [], []
for d in mb:
    mid = cat.get(d['name_norm'])
    if not mid:
        continue
    info = d.get('mb') or {}
    rels = info.get('rels') or []
    if not es_venezolano(info):
        descartes.append({'artistId': mid, 'banda': d['name_norm'], 'mbid': info.get('id'),
                          'country': info.get('country'), 'area': info.get('area'), 'begin_area': info.get('begin_area'),
                          'motivo': 'MusicBrainz sin país Venezuela (homónimo probable)'})
        continue
    # --- membresías ---
    porpersona = {}
    for r in rels:
        if r.get('type') != 'member of band':
            continue
        # A Person -> Group forward edge names the BAND, not a new person.
        # This planner writes members of an existing group only.
        if info.get('type') != 'Group' or r.get('direction') != 'backward':
            continue
        nm = ((r.get('artist') or {}).get('name') or '').strip()
        if not nm:
            continue
        pid = personas.get(norm(nm))
        if not pid:
            k = norm(nm)
            nuevas.setdefault(k, {'name': nm, 'mbid': (r.get('artist') or {}).get('id'), 'bandas': []})
            if len(nuevas[k]['bandas']) < 8:
                nuevas[k]['bandas'].append({'artistId': mid, 'banda': d['name_norm']})
            continue
        clave = (pid, r.get('begin'), r.get('end'))
        porpersona.setdefault(clave, {'attrs': [], 'url': f"https://musicbrainz.org/artist/{info.get('id')}"})
        for a in (r.get('attributes') or []):
            if a not in porpersona[clave]['attrs']:
                porpersona[clave]['attrs'].append(a)
    for (pid, begin, end), v in porpersona.items():
        membresias.append({
            'artistId': mid, 'banda': d['name_norm'], 'personId': pid,
            'role': rol(v['attrs']), 'fromYear': anio(begin), 'toYear': anio(end),
            'isCurrent': (end is None and begin is not None),
            'url': v['url'], 'evidencia': f"MusicBrainz: {info.get('name')} — miembro ({', '.join(v['attrs']) or 'sin instrumento'}) {begin or '?'}–{end or 'presente'}",
        })
    # --- campos (solo vacíos) ---
    if mid in ciudades or mid in anios:
        ciudad = (ciudades.get(mid) or '').strip()
        anio_f, anio_d = anios.get(mid, ('', ''))
        ba, ar = (info.get('begin_area') or '').strip(), (info.get('area') or '').strip()
        ls = info.get('life_span') or {}
        # ciudad: begin_area cuando existe y no es el país; area solo si no es 'Venezuela'
        ciudad_mb = ba if (ba and ba != ar) else (ar if (ar and ar.lower() not in ('venezuela',)) else '')
        fila = {'artistId': mid, 'banda': d['name_norm'], 'url': f"https://musicbrainz.org/artist/{info.get('id')}"}
        cambio = False
        if not ciudad and ciudad_mb:
            fila['originCity'] = ciudad_mb
            fila['evidenciaCiudad'] = f"MusicBrainz: área de la banda ({info.get('name')}) = {ciudad_mb}"
            cambio = True
        b = anio(ls.get('begin'))
        if not anio_f and b:
            fila['formedYear'] = b
            fila['evidenciaAnio'] = f"MusicBrainz: life-span begin = {ls.get('begin')}"
            cambio = True
        e = anio(ls.get('end'))
        if not anio_d and e:
            fila['disbandedYear'] = e
            fila['evidenciaDisolucion'] = f"MusicBrainz: life-span end = {ls.get('end')}"
            cambio = True
        if cambio:
            campos.append(fila)

for nombre, filas in (('membresias.jsonl', membresias), ('personas-nuevas.jsonl', list(nuevas.values())), ('campos.jsonl', campos), ('descartes.jsonl', descartes)):
    with open(OUT / nombre, 'w') as f:
        for r in filas:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')

print()
print(f'membresias a crear (persona existente, pais VE): {len(membresias)}')
print(f'personas nuevas (candidatos, sin crear): {len(nuevas)}')
print(f'campos a rellenar: {len(campos)} (ciudad {sum(1 for c in campos if "originCity" in c)}, año {sum(1 for c in campos if "formedYear" in c)}, disolución {sum(1 for c in campos if "disbandedYear" in c)})')
print(f'descartados por pais (homónimo probable): {len(descartes)}')
print('muestra membresías:')
for m in membresias[:5]:
    print('  ', m['banda'][:24], '<-', m['personId'], m['role'][:26], m['fromYear'], '-', m['toYear'], m['isCurrent'])
print('muestra campos:')
for c in campos[:5]:
    print('  ', c['banda'][:24], '|', c.get('originCity', '-'), '|', c.get('formedYear', '-'), '|', c.get('disbandedYear', '-'))
