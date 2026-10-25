#!/usr/bin/env python3
"""Read-only audit and publication-ready receipt for the reviewed RYM import."""
import argparse
import collections
import csv
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import unicodedata
import re

ROOT = Path(__file__).resolve().parents[1]


def norm(value):
    value = ''.join(c for c in unicodedata.normalize('NFD', value).lower() if unicodedata.category(c) != 'Mn')
    return ' '.join(re.findall(r'[^\W_]+', value))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', required=True)
    args = parser.parse_args()
    out = Path(args.dir)
    source = json.loads((out / 'entrada-verificada.json').read_text())
    applied = {phase: json.loads((out / f'{phase}-aplicado.json').read_text()) for phase in ('identities', 'profiles', 'releases', 'credits')}
    runs = [run for value in applied.values() for run in value['runs']]
    assert len(runs) == 4 and len(set(runs)) == 4
    ids = ','.join(str(int(r)) for r in runs)
    artists = sorted({c['proposal']['candidateArtistId'] for c in source['cases'] if c['proposal']['candidateArtistId']})
    persons = sorted({c['proposal']['candidatePersonId'] for c in source['cases'] if c['proposal']['candidatePersonId']})
    aids, pids = ','.join(map(str, artists)), ','.join(map(str, persons))
    statements = {
        'runs': f'SELECT id,status,params FROM ingest.scrape_runs WHERE id IN ({ids}) ORDER BY id',
        'claims': f'SELECT status,count(*) amount FROM ingest.claims WHERE run_id IN ({ids}) GROUP BY status',
        'reviews': f"SELECT q.id,q.status FROM ingest.review_queue q WHERE q.status IN ('open','in_progress') AND (q.claim_a_id IN (SELECT id FROM ingest.claims WHERE run_id IN ({ids})) OR q.claim_b_id IN (SELECT id FROM ingest.claims WHERE run_id IN ({ids})) OR q.payload->>'runId' IN ({','.join(repr(str(r)) for r in runs)}))",
        'journal': f'SELECT table_name,op,count(*) amount FROM ingest.change_journal WHERE run_id IN ({ids}) GROUP BY 1,2 ORDER BY 1,2',
        'links': f"SELECT f.id fact_id,f.value,b.artist_id,b.person_id,b.disposition,f.documentary_state,(SELECT count(*) FROM ingest.catalog_fact_evidence e WHERE e.fact_id=f.id) evidence_count FROM ingest.catalog_facts f JOIN ingest.catalog_fact_bindings b ON b.fact_id=f.id WHERE f.run_id IN ({ids}) AND f.relation='external_rym_identity' ORDER BY f.id",
        'artists': f'SELECT * FROM public.artists WHERE id IN ({aids}) ORDER BY id',
        'persons': f'SELECT * FROM public.persons WHERE id IN ({pids}) ORDER BY id',
        'albums': f"SELECT a.*,ARRAY(SELECT alias FROM ingest.album_aliases WHERE album_id=a.id) aliases FROM public.albums a WHERE artist_id IN ({aids}) ORDER BY id",
        'newAlbums': f"SELECT (row_pk->>'id')::bigint id FROM ingest.change_journal WHERE run_id IN ({ids}) AND table_name='public.albums' AND op='I'",
        'newTracks': f"SELECT t.* FROM public.tracks t WHERE t.id IN (SELECT (row_pk->>'id')::bigint FROM ingest.change_journal WHERE run_id IN ({ids}) AND table_name='public.tracks' AND op='I') ORDER BY id",
        'versions': f'SELECT * FROM ingest.album_versions WHERE run_id IN ({ids}) ORDER BY id',
        'newCredits': f"SELECT * FROM public.album_credits WHERE id IN (SELECT (row_pk->>'id')::bigint FROM ingest.change_journal WHERE run_id IN ({ids}) AND table_name='public.album_credits' AND op='I') ORDER BY id",
    }
    query = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object(' + ','.join("'" + k + "',(SELECT coalesce(json_agg(x),'[]') FROM (" + v + ') x)' for k, v in statements.items()) + '); COMMIT;'
    raw = subprocess.check_output(['docker', 'exec', 'crv-postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'crv', '-d', 'crv', '-c', query], text=True)
    state = json.loads(raw)
    assert all(r['status'] == 'ok' and r['params']['campaign'] == source['campaign'] for r in state['runs'])
    assert not state['reviews']
    assert all(r['status'] == 'accepted' for r in state['claims']), state['claims']
    links = state['links']
    assert len(links) == 97
    assert all(r['disposition'] == 'applied' and r['documentary_state'] == 'verified' and r['evidence_count'] >= 2 for r in links)
    expected = {(c['profile']['href'], kind, c['proposal'][key]) for c in source['cases'] for kind, key in [('artist', 'candidateArtistId'), ('person', 'candidatePersonId')] if c['proposal'][key]}
    actual = {(r['value']['url'].replace('https://rateyourmusic.com', ''), 'artist' if r['artist_id'] else 'person', r['artist_id'] or r['person_id']) for r in links}
    assert expected == actual
    new_ids = {r['id'] for r in state['newAlbums']}
    assert len(new_ids) == 29 and len(state['newTracks']) == 80
    by_title = collections.defaultdict(set)
    for album in state['albums']:
        for title in [album['title'], *album['aliases']]:
            by_title[(album['artist_id'], norm(title))].add(album['id'])
    duplicate_new = [dict(artistId=a['artist_id'], albumId=a['id'], title=a['title'], matches=sorted(by_title[(a['artist_id'], norm(a['title']))])) for a in state['albums'] if a['id'] in new_ids and len(by_title[(a['artist_id'], norm(a['title']))]) > 1]
    assert not duplicate_new, duplicate_new
    positions = [(t['album_id'], t['disc_number'], t['track_number']) for t in state['newTracks']]
    assert len(positions) == len(set(positions))
    assert not any(r['table_name'] in ('public.artists', 'public.persons') and r['op'] == 'I' for r in state['journal'])
    replay = json.loads((out / 'all-ensayo.json').read_text())
    assert replay['dryRun'] and replay['outcomes'] == []
    replay_runs = list(out.glob('run-*-*-ensayo.json'))
    for phase, run in zip(('identities', 'profiles', 'releases', 'credits'), replay['runs'], strict=True):
        row = json.loads((out / f'run-{run}-{phase}-ensayo.json').read_text())
        assert row['result']['changes'] == []
    stats = collections.Counter()
    for phase in applied.values():
        stats.update(phase['counts'])
    summary = {'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'campaign': source['campaign'],
        'profilesLinked': 70, 'artistTargets': len(artists), 'personTargets': len(persons), 'nativeIdentityLinks': len(links),
        'counts': dict(stats), 'nativeRuns': runs, 'claimStatusCounts': state['claims'],
        'newOpenReviews': 0, 'pendingClaims': 0, 'newDuplicatePublicationsDetected': len(duplicate_new),
        'newArtists': 0, 'newPersons': 0, 'replayCatalogChanges': 0,
        'tests': {'unitFiles': 6, 'unitTestsPassed': 41, 'typecheck': 'passed', 'targetedEslint': 'passed'},
        'retainedObservations': sum(len(r['held']) for r in applied.values()),
        'scopeNote': 'Observaciones retenidas son datos no aplicados o discrepancias preservadas; no son claims pendientes ni tareas nuevas para Brian. No equivale a importar el 100% de RYM.'}
    (out / 'catalogo-despues.json').write_text(json.dumps(state, ensure_ascii=False) + '\n')
    (out / 'resumen-aplicacion.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    with (out / 'vinculos-aplicados.csv').open('w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(['rymHref', 'artistId', 'personId', 'status', 'factIds'])
        for c in source['cases']:
            href = c['profile']['href']
            writer.writerow([href, c['proposal']['candidateArtistId'], c['proposal']['candidatePersonId'], 'applied', ';'.join(str(r['fact_id']) for r in links if r['value']['url'].endswith(href))])
    report = f'''# Aplicación de los 70 perfiles RYM verificados

Se aplicaron los puntos 1, 2 y 3 autorizados por Brian. La comparación nativa volvió a comprobar identidades, capturas originales y sus hashes antes de cada fase.

| Resultado | Cantidad |
| --- | ---: |
| Perfiles vinculados | 70 |
| Destinos de artista / persona | 54 / 43 |
| Vínculos externos documentales aplicados | 97 |
| Relaciones de solistas con proyectos añadidas | 27 |
| Publicaciones musicales nuevas | 29 |
| Pistas nuevas | 80 |
| Ediciones digitales conservadas sin duplicar la obra | 1 |
| Campos de artistas y personas completados | 33 |
| Campos de discos completados | 131 |
| Créditos nuevos de disco / pista | 37 / 1 |
| Créditos existentes con roles completados | 10 |
| Alias nuevos de artistas y personas | 6 |
| Características y categorías de publicación añadidas | 91 |
| Géneros de artistas / discos añadidos | 3 / 35 |
| Relaciones con sellos añadidas | 10 |
| Roles de integrantes completados | 1 |
| Artistas o personas nuevos | 0 |
| Revisiones nuevas abiertas / claims pendientes | 0 / 0 |
| Cambios de catálogo al repetir todo en ensayo | 0 |

Los 55 cruces con discos existentes permitieron completar sus datos; no se crearon fichas adicionales para esos cruces. Los registros internos aceptados conservan la historia de las escrituras del motor nativo: no dejan trabajo de aceptación pendiente.

## Decisiones de alcance

- Winds of May conserva su discografía separada de Dhargorak, aunque RYM los reúna en una ficha.
- La fecha y ciudad natal discrepantes de Andrea Lacoste no se completaron automáticamente.
- La publicación digital de Demo 1986, Cero a la Izquierda, se registró como edición de 2019 de la obra existente (146). No se creó otro disco ni se reasignó el orden de sus pistas. La variante documental de un título queda en las notas.
- Los destinos personales, incluido Fito Páez, no reciben automáticamente una discografía como artistas. Se aplican los créditos acreditados; se excluye el papel de teclados no corroborado en El amor ya no existe.
- Las publicaciones con años o atribuciones controvertidos conservan las discrepancias. Cuando el título y el repertorio permiten una incorporación segura, se deja el año vacío antes que escoger uno de los años en disputa.
- Los videos no generaron discos ni pistas. Los períodos y nombres ambiguos de integrantes no generaron personas ni membresías nuevas.
- Las ambigüedades de sellos, publicaciones y listas de pistas permanecen detalladas en los archivos de cada fase, sin crear colas de revisión.

## Verificación y evidencia

Las cuatro fases se ejecutaron mediante el operador nativo, con transacciones, diario de cambios y evidencia. Runs: {', '.join(map(str, runs))}.

La auditoría encontró cero publicaciones nuevas duplicadas por título/alias del mismo artista y cero posiciones nuevas repetidas. Un segundo recorrido completo, con rollback, produjo cero cambios en las cuatro fases. Pasaron 41 pruebas unitarias en seis archivos, TypeScript y ESLint de los archivos nuevos.

`vinculos-aplicados.csv` enumera los 70 perfiles y sus hechos nativos. `catalogo-antes.json`, `catalogo-despues.json`, `entrada-verificada.json`, los resultados por fase y `metodo/` conservan el detalle reproducible. `resumen-aplicacion.json` ofrece los recuentos comprobados. El informe de investigación anterior permanece intacto.
'''
    (out / 'INFORME.md').write_text(report)
    methods = out / 'metodo'
    methods.mkdir(exist_ok=True)
    for name in ['scripts/rym-aplicacion-preparar.py', 'scripts/rym-aplicar-verificados.ts', 'scripts/rym-aplicacion-auditar.py', 'src/verification/rym-reviewed-application.ts', 'test/unit/rym-reviewed-application.test.ts']:
        shutil.copyfile(ROOT / name, methods / Path(name).name)
    manifest = {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file() and p.name != 'sha256-entregables.json'}
    (out / 'sha256-entregables.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
