#!/usr/bin/env python3
"""Cliquer RYM — clics humanos en enlaces del Firefox REAL del dueño.

Instrucciones del dueño:
- 2026-10-03: «cada vez que haya un muro cloudflare abres algún link de la pestaña
  https://rateyourmusic.com/location/Oakland/CA/United States, cualquier link» · «debes usar el
  firefox que no es marionette».
- 2026-10-05: «debe hacer click en solo links de la pagina en intervalos de 30 a 65 segundos
  mientras no haya bloqueo de bots».

Funcionamiento (sin xdotool: XTEST/XFixes/XScreenSaver vía ctypes; 0 LLM):
- Cada 30-65 s ALEATORIOS intenta 1 clic mientras no haya bloqueo de bots.
- SOLO en enlaces de https://rateyourmusic.com: comprueba la URL real de la pestaña, exige
  mano (cursor «pointer») y confirma «Copiar enlace» con destino del mismo dominio.
  Tras el clic comprueba la pestaña; si salió de RYM vuelve atrás (Alt+←).
- «Bloqueo de bots» (la pestaña muestra «Un momento…», «Just a moment…», «Attention
  Required»…): NO clica — los retos de Cloudflare no se tocan.
- Espera 20 s de inactividad real. Si hay nueva entrada o cambia el foco, cancela sin
  devolver el puntero ni el foco por encima de la acción del dueño.
- Puerta de seguridad: solo la ventana del Firefox no-marionette con la pestaña de Rate Your
  Music al frente; no rota pestañas ni toca el navegador automatizado del capturador.
- Máximo seis puntos próximos por intento, reutilizando posiciones verificadas; sin barrido
  aleatorio ni preparación anticipada. Los intentos fallidos también esperan 30-65 s.
- Lee únicamente el log del capturador activo. Los avisos quedan a cargo del supervisor.
- Estado para el tablero: reports/crv-marcas/clicker-guardia (JSON).
- Pausa manual: touch reports/crv-marcas/clicker-pausa
"""
import ctypes
import json
import os
import random
import re
import subprocess
import sys
import time
import uuid
from urllib.parse import urlparse

REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano"
CAPTURADORES = (
    ("crv-scrapling-rym-resto", f"{REPO}/reports/scrapling-rym-resto.log"),
    ("crv-scrapling-nuevos", f"{REPO}/reports/scrapling-nuevos.log"),
)
SLOG = f"{REPO}/reports/crv-wall-clicker.log"
MK = f"{REPO}/reports/crv-marcas"
M_EP = f"{MK}/clicker-ep"
M_PAUSA = f"{MK}/clicker-pausa"
ENV = {**os.environ, "DISPLAY": ":0", "XAUTHORITY": "/home/brian/.Xauthority"}

X11 = ctypes.CDLL("libX11.so.6")
XTST = ctypes.CDLL("libXtst.so.6")
X11.XOpenDisplay.restype = ctypes.c_void_p
X11.XOpenDisplay.argtypes = [ctypes.c_char_p]
X11.XFlush.argtypes = [ctypes.c_void_p]
X11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
X11.XDefaultRootWindow.restype = ctypes.c_ulong
X11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
X11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
                              ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int),
                              ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
                              ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint)]
XTST.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
XTST.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
XTST.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
X11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]

_d = _root = None
X11.XDisplayWidth.argtypes = X11.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
PANTALLA = (0, 0)


class _CursorImg(ctypes.Structure):
    _fields_ = [("x", ctypes.c_short), ("y", ctypes.c_short), ("width", ctypes.c_ushort),
                ("height", ctypes.c_ushort), ("xhot", ctypes.c_ushort), ("yhot", ctypes.c_ushort),
                ("serial", ctypes.c_ulong), ("pixels", ctypes.POINTER(ctypes.c_ulong)),
                ("atom", ctypes.c_ulong), ("name", ctypes.c_char_p)]


class _SSInfo(ctypes.Structure):
    _fields_ = [("window", ctypes.c_ulong), ("state", ctypes.c_int), ("kind", ctypes.c_int),
                ("til_or_since", ctypes.c_ulong), ("idle", ctypes.c_ulong), ("eventMask", ctypes.c_ulong)]


XFIX = ctypes.CDLL("libXfixes.so.3")
XFIX.XFixesGetCursorImage.restype = ctypes.POINTER(_CursorImg)
XFIX.XFixesGetCursorImage.argtypes = [ctypes.c_void_p]
XSS = ctypes.CDLL("libXss.so.1")
XSS.XScreenSaverAllocInfo.restype = ctypes.POINTER(_SSInfo)
XSS.XScreenSaverQueryInfo.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(_SSInfo)]
_ssinfo = None
X11.XFree.argtypes = [ctypes.c_void_p]

