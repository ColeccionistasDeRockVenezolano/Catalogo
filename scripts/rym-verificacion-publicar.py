#!/usr/bin/env python3
"""Close the completed read-only RYM investigation and publish with SHA checks."""
import argparse
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
STORE = Path('/mnt/1tb/Shared/coleccionistas-rock-venezolano/reports')
METHODS = ('rym-hermes-web.py', 'rym-verificacion-profunda.py',
           'rym-verificacion-cierre.py', 'rym-verificacion-contexto.py',
           'rym-verificacion-publicar.py', 'rym-hermes-lotes.py',
           'rym-verificacion-citas-finales.py', 'staging.py', 'shared-storage.py')
FINAL = ('resultados-finales.jsonl', 'matriz-verificacion.csv',
         'propuestas-siguiente-fase.json')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    out = args.out.resolve()
    if out.parent != Path.home()/'crv-staging/reports':
        raise SystemExit('Expected an SSD reports campaign')
    destination = STORE/out.name
    if destination.exists() and any(destination.iterdir()):
        raise SystemExit('Published destination already exists')
    subprocess.run(['python3', 'scripts/shared-storage.py', 'status'], cwd=ROOT, check=True)
    assignments = json.loads((out/'asignaciones.json').read_text())
    expected = {href for b in assignments['batches'] for href in b['cases']}
    assert len(expected) == 1520
    for b in assignments['batches']:
        assert json.loads((out/'lotes'/b['id']/'estado.json').read_text())['status'] == 'complete'
    context = json.loads((out/'asignaciones-contexto-personas.json').read_text())['cases']
    assert len(context) == 89
    for c in context:
        folder = out/'contexto-personas'/('caso-'+hashlib.sha256(c['rymHref'].encode()).hexdigest()[:12])
        assert json.loads((folder/'estado.json').read_text())['status'] == 'complete'
    for section in ('reparaciones','rescate-cuota','rescate-enfoque',
                    'reparaciones-tipografia','contexto-personas','contexto-citas','rescate-personas'):
        for batch in (out/section).glob('*/lote.json'):
            assert json.loads((batch.parent/'estado.json').read_text())['status'] == 'complete', str(batch)

    spec = importlib.util.spec_from_file_location('closing', ROOT/'scripts/rym-verificacion-cierre.py')
    closing = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(closing)
    closing.export(out)
    rows = [json.loads(line) for line in (out/'resultados-finales.jsonl').read_text().splitlines()]
    assert {r['rymHref'] for r in rows} == expected and len(rows) == 1520
    proposals = json.loads((out/'propuestas-siguiente-fase.json').read_text())
    assert proposals['researchOnly'] and not proposals['nativeApproved']
    assert proposals['count'] == len(proposals['results'])
    assert len({r['idempotencyKey'] for r in proposals['results']}) == proposals['count']
    assert not json.loads((out/'colisiones.json').read_text()), 'Resolve collisions before publication'
    for r in proposals['results']:
        assert r['allCitationsVerified'] and r['mechanicalEvidenceGate']
        assert r['finalStatus'] == 'ready_for_native_validation' and not r['catalogApplied']
        assert not r['semanticReview']['blockingIssues'] and not r.get('blockingContradictions')

    checked = {}
    for row in rows:
        for citation in row['citationChecks']:
            if not citation['quoteFound']:
                continue
            file = Path(citation['sourcePath'])
            expected_sha = citation['sourceSha256']
            if file in checked:
                assert checked[file] == expected_sha
            else:
                assert file.is_file() and digest(file) == expected_sha, str(file)
                checked[file] = expected_sha
    method_dir = out/'metodo'
    method_dir.mkdir(exist_ok=True)
    for name in METHODS:
        shutil.copy2(ROOT/'scripts'/name, method_dir/name)
    (method_dir/'README.md').write_text(
        'Copias de auditoría de los métodos usados. Ejecutar los originales de scripts/ '
        'desde el repositorio: sus imports y recursos dependen de esa ubicación.\n')
    (method_dir/'sha256.json').write_text(json.dumps({n:digest(method_dir/n) for n in METHODS},indent=2)+'\n')
    # Rebase deliverables only: original captures, research JSON, session logs,
    # prompts and recovered-review hashes remain byte-for-byte reproducible.
    for name in FINAL:
        file = out/name
        file.write_text(file.read_text().replace(str(out)+'/',str(destination)+'/'))
    (out/'rutas-publicacion.json').write_text(json.dumps({
        'sourcePrefix': str(out), 'publishedPrefix': str(destination),
        'rebasedDeliverables': list(FINAL), 'historicalEvidenceBytesPreserved': True,
        'resolution': 'Replace the sourcePrefix in historical metadata paths when reading after publication.'
    },ensure_ascii=False,indent=2)+'\n')
    (out/'auditoria-final.json').write_text(json.dumps({
        'profiles': len(rows), 'groups': assignments['groups'], 'contextCases':len(context),
        'verifiedSourceFiles':len(checked), 'crossProfileCollisions':0,
        'outcomes':dict(collections.Counter(r['finalStatus'] for r in rows)),
        'catalogWrites':0,'claimsCreated':0,'nativeApprovals':0,
        'deliverableSha256':{name:digest(out/name) for name in FINAL},
        'publicationVerification':'staging.py publish --hash verifies every file before removing SSD staging'
    },ensure_ascii=False,indent=2)+'\n')
    subprocess.run(['python3','scripts/staging.py','publish','reports',out.name,'--hash'],cwd=ROOT,check=True)
    for file,sha in checked.items():
        final = Path(str(file).replace(str(out)+'/',str(destination)+'/'))
        assert final.is_file() and digest(final) == sha, str(final)
    for name in FINAL:
        assert str(out)+'/' not in (destination/name).read_text()
    print(json.dumps({'published':str(destination),'profiles':len(rows),
                      'verifiedSourceFiles':len(checked),'claimsCreated':0}),flush=True)


if __name__ == '__main__':
    main()
