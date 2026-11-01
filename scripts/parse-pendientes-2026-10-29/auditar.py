#!/usr/bin/env python3
"""Auditoría de parseo del almacén Shared — 2026-10-29.

Cruza cada carpeta de campaña de `data/raw` y `data/research` contra las dos
evidencias reales de parseo que mantiene el proyecto:

  1. runs del operador en PostgreSQL (`ingest.scrape_runs`): la nota libre del
     run es el único registro que dice qué campaña se aplicó y cuándo;
  2. informes de cierre en `reports/` y artefactos dentro de la propia carpeta
     (CIERRE/APLICACION/INFORME/REPORT/NOTAS + extract.jsonl, structured/, etc.).

No modifica nada. Escribe CSV + INFORME.md en el directorio que se le pase.

Uso:
    python3 scripts/parse-pendientes-2026-10-29/auditar.py <salida>
"""
from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
import unicodedata
from collections import Counter

STORE = "/mnt/1tb/Shared/coleccionistas-rock-venezolano"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

GENERIC = {
    "deep", "hermes", "raw", "data", "research", "crv", "lote", "campana",
    "ronda", "final", "cierre", "informe", "aplicacion", "control", "extra",
    "resto", "cola", "plan", "nuevos", "nuevo", "profundo", "reparado",
    "completar", "ampliacion", "adicional", "complementarios", "auditoria",
    "correcciones", "importacion", "recuperacion", "originales", "captures",
    "originals", "ocr", "pages", "html", "jsonl", "media", "images",
    "venezuela", "venezolano", "venezolana", "venezolanos", "rock",
}

HASH_RE = re.compile(r"^[0-9a-f]{32,64}\.")
HDR_RE = re.compile(r"^[0-9a-f]{32,64}\..*\.headers\.json$")
CAP_EXT = {".html", ".htm", ".json", ".xml", ".gz", ".pdf", ".bin", ".txt", ".mhtml"}
DOC_RE = re.compile(
    r"^(CIERRE|APLICACION|INFORME|REPORT|NOTAS|COBERTURA|VERIFICACION|README|"
    r"RESUMEN|ANALISIS|REPORTE|DECISIONES)\b.*\.md$",
    re.I,
)
OUT_ARTIFACTS = {
    "extract.jsonl", "posts.jsonl", "pages.jsonl", "links.jsonl", "images.jsonl",
    "comments.jsonl", "index.jsonl", "reviews.jsonl", "tareas.jsonl", "resultados.jsonl",
    "fichas.jsonl", "artistas.jsonl", "albumes.jsonl", "corpus.jsonl",
    "dossier_discos_nuevos.json", "resumen.json", "summary.json",
    "structured", "derived", "aplicacion", "extracted", "aplicados", "propuestas",
    "claims", "consolidado", "mirror", "reparsed", "catalogo", "catalogue.json",
    "cerrado.flag", "verify.json", "parser-validation.json",
}
POLICY_EXCLUDED = ("rym-reviews",)


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


def tokens(name: str) -> list[str]:
    out = []
    for t in re.split(r"[-_.\s]+", fold(name)):
        if len(t) < 4 or t in GENERIC:
            continue
        if re.fullmatch(r"(19|20)\d\d", t):
            continue
        out.append(t)
    if not out:
        # carpetas como hermes-auditoria-importacion: todos sus tokens eran
        # genéricos; usar las palabras largas para no perder la atribución.
        out = [t for t in re.split(r"[-_.\s]+", fold(name)) if len(t) >= 5]
    return out


def walk_stats(path: str) -> tuple[int, Counter, int]:
    """Archivos totales, extensiones y nº de capturas con nombre-hash."""
    total = 0
    exts: Counter = Counter()
    hashed = 0
    stack = [path]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                            continue
                    except OSError:
                        continue
                    total += 1
                    if HASH_RE.match(e.name) and not HDR_RE.match(e.name):
                        hashed += 1
                    ext = os.path.splitext(e.name)[1].lower()
                    exts[ext] += 1
        except OSError:
            continue
    return total, exts, hashed


def top_entries(path: str, limit: int = 4000) -> list[str]:
    try:
        return os.listdir(path)[:limit]
    except OSError:
        return []


