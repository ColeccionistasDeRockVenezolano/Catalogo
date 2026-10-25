"""Regressions for misleading RYM bodies and structural review parsing."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from rym_reviews_parse import parsear_reviews
from rym_reviews_validate import validate

TASK={'href':'/release/album/famasloop/la_quema/','page':1}
HTML='''<html><head><title>Reviews of La quema by Famasloop</title>
<meta property="og:url" content="https://rateyourmusic.com/release/album/famasloop/la_quema/"></head>
<body><h2>1 Review</h2><span class="navlinkcurrent">1</span>
<div id="review_shell_std_42"><div class="review">
<span class="review_user" itemprop="author" content="Ana"><a class="user" href="/~Ana">Ana</a></span>
<span class="review_date" itemprop="datePublished"><a href="/music-review/Ana/famasloop/la_quema/42">Oct 21 2026</a></span>
<div class="review_body"><span class="rendered_text">Primero <span>anidado</span><br>final &amp; completo</span></div>
</div></div></body></html>'''

class ReviewsTest(unittest.TestCase):
 def test_attributes_and_nested_body(self):
  total,rs=parsear_reviews(HTML)
  self.assertEqual(total,1);self.assertEqual(rs[0]['usuario'],'Ana')
  self.assertEqual(rs[0]['fecha'],'Oct 21 2026')
  self.assertEqual(rs[0]['texto'],'Primero anidado\nfinal & completo')
  self.assertTrue(validate(HTML,TASK)['valid'])
 def test_forged_heading_is_insufficient(self):
  h=HTML.replace('/music-review/Ana/famasloop/la_quema/42','/music-review/Ana/the-clash/the-clash/42')
  self.assertIn('review_identity',validate(h,TASK)['errors'])
 def test_foreign_pagination(self):
  h=HTML.replace('</body>','<a class="navlinknum" href="/release/album/the-clash/the-clash/reviews/2/">2</a></body>')
  self.assertIn('pagination_identity',validate(h,TASK)['errors'])
 def test_errors_and_empty_are_not_success(self):
  self.assertFalse(validate('<title>rateyourmusic.com | 502: Bad gateway</title>',TASK)['valid'])
  h=HTML[:HTML.index('<div id="review_shell')]+ '</body></html>'
  self.assertIn('empty_unproven',validate(h,TASK)['errors'])
 def test_wrong_page(self):
  self.assertIn('wrong_page',validate(HTML,{**TASK,'page':2})['errors'])
 def test_redirect(self):
  self.assertIn('redirect_identity',validate(HTML,TASK,'https://rateyourmusic.com/release/album/foo/bar/')['errors'])
 def test_optional_rating(self):
  self.assertIsNone(parsear_reviews(HTML)[1][0]['rating'])
 def test_explicit_documented_alias(self):
  h=HTML.replace('/music-review/Ana/famasloop/la_quema/42','/music-review/Ana/famasloop/la-quema/42')
  self.assertTrue(validate(h,{**TASK,'verifiedAliases':['/release/album/famasloop/la-quema/']})['valid'])

if __name__=='__main__':unittest.main()
