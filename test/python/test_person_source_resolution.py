import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from person_source_resolution import resolve_person,is_group_member_edge


class PersonSources(unittest.TestCase):
    def test_alias_needs_the_project(self):
        p=[{'id':1,'name':'Henry Augustus Stephen'}];idx={'henry stephen':{1}}
        self.assertEqual(resolve_person('Henry Stephen',10,p,idx,{(1,10)})['personId'],1)
        self.assertEqual(resolve_person('Henry Stephen',11,p,idx,{(1,10)})['status'],'needs_review')

    def test_one_word_is_not_approved_even_when_unique(self):
        self.assertEqual(resolve_person('Melao',10,[{'id':1,'name':'Melao'}],{'melao':{1}},{(1,10)})['status'],'needs_review')

    def test_common_name_can_be_resolved_only_with_unique_project(self):
        p=[{'id':1,'name':'Juan Pérez'},{'id':2,'name':'Juan Pérez'}]
        self.assertEqual(resolve_person('Juan Pérez',10,p,{'juan perez':{1,2}},{(2,10)})['personId'],2)
        self.assertEqual(resolve_person('Juan Pérez',10,p,{'juan perez':{1,2}},{(1,10),(2,10)})['status'],'needs_review')

    def test_no_fuzzy_surname_substitution(self):
        p=[{'id':1,'name':'Ángel Ferreira'}]
        self.assertEqual(resolve_person('Ángel Pereira',10,p,{'angel ferreira':{1}},{(1,10)})['status'],'new_candidate')
        # The native ER still decides whether creating that distinct full name is allowed.

    def test_documented_short_name_in_the_same_project(self):
        p=[{'id':1,'name':'Jean Robert Puccia Suarez'}]
        self.assertEqual(resolve_person('Jean Robert Puccia',10,p,{}, {(1,10)})['personId'],1)
        self.assertEqual(resolve_person('Jean Robert Puccia',11,p,{}, {(1,10)})['status'],'new_candidate')

    def test_forward_person_to_band_is_not_a_new_person(self):
        self.assertFalse(is_group_member_edge({'type':'Person'},{'type':'member of band','direction':'forward'}))
        self.assertTrue(is_group_member_edge({'type':'Group'},{'type':'member of band','direction':'backward'}))


if __name__=='__main__':unittest.main()
