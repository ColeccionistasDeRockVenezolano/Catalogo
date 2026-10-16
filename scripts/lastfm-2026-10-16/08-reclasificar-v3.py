#!/usr/bin/env python3
"""Re-decisión v3.1 (2026-10-16): la emoción debe ser EXPRESABLE en el tag.

Diagnóstico medido (v1→v2→v3): Laya puntúa ≥0.80 emociones para tags que no
reconoce («angola»→tristeza, «malalma»→tristeza, «sexy»→aura). Regla v3.1:

  1. Palabra de género (ingest.genres/alias, >=4 letras), país, idioma o año
     → `no_expresa_emocion`.
  2. Raíz del léxico con emoción FORZADA (lexico-emocional.json: fuerzas,
     exactas) → esa emoción, sin umbral (la evidencia es la palabra).
  3. Raíz candidata (léxico: candidatas) → decide Laya: p >= 0.80 emoción,
     0.50–0.80 `dudoso`, < 0.50 `no_expresa_emocion`.
  4. Sin raíz → `no_expresa_emocion`.
  5. Clase ganadora de Laya «ninguna» → `no_expresa_emocion`.

Idempotente: la base se recalcula SIEMPRE del argmax de `probs` (crudas de
Laya), nunca de una categoría ya forzada. Respalda en tags-clasificados-v2.jsonl
(solo la primera vez). Re-aplicar con `05-laya-clasificar.py --apply-only`.
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
V2 = OUT / 'tags-clasificados-v2.jsonl'
LEXICO = ROOT / 'scripts' / 'lastfm-2026-10-16' / 'lexico-emocional.json'
SEP = chr(31)
UMBRAL_V3 = 0.80
UMBRAL_DUDOSO = 0.50

lex = json.load(open(LEXICO))
FILTROS: list[str] = [t for c in lex['filtros'].values() if isinstance(c, list) for t in c]
FUERZAS = [(e, r) for e, rs in lex['fuerzas'].items() for r in rs]
CANDIDATAS = list(lex.get('candidatas', []))
EXACTAS = dict(lex.get('exactas', {}))
ANIO = re.compile(r'^\d{2,4}s?$')


def toca_filtro(n: str) -> bool:
    for f in FILTROS:
        if ' ' in f:
            if f in n:
                return True
        elif any(w.startswith(f) for w in n.split()):
            return True
    return False


def psql(sql: str) -> str:
    o = subprocess.run(['docker','exec','crv-postgres','psql','-U','crv','-d','crv','-tA','-F',SEP,'-c',sql], capture_output=True, text=True)
    return o.stdout.strip()


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').replace('ñ', 'n')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


palabras_genero: set[str] = set()
for l in (l.split(SEP)[0] for l in psql("SELECT name FROM ingest.genres UNION SELECT alias_normalized FROM ingest.genre_aliases").split('\n') if l.strip()):
    for w in norm(l).split():
        if len(w) >= 4:
            palabras_genero.add(w)
print(f'palabras de género: {len(palabras_genero)} · filtros: {len(FILTROS)}')


def match_raiz(tag_norm: str, r: str) -> bool:
    if ' ' in r or len(r) >= 7:
        return r in tag_norm
    ws = tag_norm.split()
    return any(w.startswith(r) for w in ws)


def fuerza(tag_norm: str) -> tuple[str, str] | None:
    for w in tag_norm.split():
        if w in EXACTAS:
            return EXACTAS[w], w
    for emo, r in FUERZAS:
        if match_raiz(tag_norm, r):
            return emo, r
    return None


filas = [json.loads(l) for l in open(CACHE)]
if not V2.exists():
    V2.write_text('\n'.join(json.dumps(f, ensure_ascii=False) for f in filas) + '\n')

res = {'genero': 0, 'pais_idioma': 0, 'anio': 0, 'ninguna': 0, 'forzadas': 0, 'forzada_debil': 0, 'candidata_clara': 0, 'candidata_dudosa': 0, 'sin_lexico': 0, 'umbral': 0}
nuevas = []
for f in filas:
    n = norm(f['tag'])
    probs = f.get('probs', {})
    base = max(probs, key=probs.get) if probs else f.get('dudoso') or f['categoria']
    f.pop('motivo_v2', None)
    f.pop('dudoso', None)
    f.pop('raiz', None)
    if base == 'ninguna':
        f['categoria'] = 'no_expresa_emocion'; f['motivo_v3'] = 'laya_ninguna'; f['p'] = probs.get('ninguna', f['p']); res['ninguna'] += 1
    elif toca_filtro(n):
        f['categoria'] = 'no_expresa_emocion'; f['motivo_v3'] = 'pais_idioma'; res['pais_idioma'] += 1
    elif ANIO.match(n):
        f['categoria'] = 'no_expresa_emocion'; f['motivo_v3'] = 'anio'; res['anio'] += 1
    elif any(w in palabras_genero for w in n.split()):
        f['categoria'] = 'no_expresa_emocion'; f['motivo_v3'] = 'genero'; res['genero'] += 1
    else:
        fr = fuerza(n)
        if fr is not None:
            emo, r = fr
            pe = probs.get(emo, f['p'])
            f['raiz'] = r
            if pe >= UMBRAL_DUDOSO:
                f['p_laya'] = f['p']
                f['p'] = pe
                f['categoria'] = emo; f['motivo_v3'] = 'forzada_lexico'; res['forzadas'] += 1
            else:
                # La palabra apunta a una emoción pero Laya no la ve creíble
                # («sex pistols»→sexo con p=0.12): no se fuerza.
                f['categoria'] = 'no_expresa_emocion'; f['motivo_v3'] = 'forzada_debil'; f['p'] = pe; res['forzada_debil'] += 1
        else:
            r = next((c for c in CANDIDATAS if match_raiz(n, c)), None)
            if r is None:
                f['categoria'] = 'no_expresa_emocion'; f['motivo_v3'] = 'sin_lexico'; res['sin_lexico'] += 1
            else:
                f['raiz'] = r
                if probs.get(base, f['p']) < UMBRAL_DUDOSO:
                    f['categoria'] = 'no_expresa_emocion'; f['motivo_v3'] = 'umbral'; res['umbral'] += 1
                elif probs.get(base, f['p']) < UMBRAL_V3:
                    f['dudoso'] = base; f['categoria'] = 'dudoso'; f['p'] = probs.get(base, f['p']); f['motivo_v3'] = 'entre_umbrales'; res['candidata_dudosa'] += 1
                else:
                    f['categoria'] = base; f['p'] = probs.get(base, f['p']); f['motivo_v3'] = 'candidata_clara'; res['candidata_clara'] += 1
    nuevas.append(f)

CACHE.write_text('\n'.join(json.dumps(f, ensure_ascii=False) for f in nuevas) + '\n')
print('resumen v3.1:', json.dumps(res, ensure_ascii=False))
print('\n--- EMOCIONES CLARAS (tag | emoción | p | raíz | motivo) ---')
for f in sorted([f for f in nuevas if f['categoria'] not in ('no_expresa_emocion','dudoso')], key=lambda x: (x['categoria'], -x['p'])):
    print(f"  {f['tag'][:44]:<44} {f['categoria']:<16} p={f['p']:.2f}  [{f.get('raiz','')}] {f.get('motivo_v3','')}")
print('\n--- DUDOSOS, top 40 por p (tag | candidata | p | raíz) ---')
for f in sorted([f for f in nuevas if f['categoria'] == 'dudoso'], key=lambda x: -x['p'])[:40]:
    print(f"  {f['tag'][:44]:<44} {f.get('dudoso',''):<16} p={f['p']:.2f}  [{f.get('raiz','')}]")
