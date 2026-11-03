#!/usr/bin/env python3
"""Tablero vivo de la campaña de reproductores de Spotify (prioridad 1, 2026-11-02).

Sin LLM y sin tocar la API: mide leyendo la entrada de la campaña, las salidas a-*.json,
el log del servicio y cuota.json. Reescribe el HTML cada `--refresco` segundos (atómico).

Uso:
  python3 scripts/spotify-tablero.py [--dir reports/streaming-embeds-2026-11-02]
                                     [--una-vez] [--refresco 10]
"""
from __future__ import annotations

import argparse
import html
import json
import os
import statistics
import subprocess
import sys
import traceback
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOG = ROOT / "data/raw/spotify-diario/diario.log"
CUOTA = ROOT / "data/raw/spotify-diario/cuota.json"
TOPE_CRED = 500
SERVICIO = "crv-spotify-diario.service"
TIMER = "crv-spotify-diario.timer"

_cache_entrada: dict = {"mtime": 0.0, "artistas": {}, "discos": {}}
_cache_salidas: dict[Path, tuple[float, dict]] = {}


# ------------------------------------------------------------------ utilidades
def miles(n) -> str:
    return f"{int(n):,}".replace(",", ".")


def pct(a, b) -> float:
    return 100.0 * a / b if b else 0.0


def num1(x) -> str:
    """Un decimal con coma (formato español), sin arrastrar el punto inglés."""
    return f"{x:.1f}".replace(".", ",")


def esc(t) -> str:
    return html.escape(str(t if t is not None else ""))


def dur(seg: float) -> str:
    seg = max(0, int(seg))
    h, r = divmod(seg, 3600)
    m, s = divmod(r, 60)
    if h:
        return f"{h} h {m} min"
    if m:
        return f"{m} min {s} s"
    return f"{s} s"


def reloj(dt: datetime | None) -> str:
    return dt.strftime("%H:%M:%S") if dt else "—"


def systemctl(*args: str, timeout: float = 4) -> str:
    try:
        return subprocess.run(["systemctl", "--user", *args], capture_output=True, text=True,
                              timeout=timeout).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def entrada(dir_camp: Path) -> tuple[dict, dict]:
    """artistas y discos de la entrada, con caché por mtime (8 MB de JSONL)."""
    base = dir_camp / "entrada"
    if not (base / "artistas.jsonl").exists():
        base = dir_camp
    f = base / "artistas.jsonl"
    mtime = f.stat().st_mtime if f.exists() else 0.0
    if mtime != _cache_entrada["mtime"]:
        artistas = {}
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip():
                a = json.loads(line)
                artistas[a["id"]] = a
        discos: dict[int, list] = {}
        for line in (base / "discos.jsonl").read_text(encoding="utf-8").splitlines():
            if line.strip():
                d = json.loads(line)
                discos.setdefault(d["artistId"], []).append(d)
        _cache_entrada.update({"mtime": mtime, "artistas": artistas, "discos": discos})
    return _cache_entrada["artistas"], _cache_entrada["discos"]


def salidas(dir_camp: Path) -> dict[int, dict]:
    """a-<id>.json de la campaña; relee solo los que cambian de mtime."""
    vistos: dict[int, dict] = {}
    d = dir_camp / "spotify"
    if not d.is_dir():
        return vistos
    for f in d.glob("a-*.json"):
        try:
            mt = f.stat().st_mtime
        except OSError:
            continue
        prev = _cache_salidas.get(f)
        if prev and prev[0] == mt:
            vistos[int(f.stem[2:])] = prev[1]
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        _cache_salidas[f] = (mt, data)
        vistos[int(f.stem[2:])] = data
    return vistos


def lineas_log() -> list[str]:
    try:
        return LOG.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:  # noqa: BLE001
        return []


def corrida_con_marcas(lineas: list[str]) -> tuple[list[str], datetime | None, list[datetime]]:
    """Última corrida que realmente trabajó (una corrida puede arrancar y salir sin cuota en 1 s:
    esa no tiene marcas y no debe borrar el ritmo de la anterior)."""
    idxs = [i for i, l in enumerate(lineas) if " entrada · " in l]
    for i in reversed(idxs):
        fin = next((j for j in idxs if j > i), len(lineas))
        tramo = lineas[i:fin]
        ts = marcas(tramo)
        if ts:
            try:
                inicio = datetime.strptime(tramo[0][:19], "%Y-%m-%d %H:%M:%S")
            except Exception:  # noqa: BLE001
                inicio = ts[0]
            return tramo, inicio, ts
    return [], None, []


