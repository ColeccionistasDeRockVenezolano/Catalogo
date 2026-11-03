#!/usr/bin/env python3
"""Auditoría EN SECO de la cosecha de reproductores de Spotify (cero llamadas a la API).

Lee la entrada recién generada desde la BD (artistas.jsonl / discos.jsonl) y mide con los datos
ya capturados en disco:

  1. Universo: discos sin enlace de Spotify, por artista con perfil verificado (prioridad 1) o
     sin perfil (prioridad 2, exige búsqueda y verificación de homónimo).
  2. Trabajo ya pagado: discos pendientes cuyo spotify_id ya está en una captura local
     (tracklists del 29-oct, a-*.json del diario, spotify_completo.jsonl).
  3. Matches locales aplicables sin red: para los artistas con lista de lanzamientos capturada
     (lote 03-oct), aplica el mismo norm/pick del pipeline y cuenta cuántos discos pendientes
     tienen candidato y si además hay pistas locales.
  4. Calidad del criterio (insesgada): sobre esos mismos artistas, de TODOS sus discos, cuántos
     quedaron ya enlazados y cuántos pendientes casan / no casan. Un disco que no está en Spotify
     no puede casar: la tasa es una cota inferior, no un fallo del criterio.
  5. Coste de red restante por prioridad y días al tope por credencial.

Uso:
  python3 ops/spotify-diario/auditoria-seca.py [reports/streaming-embeds-2026-11-02]
Escribe: informe-seco.md, resumen.json y pendientes.jsonl (cola por álbum) en el directorio.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "reports/streaming-embeds-2026-11-02")
A_JSON = ROOT / "reports/streaming-embeds-2026-10-13/spotify"
CAPTURAS = ROOT / "data/raw/spotify-lote-2026-10-03"
TRACKLISTS = Path("/home/brian/data/rockhecho/spotify_tracklists.json")
COMPLETO = Path("/home/brian/data/rockhecho/spotify_completo.jsonl")
TOPE_DIA = 1000  # 500 por credencial y día (CRV_SPOTIFY_TOPE)


def cargar(nombre, ruta):
    spec = importlib.util.spec_from_file_location(nombre, ruta)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cosecha = cargar("cosecha", ROOT / "scripts/streaming-embeds-cosecha.py")
norm, pick = cosecha.norm, cosecha.pick


def jsonl(ruta):
    return [json.loads(l) for l in ruta.read_text(encoding="utf-8").splitlines() if l.strip()]


def anio(v):
    s = str(v or "")[:4]
    return int(s) if s.isdigit() else None


def main():
    artistas = {a["id"]: a for a in jsonl(DIR / "entrada/artistas.jsonl")}
    discos = jsonl(DIR / "entrada/discos.jsonl")
    # discos.jsonl trae TODOS los álbumes; artistas.jsonl excluye «various/varios». Esos álbumes
    # no tienen ficha de artista a la que colgar un reproductor: se cuentan aparte.
    discos_va = [d for d in discos if d["artistId"] not in artistas]
    discos = [d for d in discos if d["artistId"] in artistas]

    # ---------- 1. universo
    pend = [d for d in discos if not d["links"].get("spotify")]
    pend_art = defaultdict(list)
    for d in pend:
        pend_art[d["artistId"]].append(d)
    con_perfil = {a for a in pend_art if (artistas[a]["links"].get("spotify") or {}).get("verified")}
    sin_perfil = set(pend_art) - con_perfil
    pend_p1 = [d for a in con_perfil for d in pend_art[a]]
    pend_p2 = [d for a in sin_perfil for d in pend_art[a]]

    # ---------- listas de lanzamientos capturadas (lote 03-oct, 114 artistas)
    listas = {}
    for d in CAPTURAS.iterdir():
        if not d.is_dir():
            continue
        try:
            sid = json.loads((d / "artist.json").read_text())["id"]
            listas[sid] = (d, [{"id": it["id"], "title": it["name"], "year": anio(it.get("release_date"))}
                               for it in json.loads((d / "albums.json").read_text()) if it])
        except Exception:  # noqa: BLE001
            continue

    # ---------- 2. trabajo ya pagado en capturas sueltas
    local = {}
    if TRACKLISTS.exists():
        for a in json.loads(TRACKLISTS.read_text())["albumes"]:
            if a.get("pistas"):
                local.setdefault(str(a["album_id"]), ("tracklists-29oct", a["spotify_id"]))
    if COMPLETO.exists():
        for a in jsonl(COMPLETO):
            if a.get("spotify_id"):
                local.setdefault(str(a["album_id"]), ("spotify_completo", a["spotify_id"]))
    for f in A_JSON.glob("a-*.json"):
        try:
            for al in json.loads(f.read_text()).get("album_links") or []:
                local.setdefault(str(al["albumId"]), ("a-json", al.get("id")))
        except Exception:  # noqa: BLE001
            continue
    ids_pend = {str(d["id"]) for d in pend}
    ya_pagado = {k: v for k, v in local.items() if k in ids_pend}

    # ---------- 3. matches locales aplicables sin red + 4. calidad insesgada
    aplicables = {}
    calidad = {"albumes": 0, "con_enlace": 0, "pend_casan": 0, "pend_sin_match": 0}
    detalle_muestra = []
    for a in con_perfil:
        sid = (artistas[a]["links"].get("spotify") or {}).get("id")
        if not sid or sid not in listas:
            continue
        d, cands = listas[sid]
        for al in discos:
            if al["artistId"] != a:
                continue
            calidad["albumes"] += 1
            if al["links"].get("spotify"):
                calidad["con_enlace"] += 1
                continue
            p = pick(al, cands)
            if p:
                calidad["pend_casan"] += 1
                pistas = (d / f"album-{p['id']}.json").exists() or (d / f"tracks-{p['id']}.json").exists()
                aplicables[str(al["id"])] = {"spotify_id": p["id"], "pistas": pistas, "match": p["title"]}
                if len(detalle_muestra) < 12:
                    detalle_muestra.append((al["title"], al.get("year"), p["title"], pistas))
            else:
                calidad["pend_sin_match"] += 1

    # ---------- 5. coste de red
    def tiene_lista(a):
        sid = (artistas[a]["links"].get("spotify") or {}).get("id")
        return bool(sid and sid in listas)

    p1_red = [a for a in con_perfil if not tiene_lista(a) and not any(str(d["id"]) in aplicables for d in pend_art[a])]
    p1_local = [a for a in con_perfil if any(str(d["id"]) in aplicables for d in pend_art[a])]
    llamadas_p1 = len(p1_red) * 1.15   # listado del artista + paginado ocasional
    llamadas_p2 = len(sin_perfil) * 2.0  # búsqueda + listado
    restante = llamadas_p1 + llamadas_p2

    # ---------- cola por álbum
    cola = []
    for prio, aids in ((1, con_perfil), (2, sin_perfil)):
        for a in aids:
            sid = (artistas[a]["links"].get("spotify") or {}).get("id")
            for al in pend_art[a]:
                sol = aplicables.get(str(al["id"])) or {}
                cola.append({"prioridad": prio, "album_id": al["id"], "artist_id": a,
                             "artist_name": artistas[a]["name"], "title": al["title"],
                             "year": al.get("year"), "spotify_artist_id": sid,
                             "spotify_id_local": sol.get("spotify_id") or ya_pagado.get(str(al["id"]), [None, None])[1],
                             "pistas_locales": bool(sol.get("pistas"))})
    cola.sort(key=lambda x: (x["prioridad"], -(x["spotify_id_local"] is not None), -(x["year"] or 0), x["artist_name"].lower()))

    resumen = {
        "generado": datetime.now().isoformat(timespec="seconds"),
        "entrada": str(DIR.relative_to(ROOT)),
        "artistas_entrada": len(artistas),
        "discos_entrada": len(discos),
        "discos_excluidos_va": len(discos_va),
        "pendientes_total": len(pend),
        "pendientes_p1_con_perfil": len(pend_p1),
        "artistas_p1": len(con_perfil),
        "pendientes_p2_sin_perfil": len(pend_p2),
        "artistas_p2": len(sin_perfil),
        "ya_pagado_local": {"total": len(ya_pagado), "por_fuente": dict(Counter(v[0] for v in ya_pagado.values()))},
        "aplicables_sin_red": {
            "albumes": len(aplicables),
            "con_pistas": sum(1 for v in aplicables.values() if v["pistas"]),
            "artistas": len(p1_local),
        },
        "calidad": calidad,
        "coste_red": {
            "artistas_p1_sin_lista": len(p1_red),
            "llamadas_p1": round(llamadas_p1),
            "llamadas_p2": round(llamadas_p2),
            "llamadas_estimadas": round(restante),
            "dias_p1_al_tope": round(llamadas_p1 / TOPE_DIA, 1),
            "dias_total_al_tope": round(restante / TOPE_DIA, 1),
        },
    }

    (DIR / "pendientes.jsonl").write_text(
        "\n".join(json.dumps(c, ensure_ascii=False) for c in cola) + "\n", encoding="utf-8")
    (DIR / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")
    c = calidad
    informe = [
        f"# Auditoría en seco · {resumen['generado']}",
        "",
        f"Entrada `{resumen['entrada']}`: {len(artistas)} artistas · {len(discos)} discos · "
        f"{len(discos_va)} discos de «various/varios» excluidos. **0 llamadas a la API.**",
        "",
        "## Pendiente real",
        f"- Discos sin enlace de Spotify: **{len(pend)}**",
        f"- Prioridad 1 (perfil verificado): **{len(pend_p1)}** discos de {len(con_perfil)} artistas",
        f"- Prioridad 2 (sin perfil, exige búsqueda): **{len(pend_p2)}** discos de {len(sin_perfil)} artistas",
        "",
        "## Aplicable sin red",
        f"- Discos con spotify_id ya en capturas sueltas: **{len(ya_pagado)}** {resumen['ya_pagado_local']['por_fuente'] or ''}",
        f"- Discos con candidato en listas locales capturadas: **{len(aplicables)}**"
        f" ({resumen['aplicables_sin_red']['con_pistas']} con pistas locales) de {len(p1_local)} artistas",
        "",
        "## Calidad del criterio (insesgada, artistas con lista local)",
        f"- Discos de esos artistas: **{c['albumes']}** · ya enlazados: {c['con_enlace']}"
        f" · pendientes que casan: {c['pend_casan']} · pendientes sin match: {c['pend_sin_match']}",
        f"- De los pendientes, casa el **{round(100 * c['pend_casan'] / max(1, c['pend_casan'] + c['pend_sin_match']))}%**."
        " Un disco que no está en Spotify no puede casar: es cota inferior.",
        "",
        "## Coste de red restante",
        f"- P1: {len(p1_red)} artistas sin lista local → ~{round(llamadas_p1)} llamadas"
        f" (~{round(llamadas_p1 / TOPE_DIA, 1)} días al tope de {TOPE_DIA}/día)",
        f"- P2: ~{round(llamadas_p2)} llamadas (~{round(llamadas_p2 / TOPE_DIA, 1)} días)",
        f"- Total: ~{round(restante)} llamadas (~{round(restante / TOPE_DIA, 1)} días)",
        f"- Cola: `pendientes.jsonl` ({len(cola)} filas, prioridad → aplicable local → año).",
    ]
    if detalle_muestra:
        informe += ["", "### Muestra de matches locales"]
        for t, y, m, pistas in detalle_muestra:
            informe.append(f"- {t[:55]} ({y}) → {m[:45]}" + (" · pistas locales" if pistas else ""))
    (DIR / "informe-seco.md").write_text("\n".join(informe) + "\n", encoding="utf-8")
    print("\n".join(informe))


if __name__ == "__main__":
    main()
