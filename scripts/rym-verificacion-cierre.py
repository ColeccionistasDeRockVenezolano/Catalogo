#!/usr/bin/env python3
"""Repair layout-only quotations, independently re-review, and export RYM audit.

Never writes to the catalogue. Original research and verdicts remain preserved.
"""
import argparse
import collections
import concurrent.futures
import csv
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import time
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deep', ROOT / 'scripts/rym-verificacion-profunda.py')
deep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deep)


def literal_span(text, quote):
    """Recover a contiguous source span; tokens, case and accents cannot change."""
    text = unicodedata.normalize('NFKC', text)
    quote = unicodedata.normalize('NFKC', quote)
    wanted = re.findall(r'\w+|[^\w\s]', quote)
    if len(wanted) < 3:
        return None
    tokens = list(re.finditer(r'\w+|[^\w\s]', text))
    values = [m.group() for m in tokens]
    n = len(wanted)
    for i, word in enumerate(values):
        if word == wanted[0] and values[i:i+n] == wanted:
            return text[tokens[i].start():tokens[i+n-1].end()]
    return None


def enrich_people(cases, catalog, policy):
    artists = {a['id']: a for a in catalog['artists']}
    refs = {r['artist_id']: r for r in policy['policies']}
    aliases, memberships, reference_memberships = (collections.defaultdict(list) for _ in range(3))
    for r in catalog['personAliases']:
        aliases[r['person_id']].append(r['alias'])
    for r in catalog['members']:
        if r['artist_id'] in artists:
            memberships[r['person_id']].append({**r, 'artistName': artists[r['artist_id']]['name']})
    for r in policy['persons']:
        if r['artist_id'] in refs:
            ref = refs[r['artist_id']]
            reference_memberships[r['person_id']].append({'artistId': r['artist_id'], 'artistName': ref['name'],
                'editorialReference': True, 'snapshot': ref.get('snapshot')})
    changed = set()
    for c in cases:
        for p in c['candidatePeople']:
            expected = {'catalogAliases': aliases[p['id']], 'catalogMemberships': memberships[p['id']],
                'editorialReferenceMemberships': reference_memberships[p['id']]}
            if any(v and p.get(k) != v for k, v in expected.items() if k != 'editorialReferenceMemberships') or \
                {x['artistId'] for x in p.get('editorialReferenceMemberships',[])} != {x['artistId'] for x in expected['editorialReferenceMemberships']}:
                changed.add(c['rymHref'])
            p.update(expected)
    return changed


