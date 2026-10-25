#!/usr/bin/env python3
"""Guardián de la sesión de RYM — 0 LLM.

Problema que resuelve: la `cf_clearance` de Cloudflare caduca cada ~30-60 min. Hasta ahora la
renovaba el Firefox del dueño (él navegando o el cliquer), y el capturador copiaba la cookie de
su perfil. Si el dueño no navegaba, la captura moría con 403 hasta que él abriera RYM.

Aquí un Firefox REAL corre aislado en un X virtual (Xvfb :97, sin tocar el escritorio del dueño),
visita rateyourmusic.com cada pocos minutos —Cloudflare le renueva la clearance sola, igual que a
cualquier humano— y deja una copia consistente de las cookies en /tmp/rym-prof, que es la fuente
que el capturador prefiere. Cuando el capturador ve un 403 toca /tmp/rym-prof-refrescar y el
guardián renueva en ~15 s.

Uso:  python3 ops/rym-resto/keeper.py            (servicio crv-rym-keeper)
"""
import ctypes
import os
import random
import re
import shutil
import sqlite3
import subprocess
import sys
import time

REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano"
DISPLAY = ":97"
PERFIL = os.path.expanduser("~/.cache/crv-rym-keeper/firefox")
DESTINO = "/tmp/rym-prof"
FLAG = "/tmp/rym-prof-refrescar"
LATIDO = f"{REPO}/reports/rym-keeper.latido"
LOG = f"{REPO}/reports/crv-rym-keeper.log"
URL_RYM = "https://rateyourmusic.com/"
REFRESCO = (300, 480)      # s entre visitas normales (la clearance dura ~30-60 min)
REINTENTO = 15             # s entre comprobaciones del flag de refresco urgente
ESPERA_RETO = 12           # s que se le dan al reto de Cloudflare para resolverse solo
ENV = {**os.environ, "DISPLAY": DISPLAY}

X11 = ctypes.CDLL("libX11.so.6")
XTST = ctypes.CDLL("libXtst.so.6")
X11.XOpenDisplay.restype = ctypes.c_void_p
X11.XOpenDisplay.argtypes = [ctypes.c_char_p]
X11.XSetInputFocus.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
X11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
X11.XFlush.argtypes = [ctypes.c_void_p]
X11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
XTST.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
_d = None

# Enfocar una ventana que aún no es «viewable» devuelve BadMatch por el canal de errores de Xlib
# (no es una excepción de Python). Se ignora: el reintento siguiente ya la encuentra mapeada.
_ERROR_CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
X11.XSetErrorHandler.argtypes = [_ERROR_CB]
X11.XSetErrorHandler.restype = ctypes.c_void_p


def _ignorar_error(_dpy, _evento):
    return 0


_IGNORAR = _ERROR_CB(_ignorar_error)


def display():
    global _d
    if _d is None:
        _d = X11.XOpenDisplay(DISPLAY.encode())
        if _d:
            X11.XSetErrorHandler(_IGNORAR)
    return _d


def log(msg):
    linea = f"[{time.strftime('%F %T')}] {msg}\n"
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(linea)
    except OSError:
        pass


def latir():
    try:
        os.makedirs(os.path.dirname(LATIDO), exist_ok=True)
        open(LATIDO, "a").close()
        os.utime(LATIDO, None)
    except OSError:
        pass


def correr(cmd, **kw):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20, **kw)
    except (OSError, subprocess.TimeoutExpired):
        return None


def xvfb_vivo():
    r = correr(["xdpyinfo", "-display", DISPLAY])
    return bool(r and r.returncode == 0)


