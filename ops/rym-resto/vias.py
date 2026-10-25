#!/usr/bin/env python3
"""Control y vigilancia de las vías de captura RYM «resto» — sin hardcode.

Todo lo que define una vía (unidades systemd, scripts, health-check, latido, freno, log) vive en
`ops/rym-resto/vias.json`. Este módulo es la única implementación de las acciones —reanudar,
pausar, reparar— y de la vigilancia; lo usan el panel web (`control.py`), el centinela y la CLI.

CLI:
    python3 ops/rym-resto/vias.py --estado            # JSON con todas las vías y el progreso
    python3 ops/rym-resto/vias.py --accion reanudar --via chrome
    python3 ops/rym-resto/vias.py --accion pausar --via todas
    python3 ops/rym-resto/vias.py --accion reparar --via firefox
    python3 ops/rym-resto/vias.py --vigilar [--via chrome]
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_PATH = os.path.join(REPO, "ops", "rym-resto", "vias.json")
sys.path.insert(0, os.path.join(REPO, "scripts"))


# ── configuración ────────────────────────────────────────────────────────────────────────────────
def config():
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def ruta(rel):
    if not rel:
        return rel
    return rel if os.path.isabs(rel) else os.path.join(REPO, rel)


def vias(cfg=None, solo=None):
    """Nombres de vía a operar: None/ambas = automáticas; todas = también las de solo_manual."""
    cfg = cfg or config()
    nombres = list(cfg["vias"].keys())
    if solo in (None, "", "ambas"):
        return [n for n in nombres if not cfg["vias"][n].get("solo_manual")]
    if solo in ("todas", "all"):
        return nombres
    return [solo] if solo in cfg["vias"] else []


# ── sondas ──────────────────────────────────────────────────────────────────────────────────────
def _run(cmd, timeout=25):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)


def unidad_activa(unidad):
    if not unidad:
        return None
    return _run(["systemctl", "--user", "is-active", "--quiet", unidad])[0] == 0


def salud_ok(url, timeout=4):
    if not url:
        return None
    try:
        import urllib.request
        with urllib.request.urlopen(url, timeout=timeout) as r:
            cuerpo = r.read(400).decode("utf-8", "ignore")
        return r.status == 200 and ("Browser" in cuerpo or '"ok"' in cuerpo or "rateyourmusic" in cuerpo)
    except Exception:
        return False


def latido_edad(rel):
    r = ruta(rel) if rel else None
    if not r or not os.path.exists(r):
        return None
    return int(time.time() - os.path.getmtime(r))


def _json(rel):
    try:
        with open(ruta(rel), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError, TypeError):
        return {}


def progreso(cfg=None):
    """Capturadas / pendientes / hoy, con las mismas reglas que el tablero (sin cache entre llamadas)."""
    cfg = cfg or config()
    import rym_reglas as reglas
    outdir = ruta(cfg["outdir"])
    estado, fuente = reglas.cargar_estado(os.path.join(outdir, "estado.json"))
    cola_path = os.path.join(outdir, "cola-artistas.jsonl")
    try:
        cola = reglas.cargar_cola(cola_path)
    except Exception:
        cola = []
    try:
        discos = reglas.discos_de_artistas(cola, os.path.join(outdir, "pages"))
        prog = reglas.progreso(estado, cola, discos)
    except Exception:
        prog = {}
    ini = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
    hoy = sum(1 for v in estado.values() if isinstance(v, dict) and (v.get("ts") or 0) >= ini)
    return {"capturadas": len(estado), "hoy": hoy, "fuente_estado": fuente,
            "todas": prog.get("todas"), "hechos": prog.get("hechos"),
            "faltan": prog.get("faltan"), "limite_dia": cfg.get("limite_dia")}


def estado_via(nombre, cfg=None):
    cfg = cfg or config()
    v = cfg["vias"][nombre]
    cap = v.get("capturador") or {}
    nav = v.get("navegador") or {}
    lat = _json(v.get("latido")) if str(v.get("latido", "")).startswith("/tmp") else {}
    activa = unidad_activa(cap.get("unidad"))
    edad = latido_edad(v.get("latido"))
    tope = int((v.get("vigilancia") or {}).get("latido_min") or 15) * 60
    return {
        "via": nombre,
        "etiqueta": v.get("etiqueta", nombre),
        "detalle": v.get("detalle", ""),
        "capturador": {"unidad": cap.get("unidad"), "activa": activa, "log": cap.get("log"),
                       "pasada": bool(cap.get("pasada"))},
        "navegador": {"unidad": nav.get("unidad"), "activo": unidad_activa(nav.get("unidad")),
                      "salud": salud_ok(nav.get("salud"))} if nav else None,
        "frenada": os.path.exists(ruta(v["freno"])) if v.get("freno") else False,
        "latido_edad": edad,
        # Una pasada que terminó sin dejar la unidad viva sigue sana si su latido es reciente.
        "fresco": bool(edad is not None and edad <= tope),
        "latido_estado": lat.get("estado") or lat.get("motivo"),
        "hechos_sesion": lat.get("hechos"),
        "ultimo": lat.get("ultimo"),
    }


def estado(cfg=None):
    cfg = cfg or config()
    import rym_reservas as reservas
    vivas = reservas.vivas(int((cfg.get("reservas") or {}).get("ttl", 180)))
    por_via = {}
    for href, d in vivas.items():
        por_via[d.get("via") or "?"] = por_via.get(d.get("via") or "?", 0) + 1
    return {
        "ts": int(time.time()),
        "progreso": progreso(cfg),
        "reservas": {"total": len(vivas), "por_via": por_via},
        "vias": {n: estado_via(n, cfg) for n in cfg["vias"]},
        "panel": cfg.get("panel"),
    }


# ── acciones ────────────────────────────────────────────────────────────────────────────────────
def _freno(v, motivo):
    r = ruta(v.get("freno") or "")
    if not r:
        return
    os.makedirs(os.path.dirname(r), exist_ok=True)
    with open(r, "w", encoding="utf-8") as fh:
        fh.write(f"{motivo} · {time.strftime('%F %T')}\n")


def _quitar_freno(v):
    r = ruta(v.get("freno") or "")
    try:
        os.unlink(r)
    except (OSError, TypeError):
        pass


def _lanzar(cap):
    unidad, script = cap.get("unidad"), ruta(cap.get("script"))
    if not script or not os.path.exists(script):
        return False, f"script inexistente: {script}"
    if cap.get("runner") == "script":
        subprocess.Popen(["bash", script], cwd=REPO, start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True, f"{os.path.basename(script)} lanzado"
    rc, out = _run(["systemd-run", "--user", f"--unit={unidad}", "--collect",
                    f"--working-directory={REPO}", "/bin/bash", script])
    return rc == 0, (out.strip().splitlines() or [""])[-1]


def _puerto_de(url):
    try:
        from urllib.parse import urlparse
        p = urlparse(url or "")
        return p.port or (443 if p.scheme == "https" else 80)
    except ValueError:
        return None


def _pids_en_puerto(puerto):
    rc, out = _run(["ss", "-ltnpH", f"sport = :{int(puerto)}"], timeout=10)
    return sorted({int(m) for m in re.findall(r"pid=(\d+)", out)})


def _liberar_puerto(puerto, espera=8):
    """Suelta el puerto matando a quien escuche en él.

    Hace falta cuando el navegador quedó fuera de su unidad (relanzado a mano o reparentado):
    `systemctl stop` no toca ese proceso y el puerto sigue ocupado, así que el reinicio no puede
    engancharse al CDP/puente nuevo. Medido 2026-10-20: por esto «Reparar» fallaba en ambas vías.
    """
    pids = _pids_en_puerto(puerto)
    if not pids:
        return True, "puerto libre"
    for sig in ("TERM", "KILL"):
        for pid in pids:
            _run(["kill", f"-{sig}", str(pid)], timeout=5)
        fin = time.time() + espera / 2
        while time.time() < fin:
            if not _pids_en_puerto(puerto):
                return True, f"puerto {puerto} liberado (procesos {', '.join(map(str, pids))})"
            time.sleep(0.5)
    return False, f"el proceso del puerto {puerto} no murió"


def _parar_navegador(nav):
    """Detiene el navegador y deja su puerto de salud libre, esté o no dentro de su unidad."""
    if not nav:
        return True, "sin navegador propio"
    if nav.get("unidad"):
        _run(["systemctl", "--user", "stop", nav["unidad"]], timeout=20)
    # Esperar a que el puerto CAIGA de verdad: si se relanza con el proceso viejo aún vivo,
    # el script sale por su guardia («ya está arriba») y el capturador nuevo se queda sin CDP.
    fin = time.time() + 15
    while time.time() < fin and salud_ok(nav.get("salud"), timeout=2):
        time.sleep(1)
    if salud_ok(nav.get("salud"), timeout=2):
        puerto = _puerto_de(nav.get("salud"))
        if puerto:
            ok, msg = _liberar_puerto(puerto)
            if not ok:
                return False, msg
            return True, f"unidad no lo soltó; {msg}"
        return False, "el navegador viejo sigue en el puerto: no se pudo reiniciar"
    return True, "navegador detenido"


def _asegurar_navegador(nav, forzar=False):
    if not nav:
        return True, "sin navegador propio"
    if not forzar and salud_ok(nav.get("salud")):
        return True, "navegador ya responde"
    if forzar:
        ok, msg = _parar_navegador(nav)
        if not ok:
            return False, msg
    script = ruta(nav.get("script"))
    if not script or not os.path.exists(script):
        return False, f"script inexistente: {script}"
    unidad = nav.get("unidad")
    extra = ["--force"] if forzar else []
    if unidad and nav.get("runner") == "systemd-run":
        # Bajo su propia unidad el cgroup se lleva por delante puente y navegador: un solo
        # `systemctl stop` los apaga y no quedan huérfanos ocupando el puerto.
        _run(["systemctl", "--user", "reset-failed", unidad], timeout=10)
        rc, out = _run(["systemd-run", "--user", f"--unit={unidad}", "--collect",
                        f"--working-directory={REPO}", "/bin/bash", script, *extra], timeout=25)
        if rc != 0:
            return False, (out.strip().splitlines() or ["systemd-run falló"])[-1]
    else:
        # chrome.sh se registra él mismo en su unidad y se niega a reiniciarse si el CDP sigue
        # arriba: se lanza suelto y su guardia decide.
        subprocess.Popen(["bash", script, *extra], cwd=REPO, start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    fin = time.time() + int(nav.get("espera_s") or 30)
    while time.time() < fin:
        if salud_ok(nav.get("salud")):
            return True, "navegador arriba"
        time.sleep(2)
    return False, "el navegador no respondió a tiempo"


def _parar_capturador(cap):
    if cap.get("unidad"):
        _run(["systemctl", "--user", "stop", cap["unidad"]], timeout=25)


def _mtime_log(cap):
    r = ruta(cap.get("log") or "")
    try:
        return os.path.getmtime(r)
    except (OSError, TypeError):
        return None


def _arrancado(cap, desde=None, espera=10):
    """True si el capturador quedó vivo o, siendo de una pasada, ya escribió en su log.

    `is-active` a los 2 s no sirve para los capturadores de una pasada: la cola del puente puede
    terminar en segundos y el panel los daba por fallidos aunque hubieran corrido. (2026-10-20)
    """
    fin = time.time() + espera
    while True:
        if unidad_activa(cap.get("unidad")):
            return True
        m = _mtime_log(cap)
        if m is not None and (desde is None or m > desde):
            return True
        if time.time() >= fin:
            return False
        time.sleep(1)


def reanudar(nombre, cfg=None):
    cfg = cfg or config()
    v = cfg["vias"][nombre]
    cap = v.get("capturador") or {}
    pasos = []
    _quitar_freno(v)
    pasos.append("freno retirado")
    ok, msg = _asegurar_navegador(v.get("navegador"))
    pasos.append(msg)
    if not ok:
        return {"ok": False, "via": nombre, "pasos": pasos}
    if unidad_activa(cap.get("unidad")):
        pasos.append("capturador ya estaba activo")
        return {"ok": True, "via": nombre, "pasos": pasos}
    desde = _mtime_log(cap)
    ok, msg = _lanzar(cap)
    pasos.append(msg)
    vivo = bool(ok and _arrancado(cap, desde))
    pasos.append("capturador en marcha" if vivo else "el capturador no arrancó")
    return {"ok": vivo, "via": nombre, "pasos": pasos}


def pausar(nombre, cfg=None):
    cfg = cfg or config()
    v = cfg["vias"][nombre]
    cap = v.get("capturador") or {}
    _freno(v, "pausa desde el panel")
    _parar_capturador(cap)
    return {"ok": not unidad_activa(cap.get("unidad")), "via": nombre,
            "pasos": ["freno puesto", "capturador detenido"]}


def reparar(nombre, cfg=None):
    """Parada + navegador reiniciado + reservas caducadas purgadas + capturador relanzado."""
    cfg = cfg or config()
    v = cfg["vias"][nombre]
    cap = v.get("capturador") or {}
    pasos = []
    _quitar_freno(v)
    _parar_capturador(cap)
    pasos.append("capturador detenido")
    ok, msg = _asegurar_navegador(v.get("navegador"), forzar=True)
    pasos.append(msg)
    if not ok:
        return {"ok": False, "via": nombre, "pasos": pasos}
    try:
        import rym_reservas as reservas
        reservas.limpiar(0)
        pasos.append("reservas caducadas purgadas")
    except Exception:
        pass
    desde = _mtime_log(cap)
    ok, msg = _lanzar(cap)
    pasos.append(msg)
    vivo = bool(ok and _arrancado(cap, desde))
    pasos.append("capturador en marcha" if vivo else "el capturador no arrancó")
    return {"ok": vivo, "via": nombre, "pasos": pasos}


ACCIONES = {"reanudar": reanudar, "pausar": pausar, "reparar": reparar}


def accion(nombre_accion, via="todas", cfg=None):
    cfg = cfg or config()
    fn = ACCIONES.get(nombre_accion)
    if not fn:
        return {"ok": False, "error": f"acción desconocida: {nombre_accion}"}
    resultados = [fn(n, cfg) for n in vias(cfg, via)]
    return {"ok": all(r.get("ok") for r in resultados), "accion": nombre_accion,
            "via": via, "resultados": resultados}


# ── vigilancia (centinela) ──────────────────────────────────────────────────────────────────────
def _avisar(msg, clave="gen", min_gap=1800):
    """Aviso por Telegram con anti-spam por clave (el centinela corre cada 5 min)."""
    marca = ruta(f"reports/crv-marcas/vias-aviso-{clave}")
    try:
        if os.path.exists(marca) and time.time() - os.path.getmtime(marca) < min_gap:
            return
        os.makedirs(os.path.dirname(marca), exist_ok=True)
        open(marca, "a").close()
        os.utime(marca, None)
    except OSError:
        pass
    script = ruta("scripts/rym-etapa3-avisos.sh")
    if os.path.exists(script):
        _run(["timeout", "30", "bash", script, msg], timeout=40)


def _uptime_horas(unidad):
    rc, out = _run(["systemctl", "--user", "show", unidad, "-p", "ActiveEnterTimestamp", "--value"])
    txt = (out or "").strip()
    if rc != 0 or not txt:
        return None
    try:
        import calendar
        import time as _t
        arranque = calendar.timegm(_t.strptime(txt, "%a %Y-%m-%d %H:%M:%S %Z"))
        return max(0.0, (_t.time() - arranque) / 3600)
    except Exception:
        return None


def _log_colgado(log, regla):
    """True si el tramo reciente del log tiene errores de navegación y NINGUNA captura."""
    ruta_log = ruta(log) if log else None
    if not ruta_log or not os.path.exists(ruta_log):
        return False
    try:
        lineas = open(ruta_log, encoding="utf-8", errors="ignore").read().splitlines()[-int(regla.get("lineas") or 60):]
    except OSError:
        return False
    patrones = [re.compile(p) for p in regla.get("patrones") or []]
    errores = sum(1 for l in lineas if any(p.search(l) for p in patrones))
    captura = re.compile(regla.get("captura") or r"^\[[0-9:]{8}\] \+ \[")
    capturas = sum(1 for l in lineas if captura.search(l))
    return errores >= int(regla.get("min") or 2) and capturas == 0


def vigilar(solo=None, cfg=None, avisar=None):
    """Relanza lo que deba estar corriendo y no lo está. Respeta frenos y estados terminales.

    Devuelve la lista de acciones tomadas (texto). `avisar(msg)` opcional para Telegram.
    """
    cfg = cfg or config()
    avisar = avisar or _avisar
    hechas = []
    for nombre in vias(cfg, solo):
        v = cfg["vias"][nombre]
        vig = v.get("vigilancia") or {}
        # Las vías de solo manual no se resucitan solas… salvo que se pidan por su nombre.
        if v.get("solo_manual") and solo != nombre:
            continue
        if v.get("freno") and os.path.exists(ruta(v["freno"])):
            continue
        cap, nav = v.get("capturador") or {}, v.get("navegador") or {}
        if nav and not salud_ok(nav.get("salud")):
            ok, msg = _asegurar_navegador(nav)
            hechas.append(f"{nombre}: {msg}")
            if not ok:
                continue
        if not unidad_activa(cap.get("unidad")):
            lat = _json(v.get("latido")) if str(v.get("latido", "")).startswith("/tmp") else {}
            if (lat.get("estado") or "") in ("completo", "tope"):
                continue
            ok, msg = _lanzar(cap)
            hechas.append(f"{nombre}: capturador relanzado ({msg})")
            if ok and avisar:
                avisar(f"🛟 CRV · RYM/{nombre}: el capturador estaba caído; lo relancé solo.", nombre)
            continue
        edad = latido_edad(v.get("latido"))
        tope = int(vig.get("latido_min") or v.get("latido_min") or 15) * 60
        if edad is not None and edad >= tope:
            _parar_capturador(cap)
            time.sleep(1)
            ok, msg = _lanzar(cap)
            hechas.append(f"{nombre}: reiniciado (latido de {edad // 60} min)")
            if avisar:
                avisar(f"🛟 CRV · RYM/{nombre}: capturador colgado ({edad // 60} min sin latido); reiniciado.",
                       nombre)
            continue
        # Navegador vivo pero inútil: errores de navegación sin ninguna captura en el tramo.
        regla_log = vig.get("log_errores")
        if regla_log and _log_colgado(cap.get("log"), regla_log):
            _parar_capturador(cap)
            time.sleep(2)
            ok, msg = _lanzar(cap)
            hechas.append(f"{nombre}: reiniciado (navegador colgado, sin capturas en el tramo)")
            if avisar:
                avisar(f"🛟 CRV · RYM/{nombre}: el navegador estaba colgado; reiniciado.", nombre)
            continue
        # Reciclaje por higiene de sesiones muy largas (sin aviso: es mantenimiento).
        horas = vig.get("reciclar_horas")
        uptime = _uptime_horas(cap.get("unidad")) if horas else None
        if horas and uptime and uptime >= float(horas):
            _parar_capturador(cap)
            time.sleep(2)
            ok, msg = _lanzar(cap)
            hechas.append(f"{nombre}: reciclado por higiene ({uptime:.0f} h de navegador)")
    return hechas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--estado", action="store_true")
    ap.add_argument("--accion", choices=sorted(ACCIONES))
    ap.add_argument("--via", default="todas")
    ap.add_argument("--vigilar", action="store_true")
    args = ap.parse_args()
    if args.accion:
        print(json.dumps(accion(args.accion, args.via), ensure_ascii=False))
        return 0
    if args.vigilar:
        hechas = vigilar(args.via if args.via != "todas" else None)
        for h in hechas:
            print(time.strftime("[%F %T]"), h)
        return 0
    print(json.dumps(estado(), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
