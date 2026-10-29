import hashlib
import html
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('bandcamp_capture', pathlib.Path(__file__).resolve().parents[2] / 'scripts/bandcamp-player-capture.py')
capture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capture)


class BandcampPlayerCaptureTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        capture.DEST = pathlib.Path(self.temp.name)

    def page(self, url, raw):
        key = hashlib.sha256(url.encode()).hexdigest()
        (capture.DEST / (key + '.html')).write_text(raw)

    def test_release_uses_own_id_instead_of_parent_album(self):
        url = 'https://artist.bandcamp.com/track/song'
        props = html.escape(json.dumps({'item_type': 't', 'item_id': 42}), quote=True)
        self.page(url, '<meta name="bc-page-properties" content="' + props + '">')
        self.assertEqual(capture.resolve(url)['resolvedId'], 'track=42')

    def test_artist_uses_music_publication_and_not_band_id(self):
        url = 'https://artist.bandcamp.com/'
        self.page(url, '<li data-item-id="album-3259488170"></li>')
        self.assertEqual(capture.resolve(url)['resolvedId'], 'album=3259488170')

    def test_missing_release_does_not_use_unrelated_catalog_item(self):
        url = 'https://label.bandcamp.com/album/missing'
        raw = '<li data-item-id="album-42"></li>'
        self.page(url, raw)
        self.assertEqual(capture.resolve(url)['status'], 'unresolved')

    def test_single_release_profile_redirect_metadata(self):
        url = 'https://artist.bandcamp.com/'
        data = html.escape(json.dumps({'current': {'type': 'album', 'id': 51}}), quote=True)
        self.page(url, '<script data-tralbum="' + data + '"></script>')
        self.assertEqual(capture.resolve(url)['resolvedId'], 'album=51')

    def test_challenge_is_not_successful_evidence(self):
        url = 'https://artist.bandcamp.com/'
        with patch.object(capture, 'capture', return_value=('<title>Client Challenge</title>', 'challenge.html')):
            self.assertEqual(capture.resolve(url)['status'], 'unresolved')

    def test_rejects_external_host_without_network(self):
        with patch.object(capture, 'capture') as fetch:
            self.assertEqual(capture.resolve('https://bandcamp.com.attacker.test/')['status'], 'error')
            fetch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
