import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'scripts'))
from rym_identity import assess, publication_type_conflict


class RymIdentity(unittest.TestCase):
    def test_publication_base_conflicts_require_review(self):
        self.assertTrue(publication_type_conflict('Album', 'single'))
        self.assertTrue(publication_type_conflict('EP', 'single'))
        self.assertTrue(publication_type_conflict('Album, Video', 'studio_album'))
        self.assertTrue(publication_type_conflict('DJ Mix', 'compilation'))

    def test_effective_categories_preserve_documented_compounds(self):
        self.assertFalse(publication_type_conflict('EP', 'remix'))
        self.assertFalse(publication_type_conflict('Single', 'soundtrack'))
        self.assertFalse(publication_type_conflict('Album', 'live_album'))
        self.assertFalse(publication_type_conflict('EP', 'single', ['EP', 'Remix']))

    def test_name_country_and_genre_are_not_identity(self):
        result=assess({'info': {'Formed': '1995, Venezuela'}, 'discografia_listada':[]},
                      {'id':1,'name':'Bacos','formedYear':1995,'city':'Venezuela'})
        self.assertEqual(result['status'],'needs_review')

    def test_two_distinctive_titles_resolve_without_equating_editions(self):
        source={'discografia_listada':[{'t':'Un camino largo','y':'2001'},{'t':'Otra vida','y':'2004'}]}
        artist={'id':1,'name':'Bacos','albums':[{'id':2,'title':'Un camino largo'},{'id':3,'title':'Otra vida'}]}
        self.assertEqual(assess(source,artist)['status'],'resolved')
        artist['albums'][1]['title']='Otra vida (Remixes)'
        self.assertEqual(assess(source,artist)['status'],'needs_review')

    def test_generic_titles_do_not_establish_repertoire(self):
        source={'discografia_listada':[{'t':'EP'},{'t':'Bacos'},{'t':'Live'}]}
        artist={'id':1,'name':'Bacos','albums':[{'id':i,'title':t} for i,t in enumerate(['EP','Bacos','Live'])]}
        self.assertEqual(assess(source,artist)['status'],'needs_review')

    def test_one_title_requires_year_and_city(self):
        source={'info':{'Formed':'2001, Mérida, Venezuela'},'discografia_listada':[{'t':'Un camino largo'}]}
        artist={'id':1,'name':'Bacos','formedYear':2001,'city':'Mérida','albums':[{'id':2,'title':'Un camino largo'}]}
        self.assertEqual(assess(source,artist)['status'],'resolved')
        artist['city']='São Paulo'
        self.assertEqual(assess(source,artist)['status'],'needs_review')

    def test_repeated_rows_do_not_count_as_two_members_or_titles(self):
        source={'info':{'Members':'Ana Pérez (guitar)'},'discografia_listada':[{'t':'Un camino largo'}]}
        artist={'id':1,'name':'Bacos','albums':[{'id':i,'title':'Un camino largo'} for i in [1,2]],
                'members':[{'id':3,'name':'Ana Pérez'},{'id':3,'name':'Ana Pérez'}]}
        self.assertEqual(assess(source,artist)['status'],'needs_review')


if __name__=='__main__':unittest.main()
