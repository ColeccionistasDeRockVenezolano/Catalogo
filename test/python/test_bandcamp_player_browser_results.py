import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / 'scripts/bandcamp-player-browser-results.py'


class BandcampBrowserResultsTest(unittest.TestCase):
    def merge(self, rows, requested, result, engine=None):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'results.json').write_text(json.dumps(rows))
            (root / 'browser-test.json').write_text(json.dumps({'requestedUrls': requested, 'result': result, 'engine': engine}))
            subprocess.run([sys.executable, str(SCRIPT), directory], check=True, capture_output=True)
            return json.loads((root / 'results.json').read_text())

    def row(self, url, external_id=None):
        return {'id': 1, 'url': url, 'external_id': external_id, 'verified': True, 'status': 'error'}

    def test_catalog_repairs_profile_and_exact_album_only(self):
        urls = ['https://artist.bandcamp.com/', 'https://artist.bandcamp.com/album/known', 'https://artist.bandcamp.com/album/missing']
        raw = '<li class="music-grid-item" data-item-id="album-42"><a href="/album/known">Known</a></li>'
        result = self.merge([self.row(url) for url in urls], [urls[0]], [{'url': urls[0], 'status': 200, 'content': [raw]}])
        self.assertEqual([row.get('resolvedId') for row in result], ['album=42', 'album=42', None])

    def test_deleted_profile_redirect_does_not_create_player(self):
        url = 'https://deleted.bandcamp.com/'
        result = self.merge([self.row(url)], [url], [{'url': 'https://bandcamp.com/signup?new_domain=deleted', 'status': 200, 'content': ['']}])
        self.assertEqual(result[0]['status'], 'unavailable')
        self.assertNotIn('resolvedId', result[0])

    def test_track_metadata_and_existing_profile_selection(self):
        urls = ['https://artist.bandcamp.com/', 'https://artist.bandcamp.com/track/song']
        raw = '<meta name="bc-page-properties" content=\'{"item_type":"t","item_id":51}\'>'
        result = self.merge([self.row(urls[0], 'album=42'), self.row(urls[1])], urls,
                            [{'url': urls[1], 'status': 200, 'content': [raw]} for _ in urls])
        self.assertEqual([row['resolvedId'] for row in result], ['album=42', 'track=51'])
        self.assertTrue(all(row['status'] == 'ok' for row in result))

    def test_network_error_is_pending_instead_of_unavailable(self):
        url = 'https://artist.bandcamp.com/'
        result = self.merge([self.row(url)], [url], [{'url': url, 'status': 0, 'content': []}])
        self.assertEqual(result[0]['status'], 'error')

    def test_archived_release_repairs_same_account_profile(self):
        url = 'https://artist.bandcamp.com/'
        release = 'https://artist.bandcamp.com/album/known'
        raw = '<meta name="bc-page-properties" content=\'{"item_type":"a","item_id":42}\'>'
        result = self.merge([self.row(url)], [release], [{'url': release, 'status': 200, 'content': [raw]}], 'archived_source_capture')
        self.assertEqual(result[0]['resolvedId'], 'album=42')

    def test_archive_does_not_revive_confirmed_deleted_account(self):
        url = 'https://artist.bandcamp.com/'
        row = {**self.row(url), 'status': 'unavailable'}
        raw = '<meta name="bc-page-properties" content=\'{"item_type":"a","item_id":42}\'>'
        result = self.merge([row], [url], [{'url': url, 'status': 200, 'content': [raw]}], 'archived_source_capture')
        self.assertEqual(result[0]['status'], 'unavailable')
        self.assertNotIn('resolvedId', result[0])


if __name__ == '__main__':
    unittest.main()
