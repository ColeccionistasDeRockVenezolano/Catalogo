"""Source fidelity cases that must survive catalog import."""
import importlib.util
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('plan',ROOT/'scripts/antologia-import-plan.py')
plan=importlib.util.module_from_spec(spec)
spec.loader.exec_module(plan)


def track(n,title,**kwargs):
    return {'n':n,'title':title,'raw':title+' (Autor de la fuente)','disc':1,'side':None,**kwargs}


class SourceFidelity(unittest.TestCase):
    def test_unlabelled_performers_after_authors_are_not_song_titles(self):
        rows=[track(1,'legacy',source_line='El Último Beso (Cochran/Omero) Los 007'),track(2,'legacy',source_line='Tu La Vas A Perder (Lennon/McCartney) Los Darts'),track(3,'legacy',source_line='La Guitarra "E. Alexander" Edgar Alexander Y Azúcar Cacao Y Leche')]
        got=plan.clean_listed_tracks(rows,plan.c.load_parser(),{})
        self.assertEqual([t['title'] for t in got],['El Último Beso','Tu La Vas A Perder','La Guitarra'])
        self.assertEqual(got[0]['performer'],'Los 007')
        self.assertEqual(got[0]['raw'],rows[0]['raw'])

    def test_leading_artist_credit_preserves_version_in_title(self):
        rows=[track(1,'legacy',source_line='(Los Darts) Tu La Vas A Perder (Lennon/McCartney)'),track(2,'legacy',source_line='(Los Impala) Algo (En Vivo) (Autor)')]
        got=plan.clean_listed_tracks(rows,plan.c.load_parser(),{})
        self.assertEqual([t['title'] for t in got],['Tu La Vas A Perder','Algo (En Vivo)'])
        self.assertEqual(got[1]['performer'],'Los Impala')

    def test_abbreviated_performer_label_stays_outside_title(self):
        rows=[track(1,'legacy',source_line='Nathalia (Antonio Lauro) Intp. Orq. Galantes De Venezuela')]
        got=plan.clean_listed_tracks(rows,plan.c.load_parser(),{})
        self.assertEqual(got[0]['title'],'Nathalia')

    def test_source_style_annotations_are_not_titles(self):
        rows=[track(1,'legacy',source_line='Los Cadetes \"Guaracha\" Víctor Pérez'),track(2,'legacy',source_line='Tres Regalos /Chachachá (Autor)')]
        got=plan.clean_listed_tracks(rows,plan.c.load_parser(),{})
        self.assertEqual([t['title'] for t in got],['Los Cadetes','Tres Regalos'])

    def test_zero_source_number_uses_ordinal(self):
        got=plan.source_positions([track(0,'Intro'),track(1,'Tema')])
        self.assertEqual([t['n'] for t in got],[1,2])
        self.assertEqual([t['source_number'] for t in got],[0,1])

    def test_medley_comparison_preserves_single_track(self):
        a=plan.publication_track_forms('Mosaico Nº 7')
        b=plan.publication_track_forms('Mosaico N° 7 a) Frenesí b) No negrita no')
        self.assertTrue(a&b)

    def test_number_reset_is_ordered_without_inventing_another_disc(self):
        rows=plan.source_positions([track(1,'Uno'),track(2,'Dos'),track(1,'Tres')])
        self.assertEqual([(r['disc'],r['n']) for r in rows],[(1,1),(1,2),(1,3)])
        self.assertEqual([r['source_number'] for r in rows],[1,2,1])
        self.assertTrue(all('orden del listado' in r['notes'] for r in rows))

    def test_explicit_discs_keep_their_positions(self):
        rows=plan.source_positions([track(1,'Uno'),track(2,'Dos'),track(1,'Tres',disc=2)])
        self.assertEqual([(r['disc'],r['n']) for r in rows],[(1,1),(1,2),(2,1)])
        self.assertFalse(any(r['ordinal_position'] for r in rows))

    def test_sides_and_credits_remain_documented(self):
        rows=plan.source_positions([track(1,'Cara A',side='A'),track(1,'Cara B',side='B')])
        self.assertEqual([r['source_side'] for r in rows],['A','B'])
        self.assertIn('Autor de la fuente',rows[1]['notes'])

    def test_gaps_are_not_replaced_with_guessed_tracks(self):
        rows=plan.source_positions([track(1,'Uno'),track(3,'Tres')])
        self.assertEqual([r['n'] for r in rows],[1,3])

    def test_arrangement_paragraph_is_preserved_outside_title(self):
        text='Falsa Mujer (Ernesto López, Arreglo De Carlos D León '+('comentario '*30)+')'
        row=plan.source_positions([track(1,text)])[0]
        self.assertEqual(row['title'],'Falsa Mujer')
        self.assertIn(text,row['notes'])

    def test_legitimate_long_title_is_not_silently_truncated(self):
        with self.assertRaises(AssertionError):plan.source_positions([track(1,'Tema '*70)])

    def test_sizes_of_same_image_match_but_distinct_images_do_not(self):
        a='https://a.example/img/ASSET/s72-c/front.jpg'
        b='https://b.example/img/ASSET/s320/front.jpg'
        c='https://a.example/img/ASSET/s320/back.jpg'
        self.assertEqual(plan.image_key(a),plan.image_key(b))
        self.assertNotEqual(plan.image_key(a),plan.image_key(c))

    def test_series_and_labels_are_not_artist_identities(self):
        self.assertIn(plan.norm('Venezuela Plural'),plan.COLLECTIONS)
        self.assertIn(plan.norm('PDVSA'),plan.COLLECTIONS)
        self.assertNotIn(plan.norm('Los Pacheco'),plan.COLLECTIONS)


if __name__=='__main__':unittest.main()
