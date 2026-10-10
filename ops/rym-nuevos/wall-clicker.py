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
- No roba el ratón: si el dueño usó teclado/ratón en los últimos 20 s, espera. Devuelve el
  puntero y el foco de ventana a donde estaban.
- Puerta de seguridad: solo la ventana del Firefox no-marionette con la pestaña de Rate Your
  Music al frente (si no está al frente, la busca rotando pestañas con Ctrl+AvPág).
- Avisos Telegram: al detectar un muro del capturador; el cliquer queda en espera.
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
LOG = f"{REPO}/reports/scrapling-nuevos.log"
SLOG = f"{REPO}/reports/crv-wall-clicker.log"
AVISOS = f"{REPO}/scripts/rym-etapa3-avisos.sh"
MK = f"{REPO}/reports/crv-marcas"
M_EP = f"{MK}/clicker-ep"
M_PAUSA = f"{MK}/clicker-pausa"
LWIN = os.path.expanduser("~/.hermes/skills/devops/x11-window-control/scripts/list_windows.sh")
ACT = os.path.expanduser("~/.hermes/skills/devops/x11-window-control/scripts/activate_window.py")
ENV = {**os.environ, "DISPLAY": ":0", "XAUTHORITY": "/home/brian/.Xauthority"}

X11 = ctypes.CDLL("libX11.so.6")
XTST = ctypes.CDLL("libXtst.so.6")
X11.XOpenDisplay.restype = ctypes.c_void_p
X11.XOpenDisplay.argtypes = [ctypes.c_char_p]
X11.XFlush.argtypes = [ctypes.c_void_p]
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

_d = X11.XOpenDisplay(b":0")
_root = X11.XDefaultRootWindow(_d)
X11.XDisplayWidth.argtypes = X11.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
PANTALLA = (X11.XDisplayWidth(_d, 0), X11.XDisplayHeight(_d, 0))


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
_ssinfo = XSS.XScreenSaverAllocInfo()
X11.XFree.argtypes = [ctypes.c_void_p]

CURSOR_ENLACE = {"pointer", "hand", "hand1", "hand2", "pointing_hand"}
BOT_RE = r"un momento|just a moment|attention required|verify you are human|verifica que eres|security check|checking your browser|cloudflare"
INTERVALO = (30, 65)      # s entre clics (instrucción del dueño 2026-10-05)
IDLE_MIN = 20             # s sin uso del teclado/ratón antes de tocar nada
M_GUARDIA = f"{MK}/clicker-guardia"
ULTIMO_CLIC_TS = None
PROXIMO_CLIC_TS = None
_ULT_SINTETICO = 0.0      # hora de la última tecla/movimiento que inyectó el propio cliquer
_SIN_RYM_HASTA = 0.0      # tras no hallar la pestaña RYM, no vuelve a rotar pestañas hasta esta hora
ERROR_RE = (r"problema al cargar la p[aá]gina|problem loading page|server not found|"
            r"no se puede conectar|unable to connect|secure connection failed|conexi[oó]n segura fall")


def log(msg):
    with open(SLOG, "a", encoding="utf-8") as f:
        f.write(f"[{time.strftime('%F %T')}] {msg}\n")


def aviso(msg):
    try:
        subprocess.run(["timeout", "30", "bash", AVISOS, msg], capture_output=True, timeout=40)
    except Exception as exc:
        log(f"aviso falló: {str(exc)[:80]}")
    log(f"aviso: {msg}")


def puntero():
    rr, cr = ctypes.c_ulong(), ctypes.c_ulong()
    rx, ry, wx, wy = ctypes.c_int(), ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
    m = ctypes.c_uint()
    X11.XQueryPointer(_d, _root, ctypes.byref(rr), ctypes.byref(cr), ctypes.byref(rx),
                      ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(m))
    return rx.value, ry.value


def _sintetico():
    global _ULT_SINTETICO
    _ULT_SINTETICO = time.time()


