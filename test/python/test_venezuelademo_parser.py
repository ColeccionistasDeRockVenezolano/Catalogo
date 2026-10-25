import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
from venezuelademo_parser import parse_artist_text

spec = importlib.util.spec_from_file_location('vd_extract',ROOT/'scripts/venezuelademo-extract.py')
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


class Reseñas(unittest.TestCase):
    def parse(self,name):
        return parse_artist_text((ROOT/'test/fixtures/venezuelademo'/f'{name}.txt').read_text())

    def test_contacto_y_ficha_promocional_no_contaminan_discografia(self):
        r = self.parse('agua-de-luna')
        self.assertEqual(r['discografia'],[{'titulo':'Mi tiempo','anio':2004}])
        self.assertEqual(r['contactos'][0]['emails'],['aguadluna@hotmail.com'])
        p = r['tema_promocional']
        self.assertEqual((p['titulo'],p['duracion'],p['genero']),('No te vayas','4:46','Charanga-timba'))
        self.assertTrue(any(c['rol']=='Mezcla y master' and c['valor'].startswith('José Mendoza')for c in p['creditos']))
        self.assertIn('(Madrid, España)',p['disco_declarado'])

    def test_tres_columnas_separan_personas_y_discos(self):
        r = self.parse('fauna')
        self.assertEqual([d['titulo']for d in r['discografia']],['El primero siempre es rápido','Camina','Fauna'])
        self.assertEqual(len(r['integrantes']),6)
        self.assertIn({'nombre':'Francisco Ovalles','rol':'batería'},r['integrantes'])
        self.assertIn('libero@unamaquina.com',r['contactos'][0]['emails'])

    def test_varios_discos_en_una_linea_preservan_titulos_y_fechas(self):
        r = self.parse('desorden-publico')
        self.assertEqual(len(r['discografia']),8)
        self.assertEqual(r['discografia'][-1],{'titulo':'DP 18, en concierto','anio':2004})
        self.assertNotIn('trompeta',[d['titulo']for d in r['discografia']])
        self.assertEqual(r['tema_promocional']['titulo'],'Luna verde')

    def test_dos_columnas_de_discos_no_forman_un_titulo_compuesto(self):
        r=parse_artist_text('>> Banda Ejemplo\n>> Discografía\nPrimer disco – 1981                 Segundo disco – 1999\nTercer disco – 1984                 Cuarto disco – 2001\n>> Contacto\n')
        self.assertEqual(r['discografia'],[{'titulo':'Primer disco','anio':1981},{'titulo':'Segundo disco','anio':1999},{'titulo':'Tercer disco','anio':1984},{'titulo':'Cuarto disco','anio':2001}])

    def test_guion_sin_espacios_antes_del_ano(self):
        r=parse_artist_text('>> Banda Ejemplo\n>> Discografía\nInicio- 2004\n>> Contacto\n')
        self.assertEqual(r['discografia'],[{'titulo':'Inicio','anio':2004}])

    def test_instrumentos_en_linea_siguiente_no_crean_otra_persona(self):
        r=parse_artist_text('>> Banda Ejemplo\n>> Integrantes\nJosé Boscán – caja colombiana,\nbongó, güira, güiro, campana, bombak\nArgenis Carruyo – voz líder\n>> Contacto\n')
        self.assertEqual(r['integrantes'],[
            {'nombre':'José Boscán','rol':'caja colombiana, bongó, güira, güiro, campana, bombak'},
            {'nombre':'Argenis Carruyo','rol':'voz líder'}])

    def test_fecha_de_grabacion_en_prosa_no_es_fecha_de_publicacion(self):
        r=parse_artist_text('>> Banda Ejemplo\n>> Discografía\nTema de película – Grabado en 2005\n>> Contacto\n')
        self.assertEqual(r['discografia'],[{'titulo':'Tema de película – Grabado en 2005','anio':None}])

    def test_tabla_no_fusiona_celdas_multilinea_de_filas_vecinas(self):
        # Dos títulos de dos líneas, separados por siete puntos. El parser
        # anterior los agrupaba en una celda y dejaba el segundo título vacío.
        def w(x,y,t):return {'x':x,'y':y,'t':t}
        lines=[[w(0,0,'#'),w(20,0,'Grupo'),w(100,0,'Tema'),w(200,0,'Tiempo'),w(240,0,'Autor'),w(300,0,'Género'),w(370,0,'Año')],
               [w(20,16,'Banda'),w(100,16,'Mar de')],
               [w(0,20,'1'),w(200,20,'3:40'),w(240,20,'Luis'),w(300,20,'Malagueña'),w(370,20,'1997')],
               [w(100,24,'mi esperanza')],
               [w(100,31,'Buscando')],
               [w(0,35,'2'),w(20,35,'Otra'),w(200,35,'4:36'),w(240,35,'Ana'),w(300,35,'Zumba'),w(370,35,'2006')],
               [w(100,39,'un coplero')]]
        with patch.object(extract,'words_by_line',return_value=[lines]):
            _,tracks=extract.parse_track_table(pathlib.Path('fixture.pdf'))
        self.assertEqual([t['tema']for t in tracks],['Mar de mi esperanza','Buscando un coplero'])
        self.assertEqual([t['anio']for t in tracks],[1997,2006])


if __name__=='__main__':unittest.main()