def database_url() -> str:
    env = os.path.join(REPO, ".env")
    url = ""
    with open(env, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
                break
    if not url:
        raise SystemExit("DATABASE_URL no encontrada en .env")
    # dentro del contenedor PostgreSQL escucha en 5432
    return re.sub(r":\d+/", ":5432/", url, count=1)


def load_runs() -> list[dict]:
    sql = (
        "select r.id, r.started_at::date, r.status::text, coalesce(r.params->>'action',''), "
        "coalesce(r.params->>'note',''), coalesce(r.counters::text,'{}') "
        "from ingest.scrape_runs r where r.started_at >= '2026-09-01' order by r.id"
    )
    out = subprocess.run(
        ["docker", "exec", "crv-postgres", "psql", database_url(), "-tA", "-F", "\t", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout
    runs = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 6:
            continue
        runs.append({
            "id": parts[0], "date": parts[1], "status": parts[2],
            "action": parts[3], "note": fold(parts[4]),
            "counters": parts[5],
        })
    return runs


def load_sources() -> list[dict]:
    sql = (
        "select s.slug, count(r.id), coalesce(max(r.finished_at)::date::text,'') "
        "from ingest.sources s left join ingest.scrape_runs r on r.source_id = s.id "
        "group by 1 order by 2 desc"
    )
    out = subprocess.run(
        ["docker", "exec", "crv-postgres", "psql", database_url(), "-tA", "-F", "\t", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        rows.append({"slug": parts[0], "runs": int(parts[1] or 0), "last": parts[2]})
    return rows


APPLIED_RE = re.compile(r"aplic|cerrad|incorpor|fusion|import|completad|corregid")


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "reports", "parse-pendientes-2026-10-29")
    os.makedirs(outdir, exist_ok=True)

    reports_dir = os.path.join(STORE, "reports")
    reports = sorted(os.listdir(reports_dir)) if os.path.isdir(reports_dir) else []
    reports_norm = [(r, fold(r)) for r in reports]

    print("cargando runs del operador…", flush=True)
    runs = load_runs()
    print(f"runs desde 2026-09-01: {len(runs)}", flush=True)
    sources = load_sources()

    rows = []
    for layer in ("data/raw", "data/research"):
        root = os.path.join(STORE, layer)
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            path = os.path.join(root, name)
            if not os.path.isdir(path):
                continue
            total, exts, hashed = walk_stats(path)
            entries = top_entries(path)
            artifacts = sorted({e for e in entries if e in OUT_ARTIFACTS})
            docs = sorted({e for e in entries if DOC_RE.match(e)})
            toks = tokens(name)

            hit_tokens: list[str] = []
            matched = []
            for r in runs:
                hits = [t for t in toks if t in r["note"]]
                if hits:
                    matched.append(r)
                    for h in hits:
                        if h not in hit_tokens:
                            hit_tokens.append(h)
            applied = [r for r in matched if APPLIED_RE.search(r["note"]) or r["counters"] not in ("{}", "")]
            last = max((r["date"] for r in matched), default="")

            rep_hits = [r for r, rn in reports_norm if any(t in rn for t in toks)] if toks else []

            stem = re.sub(r"-(19|20)\d\d-\d\d-\d\d[a-z]?$", "", fold(name))
            src = next((s for s in sources if s["slug"] in (stem, fold(name))), None)
            src_runs = src["runs"] if src else 0
            src_last = src["last"] if src else ""

            if name.startswith(POLICY_EXCLUDED):
                state = "excluida_politica"
            elif applied:
                state = "aplicada"
            elif src_runs:
                state = "aplicada_fuente"
            elif matched or rep_hits or docs or artifacts:
                state = "evidencia_parcial"
            else:
                state = "sin_evidencia"

            rows.append({
                "capa": layer.replace("data/", ""),
                "carpeta": name,
                "archivos": total,
                "capturas_hash": hashed,
                "artefactos": ";".join(artifacts[:6]),
                "docs": ";".join(docs[:4]),
                "runs_match": len(matched),
                "runs_aplicados": len(applied),
                "runs_fuente": src_runs,
                "ultimo_run": last or src_last,
                "informes_match": ";".join(rep_hits[:3]),
                "match_tokens": ";".join(hit_tokens[:5]),
                "estado": state,
                "extensiones": ";".join(f"{k or 'sx'}:{v}" for k, v in exts.most_common(4)),
            })
            print(f"  {layer}/{name}: {state} ({total} archivos, {len(applied)} runs)", flush=True)

    rows.sort(key=lambda r: (r["estado"] != "sin_evidencia", -r["archivos"]))
    csv_path = os.path.join(outdir, "parse-pendientes.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    counts = Counter(r["estado"] for r in rows)
    pend = [r for r in rows if r["estado"] == "sin_evidencia"]
    parcial = [r for r in rows if r["estado"] == "evidencia_parcial"]
    aplic = [r for r in rows if r["estado"] == "aplicada"]
    aplic_fuente = [r for r in rows if r["estado"] == "aplicada_fuente"]
    excl = [r for r in rows if r["estado"] == "excluida_politica"]

    def table(rs: list[dict]) -> str:
        head = ("| capa | carpeta | archivos | capturas-hash | runs aplicados | runs de la fuente | último run | tokens del match | evidencia local |\n"
                "|---|---|---:|---:|---:|---:|---|---|---|\n")
        body = "".join(
            f"| {r['capa']} | {r['carpeta']} | {r['archivos']} | {r['capturas_hash']} | "
            f"{r['runs_aplicados']} | {r['runs_fuente']} | {r['ultimo_run'] or '—'} | {r['match_tokens'] or '—'} | "
            f"{(r['informes_match'] or r['docs'] or r['artefactos'] or '—')[:70]} |\n"
            for r in rs
        )
        return head + body

    md = [
        "# Auditoría de parseo de Shared — 2026-10-29\n",
        f"Carpetas censadas: **{len(rows)}** ({counts.get('aplicada',0)} aplicadas por run de campaña, "
        f"{counts.get('aplicada_fuente',0)} aplicadas por run de fuente, "
        f"{counts.get('evidencia_parcial',0)} con evidencia parcial, "
        f"{counts.get('sin_evidencia',0)} sin evidencia, {counts.get('excluida_politica',0)} excluidas por política).\n",
        "Método: censo de archivos por carpeta (solo `readdir`, sin leer contenido) cruzado contra los runs de "
        "`ingest.scrape_runs` (nota y counters) y contra `reports/`. Un run se atribuye a una carpeta por "
        "coincidencia de tokens del nombre; los genéricos (`deep`, `hermes`, `lote`, `control`…) se descartan.\n",
        "No se certifica que un run aplicado haya consumido *todos* los archivos de la carpeta: mide que la "
        "campaña se procesó y aplicó, no cobertura semántica archivo a archivo. La columna «tokens del match» "
        "muestra por qué palabra se atribuyó cada run: un token corto o genérico indica atribución laxa. "
        "`evidencia_parcial` = hay informe, índice o extract en la carpeta pero ningún run aplicado atribuible: "
        "requiere revisión humana antes de darla por cerrada.\n",
        "\n## Sin evidencia de parseo\n",
        table(pend) if pend else "Ninguna.\n",
        "\n## Evidencia parcial (run genérico, informe o artefactos, sin aplicación confirmada)\n",
        table(parcial) if parcial else "Ninguna.\n",
        "\n## Aplicadas por run de fuente (capa antigua de scraping, sin nota de campaña)\n",
        table(aplic_fuente) if aplic_fuente else "Ninguna.\n",
        "\n## Excluidas por política editorial\n",
        table(excl) if excl else "Ninguna.\n",
        "\n## Aplicadas por run de campaña\n",
        table(aplic),
    ]
    md_path = os.path.join(outdir, "INFORME.md")
    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write("".join(md))

    with open(os.path.join(outdir, "resumen.json"), "w", encoding="utf-8") as fh:
        json.dump({"carpetas": len(rows), "estados": counts, "runs": len(runs)}, fh, ensure_ascii=False, indent=2)

    print("\n=== RESUMEN ===")
    print(f"carpetas: {len(rows)}  " + "  ".join(f"{k}={v}" for k, v in counts.items()))
    print(f"CSV: {csv_path}")
    print(f"INFORME: {md_path}")
    print("\nSIN EVIDENCIA:")
    for r in pend:
        print(f"  {r['capa']}/{r['carpeta']:<42} {r['archivos']:>7} archivos")


if __name__ == "__main__":
    main()
