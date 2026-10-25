#!/usr/bin/env python3
"""Clasificación emocional de los tags de usuario con Laya (primera pasada, 2026-10-16).

Diseño MEDIDO (el mejor de 5, 12/16 en muestra): checkpoint multilingual; 6 preguntas
`noul` en inglés (tristeza · enfocado · libertad · cachonda · aura · ninguna);
state = tag desnudo; decisión = mejor categoría con prob >= 0.5 — si `ninguna` >= 0.5
o ninguna categoría llega a 0.5, el tag es `no_expresa_emocion`. Las probabilidades
completas se guardan para recalibrar (model_version por fila).

Escribe:
  entity_user_tags.emotions  (jsonb por tag: categoría + probs)
  entity_emotions (basis='tags') por artista: score = suma ponderada de weights de los
  tags de esa emoción; detail con los tags que la sustentan.

Reanudable: reports/laya-2026-10-16/tags-clasificados.jsonl.
Uso: /home/brian/.venvs/laya/bin/python scripts/lastfm-2026-10-16/05-laya-clasificar.py [--limite=N] [--apply-only]
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'laya-2026-10-16'
OUT.mkdir(parents=True, exist_ok=True)
CACHE = OUT / 'tags-clasificados.jsonl'
LOG = OUT / 'laya.log'
SEP = chr(31)
MODEL_VERSION = 'laya-multilingual-noul-en-v3-lexico'
LIMITE = int(next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--limite=')), '0') or 0)
APPLY_ONLY = '--apply-only' in sys.argv
CLASSIFY_ONLY = '--classify-only' in sys.argv

CATS_EN = {
    'tristeza': 'The tag expresses sadness, melancholy, nostalgia, pain or loneliness.',
    'enfocado': 'The tag expresses focus, clarity, motivation or energy to get things done.',
    'libertad': 'The tag expresses release, partying, euphoria, rebellion, carefreeness or catharsis.',
    'cachonda': 'The tag expresses sexual desire, eroticism, seduction or arousal.',
    'aumenta_mi_aura': 'The tag expresses grandeur, power, confidence or epicness (energy that lifts you up).',
    'ninguna': 'The tag does not express any feeling: it is a genre, country, era, instrument or other objective data.',
}
PREGUNTAS = {k: {'type': 'noul', 'instructions': v} for k, v in CATS_EN.items()}
UMBRAL = 0.5


def log(msg: str) -> None:
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} {msg}\n')
    print(msg, flush=True)


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    return o.stdout.strip()


def clasificar() -> dict[str, dict]:
    hechos: dict[str, dict] = {}
    if CACHE.exists():
        for l in open(CACHE):
            try:
                d = json.loads(l)
                hechos[d['tag']] = d
            except Exception:
                pass
    tags = [l.strip() for l in psql("SELECT DISTINCT lower(tag) FROM public.entity_user_tags ORDER BY 1").split('\n') if l.strip()]
    pend = [t for t in tags if t not in hechos]
    log(f'clasificación: {len(tags)} tags únicos, {len(hechos)} ya clasificados, {len(pend)} pendientes')
    if APPLY_ONLY or not pend:
        return hechos
    from laya import Router

    router = Router(default='multilingual')
    t0 = time.time()
    n = 0
    with open(CACHE, 'a') as fh:
        for tag in pend:
            if LIMITE and n >= LIMITE:
                break
            try:
                r = router.predict(tag, PREGUNTAS)
                a = r['answers']
                probs = {k: round(float(a[k].get('noul') or 0), 4) for k in CATS_EN}
            except Exception as e:
                log(f'  tag "{tag[:40]}": {type(e).__name__}: {e}')
                continue
            cats = {k: v for k, v in probs.items() if k != 'ninguna'}
            mejor = max(cats, key=cats.get)
            categoria = 'no_expresa_emocion' if (probs['ninguna'] >= UMBRAL or cats[mejor] < UMBRAL) else mejor
            fila = {'tag': tag, 'categoria': categoria, 'p': cats[mejor], 'ninguna': probs['ninguna'], 'probs': probs}
            fh.write(json.dumps(fila, ensure_ascii=False) + '\n')
            fh.flush()
            hechos[tag] = fila
            n += 1
            if n % 100 == 0:
                el = time.time() - t0
                log(f'  {n}/{len(pend)} · {el/60:.1f} min · ETA {el/n*(len(pend)-n)/60:.1f} min')
    log(f'clasificación FIN: {n} nuevos')
    return hechos


def aplicar(hechos: dict[str, dict]) -> None:
    log(f'aplicando {len(hechos)} clasificaciones a la base...')
    esc = lambda s: s.replace("'", "''")
    decisiones = {}
    for line in psql("SELECT tag_key, category FROM ingest.emotion_tag_decisions").split('\n'):
        if SEP in line:
            tag_key, category = line.split(SEP, 1)
            decisiones[tag_key] = category
    with open(OUT / 'laya-apply.partial.sql', 'w') as fh:
        fh.write('BEGIN;\n')
        for tag, d in hechos.items():
            decision = decisiones.get(tag.lower())
            j = json.dumps({'categoria': decision or d['categoria'], 'p': d['p'], 'modelo': MODEL_VERSION,
                            'probs': d['probs'], 'decision': 'editorial' if decision else 'modelo'}, ensure_ascii=False)
            # Releer la decisión en la transacción de aplicación, no confiar en el snapshot del modelo.
            fh.write(f"UPDATE public.entity_user_tags SET emotions = '{j}'::jsonb || "
                     f"COALESCE((SELECT jsonb_build_object('categoria',category,'decision','editorial') "
                     f"FROM ingest.emotion_tag_decisions WHERE tag_key='{esc(tag.lower())}'), '{{}}'::jsonb) "
                     f"WHERE lower(tag) = '{esc(tag)}';\n")
        # agregado por artista (basis='tags'): solo emociones expresadas
        fh.write("DELETE FROM public.entity_emotions WHERE basis = 'tags';\n")
        fh.write("""INSERT INTO public.entity_emotions (artist_id, emotion, basis, score, evidence, detail, model_version)