CURSOR_ENLACE = {"pointer", "hand", "hand1", "hand2", "pointing_hand"}
BOT_RE = r"un momento|just a moment|attention required|verify you are human|verifica que eres|security check|checking your browser|cloudflare"
INTERVALO = (30, 65)      # s entre clics (instrucción del dueño 2026-10-05)
INTERVALO_RECARGA = (90, 180)  # s entre recargas de sesión mientras el capturador está bloqueado
IDLE_MIN = 20             # s sin uso del teclado/ratón antes de tocar nada
M_GUARDIA = f"{MK}/clicker-guardia"
ULTIMO_CLIC_TS = None
PROXIMO_CLIC_TS = None
_INTERACCION = None
_FUENTE_CACHE = (0.0, None)
_MURO_CACHE = (0.0, None, None)
_RECARGA_TS = 0.0         # hora de la última recarga de sesión (F5) durante un muro del capturador
_ENLACES = {}            # posiciones verificadas por ventana, URL y geometría (máximo 64)
_BUSQUEDAS = {}          # siguiente tramo de la rejilla; evita repetir seis puntos vacíos
ERROR_RE = (r"problema al cargar la p[aá]gina|problem loading page|server not found|"
            r"no se puede conectar|unable to connect|secure connection failed|conexi[oó]n segura fall")