def mover(x, y):
    XTST.XTestFakeMotionEvent(_d, -1, int(x), int(y), 0)
    X11.XFlush(_d)
    _sintetico()


def clic_boton():
    XTST.XTestFakeButtonEvent(_d, 1, 1, 0)
    X11.XFlush(_d)
    time.sleep(0.06)
    XTST.XTestFakeButtonEvent(_d, 1, 0, 0)
    X11.XFlush(_d)
    _sintetico()


def clic_derecho():
    XTST.XTestFakeButtonEvent(_d, 3, 1, 0)
    X11.XFlush(_d)
    time.sleep(0.06)
    XTST.XTestFakeButtonEvent(_d, 3, 0, 0)
    X11.XFlush(_d)
    _sintetico()


def tecla_next():
    """Ctrl+AvPág (pestaña siguiente) vía XTEST — como teclado real."""
    ctrl = X11.XKeysymToKeycode(_d, 0xFFE3)  # Control_L
    nxt = X11.XKeysymToKeycode(_d, 0xFF56)   # Next == PageDown
    XTST.XTestFakeKeyEvent(_d, ctrl, 1, 0)
    XTST.XTestFakeKeyEvent(_d, nxt, 1, 0)
    XTST.XTestFakeKeyEvent(_d, nxt, 0, 0)
    XTST.XTestFakeKeyEvent(_d, ctrl, 0, 0)
    X11.XFlush(_d)
    _sintetico()


def _tecla(*keysyms):
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
                           timeout=2, env=ENV)
        if r.returncode == 0:
            return r.stdout
        return b"" if b"not available" in r.stderr else None
    except Exception:
        return None


def _portapapeles_escribir(datos):
    try:
        r = subprocess.run(["xclip", "-selection", "clipboard", "-i"], input=datos,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=2, env=ENV)
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


def pestaña_en_rym():
    """Comprueba la URL real de la pestaña activa, sin confiar en el título (2 intentos:
    justo tras activar la ventana, Firefox a veces no ha tomado aún el foco de teclado)."""
    if _pestaña_en_rym():
        return True
    time.sleep(0.6)
    return _pestaña_en_rym()


def _pestaña_en_rym():
    anterior = _portapapeles_leer()
    if anterior is None:
        return False
    marcador = f"crv-tab-check-{uuid.uuid4()}".encode()
    if not _portapapeles_escribir(marcador):
        return False
    try:
        _tecla(0xFFE3, ord("l"))  # Ctrl+L: seleccionar URL de la pestaña
        time.sleep(0.1)
        _tecla(0xFFE3, ord("c"))  # Ctrl+C: copiarla
        time.sleep(0.15)
        copiado = _portapapeles_leer()
        _tecla(0xFF1B)           # Escape: devolver el foco a la página
        return bool(copiado and copiado != marcador and url_rym_valida(copiado))
    finally:
        _portapapeles_escribir(anterior)


def confirmar_enlace():
    """Exige que Firefox ofrezca «Copiar enlace» y copie una URL de RYM.

    La mano sola también aparece sobre botones. El menú contextual de Firefox ESR usa
    la tecla L para «Copy Link» / «Copiar enlace» en las traducciones instaladas.
    """
    anterior = _portapapeles_leer()
    if anterior is None:
        return False
    marcador = f"crv-link-check-{uuid.uuid4()}".encode()
    if not _portapapeles_escribir(marcador):
        return False
    try:
        clic_derecho()
        time.sleep(0.2)
        _tecla(ord("l"))
        time.sleep(0.2)
        copiado = _portapapeles_leer()
        _tecla(0xFF1B)  # Escape: cerrar cualquier menú que siguiera abierto
        return bool(copiado and copiado != marcador and enlace_permitido(copiado))
    finally:
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
    """Segundos desde el último uso del equipo POR EL DUEÑO. Las teclas y movimientos que
    inyecta el cliquer también reinician el contador de XScreenSaver; si la última entrada
    coincide con una propia (±1,5 s), no cuenta como uso del dueño."""
    ina = inactivo_s()
    ultima = time.time() - ina
    if _ULT_SINTETICO and abs(ultima - _ULT_SINTETICO) <= 1.5:
        return max(ina, IDLE_MIN)     # la última entrada fue nuestra: el dueño no tocó nada después
    return ina


