#!/usr/bin/env python3
"""Síntesis de biografías: fusiona la bio actual del catálogo con el perfil MySpace (DeepSeek).

Una llamada por dossier: (a) biografía fusionada en español (reglas de apply-biographies.ts:
sin markdown, sin nombrar fuentes, 40..7000 caracteres, español) y (b) datos extraídos
estructurados (formación, ciudad, miembros, discos, sellos) → datos-extraidos.jsonl.

Convención de la fuente: «..» son caracteres perdidos por el archivado de 2010 (tildes/ñ);
el modelo las repara solo cuando el contexto es inequívoco.

Reanudable (salta caseIds ya presentes). Salida: reports/myspace-2026-10-16/bio-synth/artist-001.jsonl
Uso: python3 scripts/myspace-2026-10-16/04-sintesis.py [--limite N] [--hilos 5]
"""
import argparse
import concurrent.futures as fut
import json
import os
import re
import time
import urllib.request
from pathlib import Path

BASE = Path("reports/myspace-2026-10-16")
DOSS = BASE / "bio-dossiers/myspace.jsonl"
SYNTH = BASE / "bio-synth/artist-001.jsonl"
DATOS = BASE / "datos-extraidos.jsonl"

PROMPT = """Eres editor de un catálogo de rock venezolano. Tienes dos insumos sobre la banda «{banda}»:

1) BIOGRAFÍA ACTUAL del catálogo (puede estar vacía):
{actual}

2) PERFIL DE LA BANDA EN MYSPACE (fuente primaria; snapshot de {anio}):
{fuente}

Tarea: devuelve un JSON con esta forma exacta:
{{"texto": "<biografía fusionada en español>", "sourcesUsed": ["current","myspace"], "note": null, "datos": {{"formacion": <año o null>, "ciudad": "<ciudad o null>", "miembros": [{{"nombre": "", "rol": ""}}], "discos": ["<títulos mencionados>"], "sellos": ["<sellos mencionados>"], "otros": ["<otros datos: premios, giras, anécdotas verificables>"]}}}}

Reglas del texto:
- Español neutro, tono enciclopédico sobrio. Entre 120 y 1500 caracteres.
- Integra los datos del perfil (miembros, formación, ciudad, discografía, influencias, anécdotas) con la biografía actual; CONSERVA todo dato de la actual que el perfil no contradiga; si hay contradicción, mantén el dato de la biografía actual.
- NO inventes nada que no esté en los insumos. Si un dato falta, no lo menciones.
- NO nombres la fuente: nada de «MySpace», «el perfil», «su página», «la web», «el catálogo». Frases como «La banda se formó en 1998 en Ciudad Ojeda» son correctas.
- Nada de Markdown, viñetas, listas ni enlaces. Solo prosa.
- En el perfil, «..» son caracteres perdidos por el archivado («Represi..n»→«Represión», «a..o»→«año», «Rub..n»→«Rubén»): repáralos solo cuando el contexto sea inequívoco; si no puedes, omite la frase.
- Si la biografía actual ya dice todo lo del perfil, amplíala solo con lo nuevo y responde naturalmente.
- Si el perfil es inservible (solo símbolos, separadores o saludos), devuelve "texto": null y "note": "sin datos".
- En "datos", extrae SOLO lo que aparezca en los insumos (nombres tal cual, sin inventar roles)."""


def env(nombre: str) -> str:
    for linea in Path(".env").read_text(encoding="utf-8").splitlines():
        if linea.startswith(nombre + "="):
            return linea.split("=", 1)[1].strip().strip('"')
    return os.environ.get(nombre, "")


