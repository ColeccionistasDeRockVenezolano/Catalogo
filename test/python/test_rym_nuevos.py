"""Pruebas de la campaña RYM «nuevos»: reglas únicas, E/S atómica, tablero y extractor.

Correr:
  python3 -m unittest discover -s test/python -p 'test_rym_nuevos.py'          # reglas + tablero
  ~/.venvs/scrapling/bin/python -m unittest discover -s test/python -p 'test_rym_nuevos.py'
                                                                     # + extractor (necesita scrapling)
"""
import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPTS = os.path.join(RAIZ, "scripts")
FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "rym")
sys.path.insert(0, SCRIPTS)

import rym_reglas as reglas  # noqa: E402
import rym_tablero as tablero  # noqa: E402

try:
    from scrapling.parser import Selector
    spec = importlib.util.spec_from_file_location("scrapling_rym", os.path.join(SCRIPTS, "scrapling-rym.py"))
    capt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capt)
except ImportError:  # sin el venv de scrapling: se saltan solo las pruebas del extractor
    Selector = capt = None


def leer(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def escribir(p, texto=""):
    with open(p, "w", encoding="utf-8") as f:
        f.write(texto)


def disco(**kw):
    e = {"kind": "release", "v": reglas.EXTRACTOR_V, "name": "X", "og": None, "nTracks": 0, "nGen": 0}
    e.update(kw)
    return e


class Reglas(unittest.TestCase):
    def test_norm_href(self):
        for h in ("https://rateyourmusic.com/release/album/a/b/", "/release/album/a/b?x=1",
                  "/release/album/a/b#c", "/release/album/a/b"):
            self.assertEqual(reglas.norm_href(h), "/release/album/a/b")
        self.assertEqual(reglas.norm_href("/release/album/a/ki_sort%E2%80%99i"), "/release/album/a/ki_sort’i")
        self.assertEqual(reglas.norm_href(None), "")

    def test_estados_de_disco(self):
        con_datos = disco(og="https://x/y.jpg")
        vacio = disco(sinDatos=True)
        muro = disco(sinDatos=True, wall=True)
        viejo = disco(og="x", v=2)
        gone = {"kind": "release", "v": reglas.EXTRACTOR_V, "status": 404, "name": None}
        self.assertTrue(reglas.es_ok_release(con_datos) and reglas.es_hecho_release(con_datos))
        self.assertTrue(reglas.es_vacio_release(vacio) and reglas.es_hecho_release(vacio))
        self.assertFalse(reglas.es_ok_release(vacio))
        self.assertFalse(reglas.es_hecho_release(muro), "una página-muro nunca cuenta como hecha")
        self.assertFalse(reglas.es_hecho_release(viejo), "otra versión del extractor se recaptura")
        self.assertTrue(reglas.es_hecho_release(gone) and reglas.es_hecho_artista(gone))
        self.assertFalse(reglas.es_hecho_release(None))

    def _campana(self, d):
        pages = os.path.join(d, "pages")
        os.makedirs(pages)
        cola = [{"name": "A", "rymHref": "/artist/a"}, {"name": "B", "rymHref": "/artist/b"},
                {"name": "C", "rymHref": "/artist/c"}]
        filas = {"a": ["/release/album/a/1", "/release/album/a/2"],
                 "b": ["https://rateyourmusic.com/release/album/a/2/", "/release/album/b/1"]}
        for slug, hs in filas.items():
            with open(os.path.join(pages, slug + ".json"), "w") as f:
                json.dump({"rec": {"rows": [{"h": h, "t": h[-1]} for h in hs]}}, f)
        estado = {"/artist/a": {"kind": "artist", "v": 3, "name": "A"},
                  "/artist/b": {"kind": "artist", "v": 3, "name": "B"},
                  "/release/album/a/1": disco(og="x"),
                  "/release/album/a/2": disco(sinDatos=True),
                  "/release/album/b/1": disco(wall=True)}
        with open(os.path.join(d, "cola-nuevos.jsonl"), "w") as f:
            f.write("\n".join(json.dumps(r) for r in cola) + "\n")
        reglas.guardar_json(os.path.join(d, "estado.json"), estado)
        return cola, estado, pages

    def test_discos_y_progreso(self):
        with tempfile.TemporaryDirectory() as d:
            cola, estado, pages = self._campana(d)
            discos = reglas.discos_de_artistas(cola, pages)
            self.assertEqual([x[0] for x in discos],
                             ["/release/album/a/1", "/release/album/a/2", "/release/album/b/1"],
                             "orden de cola y sin repetir (a/2 aparece en dos artistas)")
            p = reglas.progreso(estado, cola, discos)
            self.assertEqual((p["art_ok"], p["art_faltan"]), (2, 1))
            self.assertEqual((p["todas"], p["ok"], p["vacios"], p["hechos"], p["faltan"]), (3, 1, 1, 2, 1))
            self.assertEqual((p["sin_entry"], p["reintento"]), (0, 1))

    def test_capturador_y_tablero_cuentan_igual(self):
        if capt is None:
            self.skipTest("sin scrapling")
        with tempfile.TemporaryDirectory() as d:
            cola, estado, pages = self._campana(d)
            pend = capt.construir_releases(cola, pages, estado)
            p = reglas.progreso(estado, cola, reglas.discos_de_artistas(cola, pages))
            self.assertEqual(len(pend), p["faltan"])
            self.assertEqual([x[1] for x in pend], ["/release/album/b/1"])

    def test_escritura_atomica_y_respaldo(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "estado.json")
            reglas.guardar_json(p, {"a": 1}, respaldo=True)
            with self.assertRaises(TypeError):
                reglas.guardar_json(p, {"a": object()})  # falla al serializar…
            self.assertEqual(json.loads(leer(p)), {"a": 1})  # …y el original sigue intacto
            self.assertEqual(sorted(os.listdir(d)), ["estado.json", "estado.json.bak"], "sin temporales huérfanos")
            escribir(p, '{"a": ')  # corrupto (p. ej. disco lleno en el sistema viejo)
            est, fuente = reglas.cargar_estado(p)
            self.assertEqual((est, fuente), ({"a": 1}, p + ".bak"))
            os.unlink(p + ".bak")
            with self.assertRaises(RuntimeError):
                reglas.cargar_estado(p)
            self.assertEqual(reglas.cargar_estado(os.path.join(d, "no-existe.json")), ({}, None))

    def test_cli_progreso(self):
        with tempfile.TemporaryDirectory() as d:
            self._campana(d)
            escribir(os.path.join(d, reglas.MARCA_FASE1))
            with mock.patch.object(sys, "argv", ["rym_reglas.py", "progreso", d]), \
                    mock.patch("builtins.print") as pr:
                reglas._cli()
            out = json.loads(pr.call_args[0][0])
            self.assertTrue(out["estado_ok"] and out["fase1"])
            self.assertFalse(out["terminada"])
            self.assertEqual(out["hechos"], 2)


class Tablero(unittest.TestCase):
    def test_render_con_cuentas_oficiales(self):
        with tempfile.TemporaryDirectory() as d:
            Reglas._campana(self, d)
            salida = os.path.join(d, "copia.html")
            with mock.patch.object(tablero, "SALIDAS", (salida,)):
                tablero._CACHE_DISCOS["clave"] = None
                tablero.render(d)
            html = leer(salida)
            self.assertEqual(html, leer(os.path.join(d, "tablero.html")))
            self.assertIn('id="discos-hechos">2</span>', html)
            self.assertIn('<span class="de num">de 3</span>', html)
            self.assertIn('vacíos en RYM <b class="num">1</b>', html)
            self.assertIn('reintento <b class="num">1</b>', html)
            self.assertIn("data-gen=", html, "la recarga se alinea con la hora del render")
            self.assertIn('id="stale"', html, "aviso si el tablero deja de actualizarse")
            self.assertNotIn('http-equiv="refresh"', html, "la recarga la hace el JS que conserva el estado")
            self.assertIn("sessionStorage", html)
            self.assertNotIn("estado.json ilegible", html)

    def test_render_avisa_si_usa_respaldo(self):
        with tempfile.TemporaryDirectory() as d:
            Reglas._campana(self, d)
            p = os.path.join(d, "estado.json")
            reglas.guardar_json(p, json.loads(leer(p)), respaldo=True)
            escribir(p, "{roto")
            with mock.patch.object(tablero, "SALIDAS", ()):
                tablero._CACHE_DISCOS["clave"] = None
                tablero.render(d)
            self.assertIn("estado.json ilegible", leer(os.path.join(d, "tablero.html")))

    def test_nota_desde_marcas(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(tablero.nota_actual(d), "en marcha")
            escribir(os.path.join(d, reglas.MARCA_FASE1))
            self.assertEqual(tablero.nota_actual(d), "fase 1 terminada")
            escribir(os.path.join(d, reglas.MARCA_COLA))
            self.assertEqual(tablero.nota_actual(d), "COLA TERMINADA")


class Tiempos(unittest.TestCase):
    def test_ultimas_por_fecha_completa(self):
        ahora = int(time.time())
        estado = {
            # captura de AYER a una hora del reloj que «parece» de hace un momento
            "/release/a/ayer": disco(at=time.strftime("%H:%M:%S", time.localtime(ahora + 20)), ts=ahora - 86400 + 20),
            "/release/a/hoy1": disco(at="x", ts=ahora - 30),
            "/release/a/hoy2": disco(at="x", ts=ahora - 5),
            "/release/a/sin_fecha": disco(at="x", ts=0),
        }
        self.assertEqual([h for h, _ in reglas.ultimas(estado, 3)],
                         ["/release/a/hoy2", "/release/a/hoy1", "/release/a/ayer"])

    def test_rellenar_ts_desde_captured_at(self):
        with tempfile.TemporaryDirectory() as d:
            escribir(os.path.join(d, reglas.slug_release("/release/album/x/y") + ".json"),
                     json.dumps({"capturedAt": "2026-10-04 04:07:09"}))
            est = {"/release/album/x/y": disco(at="04:07:09"), "/release/album/x/z": disco(at="01:00:00"),
                   "/release/album/x/w": disco(at="02:00:00", ts=123)}
            self.assertEqual(reglas.rellenar_ts(est, d), 2)
            self.assertEqual(time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(est["/release/album/x/y"]["ts"])),
                             "2026-10-04 04:07:09")
            self.assertEqual(est["/release/album/x/z"]["ts"], 0, "sin página: nunca cuenta como reciente")
            self.assertEqual(est["/release/album/x/w"]["ts"], 123, "no pisa fechas existentes")

    def test_metricas_ritmo_y_eta(self):
        now = 1_000_000.0
        caps = [(now - 1800 + i * 20, "release") for i in range(90)]  # 3/min durante 30 min
        m = tablero.metricas({"caps_ts": caps + [(now - 10, "artist")]}, now, "release", 300)
        self.assertAlmostEqual(m["r20"], 3.0, places=1)
        self.assertAlmostEqual(m["r30"], 3.0, places=1)
        self.assertAlmostEqual(m["fin"] - now, 100 * 60, delta=120)  # 300 discos a 3/min
        lento = [(now - 1800 + i * 60, "release") for i in range(30)]  # el ritmo baja → la ETA crece
        self.assertGreater(tablero.metricas({"caps_ts": lento}, now, "release", 300)["fin"], m["fin"])
        p = tablero.metricas({"caps_ts": caps}, now, "release", 300, parado=True)
        self.assertTrue(p["pausa"])
        self.assertIsNone(p["fin"])
        self.assertIsNone(tablero.metricas({"caps_ts": caps[:2]}, now, "release", 300)["fin"], "sin datos suficientes")

    def test_log_sin_fecha_no_se_cuela_como_reciente(self):
        ayer = time.localtime(time.time() - 86400)
        hms = time.strftime("%H:%M:%S", time.localtime(time.time() + 15))  # «dentro de 15 s», pero de ayer
        log = (f"[{time.strftime('%Y-%m-%d', ayer)} {hms}] INFO: Fetched (200) <GET x>\n"
               f"[{hms}] + [release] /release/a/b -> Viejo | rel 0 | gen 0 | og True | pistas 1 | cred 1 (1/9)\n")
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "reports"))
            escribir(os.path.join(d, "reports", "scrapling-nuevos.log"), log)
            with mock.patch.object(tablero, "REPO", d):
                datos = tablero._tab_datos()
        self.assertLess(datos["ult_ts"], time.time() - 80000)
        self.assertEqual(tablero.metricas(datos, time.time(), "release", 5)["n60"], 0)

    def test_dia_en_espanol(self):
        ahora = time.time()
        self.assertEqual(tablero._dia(ahora), "hoy")
        self.assertEqual(tablero._dia(ahora + 86400), "mañana")
        self.assertRegex(tablero._dia(ahora + 3 * 86400), r"^(lun|mar|mié|jue|vie|sáb|dom) \d\d$")