def ventana_activa():
    try:
        r = subprocess.run(["xprop", "-root", "_NET_ACTIVE_WINDOW"], capture_output=True, text=True, env=ENV, timeout=10)
        m = re.search(r"(0x[0-9a-f]+)", r.stdout)
        return m.group(1) if m and int(m.group(1), 16) else None
    except Exception:
        return None


def activar(wid):
    try:
        subprocess.run(["python3", ACT, wid], capture_output=True, env=ENV, timeout=15)
    except Exception:
        pass


def _tail(ruta, nbytes=150000):
    try:
        with open(ruta, "rb") as f:
            f.seek(max(0, os.path.getsize(ruta) - nbytes))
            return f.read().decode("utf-8", "ignore")
    except Exception:
        return ""


def _epoch_hora(hhmmss):
    try:
        h, m, s = (int(x) for x in hhmmss.split(":"))
        t = time.localtime()
        e = int(time.mktime((t.tm_year, t.tm_mon, t.tm_mday, h, m, s, 0, 0, -1)))
        return e if e <= time.time() + 60 else e - 86400
    except Exception:
        return None


def chequear_muro():
    """Devuelve (walled, detalle): capturas detenidas tras un bloqueo CF."""
    txt = _tail(LOG)
    cap = blk = None
    blk_cf = False
    for ln in txt.splitlines():
        m = re.match(r"\[(\d{2}:\d{2}:\d{2})\] \+ \[", ln)
        if m:
            cap = m.group(1)
        m = re.match(r"\[(\d{2}:\d{2}:\d{2})\] \[bloqueo\]", ln)
        if m:
            blk = m.group(1)
            blk_cf = (("(403)" in ln and "Un momento" in ln) or
                      ("(503)" in ln and "Security check required" in ln))
    now = time.time()
    ce = _epoch_hora(cap) if cap else None
    be = _epoch_hora(blk) if blk else None
    age_cap = (now - ce) if ce else None
    age_blk = (now - be) if be else None
    walled = bool(age_cap is not None and age_cap >= 150 and blk_cf and
                  age_blk is not None and age_blk <= age_cap)
    return walled, {"captura": cap, "age_cap": age_cap, "bloqueo": blk, "blk_cf": blk_cf, "age_blk": age_blk}


def ventanas_firefox():
    """Ventanas del Firefox NO marionette del dueño → [(wid, pid, geo, titulo), ...]."""
    try:
        r = subprocess.run(["bash", LWIN], capture_output=True, text=True, env=ENV, timeout=30)
    except Exception:
        return []
    out = []
    for ln in r.stdout.splitlines()[1:]:
        parts = ln.split(None, 4)
        if len(parts) < 5:
            continue
        wid, pid, geom, titulo = parts[0], parts[1], parts[2], parts[4]
        try:
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().decode("utf-8", "ignore")
        except Exception:
            continue
        if "firefox" not in cmd or "--marionette" in cmd:
            continue
        g = re.match(r"(\d+)x(\d+)([+-]-?\d+)([+-]-?\d+)", geom)
        if not g:
            continue
        out.append((wid, pid, tuple(int(x.replace("+-", "-")) for x in g.groups()), titulo))
    return out


RYM_RE = r"rate your music|rateyourmusic|oakland"


def bloqueo_bots():
    """Título de la pestaña al frente de algún Firefox del dueño si muestra un reto anti-bots."""
    for wid, pid, geo, titulo in ventanas_firefox():
        if re.search(BOT_RE, titulo, re.I):
            return titulo
    return None


