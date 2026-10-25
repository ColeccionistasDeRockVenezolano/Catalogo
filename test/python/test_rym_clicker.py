"""Regresiones del clicker. Sin abrir X11, inyectar eventos ni tocar capturas reales.

python3 -m unittest discover -s test/python -p test_rym_clicker.py
"""
import importlib.util
import json
import ctypes
from contextlib import ExitStack
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "rym_clicker", ROOT / "ops/rym-nuevos/wall-clicker.py")
c = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(c)
RYM = b"https://rateyourmusic.com/artist/test/"
FICHA = "https://rateyourmusic.com/artist/otra"


class Clicker(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.tmp = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.estado = self.tmp / "estado.json"
        self.estado.write_text(json.dumps({
            "/artist/existe": {"status": 200},
            "/artist/fantasma": {"status": 404},
            "/release/album/disco": {"name": "Disco"},
        }), encoding="utf-8")
        self.stack.enter_context(mock.patch.multiple(
            c, M_PAUSA=str(self.tmp / "pausa"), M_GUARDIA=str(self.tmp / "guardia"),
            M_EP=str(self.tmp / "ep"), SLOG=str(self.tmp / "log"), _INTERACCION=None,
            _FUENTE_CACHE=(0, None), _MURO_CACHE=(0, None, None), _POOL=(0.0, ()),
            PROXIMA_ACCION_TS=0, ULTIMA_ACCION_TS=None, PANTALLA=(1920, 1080),
            ESTADOS_CAPTURA={"unidad": str(self.estado)}))

    def patch(self, name, **kw):
        return self.stack.enter_context(mock.patch.object(c, name, **kw))

    def entorno(self, accion="recarga", walled=False, url=RYM, previa="0x20", ina=30):
        """Entorno de una acción completa; todas las entradas y salidas son simuladas."""
        self.patch("chequear_muro", return_value=(walled, {"activo": True}))
        self.patch("fuente_capturador", return_value=("unidad", "/log-activo"))
        self.patch("dueño_inactivo_s", return_value=ina)
        self.patch("inactivo_s", return_value=30)
        self.stack.enter_context(mock.patch.object(c.time, "monotonic", return_value=1000))
        self.stack.enter_context(mock.patch.object(c.time, "time", return_value=2000))
        self.patch("ventanas_firefox", return_value=[("0x10", "123", None, "Rate Your Music")])
        self.patch("ventana_activa", side_effect=[previa] + ["0x10"] * 60)
        self.patch("activar", return_value=True)
        self.patch("puntero", return_value=(50, 50))
        self.patch("leer_url_activa", return_value=url)
        self.patch("titulo_ventana", return_value="Rate Your Music")
        self.patch("esperar_titulo", return_value="Otra ficha - Rate Your Music")
        self.patch("_tecla")
        self.patch("accion_aleatoria", return_value=accion)
        self.patch("pagina_aleatoria", return_value=FICHA)
        self.patch("navegar_a", return_value=(True, FICHA))

    def test_importar_no_abre_display(self):
        self.assertIsNone(c._d)

    def test_espera_hasta_hora_real_sin_activar_ni_enviar_teclas(self):
        c.PROXIMA_ACCION_TS = 2010
        self.stack.enter_context(mock.patch.object(c.time, "time", return_value=2000))
        fuente = self.patch("chequear_muro")
        activar = self.patch("activar")
        tecla = self.patch("_tecla")
        self.assertFalse(c.actuar()[0])
        fuente.assert_not_called()
        activar.assert_not_called()
        tecla.assert_not_called()

    def test_sin_capturador_no_toca_interfaz(self):
        self.patch("chequear_muro", return_value=(False, {"activo": False}))
        ventanas = self.patch("ventanas_firefox")
        self.assertIn("sin capturador", c.actuar()[1])
        ventanas.assert_not_called()

    def test_pausa_manual_no_toca_interfaz(self):
        Path(c.M_PAUSA).write_text("", encoding="utf-8")
        ventanas = self.patch("ventanas_firefox")
        self.assertIn("pausa manual", c.actuar()[1])
        ventanas.assert_not_called()

    def test_bloqueo_de_bots_en_su_firefox_no_toca_nada(self):
        self.patch("chequear_muro", return_value=(False, {"activo": True}))
        self.patch("ventanas_firefox", return_value=[("0x10", "123", None, "Just a moment...")])
        tecla = self.patch("_tecla")
        self.assertIn("bloqueo de bots", c.actuar()[1])
        tecla.assert_not_called()

    def test_no_exime_actividad_humana_cercana_a_evento_propio(self):
        self.patch("inactivo_s", return_value=0.1)
        self.assertEqual(c.dueño_inactivo_s(), 0.1)

    def test_capturador_activo_se_selecciona_sin_mutaciones(self):
        run = self.stack.enter_context(mock.patch.object(c.subprocess, "run"))
        run.side_effect = [subprocess.CompletedProcess([], 1), subprocess.CompletedProcess([], 0)]
        self.assertEqual(c.fuente_capturador(), c.CAPTURADORES[1])
        for call in run.call_args_list:
            self.assertEqual(call.args[0][:4], ["systemctl", "--user", "is-active", "--quiet"])

    def test_fuente_respeta_ruta_configurada(self):
        self.stack.enter_context(mock.patch.dict(c.os.environ, {"CRV_RYM_LOG": "/log-personalizado"}))
        self.stack.enter_context(mock.patch.object(c.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)))
        self.assertEqual(c.fuente_capturador()[1], "/log-personalizado")

    def test_inventario_excluye_firefox_automatizado_y_otros_navegadores(self):
        respuestas = [
            "_NET_CLIENT_LIST(WINDOW): window id # 0x10, 0x20, 0x30",
            'WM_CLASS(STRING) = "Navigator", "firefox-esr"\n_NET_WM_PID(CARDINAL) = 123\n'
            '_NET_WM_NAME(UTF8_STRING) = "Rate Your Music"',
            'WM_CLASS(STRING) = "Navigator", "firefox"\n_NET_WM_PID(CARDINAL) = 456\n'
            '_NET_WM_NAME(UTF8_STRING) = "Rate Your Music"',
            'WM_CLASS(STRING) = "google-chrome", "Google-chrome"',
        ]
        self.stack.enter_context(mock.patch.object(
            c.subprocess, "run", side_effect=[subprocess.CompletedProcess([], 0, stdout=s)
                                               for s in respuestas]))
        def abrir(ruta, modo):
            cmd = b"firefox-esr\x00--marionette" if "/456/" in ruta else b"firefox-esr"
            return mock.mock_open(read_data=cmd)()
        self.stack.enter_context(mock.patch("builtins.open", side_effect=abrir))
        self.assertEqual(c.ventanas_firefox(), [("0x10", "123", None, "Rate Your Music")])

    def test_copia_de_url_fallida_devuelve_desconocido(self):
        self.patch("comprobar_control")
        self.patch("_tecla")
        self.patch("esperar")
        self.stack.enter_context(mock.patch.object(c.uuid, "uuid4", return_value="test"))
        self.patch("_portapapeles_leer", side_effect=[b"nota", b"crv-tab-check-test",
                                                     b"crv-tab-check-test"])
        escribir = self.patch("_portapapeles_escribir", return_value=True)
        self.assertIsNone(c.leer_url_activa())
        self.assertEqual(escribir.call_args.args, (b"nota",))

    def test_portapapeles_nuevo_del_usuario_no_se_sobrescribe(self):
        self.patch("comprobar_control")
        self.patch("_tecla")
        self.patch("esperar")
        self.patch("_portapapeles_leer", side_effect=[b"nota", RYM, b"nuevo del usuario"])
        escribir = self.patch("_portapapeles_escribir", return_value=True)
        self.assertEqual(c.leer_url_activa(), RYM)
        self.assertEqual(escribir.call_count, 1)  # solo el marcador, nunca restaura sobre lo nuevo

    def test_bloqueo_antes_de_primera_captura_y_cache(self):
        self.patch("fuente_capturador", return_value=("resto", "/log-activo"))
        tail = self.patch("_tail", return_value="[23:59:59] [bloqueo] (403) Just a moment")
        self.assertTrue(c.chequear_muro()[0])
        self.assertTrue(c.chequear_muro()[0])
        tail.assert_called_once_with("/log-activo")

    def test_captura_posterior_a_medianoche_cierra_bloqueo(self):
        self.patch("fuente_capturador", return_value=("resto", "/log-activo"))
        self.patch("_tail", return_value=("[23:59:59] [bloqueo] (403) Un momento\n"
                                          "[00:00:01] + [artist] /artist/a -> A"))
        self.assertFalse(c.chequear_muro()[0])

    def test_cambio_de_campana_invalida_cache_del_muro(self):
        self.patch("fuente_capturador", side_effect=[("vieja", "/viejo"), ("resto", "/activo")])
        self.patch("_tail", side_effect=["[01:00:00] [bloqueo] (403) Un momento",
                                        "[01:00:01] + [artist] A"])
        self.assertTrue(c.chequear_muro()[0])
        self.assertFalse(c.chequear_muro()[0])

    def test_accion_aleatoria_elige_entre_reiniciar_y_entrar(self):
        class Dado:
            def __init__(self, valor):
                self.valor, self.visto = valor, None
            def choice(self, opciones):
                self.visto = tuple(opciones)
                return self.valor
        dado = Dado("pagina")
        self.assertEqual(c.accion_aleatoria(dado), "pagina")
        self.assertEqual(dado.visto, ("recarga", "pagina"))
        self.assertEqual(c.INTERVALO, (30, 50))

    def test_paginas_rym_excluye_404_y_arma_urls(self):
        self.patch("fuente_capturador", return_value=("unidad", "/log-activo"))
        self.assertEqual(set(c.paginas_rym()), {
            "https://rateyourmusic.com/artist/existe",
            "https://rateyourmusic.com/release/album/disco"})

    def test_paginas_rym_se_cachea(self):
        self.patch("fuente_capturador", return_value=("unidad", "/log-activo"))
        c.paginas_rym()
        with mock.patch("builtins.open", side_effect=AssertionError("releyó el estado.json")):
            self.assertEqual(len(c.paginas_rym()), 2)

    def test_recarga_envia_f5(self):
        self.entorno(accion="recarga")
        self.assertTrue(c.actuar()[0])
        c._tecla.assert_called_once_with(0xFFC2)
        c.navegar_a.assert_not_called()

    def test_entrar_en_pagina_aleatoria_navega_en_la_misma_pestana(self):
        self.entorno(accion="pagina")
        ok, motivo = c.actuar()
        self.assertTrue(ok)
        self.assertIn("página", motivo)
        c.navegar_a.assert_called_once_with(FICHA)
        c._tecla.assert_not_called()

    def test_sin_fichas_conocidas_no_navega(self):
        self.entorno(accion="pagina")
        c.pagina_aleatoria.return_value = None
        self.assertFalse(c.actuar()[0])
        c.navegar_a.assert_not_called()

    def test_muro_del_capturador_fuerza_recarga(self):
        self.entorno(accion="pagina", walled=True)
        self.assertTrue(c.actuar()[0])
        c.accion_aleatoria.assert_not_called()
        c._tecla.assert_called_once_with(0xFFC2)
        c.navegar_a.assert_not_called()

    def test_intervalo_de_30_a_50_segundos(self):
        self.entorno()
        c.actuar()
        self.assertGreaterEqual(c.PROXIMA_ACCION_TS, 2030)
        self.assertLessEqual(c.PROXIMA_ACCION_TS, 2050)
        c._tecla.reset_mock()
        self.assertFalse(c.actuar()[0])          # la hora aún no llegó
        c._tecla.assert_not_called()

    def test_intento_fallido_tambien_espera_30_a_50_segundos(self):
        self.entorno(accion="pagina")
        c.navegar_a.return_value = (False, "portapapeles no disponible: no navego")
        self.assertFalse(c.actuar()[0])
        self.assertGreaterEqual(c.PROXIMA_ACCION_TS, 2030)
        self.assertLessEqual(c.PROXIMA_ACCION_TS, 2050)

    def test_url_fuera_de_rym_no_se_toca(self):
        self.entorno(url=b"https://example.org/")
        self.assertIn("no está en https://rateyourmusic.com", c.actuar()[1])
        c._tecla.assert_not_called()
        c.navegar_a.assert_not_called()
        self.assertEqual(c.PROXIMA_ACCION_TS, 0)

    def test_url_ilegible_no_se_toca(self):
        self.entorno(url=None)
        self.assertFalse(c.actuar()[0])
        c._tecla.assert_not_called()

    def test_no_navega_mientras_el_dueño_mira_rym(self):
        self.entorno(previa="0x10", ina=20)
        self.assertIn("mirando RYM", c.actuar()[1])
        c._tecla.assert_not_called()

    def test_no_navega_si_el_dueño_esta_usando_el_equipo(self):
        self.entorno(previa="0x20", ina=2)
        self.assertIn("usando el equipo", c.actuar()[1])
        c.activar.assert_not_called()
        c._tecla.assert_not_called()

    def test_sin_pestaña_rym_no_hace_nada(self):
        self.patch("chequear_muro", return_value=(False, {"activo": True}))
        self.patch("ventanas_firefox", return_value=[])
        tecla = self.patch("_tecla")
        self.assertIn("sin pestaña RYM", c.actuar()[1])
        tecla.assert_not_called()

    def test_activacion_fallida_no_envia_teclas(self):
        self.entorno(previa="0x20")
        c.activar.return_value = False
        self.assertFalse(c.actuar()[0])
        c.leer_url_activa.assert_not_called()
        c._tecla.assert_not_called()

    def test_cambio_de_foco_del_dueño_cancela_la_accion(self):
        self.entorno(previa="0x20")
        c.ventana_activa.side_effect = ["0x20", "0x99"]
        self.assertFalse(c.actuar()[0])
        c._tecla.assert_not_called()

    def test_barrido_cancela_al_primer_movimiento_humano(self):
        self.patch("inactivo_s", return_value=30)
        self.stack.enter_context(mock.patch.object(c.time, "monotonic", return_value=1000))
        self.patch("ventana_activa", return_value="0x10")
        self.patch("puntero", side_effect=[(50, 50), (60, 50)])
        ctx = c.Interaccion("0x10", "0x20", (50, 50))
        ctx.comprobar()
        with self.assertRaises(c.Interrumpido):
            ctx.comprobar()
        activar = self.patch("activar")
        ctx.restaurar()
        activar.assert_not_called()

    def test_nueva_entrada_de_teclado_cancela_aunque_puntero_siga_igual(self):
        idle = self.patch("inactivo_s", return_value=30)
        self.stack.enter_context(mock.patch.object(c.time, "monotonic", return_value=1000))
        self.patch("ventana_activa", return_value="0x10")
        self.patch("puntero", return_value=(50, 50))
        ctx = c.Interaccion("0x10", "0x20", (50, 50))
        idle.return_value = 0.1
        with self.assertRaises(c.Interrumpido):
            ctx.comprobar()

    def test_guardia_preserva_contadores_y_reporta_fuente(self):
        hoy = c.time.strftime("%Y-%m-%d")
        Path(c.M_GUARDIA).write_text(json.dumps({"dia": hoy, "clics_dia": 79, "ultimo": 1234}))
        self.patch("fuente_capturador", return_value=("resto", "/log-activo"))
        c.guardar_guardia("guardia", False, "pausa manual")
        g = json.loads(Path(c.M_GUARDIA).read_text())
        self.assertEqual((g["clics_dia"], g["ultimo"], g["capturador"]), (79, 1234, "resto"))


