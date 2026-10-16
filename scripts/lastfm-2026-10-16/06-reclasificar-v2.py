#!/usr/bin/env python3
"""Re-decisión v2 de la clasificación Laya (sin re-ejecutar el modelo).

SUPERADO (2026-10-16) por `08-reclasificar-v3.py`: el léxico v3 (fuerzas por
palabra + candidatas + filtros separados) mide mejor. Se conserva como
referencia histórica; la cadena 07 ya usa el 08.

Problema medido (2026-10-16): con umbral 0.5, tags de GÉNERO caían en emociones
(«rock»→aumenta_mi_aura 0.57, «llanera»→cachonda, «dark wave»→tristeza).

Reglas v2 (sobre las probabilidades YA guardadas en tags-clasificados.jsonl):
  1. Si el tag está en el VOCABULARIO (ingest.genres + genre_aliases), en la lista
     de países/idiomas o es un año/década → `no_expresa_emocion` (sin discusión).
  2. Si la categoría v1 era emocional, exige p >= 0.65 para mantenerla; si no,
     `no_expresa_emocion` (motivo `umbral`).
El v1 queda respaldado en tags-clasificados-v1.jsonl. Re-aplicar después con
`05-laya-clasificar.py --apply-only`.
"""
from __future__ import annotations

import json
import re
import subprocess
import unicodedata
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'laya-2026-10-16'
CACHE = OUT / 'tags-clasificados.jsonl'
V1 = OUT / 'tags-clasificados-v1.jsonl'
SEP = chr(31)
UMBRAL_V2 = 0.80
UMBRAL_DUDOSO = 0.50

PAISES = {'venezuela', 'venezuelan', 'mexico', 'mexican', 'spain', 'spanish', 'usa', 'united states', 'american',
          'colombia', 'colombian', 'argentina', 'argentinian', 'chile', 'chilean', 'peru', 'peruvian', 'cuba', 'cuban',
          'brazil', 'brasil', 'brazilian', 'italy', 'italian', 'france', 'french', 'germany', 'german', 'uk', 'england',
          'british', 'japan', 'japanese', 'canada', 'canadian', 'puerto rico', 'dominican', 'uruguay', 'uruguayan',
          'ecuador', 'bolivia', 'paraguay', 'costa rica', 'panama', 'honduras', 'guatemala', 'el salvador', 'nicaragua',
          'haiti', 'jamaica', 'russia', 'russian', 'sweden', 'norway', 'finland', 'poland', 'portugal', 'portuguese',
          'greece', 'turkey', 'australia', 'ireland', 'netherlands', 'belgium', 'switzerland', 'austria', 'hungary',
          'romania', 'ukraine', 'india', 'china', 'korea', 'korean', 'africa', 'latin', 'latino', 'latina',
          'latin america', 'latinamerica', 'latinoamerica', 'sudamerica', 'south america', 'north america', 'europe',
          'asia', 'caracas', 'maracaibo', 'valencia', 'barquisimeto', 'maracay', 'merida', 'venezolano', 'venezolana'}
IDIOMAS = {'spanish', 'espanol', 'español', 'ingles', 'english', 'italiano', 'french', 'frances', 'portugues',
           'german', 'aleman', 'instrumental', 'acoustic', 'acustico', 'live', 'en vivo', 'studio', 'cover', 'covers',
           'demo', 'remix', 'single', 'ep', 'album', 'compilation', 'female vocalist', 'female vocalists',
           'male vocalist', 'male vocalists', 'guitar', 'guitars', 'piano', 'drums', 'bass', 'saxophone', 'violin'}
ANIO = re.compile(r'^\d{2,4}s?$')


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    return o.stdout.strip()


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


vocab = set()
for l in (l.split(SEP)[0] for l in psql("SELECT name FROM ingest.genres").split('\n') if l.strip()):
    vocab.add(norm(l))
for l in (l.split(SEP)[0] for l in psql("SELECT alias_normalized FROM ingest.genre_aliases").split('\n') if l.strip()):
    vocab.add(norm(l))
print(f'vocabulario de géneros: {len(vocab)} términos')

filas = [json.loads(l) for l in open(CACHE)]
if not V1.exists():
    V1.write_text('\n'.join(json.dumps(f, ensure_ascii=False) for f in filas) + '\n')

res = {'vocab': 0, 'pais_idioma': 0, 'anio': 0, 'umbral': 0, 'mantenidos': 0, 'ya_no_expresaba': 0}
nuevas = []
for f in filas:
    tag = f['tag']
    # idempotente: si ya pasó por v2 (dudoso guardado), la categoría base es la original
    if f.get('dudoso'):
        cat = f['dudoso']
    else:
        cat = f['categoria']
    n = norm(tag)
    if cat == 'no_expresa_emocion':
        res['ya_no_expresaba'] += 1
    elif n in vocab:
        f['categoria'] = 'no_expresa_emocion'
        f['motivo_v2'] = 'vocabulario'
        res['vocab'] += 1
    elif n in PAISES or n in IDIOMAS:
        f['categoria'] = 'no_expresa_emocion'
        f['motivo_v2'] = 'pais_idioma'
        res['pais_idioma'] += 1
    elif ANIO.match(n):
        f['categoria'] = 'no_expresa_emocion'
        f['motivo_v2'] = 'anio'
        res['anio'] += 1
    elif f['p'] < UMBRAL_DUDOSO:
        f['categoria'] = 'no_expresa_emocion'
        f['motivo_v2'] = 'umbral'
        res['umbral'] += 1
    elif f['p'] < UMBRAL_V2:
        f['dudoso'] = f['categoria']
        f['categoria'] = 'dudoso'
        f['motivo_v2'] = 'entre_umbrales'
        res['dudoso'] = res.get('dudoso', 0) + 1
    else:
        res['mantenidos'] += 1
    nuevas.append(f)

CACHE.write_text('\n'.join(json.dumps(f, ensure_ascii=False) for f in nuevas) + '\n')
print('resumen v2:', json.dumps(res, ensure_ascii=False))
print('categorías resultantes:')
cats = {}
for f in nuevas:
    cats[f['categoria']] = cats.get(f['categoria'], 0) + 1
for k, v in sorted(cats.items(), key=lambda x: -x[1]):
    print(f'  {k}: {v}')
print('muestra mantenidas (para verificar a ojo):')
m = [f for f in nuevas if f['categoria'] != 'no_expresa_emocion']
for f in m[:20]:
    print(f"  {f['categoria']:<18} p={f['p']:.2f}  {f['tag'][:50]}")
