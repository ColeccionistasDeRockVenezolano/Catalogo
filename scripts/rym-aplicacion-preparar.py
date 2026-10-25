#!/usr/bin/env python3
"""Pin the 70 reviewed RYM identities and their original evidence for application."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('deep', ROOT / 'scripts/rym-verificacion-profunda.py')
DEEP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEEP)


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def readl(p):
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    out = Path(args.out)
    source = (ROOT / 'reports/rym-verificacion-profunda-2026-10-22').resolve()
    corpus = (ROOT / 'reports/rym-integral-2026-10-21').resolve()
    proposal_file = source / 'propuestas-siguiente-fase.json'
    proposals = json.loads(proposal_file.read_text())['results']
    audit = json.loads((source / 'auditoria-final.json').read_text())
    assert sha(proposal_file) == audit['deliverableSha256'][proposal_file.name]
    assert len(proposals) == len({r['rymHref'] for r in proposals}) == 70
    old = json.loads((source / 'catalogo-lectura.json').read_text())
    people = {p['id']: p for p in json.loads((source / 'catalogo-personas-ampliado.json').read_text())['persons']}
    artists = {a['id']: a for a in old['artists']}
    profiles = {p['href']: p for p in readl(corpus / 'corpus/artistas.jsonl')}
    hrefs = {r['rymHref'] for r in proposals}
    cases = []
    for proposal in proposals:
        assert proposal['allCitationsVerified'] and proposal['mechanicalEvidenceGate']
        assert proposal['semanticReview']['verdict'] == 'accept_link'
        assert not proposal.get('blockingContradictions')
        folder = Path(proposal['effectiveBatch'])
        versions = DEEP.source_versions(folder)
        evidence = []
        for item, check in zip(proposal['evidence'], proposal['citationChecks'], strict=True):
            capture = DEEP.cited_source(versions, item)
            assert capture and check['quoteFound']
            assert sha(Path(capture['sourcePath'])) == capture['sha256'] == check['sourceSha256']
            text = DEEP.qnorm(capture['text'])
            quote = DEEP.qnorm(item['quote'])
            assert quote in text
            metadata_file = Path(capture['sourcePath']).with_suffix('.json')
            metadata = json.loads(metadata_file.read_text()) if metadata_file.is_file() else {}
            captured_at = capture.get('capturedAt')
            if not captured_at and metadata.get('sha256') == capture['sha256']:
                captured_at = metadata.get('capturedAt')
            evidence.append({**item, 'text': text, 'quote': quote,
                'title': capture.get('title') or item['url'],
                'sourcePath': capture['sourcePath'], 'sourceSha256': capture['sha256'],
                'capturedAt': captured_at,
                'primaryEligible': check['primaryEligible']})
        assert any(e['primaryEligible'] for e in evidence)
        assert len({e['url'] for e in evidence}) >= 2
        aid, pid = proposal.get('candidateArtistId'), proposal.get('candidatePersonId')
        cases.append({'proposal': proposal, 'profile': profiles[proposal['rymHref']],
            'artistBaseline': artists.get(aid), 'personBaseline': people.get(pid),
            'albumsBaseline': [a for a in old['albums'] if a['artist_id'] == aid],
            'membersBaseline': [m for m in old['members'] if m['artist_id'] == aid],
            'evidence': evidence})
    releases = readl(corpus / 'corpus/albumes.jsonl')
    owned = [r for r in releases if r.get('artista_url') in hrefs]
    credits = [r for r in releases if any(c.get('href') in hrefs for c in r.get('creditos', []))]
    manifest = {'version': 'crv-rym-apply-reviewed-v1', 'campaign': out.name,
        'proposalPin': {'path': str(proposal_file), 'sha256': sha(proposal_file)},
        'baselineLedger': str(corpus / 'identity-ledger.json'),
        'cases': cases, 'releases': owned, 'creditReleases': credits}
    (out / 'entrada-verificada.json').write_text(json.dumps(manifest, ensure_ascii=False) + '\n')
    print(json.dumps({'cases': len(cases), 'artistTargets': sum(bool(c['artistBaseline']) for c in cases),
        'personTargets': sum(bool(c['personBaseline']) for c in cases),
        'releases': len(owned), 'creditReleases': len(credits)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