SELECT artist_id, emotions->>'categoria', 'tags', sum(weight)::real, count(*)::int,
       jsonb_build_object('tags', jsonb_agg(jsonb_build_object('tag',tag,'weight',weight) ORDER BY weight DESC)),
       'laya-editorial-v1'
  FROM public.entity_user_tags
 WHERE artist_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM ingest.lastfm_artist_verifications v WHERE v.artist_id=entity_user_tags.artist_id)
   AND emotions->>'categoria' IN ('emocion','tristeza','enfocado','libertad','cachonda','aumenta_mi_aura')
 GROUP BY artist_id, emotions->>'categoria';
""")
        fh.write('COMMIT;\n')
    o = subprocess.run(['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                       input=open(OUT / 'laya-apply.partial.sql').read(), capture_output=True, text=True)
    if o.returncode != 0:
        log(f'ERROR aplicar: {o.stderr[-400:]}')
        raise SystemExit(1)

    log('aplicado OK')
    log('tags con emoción: ' + psql("SELECT count(*) FROM public.entity_user_tags WHERE emotions->>'categoria' <> 'no_expresa_emocion' AND emotions IS NOT NULL"))
    log('entity_emotions: ' + psql("SELECT count(*) || ' filas, ' || count(DISTINCT artist_id) || ' artistas' FROM public.entity_emotions WHERE basis='tags'"))
    log('top emociones: ' + psql("SELECT string_agg(emotion || '=' || n, ' ') FROM (SELECT emotion, count(*) n FROM public.entity_emotions WHERE basis='tags' GROUP BY emotion ORDER BY 2 DESC LIMIT 6) t"))


if __name__ == '__main__':
    log(f'INICIO (limite={LIMITE}, apply_only={APPLY_ONLY})')
    hechos = clasificar()
    if not CLASSIFY_ONLY:
        aplicar(hechos)
    log('FIN')
