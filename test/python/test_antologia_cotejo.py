import importlib.util
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('antologia_cotejo',ROOT/'scripts/antologia-cotejo-integral.py')
MOD=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class AntologiaCotejoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser=MOD.load_parser()

    def parse(self,text):
        return MOD.parse_source_tracks(text,self.parser)

    def test_numbering_reset_keeps_discs_and_suffixes(self):
        tracks=self.parse('CD 1\n1.-1 Tema Uno (Autor Uno)\n2.-1 Tema Dos\nCD 2\n1.-2 Otro Tema (Autor Dos)\n')
        self.assertEqual([(t['disc'],t['n'],t['title']) for t in tracks],[(1,1,'Tema Uno'),(1,2,'Tema Dos'),(2,1,'Otro Tema')])

    def test_side_is_preserved_without_inventing_global_position(self):
        tracks=self.parse('Disco 1 - Lado A\n1.- Canción A\nDisco 1 - Lado B\n1.- Canción B\n')
        self.assertEqual([(t['disc'],t['side'],t['n']) for t in tracks],[(1,'A',1),(1,'B',1)])

    def test_metadata_does_not_become_song_title(self):
        tracks=self.parse('1.- Tema "Joropo" (Autor Uno) 2003\nInterprete: Banda Uno\n2.- Otro Tema\nProducción: Productor Uno\nBajo: Bajista Uno\n')
        self.assertEqual(tracks[0]['title'],'Tema')
        self.assertEqual(tracks[0]['recording_year'],2003)
        self.assertEqual(tracks[0]['performer'],'Banda Uno')
        self.assertEqual(tracks[1]['title'],'Otro Tema')
        self.assertIn('Bajista Uno',tracks[1]['technical_text'])

    def test_medley_parts_are_not_separate_numbered_tracks(self):
        tracks=self.parse('1.- Mosaico\nA) Primera (Autor Uno)\nB) Segunda (Autor Dos)\n2.- Canción Final\n')
        self.assertEqual(len(tracks),2)
        self.assertEqual(tracks[0]['title'],'Mosaico')
        self.assertEqual(len(tracks[0]['medley_parts']),2)

    def test_name_normalization_does_not_singularize_or_strip_articles(self):
        self.assertNotEqual(MOD.norm('Los Chiquinquireños'),MOD.norm('Los Chiquinquireñitos'))
        self.assertNotEqual(MOD.norm('Los Impala'),MOD.norm('Impala'))

    def test_title_with_direction_character_and_missing_space(self):
        t=MOD.title_parts('Naty y Su Orquesta \u200e- 25 Aniversario (2008)',self.parser)
        self.assertEqual(t['artist'],'Naty y Su Orquesta')
        t=MOD.title_parts('Guaco -Tercera Etapa (1986)',self.parser)
        self.assertEqual(t['album'],'Tercera Etapa')

    def test_technical_tail_correction_does_not_drop_medley_or_version(self):
        self.assertTrue(MOD.technical_title_correction('Eucaristía (2012)','Eucaristía (2012) L Y M: Abdenago Borjas','Eucaristía (2012)'))
        self.assertTrue(MOD.technical_title_correction('Tema','Tema Todos Las Pistas De Yordano','Tema'))
        self.assertFalse(MOD.technical_title_correction('Mosaico','Mosaico A) Amor B) Vuelve','Mosaico'))
        self.assertFalse(MOD.technical_title_correction('Fantasía','Fantasía Remix','Fantasía'))
        self.assertFalse(MOD.technical_title_correction('Tema','Tema Del Amanecer','Tema'))

    def test_multidisc_roman_and_punctuation_are_explicit(self):
        tracks=self.parse('CD.I\n1.- Primero\nCD.2\n1.- Segundo\n(Disc III)\n1.- Tercero')
        self.assertEqual([t['disc'] for t in tracks],[1,2,3])

    def test_composer_nickname_is_not_a_genre(self):
        tracks=self.parse('1.- Tema (Abdénago "Neguito" Borjas)\n2.- Otro "Joropo" (Autor Dos)')
        self.assertIsNone(tracks[0]['genre'])
        self.assertEqual(tracks[0]['composer'],'Abdénago "Neguito" Borjas')
        self.assertEqual(tracks[1]['genre'],'Joropo')

    def test_global_repertoire_search_does_not_drop_common_songs_or_cap_candidates(self):
        albums=set(range(600))|{9999}
        index={'uno':albums,'dos':albums,'tres':albums}
        votes=MOD.repertoire_votes(['uno','dos','tres','uno'],index)
        self.assertEqual(len(votes),601)
        self.assertEqual(votes[9999],3)


if __name__=='__main__':
    unittest.main()
