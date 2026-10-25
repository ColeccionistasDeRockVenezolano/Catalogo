import importlib.util
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('recovery_plan',ROOT/'scripts/hermes_recovery_plan.py')
plan=importlib.util.module_from_spec(spec);spec.loader.exec_module(plan)
mp3spec=importlib.util.spec_from_file_location('mp3_plan',ROOT/'scripts/mp3com-plan.py')
mp3=importlib.util.module_from_spec(mp3spec);mp3spec.loader.exec_module(mp3)
recoveryspec=importlib.util.spec_from_file_location('mp3_recovery',ROOT/'scripts/mp3com-recuperar.py')
recovery=importlib.util.module_from_spec(recoveryspec);recoveryspec.loader.exec_module(recovery)


class PreparationRules(unittest.TestCase):
    def test_song_url_preserves_archive_directory_for_short_ids(self):
        self.assertTrue(recovery.parse_song_page('', '664967')['url'].endswith('/664/664967.html'))
        self.assertTrue(recovery.parse_song_page('', '2907886')['url'].endswith('/2907/2907886.html'))
        self.assertTrue(recovery.parse_song_page('', '664967', 'archive-bucket')['url'].endswith('/archive-bucket/664967.html'))

    def test_artist_website_drops_mp3_internal_navigation(self):
        page='<a href="{}">Go to the artist\'s web site</a>'
        self.assertEqual(recovery.parse_links_page(page.format('https://example.org/'))['website'],'https://example.org/')
        self.assertIsNone(recovery.parse_links_page(page.format('http://artists.mp3s.com/artists/57/agresin.html'))['website'])
    def test_redirects_follow_registered_ids_and_detect_cycles(self):
        artists={'6806':{'name':'Presidente'}}
        aid,chain=plan.canonical_artist('1696',artists,{'1696':'7000','7000':'6806'})
        self.assertEqual(aid,'6806');self.assertEqual(len(chain),2)
        self.assertEqual(plan.canonical_artist('9999',artists,{}),(None,[]))
        with self.assertRaises(ValueError):plan.canonical_artist('1',{}, {'1':'2','2':'1'})

    def test_oembed_and_incomplete_youtube_status_are_not_playability_proof(self):
        for value in ({'title':'oEmbed title'},{'status':{'privacyStatus':'public'}},
                      {'status':{'privacyStatus':'private','embeddable':True}},
                      {'status':{'privacyStatus':'public','embeddable':'true'}}):
            self.assertFalse(plan.video_eligible(value))
        self.assertTrue(plan.video_eligible({'status':{'privacyStatus':'unlisted','embeddable':True}}))

    def test_quotes_preserve_literal_accents_and_line_breaks(self):
        original='El fanzine citó a Víctimas de la\nDemocracia en Caracas, 1992.'
        quote=plan.literal_quote(original,'victimas de la democracia')
        self.assertEqual(quote['mention'],'Víctimas de la\nDemocracia')
        self.assertEqual(original[quote['start']:quote['end']],quote['quote'])
        self.assertIsNone(plan.literal_quote(original,'Otra Banda'))

    def test_location_formatting_is_not_a_conflicting_city(self):
        self.assertTrue(plan.comparable_locations('Valencia','Valencia, Carabobo'))
        self.assertTrue(plan.comparable_locations('pto. la cruz','Puerto La Cruz'))
        self.assertFalse(plan.comparable_locations('Caracas','Barquisimeto'))

    def test_one_unseparated_member_entry_does_not_prove_a_solo_artist(self):
        kind,reason=mp3.artist_type('Renan RamirezJuan Carlos ChavezDiego','This is a fresh and new project')
        self.assertEqual(kind,'other');self.assertTrue(reason)
        self.assertEqual(mp3.artist_type('Me','')[0],'solo_artist')


if __name__=='__main__':unittest.main()
