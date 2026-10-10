import importlib.util
from pathlib import Path
import unittest
s=importlib.util.spec_from_file_location('P',Path(__file__).resolve().parents[2]/'scripts/rym-nuevos-aplicar/plan-discos.py');P=importlib.util.module_from_spec(s);s.loader.exec_module(P)
def a(i,title,ty='studio_album',year=2020,aliases=()):
 return {'id':i,'c':P.clave_titulo(title),'claves':{P.clave_titulo(t) for t in [title,*aliases]},'type':ty,'year':year}
class Remanente(unittest.TestCase):
 def test_alias(self):
  r=P.elegir_album([a(1,'Time Traveler EP','ep',2021,['Time Traveler'])],{P.clave_titulo('Time Traveler')},'ep',2021,set());self.assertEqual(r['id'],1)
 def test_no_prefix(self):
  for t in ['Disco (Remixes)','Disco Vol. 2','Disco Demo']:
   self.assertIsNone(P.elegir_album([a(1,'Disco')],{P.clave_titulo(t)},'studio_album',2020,set()))
 def test_types(self):
  self.assertEqual(P.elegir_album([a(1,'The Journey','ep'),a(2,'The Journey','single')],{P.clave_titulo('The Journey')},'single',2020,set())['id'],2)
 def test_repeated_title_separate_year(self):
  self.assertEqual(P.elegir_album([a(1,'Arabella',year=1978),a(2,'Arabella',year=1985)],{P.clave_titulo('Arabella')},'studio_album',1985,set())['id'],2)
 def test_used_is_not_identity(self):
  self.assertEqual(P.elegir_album([a(1,"Arabella",year=1978),a(2,"Arabella",year=1985)],{P.clave_titulo("Arabella")},"studio_album",1978,{1})["id"],1)
 def test_ambiguity(self):
  with self.assertRaises(ValueError):P.elegir_album([a(1,'Disco'),a(2,'Disco')],{P.clave_titulo('Disco')},'studio_album',2020,set())
 def test_redirect(self):
  self.assertEqual(P.seguir({20300:7779},20300),7779)
if __name__=='__main__':unittest.main()