def log(msg):
    with open(SLOG, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%F %T')}] {msg}\n")


def iniciar_x11():
    global _d, _root, _ssinfo, PANTALLA
    _d = X11.XOpenDisplay(ENV["DISPLAY"].encode())
    if not _d:
        raise RuntimeError("no se pudo abrir el escritorio X11")
    _root = X11.XDefaultRootWindow(_d)
    _ssinfo = XSS.XScreenSaverAllocInfo()
    PANTALLA = (X11.XDisplayWidth(_d, 0), X11.XDisplayHeight(_d, 0))


class Interrumpido(Exception):
    pass


class Interaccion:
    """Propiedad temporal del foco y el puntero; nunca se recuperan tras una intervención."""
    def __init__(self, wid, previa, origen):
        self.wid, self.previa, self.origen = wid, previa, origen
        self.esperado = origen
        self.cancelada = False
        self.entrada = time.monotonic() - inactivo_s()

    def comprobar(self):
        # Fuera de una interacción no se descuenta NINGUNA entrada sintética del idle.
        # Aquí se compara la última entrada del servidor con la muestra tomada tras
        # nuestro evento, con tolerancia solo para la resolución de milisegundos de XSS.
        nueva_entrada = time.monotonic() - inactivo_s()
        motivo = None
        if self.cancelada:
            motivo = "interacción ya cancelada"
        elif os.path.exists(M_PAUSA):
            motivo = "pausa manual durante la interacción"
        elif ventana_activa() != self.wid:
            motivo = "cambió el foco de ventana"
        elif puntero() != self.esperado:
            motivo = "el dueño movió el puntero"
        elif nueva_entrada > self.entrada + 0.005:
            motivo = "nueva entrada de teclado o ratón"
        if motivo:
            self.cancelada = True
            raise Interrumpido(f"{motivo}: cedo el control")

    def registrar(self):
        self.entrada = time.monotonic() - inactivo_s()

    def restaurar(self):
        try:
            self.comprobar()
            if self.esperado != self.origen:
                mover(*self.origen)
            self.comprobar()
            if self.previa and self.previa != self.wid:
                activar(self.previa)
        except Interrumpido:
            pass


def comprobar_control():
    if _INTERACCION:
        _INTERACCION.comprobar()


def esperar(seg):
    fin = time.monotonic() + seg
    while time.monotonic() < fin:
        comprobar_control()
        time.sleep(min(0.05, max(0, fin - time.monotonic())))
    comprobar_control()


def puntero():
    rr, cr = ctypes.c_ulong(), ctypes.c_ulong()
    rx, ry, wx, wy = ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
    m = ctypes.c_uint()
    X11.XQueryPointer(_d, _root, ctypes.byref(rr), ctypes.byref(cr), ctypes.byref(rx),
                      ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(m))
    return rx.value, ry.value


def _sintetico():
    # XSync asegura que el servidor ya contabilizó nuestros eventos en XScreenSaver.
    X11.XSync(_d, 0)
    if _INTERACCION:
        _INTERACCION.registrar()


def mover(x, y):
    comprobar_control()
    XTST.XTestFakeMotionEvent(_d, -1, int(x), int(y), 0)
    X11.XFlush(_d)
    if _INTERACCION:
        _INTERACCION.esperado = (int(x), int(y))
    _sintetico()


def clic_boton():
    comprobar_control()
    XTST.XTestFakeButtonEvent(_d, 1, 1, 0)
    X11.XFlush(_d)
    time.sleep(0.01)
    XTST.XTestFakeButtonEvent(_d, 1, 0, 0)
    X11.XFlush(_d)
    _sintetico()


def clic_derecho():
    comprobar_control()
    XTST.XTestFakeButtonEvent(_d, 3, 1, 0)
    X11.XFlush(_d)
    time.sleep(0.01)
    XTST.XTestFakeButtonEvent(_d, 3, 0, 0)
    X11.XFlush(_d)
    _sintetico()


def _tecla(*keysyms):
    comprobar_control()
    codes = [X11.XKeysymToKeycode(_d, k) for k in keysyms]
    for c in codes:
        XTST.XTestFakeKeyEvent(_d, c, 1, 0)
    for c in reversed(codes):
        XTST.XTestFakeKeyEvent(_d, c, 0, 0)
    X11.XFlush(_d)
    _sintetico()


def tecla_atras():
    """Alt+← (atrás en el historial de la pestaña)."""
    _tecla(0xFFE9, 0xFF51)


def _portapapeles_leer():
    """Contenido del portapapeles; b"" si está vacío (xclip sale con error cuando nadie lo
    posee, p. ej. tras reiniciar el servicio); None solo si xclip no se puede usar."""
    try:
        r = subprocess.run(["xclip", "-selection", "clipboard", "-o"], capture_output=True,
                           timeout=0.7, env=ENV)
        if r.returncode == 0:
            return r.stdout
        return b"" if b"not available" in r.stderr else None
    except Exception:
        return None


def _portapapeles_escribir(datos):
    try:
        r = subprocess.run(["xclip", "-selection", "clipboard", "-i"], input=datos,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=0.7, env=ENV)
        return r.returncode == 0
    except Exception:
        return False


def url_rym_valida(valor):
    try:
        url = valor.decode("utf-8").strip()
        parsed = urlparse(url)
        return (parsed.scheme == "https" and parsed.hostname == "rateyourmusic.com" and
                parsed.port in (None, 443) and not parsed.username and
                not parsed.password and "\n" not in url)
    except (UnicodeError, ValueError):
        return False


# Enlaces de RYM que no se siguen: tiendas (/buy/ responde 503), cuenta, ajustes, salir, borrar.
ENLACE_EXCLUIDO_RE = r"/buy/|/shop|logout|log_out|signout|sign_out|/account|/settings|/delete|/remove|/edit|/submit"


def enlace_permitido(valor):
    try:
        return url_rym_valida(valor) and not re.search(ENLACE_EXCLUIDO_RE, urlparse(valor.decode("utf-8").strip()).path, re.I)
    except (UnicodeError, ValueError):
        return False


def leer_url_activa():
    """URL copiada o None si no pudo leerse; un fallo NO significa salir de RYM."""
    comprobar_control()
    anterior = _portapapeles_leer()
    if anterior is None:
        return None
    marcador = f"crv-tab-check-{uuid.uuid4()}".encode()
    if not _portapapeles_escribir(marcador):
        return None
    copiado = None
    try:
        _tecla(0xFFE3, ord("l"))  # Ctrl+L: seleccionar URL de la pestaña
        esperar(0.1)
        _tecla(0xFFE3, ord("c"))  # Ctrl+C: copiarla
        esperar(0.15)
        copiado = _portapapeles_leer()
        _tecla(0xFF1B)           # Escape: devolver el foco a la página
        if copiado and copiado != marcador:
            try:
                url = urlparse(copiado.decode("utf-8").strip())
                if url.scheme in ("https", "http") and url.hostname:
                    return copiado.strip()
            except (UnicodeError, ValueError):
                pass
        return None
    finally:
        # No pisar un contenido nuevo que haya copiado el dueño durante la operación.
        if _portapapeles_leer() in (marcador, copiado):
            _portapapeles_escribir(anterior)


def confirmar_enlace():
    """Devuelve el destino permitido o None, sin navegar.

    La mano sola también aparece sobre botones. El menú contextual de Firefox ESR usa
    la tecla L para «Copy Link» / «Copiar enlace» en las traducciones instaladas.
    """
    comprobar_control()
    anterior = _portapapeles_leer()
    if anterior is None:
        return None
    marcador = f"crv-link-check-{uuid.uuid4()}".encode()
    if not _portapapeles_escribir(marcador):
        return None
    copiado = None
    try:
        clic_derecho()
        esperar(0.15)
        _tecla(ord("l"))
        esperar(0.15)
        copiado = _portapapeles_leer()
        _tecla(0xFF1B)  # Escape: cerrar cualquier menú que siguiera abierto
        return copiado.strip() if copiado and copiado != marcador and enlace_permitido(copiado) else None
    finally:
        if _portapapeles_leer() in (marcador, copiado):
            _portapapeles_escribir(anterior)


def cursor_nombre():
    try:
        p = XFIX.XFixesGetCursorImage(_d)
        if not p:
            return ""
        n = (p.contents.name or b"").decode("ascii", "ignore")
        X11.XFree(p)
        return n
    except Exception:
        return ""


def inactivo_s():
    """Segundos desde la última entrada de teclado/ratón (XScreenSaver; incluye las del cliquer)."""
    try:
        XSS.XScreenSaverQueryInfo(_d, _root, _ssinfo)
        return _ssinfo.contents.idle / 1000.0
    except Exception:
        return 0.0


def dueño_inactivo_s():
    """Sin heurística: los 30-65 s entre intentos ya superan los 20 s de idle requerido."""
    return inactivo_s()


def ventana_activa():
    try:
        r = subprocess.run(["xprop", "-root", "_NET_ACTIVE_WINDOW"], capture_output=True, text=True, env=ENV, timeout=1)
        m = re.search(r"(0x[0-9a-f]+)", r.stdout)
        return m.group(1) if m and int(m.group(1), 16) else None
    except Exception:
        return None


def activar(wid):
    """Activación EWMH tipada y verificada, sin helper externo ni cambio de pestañas."""
    class Mensaje(ctypes.Structure):
        _fields_ = [("type", ctypes.c_int), ("serial", ctypes.c_ulong),
                    ("send_event", ctypes.c_int), ("display", ctypes.c_void_p),
                    ("window", ctypes.c_ulong), ("message_type", ctypes.c_ulong),
                    ("format", ctypes.c_int), ("data", ctypes.c_long * 5)]

    class Evento(ctypes.Union):
        _fields_ = [("mensaje", Mensaje), ("pad", ctypes.c_long * 24)]

    try:
        X11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
        X11.XInternAtom.restype = ctypes.c_ulong
        X11.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int,
                                  ctypes.c_long, ctypes.POINTER(Evento)]
        ev = Evento()
        ev.mensaje.type, ev.mensaje.display, ev.mensaje.window = 33, _d, int(wid, 16)
        ev.mensaje.message_type = X11.XInternAtom(_d, b"_NET_ACTIVE_WINDOW", 0)
        ev.mensaje.format = 32
        ev.mensaje.data[0] = 1
        X11.XSendEvent(_d, _root, 0, (1 << 20) | (1 << 19), ctypes.byref(ev))
        X11.XFlush(_d)
        for _ in range(10):
            if ventana_activa() == wid:
                return True
            time.sleep(0.025)
    except (ValueError, OSError):
        return False
    return False


