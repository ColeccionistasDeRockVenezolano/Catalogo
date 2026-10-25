import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from rym_release_credits import extract_credits


class RymCredits(unittest.TestCase):
    def test_mobile_roles_are_not_unspecified_musicians(self):
        rows=extract_credits('<ul class="credits"><li><a href="/artist/a">Ana Pérez</a><br><span class="role_name">piano</span><span class="role_name">producer</span></li></ul>')
        self.assertEqual([x['roles'] for x in rows],['piano','producer'])

    def test_unlinked_person_and_track_scope_survive(self):
        rows=extract_credits('<ul class="credits"><li><span>Jorge Romero</span><br><span class="role_name has_tracks">composer<span class="role_tracks">A2, B3</span></span></li><li class="expand_button"><span>Expand credits</span></li></ul>')
        self.assertEqual(rows,[{'nombre':'Jorge Romero','roles':'composer','href':None,'positions':'A2, B3'}])

    def test_identical_desktop_and_mobile_display_is_one_credit(self):
        row='<li><a href="/artist/a">Ana Pérez</a><br><span class="role_name">piano</span></li>'
        self.assertEqual(len(extract_credits('<ul class="credits">'+row+row+'</ul>')),1)

    def test_desktop_credit_roles_remain_explicit(self):
        rows=extract_credits('<ul class="credits"><li><div class="credits_artist"><a href="/artist/a">Ana Pérez</a></div><div class="credits_roles">arranger</div></li></ul>')
        self.assertEqual(rows[0]['roles'],'arranger')


if __name__=='__main__':unittest.main()