def asegurar_xvfb():
    if xvfb_vivo():
        return True
    log("arrancando Xvfb " + DISPLAY)
    try:
        subprocess.Popen(["Xvfb", DISPLAY, "-screen", "0", "1280x900x24", "-nolisten", "tcp"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    except OSError as exc:
        log(f"no pude arrancar Xvfb: {exc}")
        return False
    for _ in range(20):
        time.sleep(0.5)
        if xvfb_vivo():
            return True
    return False


def ventana_firefox():
    """(wid, título) de la ventana del NAVEGADOR en el X virtual (hay diálogos con clase Firefox)."""
    r = correr(["xwininfo", "-root", "-tree"], env=ENV)
    if not r or r.returncode != 0:
        return None, ""
    candidatas = []
    for linea in r.stdout.splitlines():
        m = re.search(r'(0x[0-9a-f]+) "([^"]*)".*?(\d+)x(\d+)\+', linea)
        if not m or "firefox" not in linea.lower():
            continue
        ancho, alto = int(m.group(3)), int(m.group(4))
        es_navegador = '"Navigator"' in linea
        candidatas.append((es_navegador, ancho * alto, m.group(1), m.group(2)))
    if not candidatas:
        return None, ""
    candidatas.sort(reverse=True)
    _nav, _area, wid, titulo_ = candidatas[0]
    return wid, titulo_


def titulo(wid):
    r = correr(["xprop", "-id", wid, "_NET_WM_NAME"], env=ENV)
    if not r or r.returncode != 0:
        return ""
    m = re.search(r'= "(.*)"', r.stdout)
    return m.group(1) if m else ""


def abrir_firefox(url=URL_RYM):
    os.makedirs(PERFIL, exist_ok=True)
    user_js = os.path.join(PERFIL, "user.js")
    if not os.path.exists(user_js):
        with open(user_js, "w", encoding="utf-8") as fh:
            fh.write('user_pref("browser.shell.checkDefaultBrowser", false);\n'
                     'user_pref("browser.aboutwelcome.enabled", false);\n'
                     'user_pref("browser.startup.homepage_override.mstone", "ignore");\n'
                     'user_pref("datareporting.policy.dataSubmissionEnabled", false);\n'
                     'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);\n'
                     'user_pref("browser.sessionstore.resume_from_crash", false);\n')
    log("abriendo Firefox del guardián")
    subprocess.Popen(["firefox-esr", "--profile", PERFIL, "--no-remote", "--new-instance", url],
                     env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


def cerrar_firefox():
    correr(["pkill", "-f", f"firefox-esr --profile {PERFIL}"])


def tecla(*keysyms):
    d = display()
    if not d:
        return False
    for k in keysyms:
        code = X11.XKeysymToKeycode(d, k)
        XTST.XTestFakeKeyEvent(d, code, 1, 0)
        XTST.XTestFakeKeyEvent(d, code, 0, 0)
    X11.XFlush(d)
    return True


def enfocar(wid):
    """Sin gestor de ventanas: el foco se da a mano (en el escritorio lo haría XFCE).

    La ventana puede tardar en estar «viewable»; se reintenta y los BadMatch se ignoran.
    """
    d = display()
    if not d:
        return False
    for _ in range(6):
        X11.XSetInputFocus(d, int(wid, 16), 2, 0)
        X11.XSync(d, 0)
        time.sleep(0.2)
    return True


def portapapeles(texto):
    """Deja `texto` en el portapapeles de :97. xclip se queda sirviendo la selección, así que
    el proceso NO termina: se espera poco y se comprueba leyéndolo de vuelta."""
    try:
        p = subprocess.Popen(["xclip", "-selection", "clipboard", "-i"], stdin=subprocess.PIPE,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=ENV)
        try:
            p.communicate(texto.encode(), timeout=2)
        except subprocess.TimeoutExpired:
            pass   # sigue vivo como dueño de la selección: es lo correcto
    except OSError:
        return False
    r = correr(["xclip", "-selection", "clipboard", "-o"], env=ENV)
    return bool(r and r.returncode == 0 and (r.stdout or "").strip() == texto)


def navegar(wid, url):
    """Ctrl+L, pegar, Enter en la pestaña del guardián (clipboard propio de :97)."""
    enfocar(wid)
    if not portapapeles(url):
        return False
    tecla(0xFFE3, ord("l"))
    time.sleep(0.15)
    tecla(0xFFE3, ord("v"))
    time.sleep(0.15)
    tecla(0xFF0D)
    return True


def recargar(wid):
    enfocar(wid)
    tecla(0xFFC2)  # F5


def volcar_cookies():
    """Copia las cookies del guardián a /tmp/rym-prof (copia de ficheros, inmune a locks).

    No se usa la API de backup de sqlite: con Firefox escribiendo, `Connection.backup` puede
    quedarse esperando el lock indefinidamente (medido: cuelga el guardián). Copiar el trío
    cookies.sqlite + -wal + -shm es lo mismo que hace el capturador al leer, y sqlite repara
    el diario al abrirlo.
    """
    origen = os.path.join(PERFIL, "cookies.sqlite")
    if not os.path.exists(origen):
        return None
    try:
        os.makedirs(DESTINO, exist_ok=True)
        for suf in ("", "-wal", "-shm"):
            src = origen + suf
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(DESTINO, ".cookies.sqlite.tmp" + suf))
        # El principal, primero; luego el diario. Un -wal viejo con un principal nuevo es peor
        # que no tener diario, así que se limpia antes de mover.
        for suf in ("-wal", "-shm"):
            p = os.path.join(DESTINO, "cookies.sqlite" + suf)
            if os.path.exists(p):
                os.remove(p)
        os.replace(os.path.join(DESTINO, ".cookies.sqlite.tmp"), os.path.join(DESTINO, "cookies.sqlite"))
        for suf in ("-wal", "-shm"):
            tmp = os.path.join(DESTINO, ".cookies.sqlite.tmp" + suf)
            if os.path.exists(tmp):
                os.replace(tmp, os.path.join(DESTINO, "cookies.sqlite" + suf))
        con = sqlite3.connect(os.path.join(DESTINO, "cookies.sqlite"))
        n, cf = con.execute(
            "SELECT count(*), sum(name = 'cf_clearance') FROM moz_cookies "
            "WHERE host LIKE '%rateyourmusic%'").fetchone()
        con.close()
        return n or 0, bool(cf)
    except Exception as exc:
        log(f"no pude volcar cookies: {str(exc)[:120]}")
        return None


def edad_cookies():
    try:
        return time.time() - os.path.getmtime(os.path.join(DESTINO, "cookies.sqlite"))
    except OSError:
        return None


def edad_firefox():
    """Segundos que lleva vivo el Firefox del guardián (0 si no corre)."""
    r = correr(["pgrep", "-f", f"firefox-esr --profile {PERFIL}"])
    if not r or r.returncode != 0 or not (r.stdout or "").strip():
        return 0
    pid = r.stdout.split()[0]
    r2 = correr(["ps", "-o", "etimes=", "-p", pid])
    if not r2 or r2.returncode != 0:
        return 0
    try:
        return int((r2.stdout or "0").strip())
    except ValueError:
        return 0


def abrir_y_esperar():
    """(Re)abre el Firefox del guardián y espera su ventana. Devuelve wid o None."""
    cerrar_firefox()
    time.sleep(1)
    abrir_firefox()
    for _ in range(40):
        time.sleep(1)
        wid, _ = ventana_firefox()
        if wid:
            return wid
    return None


def ciclo(ultima_visita):
    """Una pasada: asegura navegador y, si toca, visita RYM y publica cookies frescas."""
    if not asegurar_xvfb():
        return ultima_visita
    wid, _ = ventana_firefox()
    reciclar = edad_firefox() > 12 * 3600
    if not wid or reciclar:
        if wid and reciclar:
            log("reciclando el Firefox del guardián (12 h de sesión)")
        wid = abrir_y_esperar()
        if not wid:
            log("el Firefox del guardián no abrió")
            return ultima_visita
        log("Firefox del guardián listo")
        ultima_visita = 0.0

    urgente = os.path.exists(FLAG)
    edad = edad_cookies()
    toca = urgente or edad is None or edad >= REFRESCO[0] or time.time() - ultima_visita >= random.uniform(*REFRESCO)
    if not toca:
        return ultima_visita
    if urgente:
        try:
            os.remove(FLAG)
        except OSError:
            pass

    t = titulo(wid)
    reto = re.search(r"un momento|just a moment|attention required|verific", t, re.I)
    if reto or not re.search(r"rateyourmusic|sonemic", t, re.I):
        # Un reto abierto se pasa mejor con una carga limpia del dominio que con F5 sobre el reto.
        navegar(wid, URL_RYM)
        time.sleep(20 if reto else ESPERA_RETO)
    else:
        recargar(wid)
        time.sleep(ESPERA_RETO)
    t = titulo(wid)
    dato = volcar_cookies()
    if dato:
        n, cf = dato
        log(f"cookies publicadas ({n} de RYM · cf_clearance {'sí' if cf else 'NO'}) · ventana «{t[:48]}»")
    else:
        log(f"visita hecha pero sin cookies que publicar · ventana «{t[:48]}»")
    return time.time()


def main():
    log("guardián de sesión RYM arrancado")
    ultima = 0.0
    while True:
        try:
            ultima = ciclo(ultima)
            latir()
        except Exception as exc:
            log(f"ERROR en el ciclo: {type(exc).__name__}: {str(exc)[:150]}")
        time.sleep(REINTENTO)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
