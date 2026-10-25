#!/usr/bin/env python3
"""Cliquer RYM — mantiene caliente la sesión del Firefox REAL del dueño.

Instrucciones del dueño:
- 2026-10-03: «cada vez que haya un muro cloudflare abres algún link de la pestaña
  https://rateyourmusic.com/location/Oakland/CA/United States, cualquier link» · «debes usar el
  firefox que no es marionette».
- 2026-10-05: «debe hacer click en solo links de la pagina en intervalos de 30 a 65 segundos
  mientras no haya bloqueo de bots».
- 2026-10-18 (manda hoy): «quita el clicker… y en su lugar realiza aleatoriamente acciones de
  reinicia la página o entra en páginas aleatorias en la misma página, en intervalos aleatorios
  de 30 s a 50 s».

Funcionamiento (sin xdotool: XTEST/XFixes/XScreenSaver vía ctypes; 0 LLM):
- Cada 30-50 s ALEATORIOS ejecuta UNA acción en la misma pestaña de RYM del dueño, elegida al azar:
  reiniciar la página (F5) o entrar en una ficha de RYM al azar (Ctrl+L, pegar, Enter). Nunca abre
  pestañas ni sale de https://rateyourmusic.com.
- El repertorio de páginas sale del `estado.json` del capturador activo: solo fichas que existen
  (nunca un 404). Si no hay repertorio, la acción es F5.
- «Bloqueo de bots» (la pestaña muestra «Un momento…», «Just a moment…», «Attention Required»…):
  NO se toca nada; los retos de Cloudflare no se tocan. Si el CAPTURADOR está en muro, la acción
  es siempre F5 (renueva la `cf_clearance` sin salir de la página).
- Espera 8 s de inactividad real. Si hay nueva entrada o cambia el foco, cancela sin devolver el
  puntero ni el foco por encima de la acción del dueño.
- Puerta de seguridad: solo la ventana del Firefox no-marionette con la pestaña de RYM al frente;
  no rota pestañas ni toca el navegador automatizado del capturador.
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
# Repertorio de fichas reales de RYM por capturador: su estado.json (slug -> ficha).
ESTADOS_CAPTURA = {
    "crv-scrapling-rym-resto": f"{REPO}/data/raw/fuentes-web-2026-10-16/rym-resto/estado.json",
    "crv-scrapling-nuevos": f"{REPO}/data/raw/fuentes-web-2026-10-01/rym-nuevos/estado.json",
}
BASE_RYM = "https://rateyourmusic.com"
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

BOT_RE = r"un momento|just a moment|attention required|verify you are human|verifica que eres|security check|checking your browser|cloudflare"
INTERVALO = (30, 50)      # s entre acciones, al azar (instrucción del dueño 2026-10-18)
ACCIONES = ("recarga", "pagina")  # reiniciar la página o entrar en una página al azar
IDLE_MIN = 8              # s sin uso del teclado/ratón antes de tocar nada (ver nota de 2026-10-16)
# Nota 2026-10-16 (queja del dueño «el clicker sigue sin hacer nada útil»): con 20 s el cliquer cedía
# el control SIEMPRE que el dueño estaba delante (114 de 123 ciclos en una hora: 2 acciones útiles en
# el día). La red de seguridad real no es el umbral sino `Interaccion.comprobar()`: cualquier entrada
# nueva del dueño aborta la interacción y devuelve el foco al instante («cedo el control»). Con 8 s
# entra en las pausas naturales de lectura y sigue sin tocar nada mientras se teclea seguido.
M_GUARDIA = f"{MK}/clicker-guardia"
ULTIMA_ACCION_TS = None
PROXIMA_ACCION_TS = None
_INTERACCION = None
_FUENTE_CACHE = (0.0, None)
_MURO_CACHE = (0.0, None, None)
_POOL = (0.0, ())
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
    """Propiedad temporal del foco; nunca se recupera tras una intervención del dueño."""
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


def _tecla(*keysyms):
    comprobar_control()
    codes = [X11.XKeysymToKeycode(_d, k) for k in keysyms]
    for c in codes:
        XTST.XTestFakeKeyEvent(_d, c, 1, 0)
    for c in reversed(codes):
        XTST.XTestFakeKeyEvent(_d, c, 0, 0)
    X11.XFlush(_d)
    _sintetico()


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


def navegar_a(url):
    """Lleva la pestaña ACTIVA a `url`: Ctrl+L, Ctrl+V, Enter. Sin pestañas nuevas.

    El portapapeles se restaura si sigue teniendo lo que escribimos (nunca se pisa lo que
    copie el dueño entretanto).
    """
    comprobar_control()
    anterior = _portapapeles_leer()
    if anterior is None:
        return False, "portapapeles no disponible: no navego"
    datos = url.encode("utf-8")
    if not _portapapeles_escribir(datos):
        return False, "no pude escribir el portapapeles: no navego"
    try:
        _tecla(0xFFE3, ord("l"))  # Ctrl+L: barra de direcciones
        esperar(0.12)
        _tecla(0xFFE3, ord("v"))  # Ctrl+V: pegar la URL
        esperar(0.12)
        _tecla(0xFF0D)            # Enter: navegar en la misma pestaña
    finally:
        if _portapapeles_leer() == datos:
            _portapapeles_escribir(anterior)
    return True, url


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
    """Sin heurística: los 30-50 s entre acciones ya superan los 8 s de idle requerido."""
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
    """Inventario solo al iniciar la acción; nunca toca la pestaña del navegador automatizado."""
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


def esperar_titulo(wid, viejo, seg=15.0):
    fin = time.monotonic() + seg
    t = viejo
    while time.monotonic() < fin:
        esperar(0.2)
        t = titulo_ventana(wid) or ""
        if t and t != viejo:
            esperar(0.25)
            return titulo_ventana(wid) or t
    return t


def paginas_rym():
    """Fichas de RYM que EXISTEN, según el estado.json del capturador activo (caché 10 min).

    El estado trae también los 404: se excluyen porque navegar a una ficha inexistente no
    renueva nada y ensucia el historial del dueño.
    """
    global _POOL
    ahora = time.monotonic()
    if ahora < _POOL[0]:
        return _POOL[1]
    fuente = fuente_capturador()
    ruta = ESTADOS_CAPTURA.get(fuente[0]) if fuente else None
    urls = []
    if ruta:
        try:
            with open(ruta, encoding="utf-8") as fh:
                estado = json.load(fh)
            urls = [BASE_RYM + slug for slug, ficha in estado.items()
                    if slug.startswith("/") and isinstance(ficha, dict) and ficha.get("status") != 404]
        except (OSError, ValueError, AttributeError):
            urls = []
    _POOL = (ahora + (600 if urls else 60), tuple(urls))
    return _POOL[1]


def pagina_aleatoria():
    urls = paginas_rym()
    return random.choice(urls) if urls else None


def accion_aleatoria(rng=random):
    """Reiniciar la página o entrar en una página al azar, mitad y mitad."""
    return rng.choice(ACCIONES)


def actuar():
    """Una acción breve, solo en el Firefox del dueño. Nunca controla el scraper."""
    global ULTIMA_ACCION_TS, PROXIMA_ACCION_TS, _INTERACCION
    if os.path.exists(M_PAUSA):
        return False, "pausa manual"
    if PROXIMA_ACCION_TS is None:
        try:
            with open(M_GUARDIA, encoding="utf-8") as f:
                g = json.load(f)
            PROXIMA_ACCION_TS = float(g.get("proximo") or 0)
        except (OSError, ValueError, TypeError):
            PROXIMA_ACCION_TS = 0
    if time.time() < PROXIMA_ACCION_TS:
        return False, "esperando la hora de la próxima acción"
    walled, detalle = chequear_muro()
    if not detalle.get("activo"):
        return False, "sin capturador RYM activo: espero"
    ventanas = ventanas_firefox()
    bot = bloqueo_bots(ventanas)
    if bot:
        return False, f"bloqueo de bots en tu Firefox («{bot[:50]}»): no toco nada"
    v = ventana_rym(ventanas)
    if not v:
        return False, "sin pestaña RYM visible en el Firefox del dueño"
    wid, pid, titulo, _ = v
    previa, origen = ventana_activa(), puntero()
    ina = dueño_inactivo_s()
    # Estar EN la página no renueva nada, pero navegarle la pestaña mientras la lee sí molesta.
    if previa == wid and ina < 60:
        return False, f"estás mirando RYM (uso hace {ina:.0f} s): no navego"
    if ina < IDLE_MIN:
        return False, f"estás usando el equipo (actividad hace {ina:.0f} s): espero"
    # Capturar la entrada ANTES de activar; la activación EWMH no inyecta teclado ni ratón.
    interaccion = Interaccion(wid, previa, origen)
    if previa != wid and not activar(wid):
        return False, "no pude activar Firefox: no envío teclas"
    _INTERACCION = interaccion
    try:
        comprobar_control()
        url = leer_url_activa()
        if url is None:
            return False, "no pude leer la URL: no navego"
        if not url_rym_valida(url):
            return False, "la pestaña activa no está en https://rateyourmusic.com"
        accion = "recarga" if walled else accion_aleatoria()
        # La espera se programa SIEMPRE, también para los intentos que no llegan a nada.
        PROXIMA_ACCION_TS = time.time() + random.randint(*INTERVALO)
        if accion == "recarga":
            _tecla(0xFFC2)  # F5
            motivo = "F5"
        else:
            destino = pagina_aleatoria()
            if not destino:
                return False, "sin fichas de RYM conocidas: no navego"
            ok, dato = navegar_a(destino)
            if not ok:
                return False, dato
            motivo = f"página {dato}"
        ULTIMA_ACCION_TS = time.time()
        nuevo = esperar_titulo(wid, titulo, seg=15.0)
        if re.search(BOT_RE, nuevo, re.I):
            return True, f"{motivo} → reto anti-bots «{nuevo[:45]}» (no lo toco)"
        if re.search(ERROR_RE, nuevo, re.I):
            return True, f"{motivo} → error de carga; conservo la pestaña"
        return True, f"{motivo} → «{nuevo[:45]}»"
    except Interrumpido as exc:
        return False, f"acción cancelada: {exc}"
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
    if PROXIMA_ACCION_TS:
        g["proximo"] = PROXIMA_ACCION_TS
    if hecho:
        g["clics_dia"] = g.get("clics_dia", 0) + 1
        g["ultimo"] = int(ULTIMA_ACCION_TS or time.time())
        g["ultimo_motivo"] = motivo[:160]
    if hecho and "F5" in (motivo or ""):
        g["recargas_dia"] = g.get("recargas_dia", 0) + 1
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
        log(f"episodio cerrado: {n} acciones y {ep.get('recargas', 0)} recargas en ~{mins} min")
        ep = None

    modo = "muro" if walled else "guardia"
    ok, motivo = actuar()
    if walled and ep and ok and "F5" in motivo:
        ep["recargas"] = ep.get("recargas", 0) + 1
        guardar_ep(ep)
    guardar_guardia(modo, ok, motivo)
    log(f"[{modo}] " + (f"acción: {motivo}" if ok else f"sin acción: {motivo}"))
    if not ok and "usando el equipo" in motivo:
        return random.randint(10, 20)   # reintento corto: en cuanto sueltes el equipo
    if not ok and "mirando RYM" in motivo:
        return random.randint(20, 40)   # está leyendo: no insisto enseguida
    if not ok and ("sin pestaña RYM" in motivo or "pausa manual" in motivo or
                   "sin capturador RYM" in motivo):
        return 60                       # nada que hacer en un rato: no molestar al dueño
    if PROXIMA_ACCION_TS and time.time() < PROXIMA_ACCION_TS:
        return min(60, max(1, PROXIMA_ACCION_TS - time.time()))
    return 30


def main():
    iniciar_x11()
    modo_test = "--test" in sys.argv
    log("wall-clicker arrancado" + (" (test)" if modo_test else ""))
    if modo_test:
        walled, det = chequear_muro()
        v = ventana_rym()
        paginas = paginas_rym()
        print("walled:", walled, json.dumps({k: (round(x, 1) if isinstance(x, float) else x) for k, x in det.items()}, ensure_ascii=False))
        print("ventana RYM:", v)
        print("páginas de RYM conocidas:", len(paginas), "· ejemplo:", paginas[0] if paginas else "-")
        print("puntero (solo lectura):", puntero())
        print("cursor:", cursor_nombre(), "· inactivo:", round(inactivo_s(), 1), "s · dueño inactivo:",
              round(dueño_inactivo_s(), 1), "s · bloqueo bots:", bloqueo_bots())
        return
    if "--accion-ya" in sys.argv:
        ok, motivo = actuar()
        print("acción-ya:", ok, motivo)
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
