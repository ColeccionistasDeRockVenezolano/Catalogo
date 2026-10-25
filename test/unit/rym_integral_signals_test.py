"""Literal source extraction guards, independent of the preserved corpus."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('rym_integral_signals', ROOT/'scripts/rym-integral-signals.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class LiteralSignals(unittest.TestCase):
    def test_preserves_parenthetical_title_and_scopes_genres_and_links(self):
        markup = '''<html><head><meta itemprop="name" content="Película (Acto I: Sobriedad)">
        <meta property="og:image" content="https://example.org/cover.jpg"></head><body>
        <div class="release_pri_genres"><a href="/genre/rock/">Rock</a></div>
        <div class="release_sec_genres"><a href="/genre/art-rock/">Art Rock</a></div>
        <aside><a href="/genre/jazz/">Jazz</a></aside>
        <div id="media_link_button_container_top" data-links='{"spotify":{"123":{"type":"album"}}}'></div>
        <div id="media_link_button_container_bottom" data-links='{"spotify":{"wrong":{}}}'></div>
        </body></html>'''
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'release.html'
            source.write_text(markup)
            result = MODULE.extract({'titulo':'Película','capturePins':[{'path':str(source)}]})
        self.assertEqual(result['titulo'], 'Película (Acto I: Sobriedad)')
        self.assertEqual(result['extractedTitle'], 'Película')
        self.assertEqual(result['primaryGenres'], ['Rock'])
        self.assertEqual(result['secondaryGenres'], ['Art Rock'])
        self.assertEqual(json.dumps(result['listeningLinks'],sort_keys=True), '{"spotify": {"123": {"type": "album"}}}')

    def test_missing_literal_title_preserves_existing_title(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'release.html'
            source.write_text('<html><title>Source without structured title</title></html>')
            result = MODULE.extract({'titulo':'Original','capturePins':[{'path':str(source)}]})
        self.assertEqual(result['titulo'], 'Original')
        self.assertEqual(result['primaryGenres'], [])


if __name__ == '__main__':
    unittest.main()