def prepare_repair(out, original, catalog, policy):
    target = out / 'reparaciones' / original.name
    if (target / 'lote.json').exists():
        # Queued repairs prepared by an older run can be narrowed safely before
        # any reviewer has started. Completed reviews remain untouched.
        if not (target/'revision-1.txt').exists() and not (target/'estado.json').exists():
            receipt=json.loads((target/'reparacion.json').read_text())
            base_cases=deep.expanded_cases(original)
            personal_links={r['rymHref'] for r in json.loads((original/'resultados.json').read_text()) if r.get('candidatePersonId') is not None}
            affected=(enrich_people(base_cases,catalog,policy) & personal_links) | {c['rymHref'] for c in receipt['quoteChanges']}
            data=json.loads((target/'lote.json').read_text())
            data['cases']=[c for c in data['cases'] if c['rymHref'] in affected]
            deep.dump(target/'lote.json',data)
            rows=[r for r in json.loads((target/'investigacion.json').read_text()) if r['rymHref'] in affected]
            deep.dump(target/'investigacion.json',rows)
            receipt['reviewedSubset']=sorted(affected);deep.dump(target/'reparacion.json',receipt)
            if not rows:
                deep.dump(target/'resultados.json',[])
                deep.dump(target/'estado.json',{'status':'complete','cases':0,'outcomes':{},'note':'No substantive citation/person-context changes; original verdicts preserved'})
        return target
    rows = json.loads((original / 'resultados.json').read_text())
    cases = deep.expanded_cases(original)
    context_changed = enrich_people(cases, catalog, policy)
    # Adding the already-visible band members to the candidate pool is not a
    # new fact for an artist-only proposal. Re-review person links when their
    # own membership context changes, rather than every unrelated band member.
    context_changed &= {r['rymHref'] for r in rows if r.get('candidatePersonId') is not None}
    versions = deep.source_versions(original)
    changes = []
    for row in rows:
        for index, e in enumerate(row.get('evidence', [])):
            if row.get('citationChecks', [])[index]['quoteFound']:
                continue
            for source in versions.get(deep.canon(e['url']), []):
                raw = Path(source['sourcePath'])
                if not raw.is_file() or hashlib.sha256(raw.read_bytes()).hexdigest() != source['sha256']:
                    continue
                fixed = literal_span(source['text'], e['quote'])
                if fixed is not None:
                    changes.append({'rymHref': row['rymHref'], 'evidenceIndex': index,
                        'originalQuote': e['quote'], 'literalSourceSpan': fixed,
                        'sourcePath': source['sourcePath'], 'sha256': source['sha256'],
                        'method': 'identical contiguous tokens; whitespace layout only'})
                    e['quote'] = fixed
                    break
    affected=context_changed | {c['rymHref'] for c in changes}
    if not affected:
        return None
    cases=[c for c in cases if c['rymHref'] in affected]
    rows=[r for r in rows if r['rymHref'] in affected]
    target.mkdir(parents=True, exist_ok=True)
    deep.dump(target / 'lote.json', {'id': original.name, 'cases': cases})
    shutil.copy2(original / 'evidencia-local.json', target / 'evidencia-local.json')
    shutil.copytree(original / 'fuentes', target / 'fuentes', dirs_exist_ok=True)
    if (original / 'catalog-lookups.jsonl').exists():
        shutil.copy2(original / 'catalog-lookups.jsonl', target / 'catalog-lookups.jsonl')
    deep.dump(target / 'investigacion.json', rows)
    deep.dump(target / 'reparacion.json', {'originalBatch': str(original), 'quoteChanges': changes,
        'personContextEnriched': bool(context_changed), 'reviewedSubset':sorted(affected), 'externalFactsInvented': 0, 'catalogWrites': 0})
    return target


def repair(out, workers):
    catalog = json.loads((out / 'catalogo-lectura.json').read_text())
    policy = json.loads((out / 'politica-editorial.json').read_text())
    tasks = []
    for state in sorted((out / 'lotes').glob('*/estado.json')):
        if json.loads(state.read_text()).get('status') == 'complete':
            target = prepare_repair(out, state.parent, catalog, policy)
            if target is not None:
                tasks.append(target)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(deep.run_batch, out, {'id': p.name}, folder=p): p for p in tasks}
        for future in concurrent.futures.as_completed(futures):
            future.result()
            p = futures[future]
            print(json.dumps({'batch': p.name, 'repair': json.loads((p / 'estado.json').read_text())}), flush=True)