def marcas(tramo: list[str]) -> list[datetime]:
    out = []
    for l in tramo:
        if "reproductores:" in l and "· perfil" in l:
            try:
                out.append(datetime.strptime(l[:19], "%Y-%m-%d %H:%M:%S"))
            except Exception:  # noqa: BLE001
                continue
    return out


# ------------------------------------------------------------------ piezas HTML
def barra(etiqueta: str, num: int, den: int, color: str, ayuda: str) -> str:
    p = pct(num, den)
    ancho = min(100, max(0.0, p))
    estilo = f"width:{ancho:.2f}%" + (";min-width:3px" if p > 0 else "")
    return f"""
    <div class="barra-bloque">
      <div class="barra-cabeza">
        <span class="barra-titulo">{esc(etiqueta)}</span>
        <span class="barra-cifra"><strong>{miles(num)}</strong> / {miles(den)} · {num1(p)} %</span>
      </div>
      <div class="track" role="progressbar" aria-valuenow="{p:.1f}" aria-valuemin="0" aria-valuemax="100">
        <div class="fill {color}" style="{estilo}"></div>
      </div>
      <p class="ayuda">{ayuda}</p>
    </div>"""


def tarjeta(titulo: str, valor: str, ayuda: str, fuente: str, tono: str = "") -> str:
    return f"""
    <article class="tarjeta {tono}">
      <p class="t-titulo">{esc(titulo)}</p>
      <p class="t-valor">{valor}</p>
      <p class="t-ayuda">{ayuda}</p>
      <p class="t-fuente">Fuente: {fuente}</p>
    </article>"""


def pill(texto: str, tono: str) -> str:
    return f'<span class="pill {tono}"><i></i>{esc(texto)}</span>'


def sparkline(valores: list[float], ancho: int = 260, alto: int = 46) -> str:
    if len(valores) < 2:
        return '<p class="ayuda">Sin tramos suficientes para dibujar el ritmo.</p>'
    vmax = max(valores) or 1
    paso = ancho / (len(valores) - 1)
    pts = [(i * paso, alto - 6 - (v / vmax) * (alto - 12)) for i, v in enumerate(valores)]
    linea = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    area = f"0,{alto} " + linea + f" {ancho},{alto}"
    return (f'<svg class="spark" viewBox="0 0 {ancho} {alto}" preserveAspectRatio="none" aria-label="ritmo">'
            f'<polygon points="{area}" class="spark-area"></polygon>'
            f'<polyline points="{linea}" class="spark-line"></polyline></svg>')


