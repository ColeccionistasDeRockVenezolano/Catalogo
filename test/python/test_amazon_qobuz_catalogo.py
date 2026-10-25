import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('amazon_qobuz', Path(__file__).parents[2] / 'scripts/amazon-qobuz-catalogo.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CatalogIdentityTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.collector = module.Collector(Path(directory.name), 'http://localhost')
        self.artist = {'id': 1, 'name': 'Banda Única', 'albums': [{'id': 2, 'title': 'Primer disco', 'year': 2001}]}
        self.profile = 'https://www.qobuz.com/us-en/interpreter/banda-unica/10'
        self.album = 'https://www.qobuz.com/us-en/album/primer-disco/abc'

    def get(self, url):
        if '/search?' in url:
            return f'<main><a href="{self.profile}">Banda Unica</a></main>'
        if '/interpreter/' in url:
            return f'<div class="product__item"><a href="{self.album}"><h3 class="product__name">Primer disco</h3></a><p class="product__artist"><a>Banda Única</a></p></div>'
        return '<script type="application/ld+json">' + json.dumps({'@type': 'Product', 'name': 'Primer disco', 'brand': {'name': 'Banda Única'}, 'releaseDate': '2001-01-01'}) + '</script>'

    def test_identity_requires_repertoire_and_detail(self):
        with patch.object(self.collector, 'get', side_effect=self.get):
            result = self.collector.qobuz(self.artist)
        self.assertEqual(len(result['artist_links']), 1)
        self.assertEqual(result['album_links'][0]['albumId'], 2)
        self.assertEqual(result['album_links'][0]['profile_url'], self.profile)

    def test_known_year_conflict_stays_pending(self):
        self.artist['albums'][0]['year'] = 2002
        with patch.object(self.collector, 'get', side_effect=self.get):
            result = self.collector.qobuz(self.artist)
        self.assertEqual(result['artist_links'], [])
        self.assertEqual(result['pendingAlbums'], [2])

    def test_duplicate_canonical_records_stay_in_review(self):
        self.artist['albums'].append({'id': 3, 'title': 'Primer disco', 'year': 2001})
        with patch.object(self.collector, 'get', side_effect=self.get):
            result = self.collector.qobuz(self.artist)
        self.assertEqual(result['album_links'], [])
        self.assertEqual(result['pendingAlbums'], [2, 3])
        self.assertIn('varias fichas', result['review'][0]['reason'])

    def test_homonyms_are_not_arbitrarily_selected(self):
        def get(url):
            if '/search?' in url:
                return self.get(url).replace('</main>', f'<a href="{self.profile[:-2]}11">Banda Única</a></main>')
            return self.get(url)
        with patch.object(self.collector, 'get', side_effect=get):
            result = self.collector.qobuz(self.artist)
        self.assertEqual(result['artist_links'], [])
        self.assertEqual(result['album_links'], [])
        self.assertIn('homónimos', result['review'][0]['reason'])

    def test_follows_discography_pagination(self):
        def get(url):
            if url == self.profile:
                return f'<a href="{self.profile}/page/2">2</a>'
            return self.get(url)
        with patch.object(self.collector, 'get', side_effect=get):
            result = self.collector.qobuz(self.artist)
        self.assertEqual(len(result['album_links']), 1)

    def test_challenge_page_is_an_error_not_absence(self):
        with patch.object(self.collector, 'get', return_value='<html>Access denied</html>'):
            with self.assertRaisesRegex(RuntimeError, 'sin catálogo'):
                self.collector.qobuz(self.artist)

    def test_amazon_results_remain_review_candidates(self):
        response = {'results': [{'url': 'https://music.amazon.com/albums/B123',
                                'title': 'Play Primer disco by Banda Única on Amazon Music'}]}
        with patch.object(self.collector, 'get', return_value=json.dumps(response)):
            result = self.collector.amazon(self.artist)
        self.assertEqual(result['album_links'][0]['source'], 'amazon-web-search')
        self.assertEqual(result['artist_links'], [])
        self.assertEqual(result['pendingAlbums'], [2])


if __name__ == '__main__':
    unittest.main()
