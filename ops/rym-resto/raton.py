"""Clic de ratón real en la pantalla del dueño (X11/XTEST).

Por qué existe: Cloudflare Turnstile exige entrada *de confianza* (evento del sistema, no
sintético del DOM). Una extensión no puede tocar el iframe de challenges.cloudflare.com
(es de otro origen), pero sí puede leer su rectángulo en la página; el puente recibe esas
coordenadas y aquí se pulsa con XTEST, que el navegador ve como un clic humano auténtico.

Uso desde el puente:  POST /raton {"x": 640, "y": 400, "tipo": "click"|"mover"}
"""
import ctypes
import os
import random
import threading
import time

_CERROJO = threading.Lock()
_CTX = {}


def _libs():
    """Abre X11 una sola vez y devuelve los punteros a Xlib/XTest."""
    if _CTX:
        return _CTX
    x11 = ctypes.CDLL("libX11.so.6")
    xtst = ctypes.CDLL("libXtst.so.6")

    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    x11.XDisplayWidth.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong,
                                  ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong),
                                  ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
                                  ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
                                  ctypes.POINTER(ctypes.c_uint)]
    xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                                          ctypes.c_int, ctypes.c_ulong]
    xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int,
                                          ctypes.c_ulong]
    pantalla = os.environ.get("CRV_RYM_DISPLAY") or os.environ.get("DISPLAY") or ":0"
    dpy = x11.XOpenDisplay(pantalla.encode())
    if not dpy:
        raise RuntimeError(f"no se pudo abrir {pantalla}")
    _CTX.update(x11=x11, xtst=xtst, dpy=dpy, pantalla=pantalla,
                raiz=x11.XDefaultRootWindow(dpy),
                ancho=x11.XDisplayWidth(dpy, 0), alto=x11.XDisplayHeight(dpy, 0))
    return _CTX


def pantalla():
    c = _libs()
    return {"display": c["pantalla"], "ancho": c["ancho"], "alto": c["alto"]}


def posicion():
    """Dónde está ahora mismo el puntero (para arrancar el movimiento desde ahí)."""
    c = _libs()
    r, ch = ctypes.c_ulong(), ctypes.c_ulong()
    rx, ry, wx, wy = (ctypes.c_int() for _ in range(4))
    m = ctypes.c_uint()
    if not c["x11"].XQueryPointer(c["dpy"], c["raiz"], ctypes.byref(r), ctypes.byref(ch),
                                  ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx),
                                  ctypes.byref(wy), ctypes.byref(m)):
        return (0, 0)
    return (rx.value, ry.value)


def _dentro(x, y):
    c = _libs()
    return 0 <= x < c["ancho"] and 0 <= y < c["alto"]


def mover(x, y, pasos=None):
    """Mueve el cursor como una mano: desde donde está, en curva suave y con temblor.

    Un salto recto de 6 pasos (lo que hacía antes) es una firma clarísima de bot y hace que
    reCAPTCHA abra el mosaico de imágenes en vez de dar la casilla por buena.
    """
    c = _libs()
    if not _dentro(x, y):
        raise ValueError(f"coordenada fuera de pantalla: {x},{y}")
    xtst, dpy, x11 = c["xtst"], c["dpy"], c["x11"]
    x0, y0 = posicion()
    dist = ((x - x0) ** 2 + (y - y0) ** 2) ** 0.5
    pasos = pasos or max(8, min(45, int(dist / 22)))
    # Punto de control lateral: da curvatura al trayecto (las rectas perfectas no existen).
    cx = (x0 + x) / 2 + random.uniform(-0.18, 0.18) * (y - y0 or 60)
    cy = (y0 + y) / 2 + random.uniform(-0.18, 0.18) * (x - x0 or 60)
    with _CERROJO:
        for i in range(1, pasos + 1):
            t = i / pasos
            t = t * t * (3 - 2 * t)                    # arranque y frenada suaves
            mx = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x
            my = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y
            xtst.XTestFakeMotionEvent(dpy, -1, int(mx + random.uniform(-1.5, 1.5)),
                                      int(my + random.uniform(-1.5, 1.5)), 0)
            x11.XFlush(dpy)
            time.sleep(random.uniform(0.008, 0.028))
        xtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
        x11.XFlush(dpy)
        # Hover: la mano se para un instante antes de pulsar.
        time.sleep(random.uniform(0.12, 0.34))


def clic(x, y, boton=1, veces=1):
    """Pulsa de verdad en (x, y). Devuelve el punto usado."""
    c = _libs()
    xtst, dpy, x11 = c["xtst"], c["dpy"], c["x11"]
    mover(x, y)
    with _CERROJO:
        for _ in range(max(1, min(veces, 3))):
            xtst.XTestFakeButtonEvent(dpy, boton, 1, 0)
            x11.XFlush(dpy)
            time.sleep(random.uniform(0.06, 0.11))
            xtst.XTestFakeButtonEvent(dpy, boton, 0, 0)
            x11.XFlush(dpy)
            time.sleep(random.uniform(0.12, 0.22))
    return {"x": x, "y": y}
