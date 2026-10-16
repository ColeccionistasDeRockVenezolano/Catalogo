#!/usr/bin/env python3
"""Re-extrae OFFLINE los HTML ya capturados: About corregido (0/146 con el patrón viejo)
y la URL de la default pic (foto de banda). Actualiza el JSONL (con backup) y re-corre el
consolidado y los patrones. No toca Wayback.

Uso: python3 scripts/ma-links-2026-10-16/08-reextrae.py
"""
import importlib.util
import json
import os
import shutil
from pathlib import Path

RAIZ = Path("scripts/ma-links-2026-10-16")
BASE = Path("reports/ma-links-2026-10-15")
JSONL = BASE / "myspace-piloto.jsonl"


def cargar_modulo():
    spec = importlib.util.spec_from_file_location("mp05", str(RAIZ / "05-myspace-piloto.py"))
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    mp = cargar_modulo()
    registros: dict[str, dict] = {}
    for linea in JSONL.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(linea)
        except Exception:
            continue
        registros[str(r.get("slug") or r.get("ma_id"))] = r

    actualizados = 0
    abouts = 0
    fotos = 0
    for r in registros.values():
        archivo = r.get("archivo")
        if not archivo or not Path(archivo).exists():
            continue
        src = Path(archivo).read_text(encoding="utf-8", errors="replace")
        datos = mp.extraer(src)
        r["titulo"] = datos["titulo"][:200]
        r["campos"] = datos["campos"]
        r["no_ascii"] = sum(1 for c in src[:200000] if ord(c) > 127)
        r["plantilla"] = "clasica" if datos["campos"] else ("moderna" if "MySpace" in datos["titulo"] else "otra")
        foto = mp.foto_default(src)
        if foto:
            r["foto_url"] = foto
            fotos += 1
        if datos["campos"].get("About"):
            abouts += 1
        actualizados += 1

    shutil.copy2(JSONL, str(JSONL) + ".bak")
    with open(JSONL, "w", encoding="utf-8") as fh:
        for r in registros.values():
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"registros: {len(registros)} · con HTML re-extraídos: {actualizados}")
    print(f"  con About recuperado: {abouts}")
    print(f"  con URL de foto de perfil: {fotos}")
    print("  backup:", str(JSONL) + ".bak")


if __name__ == "__main__":
    main()