def watch_repair(out, workers):
    """Consume completed batches once, while the primary investigation runs."""
    catalog=json.loads((out/'catalogo-lectura.json').read_text())
    policy=json.loads((out/'politica-editorial.json').read_text())
    manifest=json.loads((out/'asignaciones.json').read_text())
    examined=set(); futures={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        while True:
            finished=0
            for batch in manifest['batches']:
                folder=out/'lotes'/batch['id']; statefile=folder/'estado.json'
                if not statefile.exists():continue
                state=json.loads(statefile.read_text())
                finished+=state.get('status') in ('complete','failed')
                if state.get('status')!='complete' or batch['id'] in examined:continue
                target=prepare_repair(out,folder,catalog,policy)
                examined.add(batch['id'])
                if target is not None:
                    target_state=target/'estado.json'
                    if target_state.exists() and json.loads(target_state.read_text()).get('status')=='complete':continue
                    futures[pool.submit(deep.run_batch,out,batch,folder=target)]=target
            done,_=concurrent.futures.wait(list(futures),timeout=10,return_when=concurrent.futures.FIRST_COMPLETED) if futures else (set(),set())
            for future in done:
                future.result();target=futures.pop(future)
                print(json.dumps({'batch':target.name,'repair':json.loads((target/'estado.json').read_text())}),flush=True)
            deep.dump(out/'reparaciones-seguimiento.json',{'examinedBaseBatches':len(examined),'pendingRepairs':len(futures),'baseBatchesFinished':finished})
            if finished==len(manifest['batches']) and not futures:break
            if not futures:time.sleep(10)


def rescue_quota(out, workers):
    """Reinvestigate actual gaps in batches whose search was quota-impaired."""
    catalog=json.loads((out/'catalogo-lectura.json').read_text())
    policy=json.loads((out/'politica-editorial.json').read_text())
    tasks=[]
    for errors in sorted((out/'lotes').glob('*/tavily-errors.jsonl')):
        original=errors.parent
        statuses={json.loads(line).get('status') for line in errors.read_text().splitlines()}
        if not statuses & {429,432} or not (original/'resultados.json').exists():continue
        fixed=out/'reparaciones'/original.name
        folder=fixed if (fixed/'estado.json').exists() and json.loads((fixed/'estado.json').read_text()).get('status')=='complete' else original
        rows={r['rymHref']:r for r in json.loads((original/'resultados.json').read_text())}
        case_map={c['rymHref']:c for c in deep.expanded_cases(original)}
        if folder!=original:
            rows.update({r['rymHref']:r for r in json.loads((folder/'resultados.json').read_text())})
            case_map.update({c['rymHref']:c for c in deep.expanded_cases(folder)})
        pending={href:r for href,r in rows.items() if r['finalStatus'] in ('unresolved_with_specific_gap','documented_identity_without_catalog_link')}
        if not pending:continue
        target=out/'rescate-cuota'/original.name
        if not (target/'lote.json').exists():
            cases=[c for href,c in case_map.items() if href in pending]
            enrich_people(cases,catalog,policy)
            for c in cases:
                old=pending[c['rymHref']]
                c['latestVerification']={k:old.get(k) for k in ('reason','evidence','identityAxes','semanticReview','nextCheck','citationChecks')}
            target.mkdir(parents=True,exist_ok=True)
            deep.dump(target/'lote.json',{'id':original.name,'cases':cases})
            shutil.copy2(folder/'evidencia-local.json',target/'evidencia-local.json')
            shutil.copytree(folder/'fuentes',target/'fuentes',dirs_exist_ok=True)
            if (folder/'catalog-lookups.jsonl').exists():shutil.copy2(folder/'catalog-lookups.jsonl',target/'catalog-lookups.jsonl')
            prefix='REINVESTIGACIÓN NECESARIA: las búsquedas anteriores sufrieron HTTP429/432 de Tavily. El buscador SearXNG del proyecto ya funciona. No aceptes la falta de fuentes anterior como conclusión: busca de nuevo las carencias concretas, fuentes primarias y conexiones a IDs. Aprovecha las citas válidas; corrige las fallidas abriendo los originales. Evita repetir páginas bloqueadas.\n'
            (target/'encargo.txt').write_text(prefix+deep.PROMPT+json.dumps(cases,ensure_ascii=False,separators=(',',':')))
            deep.dump(target/'rescate.json',{'sourceBatch':str(folder),'cases':list(pending),'reason':'Prior web search impaired by confirmed quota/rate errors','catalogWrites':0})
        tasks.append(target)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures={pool.submit(deep.run_batch,out,{'id':p.name},folder=p):p for p in tasks}
        for future in concurrent.futures.as_completed(futures):
            future.result();p=futures[future]
            print(json.dumps({'batch':p.name,'rescue':json.loads((p/'estado.json').read_text())}),flush=True)


def effective_results(out):
    manifest = json.loads((out / 'asignaciones.json').read_text())
    assert manifest['groups'] == {'incomplete': 162, 'rejected': 684, 'unresolved': 674}
    person_context={}
    for section in ('contexto-personas','rescate-personas','contexto-citas'):
        seen=set()
        for state in sorted((out/section).glob('*/estado.json')):
            if json.loads(state.read_text()).get('status')=='complete':
                for r in json.loads((state.parent/'resultados.json').read_text()):
                    if r['rymHref'] in seen:raise ValueError('Repeated person-context assignment')
                    seen.add(r['rymHref'])
                    person_context[r['rymHref']]=(r,state.parent)
    rows, missing = [], []
    for b in manifest['batches']:
        original = out / 'lotes' / b['id']
        fixed = out / 'reparaciones' / b['id']
        folder = original
        if not (folder / 'estado.json').exists() or json.loads((folder / 'estado.json').read_text()).get('status') != 'complete':
            missing.extend(b['cases']); continue
        selected={r['rymHref']:(r,folder) for r in json.loads((folder/'resultados.json').read_text())}
        if (fixed/'estado.json').exists() and json.loads((fixed/'estado.json').read_text()).get('status')=='complete':
            selected.update({r['rymHref']:(r,fixed) for r in json.loads((fixed/'resultados.json').read_text())})
        rescued=out/'rescate-cuota'/b['id']
        if (rescued/'estado.json').exists() and json.loads((rescued/'estado.json').read_text()).get('status')=='complete':
            selected.update({r['rymHref']:(r,rescued) for r in json.loads((rescued/'resultados.json').read_text())})
        focused=out/'rescate-enfoque'/b['id']
        if (focused/'estado.json').exists() and json.loads((focused/'estado.json').read_text()).get('status')=='complete':
            selected.update({r['rymHref']:(r,focused) for r in json.loads((focused/'resultados.json').read_text())})
        typography=out/'reparaciones-tipografia'/b['id']
        if (typography/'estado.json').exists() and json.loads((typography/'estado.json').read_text()).get('status')=='complete':
            selected.update({r['rymHref']:(r,typography) for r in json.loads((typography/'resultados.json').read_text())})
        selected.update({href:person_context[href] for href in b['cases'] if href in person_context})
        assert set(selected)==set(b['cases']), 'Effective batch does not match assigned profiles'
        checked=[]
        for source_folder in sorted({p for _,p in selected.values()}):
            validated=deep.validate(source_folder,{'results':json.loads((source_folder/'resultados.json').read_text())})
            checked.extend((r,source_folder) for r in validated if selected[r['rymHref']][1]==source_folder)
        checked.sort(key=lambda item:b['cases'].index(item[0]['rymHref']))
        for r, source_folder in checked:
            if r['finalStatus'] in ('ready_for_native_validation', 'verified_existing_editorial_reference', 'verified_distinct_candidate') and not r['mechanicalEvidenceGate']:
                issues=[]
                if not r['allCitationsVerified']:issues.append('Faltan citas literales respaldadas por capturas íntegras')
                external=[c for c in r['citationChecks'] if c['quoteFound'] and c['nonRym']]
                if not any(c['primaryEligible'] for c in external):issues.append('Falta una fuente primaria elegible; un perfil de plataforma o una transcripción recopilatoria no acreditan autoría')
                if len(r['checkedAxes'])<2:issues.append('Faltan dos ejes de identidad con evidencia externa; válidos: '+', '.join(r['checkedAxes']))
                if len({deep.canon(c['url']) for c in external})<2:issues.append('Falta una segunda fuente externa distinta')
                if r.get('independentSources') is not True:issues.append('No consta independencia de las fuentes')
                r['auditBlockingIssues']=issues
                r['auditDowngrade']='; '.join(issues)
                r['finalStatus'] = 'unresolved_with_specific_gap'
            if r['finalStatus'] == 'verified_distinct_candidate':
                side_axes = {}
                for side in ('rym', 'candidate'):
                    side_axes[side] = {a['axis'] for a in r.get('identityAxes', []) if a['axis'] in r['checkedAxes']
                        and any(r['evidence'][i].get('side') in (side, 'both') and r['citationChecks'][i]['nonRym']
                            for i in a.get('evidenceIndexes', []))}
                if any(len(axes) < 2 for axes in side_axes.values()):
                    r['auditDowngrade'] = 'La distinción no acredita dos ejes para cada identidad: RYM='+','.join(sorted(side_axes['rym']))+'; candidato='+','.join(sorted(side_axes['candidate']))
                    r['auditBlockingIssues']=[r['auditDowngrade']]
                    r['finalStatus'] = 'unresolved_with_specific_gap'
            r['finalReason']=r.get('auditDowngrade') or r.get('semanticReview',{}).get('reason') or r.get('reason')
            r['effectiveBatch'] = str(source_folder)
            rows.append(r)
    return rows, missing


def export(out):
    rows, missing = effective_results(out)
    assert len({r['rymHref'] for r in rows}) == len(rows)
    assert len(rows) + len(missing) == 1520
    # Narrow an already verified pair to its actual import target. A person's
    # project is related context, not a second destination for that profile.
    scopes_file = out / 'alcance-vinculos.json'
    scopes = json.loads(scopes_file.read_text())['profiles'] if scopes_file.exists() else {}
    for r in rows:
        scope = scopes.get(r['rymHref'])
        if not scope or r['finalStatus'] != 'ready_for_native_validation':
            continue
        expected = scope['verifiedPair']
        if any(r.get(k) != v for k,v in expected.items()):
            raise ValueError('Target narrowing no longer matches verified pair: '+r['rymHref'])
        keep = scope['targetField']
        if keep not in expected or not expected[keep]:
            raise ValueError('Target narrowing requires an existing verified ID')
        r['verifiedRelatedEntities'] = {k:v for k,v in expected.items() if k != keep and v}
        for key in expected:
            if key != keep:r[key] = None
        r['targetScope'] = {'kind': 'person' if keep == 'candidatePersonId' else 'artist',
            'id': r[keep], 'reason': scope['reason'], 'source': 'alcance-vinculos.json'}
    by_id = collections.defaultdict(list)
    for r in rows:
        if r['finalStatus'] == 'ready_for_native_validation':
            for key in ('candidateArtistId', 'candidatePersonId'):
                if r.get(key): by_id[(key, r[key])].append(r['rymHref'])
    collisions = [{'kind': k, 'id': i, 'rymProfiles': names} for (k, i), names in by_id.items() if len(set(names)) > 1]
    collision_profiles = {name for c in collisions for name in c['rymProfiles']}
    for r in rows:
        if r['rymHref'] in collision_profiles:
            r['preCollisionStatus'] = r['finalStatus']
            r['finalStatus'] = 'held_for_cross_profile_identity_check'
            r['finalReason']='Varios perfiles RYM apuntan al mismo ID; cotejar los perfiles antes de importar. '+r.get('finalReason','')
    usages = [json.loads(f.read_text()) for section in ('lotes', 'reparaciones', 'rescate-cuota', 'rescate-enfoque', 'reparaciones-tipografia', 'contexto-personas', 'contexto-citas', 'rescate-personas') for f in (out / section).glob('*/*-uso-*.json')]
    usages = {u['id']: u for u in usages if u}
    summary = {'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'totalCases':1520,
        'checkedCases':len(rows), 'missingCases':len(missing),
        'outcomes':dict(collections.Counter(r['finalStatus'] for r in rows)),
        'byInitialGroup': {g:dict(collections.Counter(r['finalStatus'] for r in rows if r['initialGroup']==g)) for g in ('incomplete','rejected','unresolved')},
        'crossProfileCollisions':len(collisions), 'estimatedModelCostUsd':sum(u.get('estimated_cost_usd') or 0 for u in usages.values()),
        'catalogWrites':0,'claimsCreated':0,'nativeApprovals':0}
    deep.dump(out / 'resumen-cierre.json', summary)
    deep.dump(out / 'colisiones.json', collisions)
    deep.dump(out / 'casos-pendientes-ejecucion.json', missing)
    ready = [r for r in rows if r['finalStatus'] == 'ready_for_native_validation']
    deep.dump(out / 'propuestas-siguiente-fase.json', {'researchOnly': True, 'nativeApproved': False,
        'catalogSnapshotSha256': hashlib.sha256((out / 'catalogo-lectura.json').read_bytes()).hexdigest(),
        'personContextSnapshotSha256': hashlib.sha256((out/'catalogo-personas-ampliado.json').read_bytes()).hexdigest() if (out/'catalogo-personas-ampliado.json').exists() else None,
        'requiresLiveNativeValidationAndIdempotencyCheck': True, 'count': len(ready),
        'results': [{**r, 'idempotencyKey': hashlib.sha256(json.dumps([r['rymHref'],r.get('candidateArtistId'),r.get('candidatePersonId')],separators=(',',':')).encode()).hexdigest()}
            for r in ready]})
    (out / 'resultados-finales.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
    with (out / 'matriz-verificacion.csv').open('w',newline='') as f:
        writer=csv.writer(f)
        writer.writerow(['rymHref','grupo_inicial','estado','artista_id','persona_id','citas_verificadas','motivo','falta','lote'])
        for r in rows:
            review=r.get('semanticReview',{})
            writer.writerow([r['rymHref'],r['initialGroup'],r['finalStatus'],r.get('candidateArtistId'),r.get('candidatePersonId'),
                r['allCitationsVerified'],r.get('finalReason'),'; '.join(r.get('auditBlockingIssues',[])+review.get('blockingIssues',[])) or r.get('nextCheck'),r['effectiveBatch']])
    labels={'ready_for_native_validation':'Vínculo con prueba suficiente; pendiente validación nativa',
        'verified_existing_editorial_reference':'Identidad de referencia editorial verificada; conservar fuera del catálogo principal',
        'verified_distinct_candidate':'Candidato distinto documentado; no descarta el perfil RYM',
        'documented_identity_without_catalog_link':'Identidad externa documentada; sin vínculo aprobado',
        'unresolved_with_specific_gap':'Evidencia insuficiente, con carencia registrada',
        'held_for_cross_profile_identity_check':'Varios perfiles apuntan al mismo ID; cotejo antes de importar'}
    report=['# Verificación profunda RYM','',f"Actualizado: {summary['updatedAt']}",'',
        f"Se completó la investigación y segunda revisión de {len(rows)} de 1.520 casos. Faltan {len(missing)} por completar.",'',
        '| Resultado | Casos |','| --- | ---: |']
    report += [f'| {labels.get(k,k)} | {v} |' for k,v in summary['outcomes'].items()]
    report += ['', '## Resultado por grupo original', '',
        '| Grupo | Examinados | Listos para validación nativa | Referencias | Candidatos distintos | Documentados sin vínculo | Evidencia insuficiente |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for group,title in [('incomplete','162 propuestas incompletas'),('rejected','684 coincidencias descartadas'),('unresolved','674 casos sin resolver')]:
        counts=summary['byInitialGroup'][group]
        report.append(f"| {title} | {sum(counts.values())} | {counts.get('ready_for_native_validation',0)} | {counts.get('verified_existing_editorial_reference',0)} | {counts.get('verified_distinct_candidate',0)} | {counts.get('documented_identity_without_catalog_link',0)} | {counts.get('unresolved_with_specific_gap',0)} |")
    report += ['', '## Alcance y controles','',
        'Los grupos originales son 162 propuestas incompletas, 684 coincidencias descartadas y 674 casos sin resolver. '
        'Se reconsidera la decisión previa, usando la instantánea de candidatos, alias, personas y referencias editoriales tomada al iniciar la campaña. '
        'Las cifras son resultados de investigación, no importaciones ni aprobaciones del catálogo.', '',
        'Cada lote tiene investigación con Hermes y una segunda sesión de revisión semántica. Se comprueban citas literales y SHA-256, '
        'dos ejes de identidad, fuente primaria, independencia y conexión con el ID propuesto. Nombre, país o género solos no bastan. '
        'Las correcciones de espacios recuperan exclusivamente un fragmento contiguo de los originales, sin modificar palabras ni puntuación, '
        'y vuelven a revisión. Los descartes exigen evidencia de ambas identidades.', '',
        'Se amplió la comparación con los nombres reales, biografías y ciudades de las personas existentes: '
        '89 casos con evidencia externa aprovechable recibieron otra investigación y revisión, más un contraste dirigido de Fito Páez con la persona Rodolfo Páez. Esos campos locales son contexto, '
        'nunca corroboración externa. También se contrastaron coincidencias de títulos y años para recuperar variantes de nombre, '
        'sin convertir colaboraciones ni créditos de intérprete en propiedad de discos.', '',
        'Las correcciones tipográficas recuperan un fragmento literal del original y se someten a otra revisión. '
        'Las capturas y sesiones históricas conservan sus bytes; `rutas-publicacion.json` documenta el traslado de sus rutas '
        'del SSD al almacén. Los archivos finales usan las rutas publicadas.', '',
        'Las colisiones entre perfiles se retienen para cotejo. Las referencias editoriales no se restauran al catálogo principal. '
        'No se crean artistas, discos, pistas, claims, revisiones nativas ni cambios en la base.', '',
        'Cuando están documentados tanto una persona como su proyecto, `alcance-vinculos.json` delimita el destino de cada perfil: '
        'Emiliano Hernández-Santana se vincula a la persona y Lunar al proyecto. El otro ID queda como relación comprobada, '
        'sin fusionar entidades ni trasladar automáticamente sus discografías.', '',
        'Tavily alcanzó el límite de uso de su plan (HTTP 432). La campaña usa como alternativa el buscador SearXNG del proyecto y '
        'capturas HTTP de los originales. Un bloqueo de acceso no se interpreta como evidencia negativa.', '',
        '## Archivos','',
        '- `matriz-verificacion.csv`: estado y carencia concreta por perfil.',
        '- `resultados-finales.jsonl`: decisiones, citas, huellas, revisiones y procedencia.',
        '- `resumen-cierre.json`: recuentos por grupo original.',
        '- `colisiones.json`: IDs compartidos que requieren cotejo.',
        '- `alcance-vinculos.json`: delimitación de destinos entre persona y proyecto, con IDs ya verificados.',
        '- `propuestas-siguiente-fase.json`: vínculos que superan las comprobaciones; sin aprobación nativa ni aplicación.',
        '- `lotes/`, `reparaciones/`, `rescate-cuota/`, `rescate-enfoque/`, `reparaciones-tipografia/`, `contexto-personas/`, `contexto-citas/` y `rescate-personas/`: sesiones y evidencia conservadas.',
        '- `catalogo-personas-ampliado.json`: contexto local adicional; no constituye evidencia externa.',
        '- `rutas-publicacion.json` y `metodo/`: traslado de rutas y copia de los métodos usados.', '',
        f"Coste estimado de modelo registrado: USD {summary['estimatedModelCostUsd']:.4f}. Es una estimación de Hermes; no incluye servicios externos.", '',
        'La fase siguiente debe consumir solo vínculos verificados, respetar la política editorial, validar el catálogo nativo y aplicar '
        'controles de idempotencia antes de importar. La identidad verificada no aprueba automáticamente todos los datos biográficos o discográficos.']
    (out / 'INFORME.md').write_text('\n'.join(report)+'\n')
    print(json.dumps(summary),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',required=True,type=Path)
    parser.add_argument('--repair',action='store_true')
    parser.add_argument('--watch-repair',action='store_true')
    parser.add_argument('--rescue-quota',action='store_true')
    parser.add_argument('--export',action='store_true')
    parser.add_argument('--workers',type=int,default=2)
    args=parser.parse_args();out=args.out.resolve()
    if not out.is_relative_to(Path.home()/'crv-staging/reports') or not (out/'asignaciones.json').exists():
        raise SystemExit('Use existing SSD campaign')
    if args.repair: repair(out,args.workers)
    if args.watch_repair: watch_repair(out,args.workers)
    if args.rescue_quota: rescue_quota(out,args.workers)
    if args.export: export(out)


if __name__=='__main__':main()