def _tail(ruta, nbytes=150000):
    try:
        with open(ruta, "rb") as f:
            f.seek(max(0, os.path.getsize(ruta) - nbytes))
            return f.read().decode("utf-8", "ignore")
    except Exception:
        return ""


def fuente_capturador():
    """Solo consulta systemd. Nunca arranca, detiene ni modifica el capturador."""
    global _FUENTE_CACHE
    ahora = time.monotonic()
    if ahora < _FUENTE_CACHE[0]:
        return _FUENTE_CACHE[1]
    fuente = None
    for unidad, ruta in CAPTURADORES:
        try:
            r = subprocess.run(["systemctl", "--user", "is-active", "--quiet", unidad],
                               capture_output=True, timeout=1)
            if r.returncode == 0:
                fuente = (unidad, os.environ.get("CRV_RYM_LOG", ruta))
                break
        except (OSError, subprocess.TimeoutExpired):
            continue
    _FUENTE_CACHE = (ahora + 15, fuente)
    return fuente


def chequear_muro():
    """Último bloqueo del capturador activo, con caché breve para no releer por punto.

    El orden de las líneas decide si el bloqueo cedió, incluso al cruzar medianoche
    o si aparece antes de la primera captura. Un log antiguo no se usa como fuente activa.
    """
    global _MURO_CACHE
    fuente = fuente_capturador()
    ahora = time.monotonic()
    if fuente == _MURO_CACHE[1] and ahora < _MURO_CACHE[0]:
        return _MURO_CACHE[2]
    cap = blk = None
    walled = False
    if fuente:
        for ln in _tail(fuente[1]).splitlines():
            m = re.match(r"\[(\d{2}:\d{2}:\d{2})\] \+ \[", ln)
            if m:
                cap, walled = m.group(1), False
            m = re.match(r"\[(\d{2}:\d{2}:\d{2})\] \[bloqueo\]", ln)
            if m:
                blk = m.group(1)
                walled = "(403)" in ln or bool(re.search(BOT_RE, ln, re.I))
            if re.match(r"\[\d{2}:\d{2}:\d{2}\] \[muro-(en-pagina|persistente)\]", ln):
                walled = True
    detalle = {"activo": bool(fuente), "unidad": fuente[0] if fuente else None,
               "log": fuente[1] if fuente else None, "captura": cap, "bloqueo": blk}
    resultado = (walled, detalle)
    _MURO_CACHE = (ahora + 2, fuente, resultado)
    return resultado


def ventanas_firefox():
    """Inventario solo al iniciar el intento; la geometría se consulta solo para el objetivo."""
    try:
        r = subprocess.run(["xprop", "-root", "_NET_CLIENT_LIST"], capture_output=True,
                           text=True, env=ENV, timeout=1)
    except (OSError, subprocess.TimeoutExpired):
        return []
    out = []
    for wid in re.findall(r"0x[0-9a-f]+", r.stdout):
        try:
            p = subprocess.run(["xprop", "-id", wid, "WM_CLASS", "_NET_WM_PID", "_NET_WM_NAME"],
                               capture_output=True, text=True, env=ENV, timeout=1)
            clase = re.search(r"WM_CLASS.*", p.stdout)
            if not clase or "firefox" not in clase.group(0).lower():
                continue
            pid = re.search(r"_NET_WM_PID\(CARDINAL\) = (\d+)", p.stdout).group(1)
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                cmd = f.read().decode("utf-8", "ignore")
            if "firefox" not in cmd or "marionette" in cmd:
                continue
            titulo = re.search(r'_NET_WM_NAME\([^)]*\) = "(.*)"', p.stdout).group(1)
            out.append((wid, pid, None, titulo))
        except (OSError, AttributeError, subprocess.TimeoutExpired):
            continue
    return out