@unittest.skipIf(capt is None, "sin scrapling (usar ~/.venvs/scrapling/bin/python)")
class Extractor(unittest.TestCase):
    def pagina(self, nombre):
        with open(os.path.join(FIX, nombre), encoding="utf-8") as f:
            return Selector(f.read())

    def test_disco_normal(self):
        rec = capt.ext_release(self.pagina("disco-normal.html"))
        self.assertEqual(rec["name"], "Tropical Trips Vol. 1")
        self.assertTrue(rec["og"])
        self.assertEqual(len(rec["tracks"]), 30)
        self.assertGreater(len(rec["genres"]), 0)
        e = capt.recortar(rec)
        self.assertTrue(reglas.es_ok_release(e))
        self.assertFalse(e["sinDatos"] or e["wall"])

    def test_disco_vacio_en_rym(self):
        e = capt.recortar(capt.ext_release(self.pagina("disco-vacio.html")))
        self.assertEqual(e["name"], "Dum dum dum")
        self.assertTrue(e["sinDatos"])
        self.assertTrue(reglas.es_vacio_release(e) and reglas.es_hecho_release(e))
        self.assertFalse(reglas.es_ok_release(e))

    def test_pistas_sin_enlace_song(self):
        rec = capt.ext_release(self.pagina("disco-clasica-sin-enlaces.html"))
        self.assertGreater(len(rec["tracks"]), 5)
        self.assertIn("Quintet No. 2", rec["tracks"][0]["t"])
        self.assertTrue(any("9:15" in t["row"] for t in rec["tracks"]))
        self.assertFalse(rec["sinDatos"])

    def test_artista(self):
        rec = capt.ext_artist(self.pagina("artista.html"))
        self.assertEqual(rec["name"], "Serenada")
        self.assertFalse(rec["wall"])
        self.assertGreater(len(rec["rows"]), 5)
        self.assertTrue(all("/release/" in r["h"] for r in rec["rows"]))
        self.assertTrue(reglas.es_ok_artista(capt.recortar(rec)))

    def test_muro(self):
        pag = self.pagina("muro-cloudflare.html")
        for rec in (capt.ext_release(pag), capt.ext_artist(pag)):
            self.assertTrue(rec["wall"])
            self.assertFalse(reglas.es_hecho_release(capt.recortar(rec)))


if __name__ == "__main__":
    unittest.main()