def llamar(case: dict, api_key: str, modelo: str, intentos: int = 3) -> dict:
    cuerpo = {
        "model": modelo,
        "messages": [{"role": "user", "content": PROMPT.format(
            banda=case["name"], actual=(case.get("currentText") or "(sin biografía)")[:3000],
            fuente=case["sources"][0]["text"][:4500], anio=(case["sources"][0]["url"] or "")[28:32] or "2010")}],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "max_tokens": 8000,
    }
    for intento in range(1, intentos + 1):
        try:
            req = urllib.request.Request(
                "https://api.deepseek.com/chat/completions",
                data=json.dumps(cuerpo).encode(),
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read().decode())
            eleccion = data["choices"][0]
            contenido = eleccion["message"].get("content") or ""
            if not contenido.strip():
                raise ValueError(f"content vacío (finish {eleccion.get('finish_reason')}, "
                                 f"reasoning {data.get('usage', {}).get('completion_tokens_details', {}).get('reasoning_tokens')})")
            try:
                out = json.loads(contenido)
            except json.JSONDecodeError:
                m = re.search(r"\{.*\}", contenido, re.S)
                if not m:
                    raise
                out = json.loads(m.group(0))
            texto = out.get("texto")
            if isinstance(texto, str):
                texto = re.sub(r"\s+\n", "\n", texto).strip()
                texto = None if len(texto) < 40 else texto
            return {"caseId": case["caseId"], "text": texto, "sourcesUsed": ["current", "myspace"],
                    "note": out.get("note"), "model": modelo, "datos": out.get("datos")}
        except Exception as e:  # noqa: BLE001
            if intento == intentos:
                return {"caseId": case["caseId"], "text": None, "sourcesUsed": [], "note": f"error: {e}", "model": modelo, "datos": None}
            time.sleep(5 * intento)
    return {"caseId": case["caseId"], "text": None, "sourcesUsed": [], "note": "error", "model": modelo, "datos": None}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--hilos", type=int, default=5)
    args = ap.parse_args()
    api_key = env("DEEPSEEK_API_KEY")
    # deepseek-flash razona y agota max_tokens en dossiers grandes (medido: hasta 14k tokens de
    # razonamiento y content vacío); deepseek-chat responde en ~5 s sin divagar.
    modelo = env("DEEPSEEK_MODEL_SINTESIS") or "deepseek-chat"
    if not api_key:
        raise SystemExit("falta DEEPSEEK_API_KEY en .env")

    dossiers = [json.loads(l) for l in DOSS.read_text(encoding="utf-8").splitlines() if l.strip()]
    SYNTH.parent.mkdir(parents=True, exist_ok=True)
    hechos = set()
    if SYNTH.exists():
        for l in SYNTH.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(l)
            except Exception:
                continue
            if item.get("text"):  # los errores se reintentan
                hechos.add(item["caseId"])
    pend = [d for d in dossiers if d["caseId"] not in hechos]
    if args.limite:
        pend = pend[: args.limite]
    print(f"dossiers {len(dossiers)} · hechos {len(hechos)} · pendientes {len(pend)} · modelo {modelo}")

    t0 = time.time()
    resultados = []
    with fut.ThreadPoolExecutor(max_workers=args.hilos) as pool:
        for i, res in enumerate(pool.map(lambda c: llamar(c, api_key, modelo), pend), 1):
            resultados.append(res)
            estado = "ok" if res["text"] else f"sin texto ({res['note']})"
            print(f"  {i}/{len(pend)} {res['caseId']}: {len(res['text'] or '')} chars · {estado}", flush=True)
            with open(SYNTH, "a", encoding="utf-8") as fh:
                fh.write(json.dumps({k: res[k] for k in ("caseId", "text", "sourcesUsed", "note", "model")}, ensure_ascii=False) + "\n")
            if res.get("datos"):
                with open(DATOS, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps({"caseId": res["caseId"], "datos": res["datos"]}, ensure_ascii=False) + "\n")

    ok = sum(1 for r in resultados if r["text"])
    print(f"\nlisto: {ok}/{len(pend)} con texto · {time.time() - t0:.0f}s · {SYNTH}")


if __name__ == "__main__":
    main()