RYM_RE = r"rate your music|rateyourmusic|oakland"


def bloqueo_bots(ventanas=None):
    """Título de la pestaña al frente de algún Firefox del dueño si muestra un reto anti-bots."""
    for wid, pid, geo, titulo in ventanas if ventanas is not None else ventanas_firefox():
        if re.search(BOT_RE, titulo, re.I):
            return titulo
    return None


def ventana_rym(ventanas=None):
    """Su ventana de Firefox con pestaña RYM al frente → (wid, pid, titulo, geo) o None."""
    for wid, pid, geo, titulo in ventanas if ventanas is not None else ventanas_firefox():
        if re.search(RYM_RE, titulo, re.I):
            return wid, pid, titulo, geo
    return None


def titulo_ventana(ventana_id):
    """Lee solo la ventana objetivo, sin inventariar el escritorio."""
    try:
        p = subprocess.run(["xprop", "-id", ventana_id, "_NET_WM_NAME"], capture_output=True,
                           text=True, env=ENV, timeout=1)
        return re.search(r'= "(.*)"', p.stdout).group(1)
    except (OSError, AttributeError, subprocess.TimeoutExpired):
        return None


def buscar_ventana_rym():
    """Solo pestañas ya visibles: no rota ni recupera ventanas ajenas."""
    return ventana_rym()


def geo_abs(wid):
    """Geometría X11 real. Las capturas se recortan a la parte visible de la pantalla."""
    try:
        r = subprocess.run(["xwininfo", "-id", wid], capture_output=True, text=True, env=ENV, timeout=1)
        ax = int(re.search(r"Absolute upper-left X:\s+(-?\d+)", r.stdout).group(1))
        ay = int(re.search(r"Absolute upper-left Y:\s+(-?\d+)", r.stdout).group(1))
        w = int(re.search(r"Width:\s+(\d+)", r.stdout).group(1))
        h = int(re.search(r"Height:\s+(\d+)", r.stdout).group(1))
        return ax, ay, w, h
    except Exception:
        return None


