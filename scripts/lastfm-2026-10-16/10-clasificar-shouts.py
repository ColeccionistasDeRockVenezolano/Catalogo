#!/usr/bin/env python3
"""Clasifica los comentarios (shouts) con Laya y los agrega a entity_emotions.

Los shouts son conversación, no folksonomía: el léxico de candidatura excluye lo
que en texto libre es ruido medido — «fuck» como intensificador («fucking amazing»,
579 casos) y «cry» por bandas como Cryptopsy. El resto de la cadena es la misma:
raíz de fuerza → emoción fija si Laya da p≥0.50; raíz candidata → ≥0.80 clara,
0.50–0.80 `dudoso` (no se publica); sin raíz → no se clasifica.

Escribe: `entity_shouts.emotions` y el agregado `entity_emotions` (basis='shouts',
score = nº de comentarios × 20, detail con los textos). Reanudable por caché.
Uso: python3 scripts/lastfm-2026-10-16/10-clasificar-shouts.py [--limite=N]
"""
from __future__ import annotations

raise SystemExit('+shoutbox retirado por Brian (2026-10-16): no clasificar ni publicar comentarios o cachés históricos.')

import json
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

ROOT = Path('/home/brian/apps/Coleccionistas De Rock Venezolano')
OUT = ROOT / 'reports' / 'laya-shouts-2026-10-16'
CACHE = OUT / 'shouts-clasificados.jsonl'
LOG = OUT / 'shouts.log'
LEXICO = ROOT / 'scripts' / 'lastfm-2026-10-16' / 'lexico-emocional.json'
SEP = chr(31)
UMBRAL_CLARA = 0.80
UMBRAL_DUDOSO = 0.50
# Ruido medido en texto libre (2026-10-16): intensificador y nombre de banda.
EXCLUIR_RAICES = {'fuck', 'cry'}
# Un comentario expresa emoción DE LA MÚSICA solo si habla de ella (o de lo que
# le hace a quien escribe): sin esto, «suck my dick» entre metaleros entraba
# como «cachonda» (medido: Metallica, Sepultura, Blasphemy). Lista corta y
# medida: señales musicales, valoraciones y primera persona.
SENALES = ['music', 'musica', 'song', 'cancion', 'album', 'disco', 'sound', 'sonido', 'track',
           'listen', 'escuch', 'i love', 'me encanta', 'me gusta', 'adoro', ' amo ', 'best ',
           'favorit', 'perfect', 'genial', 'brutal', 'makes me', 'me hace', 'me pone', 'me vuelve',
           'i feel', 'me siento', 'im hot', 'i m hot', 'orgasm', 'sexy']
