#!/usr/bin/env python3
"""Convierte los documentos de la landing a rutas relativas a la base inyectada.

El servidor inserta <base href="/crv/"> (o "/" en la raíz) en cada documento.
Desde entonces las rutas deben ser `api/...`, `roadmap`, `colaborar`…, nunca
`../api/...` ni `../roadmap`: bajo el Funnel `..` sale al host equivocado.
"""
from pathlib import Path

LANDING = Path(__file__).resolve().parents[1] / "web" / "public" / "landing"

for path in sorted(LANDING.glob("*.html")):
    text = path.read_text(encoding="utf-8")
    text = text.replace('href="../', 'href="')
    text = text.replace('action="../', 'action="')
    for attr in ("data-radio-api", "data-radio-listener-api", "data-radio-unavailable-api", "data-visits-url"):
        text = text.replace(f'{attr}="../api/', f'{attr}="api/')
    path.write_text(text, encoding="utf-8")
    print(f"html {path.name}")

for path in sorted(LANDING.glob("*.js")):
    text = path.read_text(encoding="utf-8")
    text = text.replace('"../api/', '"api/')
    text = text.replace('new URL("../roadmap"', 'new URL("roadmap"')
    text = text.replace('href="../roadmap"', 'href="roadmap"')
    text = text.replace('or "../api/radio/now"', 'or "api/radio/now"')
    path.write_text(text, encoding="utf-8")
    print(f"js   {path.name}")
