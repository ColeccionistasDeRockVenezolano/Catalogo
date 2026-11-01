#!/usr/bin/env python3
"""Capturas de referencia del panel abierto por Brian, sin guardar cambios.

Requiere Chrome 144+ con depuración remota autorizada y /admin abierto.
Solo abre ventanas, cambia el idioma temporalmente y restaura el viewport.
"""
import json
import re
import subprocess
from pathlib import Path

OUT = Path.home() / "crv-staging/reports/b6-herra-panel-2026-11"
OUT.mkdir(parents=True, exist_ok=True)
proc = subprocess.Popen(
    ["npx", "-y", "chrome-devtools-mcp@latest", "--auto-connect", "--no-usage-statistics", "--workspace=" + str(OUT)],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
)
serial = 0


def send(message):
    proc.stdin.write(json.dumps(message) + "\n")
    proc.stdin.flush()


def request(method, params):
    global serial
    serial += 1
    send({"jsonrpc": "2.0", "id": serial, "method": method, "params": params})
    while True:
        line = proc.stdout.readline()
        if not line:
            raise RuntimeError("El servidor de Chrome terminó antes de responder")
        result = json.loads(line)
        if result.get("id") != serial:
            continue
        if "error" in result or result.get("result", {}).get("isError"):
            raise RuntimeError(str(result.get("error") or result["result"]["content"]))
        return result["result"]


def tool(name, **arguments):
    return request("tools/call", {"name": name, "arguments": arguments})


def snapshot(page):
    return tool("take_snapshot", pageId=page)["content"][0]["text"]


def find_button(text, label):
    for line in text.splitlines():
        match = re.search(r'uid=(\S+) button "([^"]+)"', line)
        if match and (match.group(2) == label or match.group(2).startswith(label + " ")):
            return match.group(1)
    raise RuntimeError("No se encontró el botón: " + label)


def capture(page, name, full=False):
    tool("take_screenshot", pageId=page, fullPage=full, filePath=str(OUT / (name + ".png")))
    print(name, flush=True)


try:
    request("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "crv-paridad", "version": "1"}})
    send({"jsonrpc": "2.0", "method": "notifications/initialized"})
    listing = tool("list_pages")["content"][0]["text"]
    admin_line = next(line for line in listing.splitlines() if "https://coleccionistasderockvenezolano.com/admin" in line)
    page_id = int(admin_line.split(":", 1)[0])
    labels = {
        "es": [("3.1", "Nueva actividad"), ("3.2", "Nueva etapa"), ("3.3", "Editar actividad"), ("3.4", "Personas y colaboradores"), ("3.5", "Solicitudes pendientes"), ("3.6", "Candidaturas")],
        "en": [("3.1", "New activity"), ("3.2", "New stage"), ("3.3", "Edit activity"), ("3.4", "People and collaborators"), ("3.5", "Pending requests"), ("3.6", "Applications")],
    }
    for lang in ("es", "en"):
        tool("navigate_page", pageId=page_id, type="url", url=f"https://coleccionistasderockvenezolano.com/lang/{lang}?next=%2Fadmin")
        for width, height in ((1440, 900), (390, 844)):
            tool("emulate", pageId=page_id, viewport=f"{width}x{height}x1")
            capture(page_id, f"admin-{lang}-{width}", True)
            for number, label in labels[lang]:
                uid = find_button(snapshot(page_id), label)
                tool("click", pageId=page_id, uid=uid)
                capture(page_id, f"ventana-{number}-{lang}-{width}")
                tool("press_key", pageId=page_id, key="Escape")
finally:
    try:
        if "page_id" in globals():
            tool("emulate", pageId=page_id)
            tool("navigate_page", pageId=page_id, type="url", url="https://coleccionistasderockvenezolano.com/lang/es?next=%2Fadmin")
    finally:
        proc.terminate()