LIMITE = int(next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--limite=')), '0') or 0)

CATS_EN = {
    'tristeza': 'The comment expresses sadness, melancholy, nostalgia, pain or loneliness.',
    'enfocado': 'The comment expresses focus, clarity, motivation or energy to get things done.',
    'libertad': 'The comment expresses release, partying, euphoria, rebellion, carefreeness or catharsis.',
    'cachonda': 'The comment expresses sexual desire, eroticism, seduction or arousal.',
    'aumenta_mi_aura': 'The comment expresses grandeur, power, confidence or epicness (energy that lifts you up).',
    'ninguna': 'The comment does not express any feeling: it is a genre, country, era, instrument or other objective data.',
}
PREGUNTAS = {k: {'type': 'noul', 'instructions': v} for k, v in CATS_EN.items()}
# Gate de intención (medido 2026-10-16): en texto libre la emoción solo cuenta
# si el comentario es una apreciación real; «anal sex sounds better than this»
# (insulto), copypastas y peleas entre usuarios no lo son.
PREGUNTA_GATE = {'type': 'noul', 'instructions':
    'This comment is a genuine appreciation of the music or of how it makes the listener feel '
    '(not an insult, a joke, spam, a copypasta, or an argument with another user).'}
UMBRAL_GATE = 0.5


def log(msg: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a') as f:
        f.write(f'{time.strftime("%H:%M:%S")} {msg}\n')
    print(msg, flush=True)


def psql(sql: str) -> str:
    o = subprocess.run(['docker', 'exec', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-tA', '-F', SEP, '-c', sql], capture_output=True, text=True)
    return o.stdout.strip()


def esc(s: str) -> str:
    return s.replace("'", "''")


def norm(s: str) -> str:
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').replace('ñ', 'n')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


lex = json.load(open(LEXICO))
FUERZAS = [(e, r) for e, rs in lex['fuerzas'].items() for r in rs if r not in EXCLUIR_RAICES]
CANDIDATAS = [c for c in lex.get('candidatas', []) if c not in EXCLUIR_RAICES]
EXACTAS = {k: v for k, v in lex.get('exactas', {}).items() if k not in EXCLUIR_RAICES}


def match(n: str, r: str) -> bool:
    if ' ' in r or len(r) >= 7:
        return r in n
    return any(w.startswith(r) for w in n.split())


def raiz_de(n: str) -> tuple[str, str] | None:
    for w in n.split():
        if w in EXACTAS:
            return EXACTAS[w], w
    for emo, r in FUERZAS:
        if match(n, r):
            return emo, r
    r = next((c for c in CANDIDATAS if match(n, c)), None)
    return ('', r) if r else None


def candidatos() -> list[dict]:
    filas = [l.split(SEP) for l in psql("SELECT id, artist_id, replace(text, E'\\n', ' ') FROM public.entity_shouts WHERE emotions IS NULL ORDER BY id").split('\n') if l.strip()]
    out = []
    for f in filas:
        if len(f) < 3:
            continue
        n = norm(f[2])
        if not any(s in n for s in SENALES):
            continue
        r = raiz_de(n)
        if r:
            out.append({'id': int(f[0]), 'artist_id': int(f[1]), 'text': f[2][:600], 'emo_fija': r[0], 'raiz': r[1]})
    return out


def main() -> None:
    hechos: dict[int, dict] = {}
    if CACHE.exists():
        for l in open(CACHE):
            try:
                d = json.loads(l)
                hechos[d['id']] = d
            except Exception:
                pass
    pend = [c for c in candidatos() if c['id'] not in hechos]
    log(f'shouts: {len(hechos)} ya clasificados, {len(pend)} pendientes con léxico')
    if pend:
        from laya import Router
        router = Router(default='multilingual')
        t0 = time.time()
        n = 0
        with open(CACHE, 'a') as fh:
            for c in pend:
                if LIMITE and n >= LIMITE:
                    break
                try:
                    r = router.predict(c['text'], PREGUNTAS)
                    a = r['answers']
                    probs = {k: round(float(a[k].get('noul') or 0), 4) for k in CATS_EN}
                except Exception as e:
                    log(f"  shout {c['id']}: {type(e).__name__}: {e}")
                    continue
                cats = {k: v for k, v in probs.items() if k != 'ninguna'}
                mejor = max(cats, key=cats.get)
                # En texto libre NO se fuerza por raíz (medido: los ruidos caen
                # en 0.64–0.67 y los testimonios reales en ≥0.80): decide Laya.
                if probs['ninguna'] >= UMBRAL_CLARA or cats[mejor] < UMBRAL_DUDOSO:
                    categoria, p = 'no_expresa_emocion', cats[mejor]
                elif cats[mejor] >= UMBRAL_CLARA:
                    categoria, p = mejor, cats[mejor]
                else:
                    categoria, p = 'dudoso', cats[mejor]
                fila = {'id': c['id'], 'artist_id': c['artist_id'], 'text': c['text'], 'raiz': c['raiz'],
                        'categoria': categoria, 'p': p, 'probs': probs}
                fh.write(json.dumps(fila, ensure_ascii=False) + '\n')
                fh.flush()
                hechos[c['id']] = fila
                n += 1
                if n % 100 == 0:
                    el = time.time() - t0
                    log(f'  {n}/{len(pend)} · {el/60:.1f} min · ETA {el/n*(len(pend)-n)/60:.1f} min')
        log(f'clasificación FIN: {n} nuevos')

    # Gate de intención: solo los clasificados como emoción (no reanudados ya).
    por_gatear = [h for h in hechos.values() if h['categoria'] not in ('no_expresa_emocion', 'dudoso') and 'gate' not in h]
    if por_gatear:
        from laya import Router
        router = Router(default='multilingual')
        t0 = time.time()
        n = 0
        for h in por_gatear:
            try:
                r = router.predict(h['text'], {'g': PREGUNTA_GATE})
                h['gate'] = round(float(r['answers']['g'].get('noul') or 0), 4)
            except Exception as e:
                log(f"  gate {h['id']}: {type(e).__name__}: {e}")
                continue
            n += 1
            if n % 100 == 0:
                el = time.time() - t0
                log(f'  gate {n}/{len(por_gatear)} · {el/60:.1f} min · ETA {el/n*(len(por_gatear)-n)/60:.1f} min')
        with open(CACHE, 'w') as fh:
            for h in hechos.values():
                fh.write(json.dumps(h, ensure_ascii=False) + '\n')
        log(f'gate FIN: {n} evaluados')

    aplicar(hechos)


def aplicar(hechos: dict[int, dict]) -> None:
    log(f'aplicando {len(hechos)} clasificaciones...')
    sql = ['BEGIN;']
    for h in hechos.values():
        cat = h['categoria']
        if cat not in ('no_expresa_emocion', 'dudoso') and not any(s in norm(h['text']) for s in SENALES):
            cat = 'no_expresa_emocion'  # grosería de conversación, no emoción musical
        if cat not in ('no_expresa_emocion', 'dudoso') and h.get('gate', 1) < UMBRAL_GATE:
            cat = 'no_expresa_emocion'  # insulto, broma o spam (gate de intención)
        h['cat_efectiva'] = cat
        j = json.dumps({'categoria': cat, 'p': h['p'], 'raiz': h['raiz'], 'gate': h.get('gate'), 'modelo': 'laya-shouts-v3'}, ensure_ascii=False)
        sql.append(f"UPDATE public.entity_shouts SET emotions = '{esc(j)}'::jsonb WHERE id = {h['id']};")
    sql.append("DELETE FROM public.entity_emotions WHERE basis = 'shouts';")
    agg: dict[tuple[int, str], list[dict]] = {}
    for h in hechos.values():
        if h['cat_efectiva'] in ('no_expresa_emocion', 'dudoso'):
            continue
        agg.setdefault((h['artist_id'], h['cat_efectiva']), []).append(h)
    # Evidencia mínima de comentarios: un solo shout no convierte a un artista en
    # «música para tener sexo». Los tags ya ponderan por weight; los comentarios
    # exigen >= 2 testimonios.
    agg = {k: v for k, v in agg.items() if len(v) >= 2}
    for (aid, emo), hs in agg.items():
        detail = json.dumps({'shouts': [{'author': '', 'text': h['text'][:200]} for h in hs[:25]]}, ensure_ascii=False)
        score = len(hs) * 20
        sql.append("INSERT INTO public.entity_emotions (artist_id, emotion, basis, score, evidence, detail, model_version) VALUES "
                   f"({aid},'{esc(emo)}','shouts',{score},{len(hs)},'{esc(detail)}'::jsonb,'laya-shouts-v3') "
                   "ON CONFLICT (artist_id, emotion, basis) WHERE artist_id IS NOT NULL DO UPDATE SET score = EXCLUDED.score, evidence = EXCLUDED.evidence, detail = EXCLUDED.detail, model_version = EXCLUDED.model_version, computed_at = now();")
    sql.append('COMMIT;')
    o = subprocess.run(['docker', 'exec', '-i', 'crv-postgres', 'psql', '-U', 'crv', '-d', 'crv', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                       input='\n'.join(sql), capture_output=True, text=True)
    if o.returncode != 0:
        log(f'ERROR aplicar: {o.stderr[-400:]}')
        raise SystemExit(1)
    log('aplicado OK · ' + psql("SELECT count(*) || ' filas, ' || count(DISTINCT artist_id) || ' artistas' FROM public.entity_emotions WHERE basis='shouts'"))
    log('top: ' + psql("SELECT string_agg(emotion || '=' || n, ' ') FROM (SELECT emotion, count(*) n FROM public.entity_emotions WHERE basis='shouts' GROUP BY emotion ORDER BY 2 DESC LIMIT 6) t"))


if __name__ == '__main__':
    main()
