#!/usr/bin/env python3
"""CRV · Filtra el plan de reviews al alcance del catálogo.

De las fichas de RYM medidas por rym-reviews-plan.py, deja solo las que
corresponden a un disco que EXISTE en public.albums (mismo artista + título,
con tolerancia a acentos, paréntesis y sufijos tipo «(Bootleg)»/«Remaster»).

Motivo (2026-10-20): el plan completo eran 5.537 páginas, pero 4.253 no
correspondían a ningún disco del catálogo — discografías extranjeras completas
que entraron por fichas mal marcadas (Metallica/Sepultura con bootlegs
venezolanos) o artistas que no existen en la BD.

Escribe:
  <campaña>/tareas.jsonl         solo tareas del catálogo
  <campaña>/tareas-todas.jsonl   respaldo con el plan completo
  <campaña>/resumen.json         totales del alcance (los lee el tablero)
  <campaña>/fuera-de-alcance.jsonl  las fichas descartadas, con su motivo
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter
from pathlib import Path

REPO = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
RUIDO = re.compile(r'\b(bootleg|remaster|remastered|deluxe|edicion|edition|reissue|version|vinyl|cd)\b')
VACIAS = {'the', 'a', 'de', 'del', 'la', 'el', 'y', 'los', 'las'}


def slug(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r'\([^)]*\)|\[[^\]]*\]', ' ', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return re.sub(r'-+', '-', RUIDO.sub('', s)).strip('-')


def tokens(s: str) -> set[str]:
    return {t for t in s.split('-') if t and t not in VACIAS}


def catalogo() -> tuple[dict[str, list[str]], dict[str, str]]:
    q = ("select ar.name || '\t' || al.title || '\t' || coalesce(ar.origin_country,'') "
         "from public.albums al join public.artists ar on ar.id = al.artist_id;")
    r = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv',
                        '-tAF', '\t', '-c', q], capture_output=True, text=True, timeout=300)
    discos: dict[str, list[str]] = {}
    pais: dict[str, str] = {}
    for linea in r.stdout.splitlines():
        partes = linea.split('\t')
        if len(partes) < 3:
            continue
        artista, titulo, p = partes[0], partes[1], partes[2]
        discos.setdefault(slug(artista), []).append(slug(titulo))
        pais.setdefault(slug(artista), p)
    if not discos:
        raise SystemExit('no se pudo leer public.albums (¿docker crv-postgres arriba?)')
    return discos, pais


def coincide(artista: str, titulo: str, discos: dict[str, list[str]]) -> str | None:
    for ct in discos.get(artista, []):
        if ct == titulo:
            return 'exacto'
        if ct and titulo and (ct in titulo or titulo in ct):
            return 'difuso'
        ta, tb = tokens(ct), tokens(titulo)
        if ta and tb and len(ta & tb) / len(ta | tb) >= 0.6:
            return 'difuso'
    return None


def main() -> int:
    camp = REPO / (sys.argv[1] if len(sys.argv) > 1 else 'data/raw/rym-reviews-2026-10-20')
    discos, pais = catalogo()
    fichas = [json.loads(l) for l in (camp / 'plan-fichas.jsonl').open(encoding='utf-8')]
    tareas_todas = [json.loads(l) for l in (camp / 'tareas.jsonl').open(encoding='utf-8')]

    dentro, fuera = [], []
    for f in fichas:
        partes = [p for p in f['href'].strip('/').split('/') if p]
        artista = slug(partes[2]) if len(partes) > 2 else ''
        titulo = slug(partes[3]) if len(partes) > 3 else ''
        tipo = coincide(artista, titulo, discos)
        if tipo:
            f['match'] = tipo
            f['pais_bd'] = pais.get(artista)
            dentro.append(f)
        else:
            f['motivo'] = 'artista fuera de la BD' if artista not in discos else 'disco no está en el catálogo'
            fuera.append(f)

    bases = {f['base'] for f in dentro}
    tareas = [t for t in tareas_todas if t['base'] in bases]
    tareas.sort(key=lambda t: (t['page'], -t['declaradas'], t['base']))
    (camp / 'tareas-todas.jsonl').write_text(
        ''.join(json.dumps(t, ensure_ascii=False) + '\n' for t in tareas_todas), encoding='utf-8')
    (camp / 'tareas.jsonl').write_text(
        ''.join(json.dumps(t, ensure_ascii=False) + '\n' for t in tareas), encoding='utf-8')
    (camp / 'fuera-de-alcance.jsonl').write_text(
        ''.join(json.dumps(f, ensure_ascii=False) + '\n' for f in fuera), encoding='utf-8')

    por_pais = Counter(f.get('pais_bd') or '(sin país)' for f in dentro)
    resumen = {
        'alcance': 'catalogo',
        'fichas_con_reviews': len(dentro),
        'paginas_necesarias': sum(f['paginas'] for f in dentro),
        'paginas_hechas': sum(f['paginas_hechas'] for f in dentro),
        'paginas_pendientes': len(tareas),
        'fichas_pendientes': len({t['base'] for t in tareas}),
        'fichas_paginadas': sum(1 for f in dentro if f['paginas'] >= 2),
        'paginas_1_pendientes': sum(1 for t in tareas if t['page'] == 1),
        'subpaginas_pendientes': sum(1 for t in tareas if t['page'] > 1),
        'declaradas_totales': sum(f['declaradas'] for f in dentro),
        'descartadas_fichas': len(fuera),
        'descartadas_paginas': sum(len(f['paginas_pendientes']) for f in fuera),
        'descartadas_por_motivo': dict(Counter(f['motivo'] for f in fuera)),
        'fichas_por_pais_bd': dict(por_pais.most_common()),
        'generado': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
    }
    (camp / 'resumen.json').write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(resumen, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