def puntos_en_imagen(ppm, geo, origen, limite=6):
    """Localiza texto azul de RYM sin mover el cursor. Cada candidato se valida después.

    PPM de ImageMagick, sin dependencias Python adicionales. Se eligen píxeles reales
    del texto, separados entre sí; las superficies azules grandes (botones) se descartan.
    """
    cabecera = re.match(rb"P6\s+(\d+)\s+(\d+)\s+255\s", ppm)
    if not cabecera:
        return []
    ancho, alto = map(int, cabecera.groups())
    pixels = memoryview(ppm)[cabecera.end():]
    if not (0 < ancho <= PANTALLA[0] and 0 < alto <= PANTALLA[1]) or len(pixels) != ancho * alto * 3:
        return []
    ax, ay, w, h = geo
    # import -window entrega el área visible, recortando los bordes fuera de pantalla.
    ox, oy = max(0, ax), max(0, ay)
    celdas = {}
    for y in range(max(0, ay + 200 - oy), min(alto, PANTALLA[1] - oy - 40), 2):
        for x in range(max(0, ax + int(w * .06) - ox), min(ancho, ax + int(w * .94) - ox), 2):
            i = (y * ancho + x) * 3
            r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
            if b >= 120 and g - r >= 25 and b - g >= 10:
                celda = (x // 24, y // 24)
                cantidad, punto = celdas.get(celda, (0, (x, y)))
                centro = (celda[0] * 24 + 12, celda[1] * 24 + 12)
                if (x - centro[0]) ** 2 + (y - centro[1]) ** 2 < (punto[0] - centro[0]) ** 2 + (punto[1] - centro[1]) ** 2:
                    punto = (x, y)
                celdas[celda] = cantidad + 1, punto
    candidatos = [(ox + p[0], oy + p[1]) for cantidad, p in celdas.values() if 2 <= cantidad <= 65]
    ruta = []
    actual = origen
    while candidatos and len(ruta) < limite:
        punto = min(candidatos, key=lambda p: ((p[0] - actual[0]) ** 2 + (p[1] - actual[1]) ** 2, p))
        ruta.append(punto)
        candidatos = [p for p in candidatos if (p[0] - punto[0]) ** 2 + (p[1] - punto[1]) ** 2 >= 80 ** 2]
        actual = punto
    return ruta


def puntos_visuales(wid, geo, origen):
    """Captura únicamente la ventana objetivo, en memoria; no guarda imágenes del dueño."""
    try:
        r = subprocess.run(["import", "-silent", "-window", wid, "-depth", "8", "ppm:-"],
                           capture_output=True, env=ENV, timeout=1)
        return puntos_en_imagen(r.stdout, geo, origen) if r.returncode == 0 else []
    except (OSError, subprocess.TimeoutExpired):
        return []


def puntos_busqueda(ax, ay, w, h, origen, clave, intentos=6):
    """Ruta corta y acotada: punto verificado, posición actual y rejilla por proximidad."""
    x0, x1 = max(ax + int(w * 0.06), 0), min(ax + int(w * 0.94), PANTALLA[0] - 1)
    y0, y1 = max(ay + 200, 0), min(ay + h - 60, PANTALLA[1] - 40)
    if x1 - x0 < 100 or y1 - y0 < 100:
        return []
    dentro = lambda p: x0 <= p[0] <= x1 and y0 <= p[1] <= y1
    ruta = []
    for punto in (_ENLACES.get(clave), origen):
        if punto and dentro(punto) and punto not in ruta:
            ruta.append(punto)
    pendientes = {(int(x0 + (x1 - x0) * x), int(y0 + (y1 - y0) * y))
                  for x in (0.2, 0.4, 0.6, 0.8) for y in (0.15, 0.4, 0.65, 0.85)}
    pendientes.difference_update(ruta)
    actual = ruta[-1] if ruta else origen
    anclas = len(ruta)
    while pendientes:
        punto = min(pendientes, key=lambda p: ((p[0] - actual[0]) ** 2 +
                                               (p[1] - actual[1]) ** 2, p))
        pendientes.remove(punto)
        ruta.append(punto)
        actual = punto
    rejilla = ruta[anclas:]
    inicio = _BUSQUEDAS.get(clave, 0) % max(1, len(rejilla))
    disponibles = max(0, intentos - anclas)
    tramo = (rejilla[inicio:] + rejilla[:inicio])[:disponibles]
    if len(_BUSQUEDAS) >= 64 and clave not in _BUSQUEDAS:
        _BUSQUEDAS.pop(next(iter(_BUSQUEDAS)))
    _BUSQUEDAS[clave] = inicio + len(tramo)
    return (ruta[:anclas] + tramo)[:intentos]


def buscar_enlace(ax, ay, w, h, clave, intentos=6):
    """Hasta seis puntos y cuatro segundos. Ningún inventario de ventanas por punto."""
    fin = time.monotonic() + 4
    origen = puntero()
    visuales = puntos_visuales(clave[0], (ax, ay, w, h), origen)
    puntos = []
    guardado = _ENLACES.get(clave)
    if guardado and guardado in visuales:
        puntos.append(guardado)
    puntos.extend(p for p in visuales if p not in puntos)
    if not puntos:
        puntos = puntos_busqueda(ax, ay, w, h, origen, clave, intentos)
    for x, y in puntos[:intentos]:
        comprobar_control()
        if time.monotonic() >= fin or chequear_muro()[0]:
            return None
        titulo = titulo_ventana(clave[0])
        if not titulo or re.search(BOT_RE, titulo, re.I):
            return None
        if puntero() != (x, y):
            mover(x, y)
        esperar(0.08)
        if cursor_nombre() in CURSOR_ENLACE:
            destino = confirmar_enlace()
            if destino:
                if len(_ENLACES) >= 64:
                    _ENLACES.pop(next(iter(_ENLACES)))
                _ENLACES[clave] = (x, y)
                return x, y, destino
    _ENLACES.pop(clave, None)
    return None


def esperar_titulo(wid, viejo, seg=3.0):
    fin = time.monotonic() + seg
    t = viejo
    while time.monotonic() < fin:
        esperar(0.2)
        t = titulo_ventana(wid) or ""
        if t and t != viejo:
            esperar(0.25)
            return titulo_ventana(wid) or t
    return t


def recargar_sesion(detalle):
    """El capturador está bloqueado: refresca la SESIÓN del dueño con un F5 humano.

    Un bloqueo del CAPTURADOR no implica que el Firefox del dueño esté bloqueado: su pestaña carga
    RYM con normalidad y lo que falta es sesión fresca (la `cf_clearance` que el capturador recarga
    desde ese perfil en cada reintento). El F5 es navegación normal — no se toca ningún reto: si la
    pestaña del dueño muestra uno, se deja quieta, como siempre. Solo con el dueño inactivo.
    """
    global _RECARGA_TS
    if os.path.exists(M_PAUSA):
        return False, "pausa manual: no recargo"
    espera = random.randint(*INTERVALO_RECARGA)
    if time.time() - _RECARGA_TS < espera:
        return False, f"bloqueo del capturador: espero entre recargas ({espera} s)"
    ina = dueño_inactivo_s()
    if ina < IDLE_MIN:
        return False, f"estás usando el equipo (actividad hace {ina:.0f} s): no recargo"
    ventanas = ventanas_firefox()
    bot = bloqueo_bots(ventanas)
    if bot:
        return False, f"tu Firefox muestra un reto («{bot[:50]}»): no lo toco"
    v = ventana_rym(ventanas)
    if not v:
        v = buscar_ventana_rym()
    if not v:
        return False, "sin pestaña RYM visible en el Firefox del dueño: no recargo"
    wid, pid, titulo, _ = v
    previa, origen = ventana_activa(), puntero()
    interaccion = Interaccion(wid, previa, origen)
    try:
        if previa != wid and not activar(wid):
            return False, "no pude activar Firefox: no mando el F5"
        comprobar_control()
        url_activa = leer_url_activa()
        if url_activa is None or not url_rym_valida(url_activa):
            return False, "la pestaña activa no está en RYM: no recargo"
        _RECARGA_TS = time.time()
        _tecla(0xFFC2)  # F5
        nuevo = esperar_titulo(wid, titulo, seg=15.0)
        if re.search(BOT_RE, nuevo, re.I):
            return False, f"tras el F5 aparece un reto («{nuevo[:40]}»): lo dejo, no lo toco"
        return True, f"sesión refrescada con F5 («{titulo[:28]}» → «{nuevo[:28]}»)"
    except Interrumpido as exc:
        return False, f"recarga cancelada: {exc}"
    finally:
        try:
            interaccion.restaurar()
        finally:
            _INTERACCION = None


def clickear():
    """Un intento breve, solo en el Firefox del dueño. Nunca controla el scraper."""
    global ULTIMO_CLIC_TS, PROXIMO_CLIC_TS, _INTERACCION
    if os.path.exists(M_PAUSA):
        return False, "pausa manual"
    if PROXIMO_CLIC_TS is None:
        try:
            with open(M_GUARDIA, encoding="utf-8") as f:
                g = json.load(f)
            PROXIMO_CLIC_TS = float(g.get("proximo") or 0)
        except (OSError, ValueError, TypeError):
            PROXIMO_CLIC_TS = 0
    if time.time() < PROXIMO_CLIC_TS:
        return False, "esperando la hora del próximo intento"
    walled, detalle = chequear_muro()
    if not detalle.get("activo"):
        return False, "sin capturador RYM activo: espero"
    if walled:
        # El capturador está bloqueado… pero eso NO dice nada del Firefox del dueño. Si SU pestaña
        # carga RYM con normalidad, lo que falta es sesión fresca: la `cf_clearance` que el capturador
        # recarga desde su perfil en cada reintento. Un F5 sobre esa pestaña (navegación normal, sin
        # tocar ningún reto) la renueva y destraba al capturador. Antes esto se quedaba en «espero» y
        # el bloqueo se sostenía solo (medido 2026-10-16: 503 de 01:28 a 01:50 con 1 clic en el día).
        return recargar_sesion(detalle)
    ina = dueño_inactivo_s()
    if ina < IDLE_MIN:
        return False, f"estás usando el equipo (actividad hace {ina:.0f} s): espero"
    # Programar también los intentos sin enlace: no repetir barridos cada cinco segundos.
    PROXIMO_CLIC_TS = time.time() + random.randint(*INTERVALO)
    ventanas = ventanas_firefox()
    bot = bloqueo_bots(ventanas)
    if bot:
        return False, f"bloqueo de bots en tu Firefox («{bot[:50]}»): no toco nada"
    v = ventana_rym(ventanas)
    if not v:
        return False, "sin pestaña RYM visible en el Firefox del dueño"
    wid, pid, titulo, _ = v
    g = geo_abs(wid)
    if not g or g[2] < 300 or g[3] < 300:
        return False, "sin geometría utilizable"
    previa, origen = ventana_activa(), puntero()
    if not previa or dueño_inactivo_s() < IDLE_MIN:
        return False, "estás usando el equipo: espero"
    # Capturar la entrada ANTES de activar; la activación EWMH no inyecta teclado ni ratón.
    interaccion = Interaccion(wid, previa, origen)
    if previa != wid and not activar(wid):
        return False, "no pude activar Firefox: no envío teclas ni clics"
    _INTERACCION = interaccion
    hecho = False
    try:
        comprobar_control()
        url = leer_url_activa()
        if url is None:
            return False, "no pude leer la URL: no navego"
        if not url_rym_valida(url):
            return False, "la pestaña activa no está en https://rateyourmusic.com"
        clave = (wid, url, g)
        enlace = buscar_enlace(*g, clave)
        if not enlace:
            return False, f"sin enlace en búsqueda breve de «{titulo[:45]}»"
        x, y, destino = enlace
        comprobar_control()
        if chequear_muro()[0] or titulo_ventana(wid) != titulo:
            return False, "cambió la página o apareció un bloqueo: cancelo"
        # No hay espera previa al clic ni nuevas teclas que puedan cambiar el enlace.
        if cursor_nombre() not in CURSOR_ENLACE:
            return False, "el enlace dejó de estar bajo el puntero: cancelo"
        clic_boton()
        hecho = True
        ULTIMO_CLIC_TS = time.time()
        PROXIMO_CLIC_TS = ULTIMO_CLIC_TS + random.randint(*INTERVALO)
        # Devolver el puntero enseguida, sin mantenerlo sobre la página que está cargando.
        if origen != (x, y):
            mover(*origen)
        nuevo = esperar_titulo(wid, titulo)
        if re.search(BOT_RE, nuevo, re.I):
            return True, f"enlace → reto anti-bots «{nuevo[:45]}» (no lo toco)"
        if re.search(ERROR_RE, nuevo, re.I):
            return True, "enlace dio error de carga; conservo la pestaña para revisión"
        actual = leer_url_activa()
        if actual is None:
            return True, "clic enviado; URL posterior no verificable (sin retroceso automático)"
        if not url_rym_valida(actual):
            tecla_atras()
            return True, "salida de RYM confirmada por URL: volví atrás"
        return True, f"enlace {destino.decode('utf-8')[:90]} → «{nuevo[:45]}»"
    except Interrumpido as exc:
        return hecho, ("clic enviado; " if hecho else "") + str(exc)
    finally:
        try:
            interaccion.restaurar()
        finally:
            _INTERACCION = None


def guardar_guardia(modo, hecho, motivo):
    try:
        with open(M_GUARDIA, encoding="utf-8") as f:
            g = json.loads(f.read())
    except Exception:
        g = {}
    hoy = time.strftime("%Y-%m-%d")
    if g.get("dia") != hoy:
        g = {"dia": hoy, "clics_dia": 0}
    g.update({"ts": int(time.time()), "modo": modo, "motivo": motivo[:160], "hecho": bool(hecho)})
    fuente = fuente_capturador()
    g["capturador"] = fuente[0] if fuente else None
    if PROXIMO_CLIC_TS:
        g["proximo"] = PROXIMO_CLIC_TS
    if hecho:
        g["clics_dia"] = g.get("clics_dia", 0) + 1
        g["ultimo"] = int(ULTIMO_CLIC_TS or time.time())
        g["ultimo_motivo"] = motivo[:160]
    tmp = M_GUARDIA + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(json.dumps(g, ensure_ascii=False))
    os.replace(tmp, M_GUARDIA)


def leer_ep():
    try:
        with open(M_EP, encoding="utf-8") as f:
            return json.loads(f.read())
    except Exception:
        return None


def guardar_ep(d):
    with open(M_EP, "w", encoding="utf-8") as f:
        f.write(json.dumps(d))


def ciclo():
    walled, det = chequear_muro()
    ep = leer_ep()
    if walled and not ep:
        ep = {"inicio": int(time.time()), "clics": 0}
        guardar_ep(ep)
        log(f"episodio de muro iniciado ({det})")
    elif not walled and ep:
        n = ep.get("clics", 0)
        mins = max(1, (int(time.time()) - ep.get("inicio", int(time.time()))) // 60)
        try:
            os.remove(M_EP)
        except Exception:
            pass
        log(f"episodio cerrado: {n} clics y {ep.get('recargas', 0)} recargas en ~{mins} min")
        ep = None

    modo = "muro" if walled else "guardia"
    ok, motivo = clickear()
    if walled and ep and ok and "F5" in motivo:
        ep["recargas"] = ep.get("recargas", 0) + 1
        guardar_ep(ep)
    guardar_guardia(modo, ok, motivo)
    log(f"[{modo}] " + (f"clic: {motivo}" if ok else f"sin clic: {motivo}"))
    if not ok and "usando el equipo" in motivo:
        return random.randint(10, 20)   # reintento corto: en cuanto sueltes el equipo
    if not ok and ("sin pestaña RYM" in motivo or "pausa manual" in motivo or
                   "sin capturador RYM" in motivo):
        return 60                       # nada que hacer en un rato: no molestar al dueño
    if PROXIMO_CLIC_TS and time.time() < PROXIMO_CLIC_TS:
        return min(60, max(1, PROXIMO_CLIC_TS - time.time()))
    return 30


def main():
    iniciar_x11()
    modo_test = "--test" in sys.argv
    log("wall-clicker arrancado" + (" (test)" if modo_test else ""))
    if modo_test:
        walled, det = chequear_muro()
        v = ventana_rym()
        print("walled:", walled, json.dumps({k: (round(x, 1) if isinstance(x, float) else x) for k, x in det.items()}, ensure_ascii=False))
        print("ventana RYM:", v)
        print("puntero (solo lectura):", puntero())
        print("cursor:", cursor_nombre(), "· inactivo:", round(inactivo_s(), 1), "s · dueño inactivo:",
              round(dueño_inactivo_s(), 1), "s · bloqueo bots:", bloqueo_bots())
        return
    if "--clic-ya" in sys.argv:
        ok, motivo = clickear()
        print("clic-ya:", ok, motivo)
        return
    if "--buscar" in sys.argv:
        v = buscar_ventana_rym()
        print("buscar-rym:", v)
        return
    while True:
        try:
            espera = ciclo()
        except Exception as exc:
            log(f"ERROR en ciclo: {str(exc)[:150]}")
            espera = 60
        time.sleep(espera)


if __name__ == "__main__":
    main()
