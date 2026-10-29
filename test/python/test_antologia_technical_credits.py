import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('antologia', ROOT / 'scripts/antologia-blogspot-cruce.py')
PARSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARSER)


class TrackTechnicalCredits(unittest.TestCase):
    def test_short_title_metadata_has_no_length_threshold(self):
        row = PARSER.parse_tracks('1.- Tu Y Yo Integrantes: Humberto Becerra, Alfredo Cabrera')[0]
        self.assertEqual(row['title'], 'Tu Y Yo')
        self.assertIn('Humberto', row['technical_credits'])
        self.assertIn('Humberto', row['raw'])

    def test_missing_colon_and_global_composer_annotation(self):
        row = PARSER.parse_tracks('1.- Volver Todas Las Pistas De Marcos Chacón Excepto (Pista 7, 9)')[0]
        self.assertEqual(row['title'], 'Volver')
        row = PARSER.parse_tracks('1.- Coda\n\nMúsicos')[0]
        self.assertEqual(row['title'], 'Coda')

    def test_musicians_word_inside_song_title_is_not_a_heading(self):
        row = PARSER.parse_tracks('1.- Los Músicos Del Pueblo')[0]
        self.assertEqual(row['title'], 'Los Músicos Del Pueblo')
        self.assertIsNone(row['technical_credits'])

    def test_numbered_credits_track_is_preserved(self):
        row = PARSER.parse_tracks('1.- Créditos Integrantes: Ana, Pedro')[0]
        self.assertEqual(row['title'], 'Créditos')

    def test_composer_is_separate_from_technical_block(self):
        row = PARSER.parse_tracks('1.- Otra Vez (Alí Primera) Integrantes: Cuatro: Alí Primera')[0]
        self.assertEqual(row['title'], 'Otra Vez')
        self.assertEqual(row['composer'], 'Alí Primera')

    def test_medley_components_remain_one_musical_track(self):
        row = PARSER.parse_tracks('1.- Mosaico A) La Paloma B) El Caimán C) El Manisero')[0]
        self.assertEqual(row['title'], 'Mosaico A) La Paloma B) El Caimán C) El Manisero')
        self.assertIsNone(row['technical_credits'])

    def test_performer_marker_does_not_match_inside_song_words(self):
        for title in ['Soy El Propio Cantaclaro', 'Encantada', 'Me Encanta El Amor']:
            row = PARSER.parse_tracks('1.- ' + title)[0]
            self.assertEqual(row['title'], title)
            self.assertIsNone(row['performer'])
        row = PARSER.parse_tracks('1.- Canción Canta: María')[0]
        self.assertEqual(row['title'], 'Canción')
        self.assertEqual(row['performer'], 'María')

    def test_explicit_discs_keep_repeated_track_numbers(self):
        rows = PARSER.parse_tracks('CD 1\n1.-1 Taboga\n2.-1 Dulce Cantar\nDisco 2\n1.-2 Pensando En Ti\n2.-2 A Mi Tierra')
        self.assertEqual([(r['disc'], r['n'], r['title']) for r in rows],
                         [(1, 1, 'Taboga'), (1, 2, 'Dulce Cantar'),
                          (2, 1, 'Pensando En Ti'), (2, 2, 'A Mi Tierra')])

    def test_musician_track_references_do_not_create_a_phantom_song(self):
        rows = PARSER.parse_tracks('1.- Canción\n\nIntegrantes:\nPiano: Ana (Pista CD1: 5, 8, 10 - CD2: 8, 10)')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['title'], 'Canción')
        self.assertIn('Piano', rows[0]['technical_credits'])

    def test_disc_with_continuing_numbers_is_preserved(self):
        rows = PARSER.parse_tracks('Disco 3\n1.- Canción\nDisco 4\n11.- Cantan Los Gallos\n12.- Cantar')
        self.assertEqual([(r['disc'], r['n']) for r in rows], [(3, 1), (4, 11), (4, 12)])


if __name__ == '__main__':
    unittest.main()