def ventana_rym():
    """Su ventana de Firefox con pestaña RYM al frente → (wid, pid, titulo, geo) o None."""
    for wid, pid, geo, titulo in ventanas_firefox():
        if re.search(RYM_RE, titulo, re.I):
            return wid, pid, titulo, geo
    return None


def titulo_ventana(ventana_id):
    """Título de esa ventana exacta (Firefox puede tener varias con el mismo pid)."""
    for wid, p, geo, titulo in ventanas_firefox():
        if wid == ventana_id:
            return titulo
    return None


def recuperar_error():
    """Si una ventana del dueño muestra una página de error de Firefox («Problema al cargar la
    página»…) y su URL es de RYM (p. ej. tras un clic con la red caída), la recarga (F5)."""
    for wid, pid, geo, titulo in ventanas_firefox():
        if not re.search(ERROR_RE, titulo, re.I):
            continue
        activar(wid)
        time.sleep(0.4)
        if not pestaña_en_rym():
            continue
        tecla_atras()   # vuelve a la última página buena (p. ej. /buy/ da 503 siempre)
        nuevo = esperar_titulo(wid, titulo, seg=10.0)
        if re.search(ERROR_RE, nuevo, re.I):
            _tecla(0xFFC2)  # F5
            nuevo = esperar_titulo(wid, nuevo, seg=10.0)
        log(f"página de error en RYM recuperada: «{titulo[:40]}» → «{nuevo[:50]}»")
        if re.search(RYM_RE, nuevo, re.I):
            return wid, pid, nuevo, geo
    return None


def buscar_ventana_rym():
    """ventana_rym(); si la pestaña RYM quedó en una página de error, la recarga; si no está
    al frente, rota pestañas de su Firefox (Ctrl+AvPág) hasta encontrarla — como mucho una
    vez cada 10 min, para no pasearle las pestañas al dueño. Devuelve igual que ventana_rym()."""
    global _SIN_RYM_HASTA
    v = ventana_rym()
    if v:
        _SIN_RYM_HASTA = 0.0
        return v
    if time.time() < _SIN_RYM_HASTA:
        return None
    _SIN_RYM_HASTA = time.time() + 600
    v = recuperar_error()
    if v:
        _SIN_RYM_HASTA = 0.0
        return v
    for wid, pid, geo, titulo in ventanas_firefox():
        try:
            subprocess.run(["python3", ACT, wid], capture_output=True, env=ENV, timeout=15)
        except Exception:
            pass
        time.sleep(0.4)
        t0 = titulo_ventana(wid) or titulo
        for _ in range(24):
            tecla_next()
            time.sleep(0.35)
            t = titulo_ventana(wid)
            if t is None:
                break
            if re.search(RYM_RE, t, re.I):
                log(f"pestaña RYM encontrada rotando: «{t[:60]}»")
                _SIN_RYM_HASTA = 0.0
                return wid, pid, t, geo
            if t == t0:
                break
    return None


TITLEBAR_Y = 24  # xfwm4: el contenido real de una ventana decorada empieza ~24 px más abajo
# que el "Absolute upper-left" que reporta xwininfo; verificado empíricamente 2026-10-03
# (sin este ajuste TODOS los clics caían 24 px ARRIBA del objetivo y no hacía nada).


def geo_abs(wid):
    """Geometría absoluta del CONTENIDO de la ventana (xwininfo + ajuste de titlebar)."""
    try:
        r = subprocess.run(["xwininfo", "-id", wid], capture_output=True, text=True, env=ENV, timeout=15)
        ax = int(re.search(r"Absolute upper-left X:\s+(-?\d+)", r.stdout).group(1))
        ay = int(re.search(r"Absolute upper-left Y:\s+(-?\d+)", r.stdout).group(1))
        w = int(re.search(r"Width:\s+(\d+)", r.stdout).group(1))
        h = int(re.search(r"Height:\s+(\d+)", r.stdout).group(1))
        return ax, ay + TITLEBAR_Y, w, h
    except Exception:
        return None


