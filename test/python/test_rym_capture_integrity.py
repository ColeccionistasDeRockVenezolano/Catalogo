import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import rym_reglas as rules

spec = importlib.util.spec_from_file_location("integrity", Path(__file__).resolve().parents[2] / "scripts/rym-capture-integrity.py")
integrity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(integrity)


class CaptureIntegrity(unittest.TestCase):
    def test_urls_with_shared_long_prefix_do_not_collide(self):
        prefix = "/release/album/" + "a" * 100
        urls = [prefix + "/one", prefix + "/two", prefix + "/one?ignored=yes"]
        self.assertNotEqual(rules.slug_release(urls[0]), rules.slug_release(urls[1]))
        self.assertEqual(rules.slug_release(urls[0]), rules.slug_release(urls[2]))
        self.assertEqual(rules.slug_release('/release/album/a/b'), 'rel_album_a_b')

    def test_lost_punctuation_does_not_overwrite(self):
        self.assertNotEqual(rules.slug_release('/release/album/a/x!'), rules.slug_release('/release/album/a/x'))
        self.assertNotEqual(rules.slug_artist('/artist/éon'), rules.slug_artist('/artist/on'))

    def test_missing_capture_is_retryable_and_original_survives_migration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pages = root / 'pages'
            pages.mkdir()
            hrefs = ['/release/album/' + 'a' * 100 + '/' + suffix for suffix in ['one', 'two']]
            entry = {'kind': 'release', 'v': 3, 'name': 'X', 'og': 'cover'}
            legacy = 'rel_' + rules.slugify(hrefs[0].replace('/release/', ''))
            original = json.dumps({'href': hrefs[1], 'rec': entry})
            (pages / (legacy + '.json')).write_text(original)
            (pages / (legacy + '.html')).write_text('<html>two</html>')
            (root / 'estado.json').write_text(json.dumps(dict.fromkeys(hrefs, entry)))
            result = integrity.audit(root, True)
            self.assertFalse(result['errors'])
            self.assertEqual([x['href'] for x in result['missing']], [hrefs[0]])
            state = json.loads((root / 'estado.json').read_text())
            self.assertFalse(rules.es_hecho_release(state[hrefs[0]]))
            self.assertTrue(rules.es_hecho_release(state[hrefs[1]]))
            self.assertEqual((root / 'conservation-legacy' / (legacy + '.json')).read_text(), original)
            self.assertTrue((pages / (legacy + '.json')).exists(), 'old evidence paths remain readable')
            self.assertEqual(integrity.audit(root, True)['renamed'], [])

    def test_neighbour_file_or_missing_html_is_not_a_capture(self):
        with tempfile.TemporaryDirectory() as tmp:
            href = '/release/album/a/b'
            target = Path(tmp) / (rules.slug_release(href) + '.json')
            target.write_text(json.dumps({'href': href + '-different'}))
            target.with_suffix('.html').write_text('other')
            self.assertFalse(rules.captura_conservada(tmp, href, 'release'))

    def test_interrupted_pair_does_not_count_as_conserved(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            href = '/release/album/a/b'
            target = Path(tmp) / (rules.slug_release(href) + '.json')
            target.write_text(json.dumps({'href': href, 'htmlSha256': hashlib.sha256(b'old').hexdigest()}))
            target.with_suffix('.html').write_text('changed before JSON commit')
            self.assertFalse(rules.captura_conservada(tmp, href, 'release'))
            target.write_text(json.dumps({'href': href}))
            target.with_suffix('.html').unlink()
            self.assertFalse(rules.captura_conservada(tmp, href, 'release'))


if __name__ == '__main__':
    unittest.main()