@unittest.skipUnless(shutil.which("Xvfb"), "Xvfb no instalado")
class EscritorioAislado(unittest.TestCase):
    def test_eventos_propios_y_entrada_ajena_en_servidor_x11_separado(self):
        # Los eventos reales de XTEST se envían a otro servidor, nunca al escritorio del dueño.
        with ExitStack() as stack, tempfile.TemporaryDirectory() as tmp:
            servidor = subprocess.Popen(
                ["Xvfb", "-displayfd", "1", "-screen", "0", "800x600x24", "-nolisten", "tcp"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            self.addCleanup(servidor.stdout.close)
            def cerrar():
                servidor.terminate()
                servidor.wait(timeout=5)
            stack.callback(cerrar)
            display = servidor.stdout.readline().strip()
            self.assertTrue(display.isdigit())
            stack.enter_context(mock.patch.multiple(
                c, _d=None, _root=None, _ssinfo=None, PANTALLA=(0, 0),
                _INTERACCION=None, M_PAUSA=tmp + "/pausa", ENV={**c.ENV, "DISPLAY": ":" + display}))
            stack.enter_context(mock.patch.object(c, "ventana_activa", return_value="0x10"))
            c.iniciar_x11()
            c.X11.XCloseDisplay.argtypes = [ctypes.c_void_p]
            stack.callback(c.X11.XCloseDisplay, c._d)
            stack.callback(c.X11.XFree, c._ssinfo)
            ctx = c.Interaccion("0x10", "0x10", c.puntero())
            c._INTERACCION = ctx
            c._tecla(0xFFE3, ord("l"))
            c.esperar(0.08)
            c._tecla(0xFFE3, ord("v"))
            c.esperar(0.08)
            self.assertFalse(ctx.cancelada)
            # Evento fuera del clicker: debe detectarse sin sobreescribirlo al salir.
            c.XTST.XTestFakeMotionEvent(c._d, -1, 250, 320, 0)
            c.X11.XSync(c._d, 0)
            with self.assertRaises(c.Interrumpido):
                ctx.comprobar()
            ctx.restaurar()
            self.assertEqual(c.puntero(), (250, 320))


if __name__ == "__main__":
    unittest.main()