def buscar_enlace(ax, ay, w, h, intentos=45):
    """Pasa el puntero por puntos al azar del contenido y devuelve (x, y) del primero donde
    Firefox muestra la mano y «Copiar enlace» devuelve una URL de RYM, o None.
    Evita la cabecera (pestañas, barra de
    direcciones y menú de RYM con «cerrar sesión») y lo que cae fuera de pantalla."""
    x0, x1 = max(ax + int(w * 0.06), 0), min(ax + int(w * 0.94), PANTALLA[0] - 1)
    y0, y1 = max(ay + 200, 0), min(ay + h - 60, PANTALLA[1] - 40)
    if x1 - x0 < 100 or y1 - y0 < 100:
        return None
    for _ in range(intentos):
        if chequear_muro()[0] or bloqueo_bots():
            return None
        x, y = random.randint(x0, x1), random.randint(y0, y1)
        mover(x, y)
        time.sleep(0.07)
        if cursor_nombre() in CURSOR_ENLACE:
            time.sleep(0.05)
            if cursor_nombre() in CURSOR_ENLACE and confirmar_enlace():
                return x, y
    return None


def esperar_titulo(wid, viejo, seg=6.0):
    fin = time.time() + seg
    t = viejo
    while time.time() < fin:
        time.sleep(0.5)
        t = titulo_ventana(wid) or ""
        if t and t != viejo:
            time.sleep(0.8)
            return titulo_ventana(wid) or t
    return t


