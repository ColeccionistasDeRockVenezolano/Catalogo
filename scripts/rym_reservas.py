#!/usr/bin/env python3
"""Reservas compartidas de fichas RYM entre las vías de captura (Firefox/puente y Chrome).

Las dos vías escriben en el MISMO `estado.json` y `pages/`, así que sin coordinación pedirían la
misma ficha dos veces (una por navegador). Aquí cada ficha se reclama con un archivo creado de
forma atómica (O_CREAT|O_EXCL) antes de navegar y se libera al terminar. La reserva caduca sola
por TTL, de modo que un proceso muerto no bloquea la ficha para siempre.

Uso:
    import rym_reservas as reservas
    if not reservas.reservar(href, "chrome"):
        continue          # la está trabajando la otra vía
    try:
        ...
    finally:
        reservas.liberar(href)

CLI:
    python3 scripts/rym_reservas.py            # lista reservas vivas
    python3 scripts/rym_reservas.py --limpiar  # purga caducadas
"""
import argparse
import hashlib
import json
import os
import socket
import sys
import time

RESERVAS = os.environ.get("CRV_RYM_RESERVAS", "/tmp/crv-rym-reservas")
TTL = int(os.environ.get("CRV_RYM_RESERVA_TTL", "180"))


def _ruta(href):
    clave = hashlib.sha1(href.encode("utf-8")).hexdigest()[:20]
    return os.path.join(RESERVAS, clave + ".json")


def _leer(ruta):
    try:
        with open(ruta, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def reservar(href, via, ttl=TTL):
    """Reclama `href` para `via`. True si la reserva es nuestra (o estaba caducada)."""
    os.makedirs(RESERVAS, exist_ok=True)
    ruta = _ruta(href)
    datos = json.dumps({"href": href, "via": via, "ts": time.time(),
                        "host": socket.gethostname(), "pid": os.getpid()})
    for _ in range(2):
        try:
            fd = os.open(ruta, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(datos)
            return True
        except FileExistsError:
            previo = _leer(ruta)
            if previo and time.time() - float(previo.get("ts") or 0) < ttl:
                return False
            try:
                os.unlink(ruta)          # caducada o ilegible: se retira y se reintenta
            except OSError:
                return False
    return False


def liberar(href):
    try:
        os.unlink(_ruta(href))
    except OSError:
        pass


def vivas(ttl=TTL):
    """{href: {via, ts, edad, pid}} de las reservas no caducadas."""
    salida = {}
    try:
        nombres = os.listdir(RESERVAS)
    except OSError:
        return salida
    ahora = time.time()
    for nombre in nombres:
        if not nombre.endswith(".json"):
            continue
        datos = _leer(os.path.join(RESERVAS, nombre))
        if not datos or not datos.get("href"):
            continue
        edad = ahora - float(datos.get("ts") or 0)
        if edad < ttl:
            salida[datos["href"]] = {"via": datos.get("via"), "ts": datos.get("ts"),
                                     "edad": round(edad, 1), "pid": datos.get("pid")}
    return salida


def limpiar(ttl=TTL):
    quitadas = 0
    for nombre in os.listdir(RESERVAS) if os.path.isdir(RESERVAS) else []:
        if not nombre.endswith(".json"):
            continue
        ruta = os.path.join(RESERVAS, nombre)
        datos = _leer(ruta)
        if not datos or time.time() - float(datos.get("ts") or 0) >= ttl:
            try:
                os.unlink(ruta)
                quitadas += 1
            except OSError:
                pass
    return quitadas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limpiar", action="store_true")
    ap.add_argument("--ttl", type=int, default=TTL)
    args = ap.parse_args()
    if args.limpiar:
        print("reservas caducadas retiradas:", limpiar(args.ttl))
    vivas_ = vivas(args.ttl)
    print(f"reservas vivas: {len(vivas_)} (ttl {args.ttl}s, dir {RESERVAS})")
    for href, d in sorted(vivas_.items(), key=lambda x: x[1]["edad"]):
        print(f"  {d['via']:<8} {d['edad']:6.1f}s  {href}")


if __name__ == "__main__":
    sys.exit(main())
