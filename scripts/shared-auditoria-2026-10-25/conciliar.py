#!/usr/bin/env python3
"""Cruza candidatos, decisiones archivadas, diario y snapshot actual; no aplica datos."""
import collections
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUD = ROOT / 'reports/shared-auditoria-profunda-2026-10-25'
APP = ROOT / 'reports/shared-auditoria-aplicacion-2026-10-25'
OUT = Path(sys.argv[1]).resolve()
if '/crv-staging/' not in str(OUT):
    raise SystemExit('Usar staging SSD')


def rows(p):
    with p.open() as f:
        return [json.loads(l) for l in f if l.strip()]


def dump(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def jsonl(name, data):
    with (OUT / name).open('w') as f:
        for r in data:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')


def key(kind, ident, field):
    return kind, str(ident), 'label_id' if field == 'label_name' else field


tables = {k: {str(r['id']): r for r in rows(OUT / f'public-{t}.jsonl')}
          for k, t in [('artist', 'artists'), ('album', 'albums'), ('track', 'tracks'), ('person', 'persons')]}
policy = {r['artist_id']: r for r in rows(OUT / 'ingest-artist_editorial_policy.jsonl')}
gaps = rows(AUD / 'huecos-con-candidatos-agrupados.jsonl')
journal = rows(OUT / 'ingest-change_journal.jsonl')
changes = collections.defaultdict(list)
for j in journal:
    if j['table_name'].startswith('public.') and j['op'] == 'U':
        kind = {'artists': 'artist', 'albums': 'album', 'tracks': 'track', 'persons': 'person'}.get(j['table_name'].split('.')[1])
        for field, val in j['new_data'].items():
            if kind:
                changes[key(kind, j['row_pk']['id'], field)].append({'runId': j['run_id'], 'value': val, 'oldValue': j['old_data'].get(field)})

verdicts = {}
for fn in ['verif-album-fields.jsonl', 'verif-durations.jsonl', 'verif-images.jsonl']:
    for r in rows(APP / 'verificacion' / fn):
        k = key(r.get('kind', 'track' if 'trackId' in r else 'album'), r.get('id', r.get('trackId', r.get('albumId'))), r.get('field', 'duration_seconds'))
        verdicts[k] = r
plans = collections.defaultdict(list)
plan_rows = []
for f in sorted(APP.glob('plan-*.jsonl')):
    for r in rows(f):
        plans[key(r['kind'], r['id'], r['field'])].append(r)
        plan_rows.append({**r, 'plan': f.name})

final_rejections = {}
for r in json.loads((APP / 'pendientes/sellos-excluidos.json').read_text()):
    final_rejections[key('album', r['albumId'], 'label_id')] = r['motivo']
for r in json.loads((APP / 'pendientes/generos-excluidos.json').read_text()):
    final_rejections[key(r['kind'], r['entityId'], 'genre')] = r['motivo']
for r in verdicts.values():
    if r.get('field') == 'media_format' and str(r.get('value', '')).lower() in ['ep', 'lp', 'single', 'album']:
        final_rejections[key('album', r['albumId'], 'media_format')] = 'build_plans.py: tipo de publicación, no soporte'
for ident, reason in [('4675', 'Dark Manthra: identidad colombiana'), ('2726', 'Trujillo: DJ homónimo'),
                      ('6111', 'Conjunto Santa Anita: Argentina'), ('2672', 'Yare: sello, no artista')]:
    final_rejections[key('artist', ident, 'picture_url')] = 'INFORME de aplicación: ' + reason
final_rejections[key('artist', '1287', 'logo_url')] = 'INFORME de aplicación: Nemesis, dos bandas; identidad por resolver'

genre_primary = set()
for kind in ['artist', 'album']:
    for r in rows(OUT / f'ingest-{kind}_genres.jsonl'):
        if r['status'] == 'confirmed' and r['role'] == 'primary':
            genre_primary.add((kind, str(r[kind + '_id'])))

reconciled = []
for g in gaps:
    k = key(g['kind'], g['id'], g['field'])
    ent = tables[g['kind']].get(str(g['id']))
    field = k[2]
    val = ent.get(field) if ent else None
    filled = val is not None and str(val).strip() != ''
    if g['field'] == 'genre' and (g['kind'], str(g['id'])) in genre_primary:
        filled = True
    aid = (ent or {}).get('artist_id')
    if g['kind'] == 'artist': aid = str(g['id'])
    if g['kind'] == 'track': aid = tables['album'].get(str((ent or {}).get('album_id')), {}).get('artist_id')
    pol = policy.get(str(aid))
    v = verdicts.get(k)
    if not ent: state = 'entidad_inexistente'
    elif filled: state = 'campo_cubierto_actualmente'
    elif pol and pol['disposition'] != 'catalog': state = 'vacio_con_politica_editorial'
    elif k in final_rejections: state = 'excluido_en_decision_final_documentada'
    elif v and v['verdict'] == 'autoedicion': state = 'autoedicion_sin_campo'
    elif v and v['verdict'] == 'fuentes_discrepan': state = 'discrepancia_pendiente'
    elif v and v['verdict'] == 'rechazado': state = 'descartado_por_verificador'
    elif v and v['verdict'] == 'aceptado': state = 'aceptado_en_verificador_pero_aun_vacio'
    else: state = 'sin_dictamen_individual_estructurado'
    reconciled.append({'kind': g['kind'], 'id': str(g['id']), 'name': g['name'], 'artist': g['artist'],
        'field': g['field'], 'state': state, 'filled': filled, 'current': val,
        'verification': v.get('verdict') if v else None, 'plans': len(plans[k]), 'journal': changes[k],
        'finalRejectionReason': final_rejections.get(k),
        'editorialPolicy': {x: pol[x] for x in ['disposition', 'reason']} if pol else None,
        'candidates': [x['value'] for x in g['values']]})
jsonl('conciliacion-7714.jsonl', reconciled)
with (OUT / 'PENDIENTES.csv').open('w') as f:
    cols = ['kind', 'id', 'name', 'artist', 'field', 'state', 'verification', 'plans', 'candidates']
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader()
    for r in reconciled:
        if not r['filled']:
            d = {k: r[k] for k in cols}; d['candidates'] = json.dumps(d['candidates'], ensure_ascii=False); w.writerow(d)

plan_checks = []
for r in plan_rows:
    k = key(r['kind'], r['id'], r['field'])
    val = tables[r['kind']].get(str(r['id']), {}).get(r['field'])
    if str(val) == str(r['value']): state = 'valor_plan_presente'
    elif r['field'] in ['lyrics', 'biography'] and isinstance(val, str) and isinstance(r['value'], str) and unicodedata.normalize('NFC', val).split() == unicodedata.normalize('NFC', r['value']).split(): state = 'valor_plan_presente_normalizado'
    elif val is None or str(val).strip() == '': state = 'vacio'
    else: state = 'valor_diferente'
    plan_checks.append({'kind': r['kind'], 'id': r['id'], 'field': r['field'], 'plan': r['plan'],
        'planned': r['value'], 'current': val, 'state': state, 'journal': changes[k]})
jsonl('planes-contra-catalogo.jsonl', plan_checks)

dates = []
for k, r in verdicts.items():
    if k[2] != 'release_date_text' or r['verdict'] == 'aceptado': continue
    a = tables['album'].get(k[1], {})
    if a.get('release_date_text') or not a.get('release_year'): continue
    checks = []
    for c in r['checks']:
        if c.get('why', '').startswith('el disco no tiene año'):
            match = re.search(r'(1[89]\d\d|20\d\d)', str(c['value']))
            if match and int(match[1]) == a['release_year'] and not re.fullmatch(r'\d{4}(?:-01-01)?', str(c['value'])) and c.get('editionOk') is not False:
                checks.append(c)
    if checks:
        dates.append({'albumId': k[1], 'artist': r['artist'], 'title': r['title'], 'currentYear': a['release_year'],
            'state': 'reabrir_fecha_tras_aplicar_anio_no_es_aprobacion', 'checks': checks})
jsonl('fechas-que-deben-reabrirse.jsonl', dates)

images = []
for r in reconciled:
    if r['field'] not in ['cover_url', 'picture_url', 'logo_url'] or r['filled'] or r['editorialPolicy']: continue
    g = next(g for g in gaps if g['kind'] == r['kind'] and str(g['id']) == r['id'] and g['field'] == r['field'])
    images.append({**r, 'fullEvidence': g['values']})
jsonl('imagenes-pendientes-con-fuentes.jsonl', images)

aq = []
for k, r in verdicts.items():
    if k[2] != 'duration_seconds' or r['verdict'] != 'rechazado': continue
    for c in r['checks']:
        if c['channel'] == 'aqustico' and 'duración inválida' in c.get('why', '') and isinstance(c['value'], (int, float)):
            seconds = c['value'] / 1000
            if 5 <= seconds <= 3600:
                aq.append({'trackId': k[1], 'title': r['title'], 'artist': r['artist'], 'milliseconds': c['value'],
                    'candidateSeconds': seconds, 'state': 'unidad_posible_requiere_original_y_grabacion', 'check': c})
jsonl('aqustico-unidades-por-revisar.jsonl', aq)

img_log = (APP / 'localizar-imagenes.log').read_text()
excluded_keys = set(re.findall(r'\b(album|artist):(\d+)\b', img_log))
image_targets = rows(APP / 'imagenes-candidatas.jsonl')
image_states = collections.Counter()
for r in image_targets:
    fld = 'cover_url' if r['kind'] == 'album' else 'picture_url'
    val = tables[r['kind']][str(r['id'])].get(fld)
    state = 'campo_cubierto' if val else ('excluido_PCE01_en_log' if (r['kind'], str(r['id'])) in excluded_keys else 'descarga_fallida')
    image_states[(r['kind'], state)] += 1

summary = {
    'snapshot': json.loads((OUT / 'instantanea.json').read_text()),
    'originalSlots': len(reconciled), 'filledSlots': sum(r['filled'] for r in reconciled),
    'emptySlots': sum(not r['filled'] for r in reconciled),
    'slotStates': dict(collections.Counter(r['state'] for r in reconciled)),
    'fields': {f: {'original': len(rs), 'filled': sum(r['filled'] for r in rs),
                   'empty': sum(not r['filled'] for r in rs), 'states': dict(collections.Counter(r['state'] for r in rs))}
               for f, rs in ((f, [r for r in reconciled if r['kind'] + '.' + r['field'] == f])
                             for f in sorted({r['kind'] + '.' + r['field'] for r in reconciled}))},
    'planRows': len(plan_checks), 'planStates': dict(collections.Counter(r['state'] for r in plan_checks)),
    'publicJournalFieldChanges': sum(bool(js) for js in changes.values()), 'journalOldNonempty': sum(j['oldValue'] is not None and str(j['oldValue']).strip() != '' for js in changes.values() for j in js),
    'imageTargets': len(image_targets), 'imageStates': {'.'.join(k): v for k, v in image_states.items()},
    'datesToReopen': len(dates), 'aqusticoMillisecondsToRecheck': len(aq),
    'note': 'Vacío no significa dato aplicable. Rechazos, política editorial y autoedición se conservan separados. No hay escrituras en PostgreSQL.',
}
dump('RESUMEN.json', summary)
print(json.dumps(summary, ensure_ascii=False, indent=2))
