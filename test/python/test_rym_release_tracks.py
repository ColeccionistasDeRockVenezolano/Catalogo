import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from rym_release_tracks import extract_tracks


def row(title, number='1'):
    return f'<li class="track"><div class="tracklist_line"><span class="tracklist_num">{number}</span><span class="tracklist_title">{title}</span></div></li>'


class TrackExtraction(unittest.TestCase):
    def test_uses_one_primary_presentation_and_ignores_other_issues(self):
        original = row('<a class="song" href="/song/a/original">Original</a>')
        alternate = row('<a class="song" href="/song/a/alternate">Other issue</a>', 'A1')
        result = extract_tracks('<div><ul id="tracks_mobile">'+original+'</ul><div id="catalog_list"><ul>'+alternate+'</ul></div><ul id="tracks">'+original+'</ul></div>')
        self.assertEqual([track['titulo'] for track in result['pistas']], ['Original'])

    def test_split_song_links_select_title_and_preserve_artists(self):
        markup = row('<a class="artist" href="/artist/a">A</a><a class="song" href="/song/a-b/title"> &amp; </a><a class="artist" href="/artist/b">B</a><a class="song" href="/song/a-b/title"> - Agradecida</a>')
        track = extract_tracks(markup)['pistas'][0]
        self.assertEqual(track['titulo'], 'Agradecida')
        self.assertEqual([artist['nombre'] for artist in track['artist_credits']], ['A', 'B'])
        self.assertNotIn('title_ambiguous', track)

    def test_leading_separator_is_removed_only_after_an_artist_credit(self):
        self.assertEqual(extract_tracks(row('<a class="song" href="/song/a/title">- Quiet</a>'))['pistas'][0]['titulo'], '- Quiet')
        markup = row('<a class="artist" href="/artist/a">A</a><a class="song" href="/song/a/title"> - OmniDead</a>')
        self.assertEqual(extract_tracks(markup)['pistas'][0]['titulo'], 'OmniDead')

    def test_plain_title_excludes_lyrics_and_duration_and_deduplicates(self):
        markup = row('Canción<a class="tracks_lyric_link" href="/song/a/title/#lyrics">lyrics</a><span class="tracklist_duration" data-inseconds="225">3:45</span>')
        result = extract_tracks('<ul>'+markup+markup+'</ul>')
        self.assertEqual(result['n_pistas'], 1)
        self.assertEqual(result['pistas'][0]['titulo'], 'Canción')
        self.assertEqual(result['pistas'][0]['seg'], 225)

    def test_multiple_works_remain_explicitly_ambiguous(self):
        result = extract_tracks(row('<a class="song" href="/song/a/one">One</a> / <a class="song" href="/song/a/two">Two</a>'))
        self.assertTrue(result['pistas'][0]['title_ambiguous'])

    def test_vs_separator_and_linked_remixer_inside_title_are_preserved(self):
        markup = row('<a class="artist" href="/artist/a">A</a><a class="song" href="/song/a-b/title"> vs </a><a class="artist" href="/artist/b">B</a><a class="song" href="/song/a-b/title"> - Song (</a><a class="artist" href="/artist/c">C</a><a class="song" href="/song/a-b/title"> Remix)</a>')
        track = extract_tracks(markup)['pistas'][0]
        self.assertEqual(track['titulo'], 'Song (C Remix)')
        self.assertNotIn('title_ambiguous', track)

    def test_by_credit_is_not_part_of_song_when_literal_title_matches_song_url(self):
        markup = row('<a class="artist" href="/artist/miss-construction">Miss Construction</a><a class="song" href="/song/miss-construction/too-extreme/">by Chris Pohl - Too Extreme</a>')
        track = extract_tracks(markup)['pistas'][0]
        self.assertEqual(track['titulo'], 'Too Extreme')
        self.assertNotIn('title_ambiguous', track)


if __name__ == '__main__':
    unittest.main()