def clickear():
    """Un clic en un enlace. Devuelve (hecho, motivo)."""
    global ULTIMO_CLIC_TS, PROXIMO_CLIC_TS
    if os.path.exists(M_PAUSA):
        return False, "pausa manual"
    try:
        with open(M_GUARDIA, encoding="utf-8") as f:
            guardia = json.load(f)
            ultimo = float(guardia.get("ultimo") or 0)
    except (OSError, ValueError, TypeError):
        guardia = {}
        ultimo = 0
    if PROXIMO_CLIC_TS is None:
        PROXIMO_CLIC_TS = float(guardia.get("proximo") or 0)
        if not PROXIMO_CLIC_TS and ultimo:
            PROXIMO_CLIC_TS = ultimo + random.randint(*INTERVALO)
    # Preparar la comprobación del enlace hasta 20 s antes de la hora sorteada.
    if time.time() < PROXIMO_CLIC_TS - 20:
        return False, "esperando la hora aleatoria del próximo clic"
    walled, _ = chequear_muro()
    if walled:
        return False, "bloqueo de bots en el capturador: espero"
    bot = bloqueo_bots()
    if bot:
        return False, f"bloqueo de bots en tu Firefox («{bot[:50]}»): no toco nada"
    ina = dueño_inactivo_s()
    if ina < IDLE_MIN:
        return False, f"estás usando el equipo (actividad hace {ina:.0f} s): espero"
    previa = ventana_activa()
    ox, oy = puntero()
    try:
        v = buscar_ventana_rym()
        if not v:
            return False, "sin pestaña RYM (ni rotando) en el Firefox del dueño"
        wid, pid, titulo, _ = v
        g = geo_abs(wid)
        if not g:
            return False, "sin geometría"
        ax, ay, w, h = g
        if w < 300 or h < 300:
            return False, "ventana rara"
        activar(wid)
        time.sleep(0.4)
        if not pestaña_en_rym():
            return False, "la pestaña activa no está en https://rateyourmusic.com"
        p = buscar_enlace(ax, ay, w, h)
        if not p:
            return False, f"no encontré enlaces en «{titulo[:45]}»"
        if chequear_muro()[0] or bloqueo_bots():
            return False, "bloqueo de bots antes del clic: espero"
        if not pestaña_en_rym():
            return False, "la pestaña salió de https://rateyourmusic.com antes del clic"
        if inactivo_s() < 0.5 and puntero() != p:   # el dueño tocó el ratón en pleno barrido
            return False, "el dueño movió el ratón: cancelo"
        if time.time() < PROXIMO_CLIC_TS:
            time.sleep(PROXIMO_CLIC_TS - time.time())
        if (chequear_muro()[0] or bloqueo_bots() or ventana_activa() != wid or
                not pestaña_en_rym() or puntero() != p or not confirmar_enlace()):
            return False, "cambió la página, el puntero o apareció un bloqueo: cancelo"
        clic_boton()
        ULTIMO_CLIC_TS = time.time()
        PROXIMO_CLIC_TS = ULTIMO_CLIC_TS + random.randint(*INTERVALO)
        nuevo = esperar_titulo(wid, titulo)
        if re.search(ERROR_RE, nuevo, re.I):
            tecla_atras()   # volver a la página de origen, que sí cargaba
            nuevo2 = esperar_titulo(wid, nuevo, seg=10.0)
            return True, f"enlace en ({p[0]},{p[1]}) dio error de carga; volví atrás → «{nuevo2[:45]}»"
        if re.search(BOT_RE, nuevo, re.I):
            return True, f"enlace en ({p[0]},{p[1]}) → reto anti-bots «{nuevo[:45]}» (no lo toco)"
        if not pestaña_en_rym():
            tecla_atras()
            time.sleep(1.5)
            return True, f"enlace en ({p[0]},{p[1]}) salió de https://rateyourmusic.com: volví atrás"
        if nuevo == titulo:
            return True, f"enlace en ({p[0]},{p[1]}) sin cambio de página «{titulo[:45]}»"
        return True, f"enlace en ({p[0]},{p[1]}): «{titulo[:35]}» → «{nuevo[:45]}»"
    finally:
        mover(ox, oy)  # devolver el puntero a donde estaba
        if previa:
            activar(previa)


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
        aviso("🛠️ CRV · «nuevos»: bloqueo de Cloudflare detectado; el cliquer queda en espera "
              "hasta que vuelvan las capturas.")
    elif not walled and ep:
        n = ep.get("clics", 0)
        mins = max(1, (int(time.time()) - ep.get("inicio", int(time.time()))) // 60)
        try:
            os.remove(M_EP)
        except Exception:
            pass
        log(f"episodio cerrado: {n} clics en ~{mins} min")
        aviso(f"✅ CRV · «nuevos»: el bloqueo terminó; el cliquer reanuda sus intentos de enlace.")
        ep = None

    modo = "muro" if walled else "guardia"
    ok, motivo = clickear()
    guardar_guardia(modo, ok, motivo)
    log(f"[{modo}] " + (f"clic: {motivo}" if ok else f"sin clic: {motivo}"))
    if not ok and "usando el equipo" in motivo:
        return random.randint(10, 20)   # reintento corto: en cuanto sueltes el equipo
    if not ok and ("sin pestaña RYM" in motivo or "pausa manual" in motivo):
        return 60                       # nada que hacer en un rato: no molestar al dueño
    if PROXIMO_CLIC_TS and time.time() < PROXIMO_CLIC_TS - 20:
        return max(1, PROXIMO_CLIC_TS - 20 - time.time())
    return 30 if walled else 5


def main():
    modo_test = "--test" in sys.argv
    log("wall-clicker arrancado" + (" (test)" if modo_test else ""))
    if modo_test:
        walled, det = chequear_muro()
        v = ventana_rym()
        ox, oy = puntero()
        mover(ox + 1, oy + 1)
        nx, ny = puntero()
        mover(ox, oy)
        rx, ry = puntero()
        print("walled:", walled, json.dumps({k: (round(x, 1) if isinstance(x, float) else x) for k, x in det.items()}, ensure_ascii=False))
        print("ventana RYM:", v)
        print(f"xtest motion: ({ox},{oy}) -> ({nx},{ny}) -> restaurado ({rx},{ry})")
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