CSS = """
:root{
  --bg:#0a0c11; --bg2:#0e1118; --sup:#12161f; --sup2:#171c27; --borde:#212836;
  --txt:#e9edf6; --muted:#8e97ab; --violeta:#8b5cf6; --verde:#2dd4a7; --ambar:#f5b544;
  --rojo:#f2555a; --azul:#4ea8ff; --radio:16px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; background:
    radial-gradient(1100px 500px at 12% -8%, rgba(139,92,246,.16), transparent 60%),
    radial-gradient(900px 420px at 92% 0%, rgba(45,212,167,.10), transparent 55%),
    var(--bg);
  color:var(--txt); font:15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing:antialiased; font-variant-numeric:tabular-nums;
}
.wrap{max-width:1220px;margin:0 auto;padding:clamp(16px,3vw,34px)}
header.top{
  position:sticky; top:0; z-index:20; backdrop-filter:blur(14px);
  background:rgba(10,12,17,.78); border-bottom:1px solid var(--borde);
}
.top .wrap{display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;padding-block:14px}
.marca{display:flex;align-items:center;gap:12px}
.logo{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;
  background:linear-gradient(145deg,#1b2130,#12161f);border:1px solid var(--borde)}
.logo svg{width:20px;height:20px}
h1{margin:0;font-size:clamp(16px,2.2vw,19px);letter-spacing:-.02em}
.sub{margin:1px 0 0;color:var(--muted);font-size:12.5px}
.estado{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;
  font-size:12.5px;font-weight:600;border:1px solid var(--borde);background:var(--sup);color:var(--txt)}
.pill i{width:7px;height:7px;border-radius:50%;background:currentColor;display:block}
.pill.ok{color:var(--verde);border-color:rgba(45,212,167,.35);background:rgba(45,212,167,.08)}
.pill.ok i{animation:pulso 1.8s infinite}
.pill.warn{color:var(--ambar);border-color:rgba(245,181,68,.35);background:rgba(245,181,68,.08)}
.pill.bad{color:var(--rojo);border-color:rgba(242,85,90,.35);background:rgba(242,85,90,.08)}
.pill.info{color:var(--azul);border-color:rgba(78,168,255,.3);background:rgba(78,168,255,.08)}
@keyframes pulso{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.82)}}
.vistazo{
  margin:18px 0 22px;padding:16px 18px;border-radius:var(--radio);border:1px solid var(--borde);
  background:linear-gradient(180deg,var(--sup2),var(--sup));font-size:14.5px;color:#cfd6e6;
}
.vistazo b{color:#fff}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(228px,1fr))}
.tarjeta{
  background:linear-gradient(180deg,var(--sup2),var(--sup));border:1px solid var(--borde);
  border-radius:var(--radio);padding:16px 16px 13px;position:relative;overflow:hidden;
}
.tarjeta::after{content:"";position:absolute;inset:0 0 auto 0;height:2px;
  background:linear-gradient(90deg,var(--violeta),transparent 70%);opacity:.55}
.tarjeta.verde::after{background:linear-gradient(90deg,var(--verde),transparent 70%)}
.tarjeta.ambar::after{background:linear-gradient(90deg,var(--ambar),transparent 70%)}
.tarjeta.azul::after{background:linear-gradient(90deg,var(--azul),transparent 70%)}
.t-titulo{margin:0;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.07em;font-weight:600}
.t-valor{margin:6px 0 4px;font-size:clamp(24px,3.4vw,31px);font-weight:700;letter-spacing:-.03em;line-height:1.1}
.t-ayuda{margin:0;color:#c3cadb;font-size:12.8px}
.t-fuente{margin:8px 0 0;color:#6d768a;font-size:11px}
section{margin:26px 0 0}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:0 0 12px;font-weight:700}
h2 span{color:#5f6880;font-weight:500;letter-spacing:0;text-transform:none;font-size:12.5px;margin-left:8px}
.panel{background:linear-gradient(180deg,var(--sup2),var(--sup));border:1px solid var(--borde);
  border-radius:var(--radio);padding:18px}
.barras{display:grid;gap:20px}
.barra-cabeza{display:flex;justify-content:space-between;gap:12px;align-items:baseline;flex-wrap:wrap}
.barra-titulo{font-weight:600;font-size:13.5px}
.barra-cifra{color:var(--muted);font-size:12.5px}
.barra-cifra strong{color:#fff;font-size:14px}
.track{height:10px;border-radius:999px;background:#1b2130;overflow:hidden;margin:8px 0 7px;
  border:1px solid rgba(255,255,255,.04)}
.fill{height:100%;border-radius:999px;transition:width .8s cubic-bezier(.22,1,.36,1);position:relative}
.fill.violeta{background:linear-gradient(90deg,#6d3ff5,#a78bfa)}
.fill.verde{background:linear-gradient(90deg,#0f9f7a,#2dd4a7)}
.fill.ambar{background:linear-gradient(90deg,#c98a12,#f5b544)}
.fill.azul{background:linear-gradient(90deg,#1f6feb,#4ea8ff)}
.ayuda{margin:0;color:#7f889c;font-size:12px}
.ritmo{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));align-items:center}
.ritmo .dato{font-size:26px;font-weight:700;letter-spacing:-.02em}
.ritmo .dato small{font-size:13px;color:var(--muted);font-weight:500;letter-spacing:0}
.spark{width:100%;height:52px;display:block}
.spark-line{fill:none;stroke:var(--verde);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.spark-area{fill:rgba(45,212,167,.14)}
table{width:100%;border-collapse:collapse;font-size:13px}
.tabla-scroll{overflow-x:auto;border-radius:12px;border:1px solid var(--borde)}
th{position:sticky;top:0;background:#151a24;text-align:left;padding:10px 12px;color:var(--muted);
  font-size:11px;text-transform:uppercase;letter-spacing:.07em;white-space:nowrap;border-bottom:1px solid var(--borde)}
td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.045);vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:rgba(139,92,246,.06)}
.nombre{font-weight:600}
.mini{color:var(--muted);font-size:11.5px}
.ok-txt{color:var(--verde);font-weight:600}
.no-txt{color:#7f889c}
.chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;
  border:1px solid var(--borde);color:#aab3c7;background:#161b26;white-space:nowrap}
.chip.v{color:#c4b5fd;border-color:rgba(139,92,246,.32);background:rgba(139,92,246,.10)}
.chip.g{color:#7ee7c8;border-color:rgba(45,212,167,.3);background:rgba(45,212,167,.09)}
.chip.a{color:#f7ce7f;border-color:rgba(245,181,68,.3);background:rgba(245,181,68,.09)}
.cuota{display:grid;gap:22px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.cuota .cab{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px}
footer{margin:34px 0 10px;color:#6d768a;font-size:12px;border-top:1px solid var(--borde);padding-top:16px}
footer a{color:#9aa6c0;text-decoration:none;border-bottom:1px dashed #39425a;margin-right:14px;white-space:nowrap}
footer a:hover{color:#fff}
.aviso{border-left:3px solid var(--ambar);background:rgba(245,181,68,.07);padding:12px 14px;
  border-radius:10px;color:#e8d5ac;font-size:12.8px;margin-top:12px}
@media (max-width:640px){
  .t-valor{font-size:26px}
  header.top .wrap{padding-block:10px}
  .vistazo{font-size:13.5px}
  th,td{padding:9px 10px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
"""


def construir(dir_camp: Path) -> str:
    artistas, discos = entrada(dir_camp)
    hechos = salidas(dir_camp)
    tramo, inicio, ts = corrida_con_marcas(lineas_log())
    ahora = datetime.now()

    # universo del job: prioridad 1 y algún disco sin enlace verificado
    def tiene_perfil(a):
        return bool((a["links"].get("spotify") or {}).get("verified"))

    uni_art = {aid for aid, a in artistas.items()
               if tiene_perfil(a) and any(not (d["links"].get("spotify") or {}).get("verified")
                                          for d in discos.get(aid, []))}
    uni_disc = sum(1 for aid in uni_art for d in discos.get(aid, [])
                   if not (d["links"].get("spotify") or {}).get("verified"))

    procesados = {aid: r for aid, r in hechos.items() if aid in uni_art}
    con_match = {aid: r for aid, r in procesados.items() if r.get("album_links")}
    discos_ok = {al["albumId"] for r in con_match.values() for al in r.get("album_links") or []}
    pend_procesados = sum(1 for aid in procesados for d in discos.get(aid, [])
                          if not (d["links"].get("spotify") or {}).get("verified"))
    restantes = max(0, len(uni_art) - len(procesados))

    # cuota y estado
    try:
        cuota = json.loads(CUOTA.read_text()) if CUOTA.exists() else {}
    except Exception:  # noqa: BLE001
        cuota = {}
    castigos = cuota.get("castigo_hasta") or {}
    usadas = cuota.get("usadas") or {}
    creds = ["principal", "respaldo"]
    libre_hoy = 0
    bloques_cuota = []
    for c in creds:
        u = sum((usadas.get(c) or {}).values())
        cast = max((castigos.get(c) or {}).values(), default=0)
        cast_dt = datetime.fromtimestamp(cast) if cast > ahora.timestamp() else None
        cupo = 0 if cast_dt else max(0, TOPE_CRED - u)
        libre_hoy += cupo
        color = "ambar" if cast_dt else ("verde" if u else "violeta")
        nota = (f"Castigada hasta {cast_dt:%d/%m %H:%M} por cuota agotada (429 QUOTA_EXCEEDED)."
                if cast_dt else ("Sin castigo; cupo disponible hoy." if u else "Sin usar todavía."))
        bloques_cuota.append(barra(f"Credencial {c}", u, TOPE_CRED, color,
                                   f"Llamadas hechas hoy con esta credencial sobre el tope de {miles(TOPE_CRED)}. {nota}"))

    activo = systemctl("is-active", SERVICIO) == "active"
    castigo_max = max((datetime.fromtimestamp(cast) for c in creds
                       for cast in (castigos.get(c) or {}).values() if cast > ahora.timestamp()),
                      default=None)
    prox = None
    try:
        data = json.loads(systemctl("list-timers", TIMER, "--output=json") or "[]")
        if data:
            prox = datetime.fromtimestamp(data[0]["next"] / 1_000_000)
    except Exception:  # noqa: BLE001
        prox = None

    # ritmo: mediana de tramos + tasa efectiva de la última media hora
    deltas = [(b - a).total_seconds() for a, b in zip(ts, ts[1:]) if (b - a).total_seconds() > 0]
    mediana = statistics.median(deltas) if deltas else 0
    ult30 = [t for t in ts if (ahora - t).total_seconds() <= 1800]
    if not activo and len(ts) >= 3:
        tasa = (len(ts) - 1) / max(1.0, (ts[-1] - ts[0]).total_seconds() / 60)
        origen_tasa = "última corrida"
    elif len(ult30) >= 3:
        tasa = (len(ult30) - 1) / max(1.0, (ult30[-1] - ult30[0]).total_seconds() / 60)
        origen_tasa = "últimos 30 min"
    elif len(ts) >= 3:
        tasa = (len(ts) - 1) / max(1.0, (ts[-1] - ts[0]).total_seconds() / 60)
        origen_tasa = "corrida completa"
    else:
        tasa, origen_tasa = 0.0, "sin datos"
    eta_txt, eta_nota = "—", "Sin ritmo medible todavía."
    if restantes == 0:
        eta_txt, eta_nota = "Terminado", "No quedan artistas de la prioridad 1."
    elif not activo:
        # Fin de calendario: capacidad = 2 credenciales × 500 llamadas; coste = llamadas/artista medido hoy.
        llamadas_hoy = sum(sum((usadas.get(c) or {}).values()) for c in creds)
        costo = max(1.0, llamadas_hoy / max(1, len(procesados)))
        cap_art = max(1, int((TOPE_CRED * 2) / costo))
        arranque = prox or ahora
        if castigo_max and arranque < castigo_max:
            arranque = arranque + timedelta(days=1)  # la de hoy sale sin cuota
        dias = max(1, (restantes + cap_art - 1) // cap_art)
        ultimo_tramo = restantes - cap_art * (dias - 1)
        primera = arranque
        ultima = arranque + timedelta(days=dias - 1)
        if tasa > 0 and restantes:
            fin = ultima + timedelta(minutes=ultimo_tramo / tasa)
            eta_txt = fin.strftime("%d/%m ~%H:%M")
            eta_nota = (
                f"Orientativa: {miles(restantes)} artistas por delante, capacidad ~{miles(cap_art)}/día "
                f"(cuota de {miles(TOPE_CRED * 2)} llamadas y {num1(costo)} llamadas por artista medido hoy), "
                f"ritmo {num1(tasa)}/min. "
                + (f"Sin cuota hasta el {castigo_max:%d/%m %H:%M}; la primera corrida útil arranca el "
                   f"{primera:%d/%m a las %H:%M}." if castigo_max else
                   f"Primera corrida útil el {primera:%d/%m a las %H:%M}."))
        else:
            eta_txt = "Sin cuota" if castigo_max else "En pausa"
            eta_nota = ("Las dos credenciales están castigadas por cuota agotada (429 QUOTA_EXCEEDED); "
                        f"la más próxima libera el {castigo_max:%d/%m a las %H:%M}." if castigo_max else
                        "El servicio no está corriendo y no hay ritmo medible todavía.")
    elif tasa > 0:
        minutos = restantes / tasa
        eta_txt = dur(minutos * 60)
        if libre_hoy < restantes * 1.05:
            eta_nota = (f"Con la cuota que queda hoy ({miles(libre_hoy)} llamadas) alcanza para "
                        f"~{miles(int(libre_hoy))} artistas; el resto sigue en la próxima corrida"
                        + (f" ({prox:%d/%m %H:%M})." if prox else "."))
        else:
            eta_nota = f"Al ritmo efectivo de {num1(tasa)} artistas/min ({origen_tasa})."

    def hora_rel(t: datetime) -> str:
        d = (ahora - t).total_seconds()
        return f"hace {dur(d)}" if d < 86400 else t.strftime("%d/%m %H:%M")

    # tabla de últimos artistas trabajados
    filas = []
    for aid, r in sorted(procesados.items(), key=lambda kv: _cache_salidas.get(
            dir_camp / "spotify" / f"a-{kv[0]}.json", (0, {}))[0], reverse=True)[:28]:
        f = dir_camp / "spotify" / f"a-{aid}.json"
        mt = _cache_salidas.get(f, (0, {}))[0]
        t = datetime.fromtimestamp(mt) if mt else None
        pend = sum(1 for d in discos.get(aid, []) if not (d["links"].get("spotify") or {}).get("verified"))
        n = len(r.get("album_links") or [])
        via = (r.get("via") or "—").replace(" (lista del lote sin foto)", " + lista local")
        chip = "v" if "perfil" in via else ("g" if "búsqueda" in via else "a")
        resultado = (f'<span class="ok-txt">+{n} disco{"s" if n != 1 else ""}</span>'
                     if n else '<span class="no-txt">sin match</span>')
        filas.append(f"""<tr>
          <td class="mini">{reloj(t)}<br><span class="mini">{hora_rel(t) if t else ''}</span></td>
          <td><span class="nombre">{esc(r.get('name') or artistas.get(aid, {}).get('name') or aid)}</span>
              <div class="mini">id {aid}</div></td>
          <td><span class="chip {chip}">{esc(via)}</span></td>
          <td>{resultado}<div class="mini">{n} de {pend} pendientes</div></td>
        </tr>""")
    tabla_art = "".join(filas) or '<tr><td colspan="4" class="mini">Todavía no hay artistas procesados.</td></tr>'

    # últimos discos enlazados
    discos_recientes = []
    for aid, r in sorted(con_match.items(), key=lambda kv: _cache_salidas.get(
            dir_camp / "spotify" / f"a-{kv[0]}.json", (0, {}))[0], reverse=True):
        for al in (r.get("album_links") or [])[-2:]:
            discos_recientes.append((esc(al.get("title_plat") or ""), esc(r.get("name") or ""),
                                     al.get("year_plat") or "—", al.get("id")))
            if len(discos_recientes) >= 10:
                break
        if len(discos_recientes) >= 10:
            break
    tabla_disc = "".join(
        f'<tr><td class="nombre">{t}</td><td>{a}</td><td class="mini">{y}</td>'
        f'<td><a class="chip" href="https://open.spotify.com/album/{sid}" target="_blank" rel="noopener">Abrir</a></td></tr>'
        for t, a, y, sid in discos_recientes) or '<tr><td colspan="4" class="mini">Aún sin discos enlazados.</td></tr>'

    errores = [l for l in tramo if any(k in l for k in (
        "ERROR", "aplicación falló", "parada, sin cuota", "Traceback", "Error:"))]
    # solo líneas con marca de log («2026-11-02 16:53:46 …»): fuera el traceback y sus continuaciones
    utiles = [l for l in tramo if len(l) > 20 and l[:4].isdigit() and l[4] == "-" and l[10] == " "]
    ultimo = utiles[-1] if utiles else ""

    # estado en palabras del trabajo, no de systemd
    if restantes == 0:
        estado_html = pill("Completo · nada en cola", "ok")
    elif activo:
        estado_html = pill(f"Corriendo · {miles(restantes)} artistas en cola", "ok")
    elif castigo_max:
        estado_html = pill(f"Sin cuota hasta {castigo_max:%d/%m %H:%M} · {miles(restantes)} en cola", "warn")
    else:
        estado_html = pill(f"En pausa · {miles(restantes)} artistas en cola", "warn")

    resumen_txt = (f"De <b>{miles(len(uni_art))}</b> artistas con perfil verificado y discos sin enlace, "
                   f"se han trabajado <b>{miles(len(procesados))}</b> ({num1(pct(len(procesados), len(uni_art)))} %): "
                   f"<b>{miles(len(con_match))}</b> con al menos un disco enlazado y "
                   f"<b>{miles(len(procesados) - len(con_match))}</b> sin match. "
                   f"Discos enlazados: <b>{miles(len(discos_ok))}</b> de {miles(uni_disc)} pendientes "
                   f"({num1(pct(len(discos_ok), uni_disc))} %). Faltan <b>{miles(restantes)}</b> artistas.")

    serv_txt = (f"Activo desde {reloj(inicio)}" if activo and inicio else
                (f"Parado (último arranque {reloj(inicio)})" if inicio else "Sin corridas registradas"))
    actualizado = ahora.strftime("%d/%m/%Y %H:%M:%S")
    campana = dir_camp.name.replace("streaming-embeds-", "")

    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="{REFRESCO}">
<title>Spotify · {esc(campana)} · CRV</title>
<style>{CSS}</style>
</head>
<body>
<header class="top"><div class="wrap">
  <div class="marca">
    <div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.8">
      <path d="M4 14c4-3 9-4 16-2M4 9c5-3 11-3 16-1M5 19c4-2 8-2 13-1" stroke-linecap="round"/></svg></div>
    <div>
      <h1>Reproductores de Spotify · prioridad 1</h1>
      <p class="sub">Campaña <b>{esc(campana)}</b> · {esc(serv_txt)} · actualizado {actualizado}</p>
    </div>
  </div>
  <div class="estado">{estado_html}
    {pill(f"{miles(libre_hoy)} llamadas disponibles hoy", "info")}
    {pill("Actualiza cada " + str(REFRESCO) + " s", "info")}
  </div>
</div></header>

<main class="wrap">
  <p class="vistazo">{resumen_txt}</p>

  <div class="grid">
    {tarjeta("Artistas trabajados", f"{miles(len(procesados))} <span class='mini'>/ {miles(len(uni_art))}</span>",
             "Artistas de la cola que ya tienen su archivo de salida. Un artista trabajado puede acabar sin ningún disco enlazado.",
             "archivos a-*.json de la campaña", "azul")}
    {tarjeta("Con disco enlazado", f"{miles(len(con_match))}",
             f"Artistas a los que se les encontró al menos un disco en Spotify: {num1(pct(len(con_match), max(1, len(procesados))))} % de los trabajados.",
             "album_links de cada a-*.json", "verde")}
    {tarjeta("Discos enlazados", f"{miles(len(discos_ok))}",
             f"Discos distintos que entran al catálogo. Sobre los pendientes del universo: {num1(pct(len(discos_ok), uni_disc))} %.",
             "ids de album_links (sin repetir)", "violeta")}
    {tarjeta("Ritmo actual", f"{num1(tasa)} <span class='mini'>artistas/min</span>",
             f"Velocidad efectiva ({origen_tasa}). Mediana del tramo: {num1(60/mediana)} artistas/min." if mediana else "Aún sin tramos suficientes.",
             "marcas de tiempo del diario.log", "ambar")}
  </div>

  <section>
    <h2>Progreso <span>cada barra con su propio universo</span></h2>
    <div class="panel barras">
      {barra("Cola de artistas trabajada", len(procesados), len(uni_art), "violeta",
             "Numerador: artistas con archivo de salida. Denominador: artistas con perfil de Spotify verificado y algún disco sin enlace (el universo de esta campaña).")}
      {barra("De lo trabajado, cuánto sirvió", len(con_match), max(1, len(procesados)), "verde",
             "No todo lo intentado es éxito: los discos del catálogo que no están en Spotify no casan. Esta barra mide artistas con al menos un disco enlazado sobre los ya trabajados.")}
      {barra("Discos enlazados sobre los pendientes vistos", len(discos_ok), max(1, pend_procesados), "azul",
             "Solo cuenta los discos pendientes de los artistas ya trabajados. Es la medida justa de acierto del cruce, sin diluirla con la cola que aún no se ha mirado.")}
      {barra("Cobertura total de la cola de discos", len(discos_ok), uni_disc, "ambar",
       f"Discos enlazados sobre los {miles(uni_disc)} discos pendientes del universo P1. Baja por diseño: la mayoría son ediciones que Spotify no tiene con el título del catálogo.")}
    </div>
  </section>

  <section>
    <h2>Ritmo y tiempo estimado <span>tasa efectiva, no promedio histórico</span></h2>
    <div class="panel ritmo">
      <div>
        <p class="dato">{eta_txt}</p>
        <p class="ayuda">Tiempo estimado para terminar los {miles(restantes)} artistas restantes. {eta_nota}</p>
        <p class="ayuda" style="margin-top:8px">Última línea del diario: <span class="mini">{esc(ultimo[:150])}</span></p>
      </div>
      <div>
        {sparkline([round(60/d, 1) for d in deltas[-24:]] if deltas else [])}
        <p class="ayuda">Artistas por minuto en los últimos {min(24, len(deltas))} tramos. Cada punto es un intervalo real entre artistas.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Cuota de la API <span>lo que de verdad limita el avance</span></h2>
    <div class="panel cuota">{''.join(bloques_cuota)}</div>
    <p class="ayuda" style="margin-top:10px">La cuota es por app y cuenta de desarrollador; se agota con 429 QUOTA_EXCEEDED y castigo de ~24 h. El job reparte {miles(TOPE_CRED)} llamadas por credencial y día y para limpio al agotarlas: no reintenta en bucle.</p>
  </section>

  <section>
    <h2>Últimos artistas trabajados <span>lo más reciente arriba</span></h2>
    <div class="tabla-scroll"><table>
      <thead><tr><th>Hora</th><th>Artista</th><th>Vía</th><th>Resultado</th></tr></thead>
      <tbody>{tabla_art}</tbody>
    </table></div>
  </section>

  <section>
    <h2>Últimos discos enlazados <span>los datos que sí entraron</span></h2>
    <div class="tabla-scroll"><table>
      <thead><tr><th>Disco en Spotify</th><th>Artista</th><th>Año</th><th></th></tr></thead>
      <tbody>{tabla_disc}</tbody>
    </table></div>
  </section>

  {f'<section><h2>Incidencias</h2><div class="panel"><p class="ayuda">{len(errores)} líneas de error o parada en la corrida actual.</p><pre class="mini" style="white-space:pre-wrap;margin:8px 0 0">{esc(chr(10).join(errores[-6:]))}</pre></div></section>' if errores else ''}

  <footer>
    <a href="{LOG.as_uri()}">diario.log</a>
    <a href="{(dir_camp / 'pendientes.jsonl').as_uri()}">cola pendientes.jsonl</a>
    <a href="{(dir_camp / 'informe-seco.md').as_uri()}">auditoría en seco</a>
    <a href="{(dir_camp / 'resumen.json').as_uri()}">resumen.json</a>
    <a href="{(dir_camp / 'spotify').as_uri()}">salidas a-*.json</a>
    <p>Tablero generado por <code>scripts/spotify-tablero.py</code> cada {REFRESCO} s, sin LLM y sin llamar a la API.
    Los números salen de la entrada de la campaña, las salidas en disco, <code>cuota.json</code> y el log del servicio;
    si algo no se puede medir, se muestra «—» y se explica.</p>
  </footer>
</main>
</body></html>"""


def main() -> None:
    global REFRESCO
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="reports/streaming-embeds-2026-11-02")
    ap.add_argument("--refresco", type=int, default=10)
    ap.add_argument("--una-vez", action="store_true")
    args = ap.parse_args()
    REFRESCO = max(5, args.refresco)
    dir_camp = (ROOT / args.dir).resolve()
    destino = dir_camp / "tablero.html"
    espejo = Path("/tmp/crv-recon")
    espejo.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            doc = construir(dir_camp)
        except Exception:  # noqa: BLE001 — el tablero nunca mata la unidad
            detalle = traceback.format_exc()[-1500:]
            doc = ("<!doctype html><meta charset='utf-8'><meta http-equiv='refresh' content='15'>"
                   "<body style='background:#0a0c11;color:#e9edf6;font:15px system-ui;padding:30px'>"
                   "<h1>El tablero no pudo leer los datos</h1><pre style='color:#f2555a;white-space:pre-wrap'>"
                   + html.escape(detalle) + "</pre></body>")
        for ruta in (destino, espejo / f"spotify-tablero-{dir_camp.name}.html"):
            try:
                tmp = ruta.with_suffix(".tmp")
                tmp.write_text(doc, encoding="utf-8")
                os.replace(tmp, ruta)
            except Exception as e:  # noqa: BLE001
                print(f"no se pudo escribir {ruta}: {e}", flush=True)
        print(f"{datetime.now():%H:%M:%S} tablero → {destino}", flush=True)
        if args.una_vez:
            return
        import time
        time.sleep(REFRESCO)


REFRESCO = 10
if __name__ == "__main__":
    main()
