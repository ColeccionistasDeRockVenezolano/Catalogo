#!/usr/bin/env python3
"""Capturador de páginas de reviews de RYM (encargo de Brian, 2026-10-16).

Sólo para discos con paginación (>1 página): pide /release/<tipo>/<a>/<t>/reviews/1..N/ y guarda
cada review con su rating, votos, título, texto y (si viene) el rating por pista.

Reutiliza el motor probado de `scripts/scrapling-rym.py`: navegador stealth de Scrapling
(Camoufox) + cookies del perfil de Firefox del dueño, ritmo humano, enfriamiento ante muro.
NO resuelve captchas y NO usa proxies. Una sola sesión contra RYM a la vez (ver ops/rym-reviews/).

Salida (outdir):
  pages/<slug>_reviews_<N>.html|.json   HTML crudo + reviews parseadas de la página N
  estado.json                           reanudable por (href, página)
  reviews.jsonl                         export plano re-escrito desde pages/ (idempotente)
  tablero.html                          progreso (copia en /tmp/crv-recon/)
"""
import argparse, html as htmlmod, importlib.util, json, math, os, random, re, subprocess, sys, time
from typing import Any

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPTS)
import rym_reglas as reglas  # noqa: E402

_spec = importlib.util.spec_from_file_location("motor_rym", os.path.join(SCRIPTS, "scrapling-rym.py"))
motor = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(motor)  # el motor tiene guard __main__: no ejecuta nada

REPO = "/home/brian/apps/Coleccionistas De Rock Venezolano"
AVISOS = f"{REPO}/scripts/rym-etapa3-avisos.sh"
UA = motor.UA
load_cookies = motor.load_cookies

from rym_reviews_parse import (  # noqa: E402  — selectores y parseo compartidos
    RE_PAG, RE_SHELL, RE_TOTAL, limpiar_texto, parsear_reviews,
)


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


def avisar(msg):
    try:
        subprocess.run(["timeout", "30", "bash", AVISOS, msg], capture_output=True, timeout=40)
    except Exception as exc:
        log("aviso Telegram falló:", str(exc)[:80])


_LAST = {}


def avisar_throttled(msg, min_gap=3600, clave="gen"):
    if time.time() - _LAST.get(clave, 0.0) >= min_gap:
        _LAST[clave] = time.time()
        avisar(msg)


def exportar_jsonl(pages_dir, destino):
    filas = []
    for f in sorted(os.listdir(pages_dir)):
        if not f.endswith(".json") or "_reviews_" not in f:
            continue
        try:
            d = json.load(open(os.path.join(pages_dir, f), encoding="utf-8"))
        except Exception:
            continue
        if d.get("tipo_doc") == "reviews":
            # A historical filename is not a successful capture. Revalidate the HTML.
            from rym_reviews_validate import validate
            try:
                with open(os.path.join(pages_dir, f[:-5] + '.html'), encoding='utf-8') as source:
                    checked = validate(source.read(), d)
                if not checked['valid']:
                    continue
                filas.append({**d, 'reviews': checked['reviews'], 'n': len(checked['reviews']),
                              'validation': {k:v for k,v in checked.items() if k not in ('reviews','title')}})
            except (OSError, ValueError, KeyError):
                continue
    filas.sort(key=lambda d: (d["href"], d["page"]))
    tmp = destino + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for d in filas:
            fh.write(json.dumps(d, ensure_ascii=False) + "\n")
    os.replace(tmp, destino)
    return len(filas)


def tablero(outdir, estado, cola, nota=""):
    tot_pag = sum(max(r["paginas"], (estado.get(r["href"]) or {}).get("paginas_max_vista") or 0) for r in cola)
    hechas = sum(len(v.get("paginas_ok", [])) for v in estado.values())
    revs = sum(v.get("n_reviews", 0) for v in estado.values())
    filas = "\n".join(
        f"<tr><td>{v.get('album', k)}</td><td>{len(v.get('paginas_ok', []))}/{v.get('paginas', '?')}</td>"
        f"<td>{v.get('n_reviews', 0)}/{v.get('total_declarado') or '?'}</td><td>{v.get('status', '')}</td><td>{v.get('at', '')}</td></tr>"
        for k, v in sorted(estado.items(), key=lambda kv: kv[1].get("at") or "", reverse=True)[:90])
    doc = f"""<!doctype html><html lang="es"><meta charset="utf-8">
<meta http-equiv="refresh" content="15"><title>CRV · reviews RYM</title>
<style>body{{font:14px system-ui;background:#14161a;color:#e8e8e8;margin:24px}}
table{{border-collapse:collapse;width:100%}}td,th{{border-bottom:1px solid #2c3037;padding:4px 8px;text-align:left}}
.big{{font-size:22px;margin:6px 0}}.ok{{color:#7ddc7d}}</style>
<h2>CRV · captura de reviews RYM</h2>
<div class="big">páginas: <b>{hechas}/{tot_pag}</b> · reviews: <b class="ok">{revs}</b> · discos: {len(estado)}/{len(cola)} {nota}</div>
<table><tr><th>disco</th><th>págs</th><th>reviews</th><th>estado</th><th>última</th></tr>{filas}</table>
</html>"""
    for p in (os.path.join(outdir, "tablero.html"), "/tmp/crv-recon/rym-reviews-tablero.html"):
        try:
            reglas.escribir_atomico(p, doc)
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cola", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--headful", action="store_true")
    ap.add_argument("--base-min", type=float, default=5.0)
    ap.add_argument("--base-max", type=float, default=7.0)
    ap.add_argument("--cdp", default="",
                    help="URL del CDP de Chrome (p. ej. http://127.0.0.1:9333). Si se pasa, las "
                         "páginas se piden con el Chrome del dueño en vez de Camoufox: el 20/10 el "
                         "motor recibía 403 Verification en /reviews/ y Chrome servía 200.")
    args = ap.parse_args()

    outdir = args.outdir
    pages_dir = os.path.join(outdir, "pages")
    os.makedirs(pages_dir, exist_ok=True)
    os.makedirs("/tmp/crv-recon", exist_ok=True)
    state_path = os.path.join(outdir, "estado.json")
    estado, _fuente = reglas.cargar_estado(state_path)
    cola = [json.loads(l) for l in open(args.cola, encoding="utf-8") if l.strip()]
    session = {"s": None}
    cdp: dict[str, Any] = {"p": None, "b": None, "ctx": None}

    class _Texto:
        def __init__(self, valor):
            self.valor = valor

        def get(self):
            return self.valor

    class PaginaCDP:
        """Pestaña de Playwright con la interfaz mínima que usa este capturador."""

        def __init__(self, status, html, title):
            self.status = status
            self.html_content = html
            self._title = title

        def css(self, selector):
            if selector.split("::")[0] in ("title",):
                return _Texto(self._title)
            raise NotImplementedError(selector)

    def nueva_sesion():
        if args.cdp:
            if cdp["ctx"] is None:
                from playwright.sync_api import sync_playwright
                cdp["p"] = sync_playwright().start()
                cdp["b"] = cdp["p"].chromium.connect_over_cdp(args.cdp)
                cdp["ctx"] = cdp["b"].contexts[0]
                log(f"sesión CDP conectada a {args.cdp}")
            return
        if session["s"] is not None:
            try:
                session["s"].close()
            except Exception:
                pass
        cs, src_c, mt_c = load_cookies()
        log(f"cookies: {len(cs)} (fuente {src_c}, mtime {time.strftime('%H:%M', time.localtime(mt_c))})"
            f" · cf_clearance {'sí' if any(c['name'] == 'cf_clearance' for c in cs) else 'NO'}")
        from scrapling.fetchers import StealthySession
        session["s"] = StealthySession(headless=not args.headful, cookies=cs, useragent=UA,
                                       timeout=120000, retries=1, solve_cloudflare=False)
        session["s"].start()

    def fetch_cdp(url, max_tries=3):
        for intento in range(1, max_tries + 1):
            if cdp["ctx"] is None:
                nueva_sesion()
            pg = cdp["ctx"].new_page()
            html, title, status = "", "", 0
            try:
                r = pg.goto(url, wait_until="domcontentloaded", timeout=60000)
                status = r.status if r else 0
                for _ in range(6):
                    html = pg.content()
                    if "review_shell_std_" in html:
                        break
                    pg.wait_for_timeout(800)
                title = pg.title()
            except Exception as exc:
                log(f"[fetch-err-cdp] {url}: {str(exc)[:100]}")
                time.sleep(5 + intento * 5)
                continue
            finally:
                try:
                    pg.close()
                except Exception:
                    pass
            bloqueado = status in (403, 429, 503) or re.search(
                r"Un momento|Just a moment|Security check|Attention Required|Quick verification",
                title or "", re.I)
            if not bloqueado:
                return PaginaCDP(status, html, title)
            log(f"[bloqueo-cdp] ({status}) {(title or '')[:60]} — enfrío (intento {intento}/{max_tries})")
            time.sleep(random.uniform(20, 40) * intento)
        return None

    def fetch_una(url, max_tries=3):
        if args.cdp:
            return fetch_cdp(url, max_tries)
        for intento in range(1, max_tries + 1):
            if session["s"] is None:
                nueva_sesion()
            s = session["s"]
            try:
                page = s.fetch(url, timeout=60000, disable_resources=True)
            except Exception as exc:
                log(f"[fetch-err] {url}: {str(exc)[:100]}")
                time.sleep(10 + intento * 10)
                if intento >= 2:
                    nueva_sesion()
                continue
            title = ""
            try:
                title = (page.css("title::text").get() or "")[:80]
            except Exception:
                pass
            bloqueado = page.status in (403, 503) or re.search(
                r"Un momento|Just a moment|Security check|Attention Required", title, re.I)
            if not bloqueado:
                return page
            tipo_cf = page.status == 403 or bool(re.search(r"Un momento|Just a moment|Attention Required", title, re.I))
            log(f"[bloqueo] ({page.status}) {title} — refresco cookies y enfrío (intento {intento}/{max_tries})")
            if intento == 1:
                if tipo_cf:
                    avisar_throttled("🔒 CRV · reviews RYM: muro de Cloudflare (sesión vencida). Reintentar NO lo destraba: abre rateyourmusic.com en tu Firefox ~30 s. Nada se pierde.", clave="cf")
                else:
                    avisar_throttled("🟡 CRV · reviews RYM: muro suave (503). Auto-recupera; sin acción tuya.", clave="soft")
            time.sleep(random.uniform(15, 35) if (not tipo_cf and intento == 1) else random.uniform(90, 240))
            nueva_sesion()
        return None

    def cota_de(row, e):
        """Cota de páginas: la de la cola, la vista en el nav y la derivada del total declarado
        (por si el nav viene truncado). Sobrestimar solo cuesta una página 404."""
        cota = max(row["paginas"], e.get("paginas_max_vista") or 0)
        total = e.get("total_declarado")
        per_page = e.get("per_page") or 0
        if total and per_page:
            cota = max(cota, math.ceil(total / per_page))
        return cota

    def pendientes():
        pend = []
        for r in cola:
            e = estado.setdefault(r["href"], {"album": os.path.basename(r["href"].rstrip("/")), "paginas_ok": []})
            ok = set(e["paginas_ok"])
            for p in range(1, cota_de(r, e) + 1):
                if p not in ok:
                    pend.append((r["href"], p))
        return pend

    nueva_sesion()
    log(f"capturador de reviews listo: {len(cola)} discos · {len(pendientes())} páginas pendientes")
    hechas = 0
    fallos_seguidos = 0
    while True:
        if args.limit and hechas >= args.limit:
            break
        pend = pendientes()
        if not pend:
            break
        href, pagina = pend[0]
        url = "https://rateyourmusic.com" + href + f"reviews/{pagina}/"
        page = fetch_una(url)
        if page is None:
            fallos_seguidos += 1
            log(f"[fallo] {href} p{pagina}: bloqueo persistente ({fallos_seguidos} seguidos)")
            if fallos_seguidos >= 5:
                avisar_throttled("🟡 CRV · reviews RYM: muro sostenido — espera paciente (~15-25 min entre sondas).", clave="soft")
                time.sleep(random.uniform(900, 1500))
                fallos_seguidos = 0
            else:
                time.sleep(random.uniform(60, 120))
            continue
        fallos_seguidos = 0
        e = estado[href]
        if getattr(page, "status", 200) == 404:
            e["paginas_ok"].append(pagina)
            e["status"] = "pagina_404"
            e["at"] = time.strftime("%H:%M:%S")
            reglas.guardar_json(state_path, estado)
            log(f"[404] {href} p{pagina}")
            continue
        html = page.html_content or ""
        total, revs = parsear_reviews(html)
        pags_nav = [int(x) for x in RE_PAG.findall(html) if int(x) < 500]
        pags_max = max(pags_nav) if pags_nav else pagina
        slug = reglas.slug_release(href) + f"_reviews_{pagina}"
        rec = {"tipo_doc": "reviews", "href": href, "page": pagina, "url": url,
               "total_declarado": total, "n": len(revs), "paginas_max_vista": pags_max,
               "reviews": revs, "capturedAt": time.strftime("%Y-%m-%d %H:%M:%S")}
        reglas.guardar_json(os.path.join(pages_dir, slug + ".json"), rec)
        reglas.escribir_atomico(os.path.join(pages_dir, slug + ".html"), html)
        e["paginas_ok"].append(pagina)
        e["n_reviews"] = e.get("n_reviews", 0) + len(revs)
        e["paginas_max_vista"] = max(e.get("paginas_max_vista") or 0, pags_max)
        e["per_page"] = max(e.get("per_page") or 0, len(revs))
        e["total_declarado"] = total or e.get("total_declarado")
        e["paginas"] = cota_de({"paginas": e.get("paginas") or 0}, e)
        e["status"] = "ok" if len(revs) else ("vacia" if pagina > 1 else "sin_reviews")
        e["at"] = time.strftime("%H:%M:%S")
        e["ts"] = int(time.time())
        reglas.guardar_json(state_path, estado, respaldo=(hechas % 25 == 24))
        hechas += 1
        log(f"+ {href} p{pagina}/{e['paginas']} -> {len(revs)} reviews (declaradas {total}) · disco {e['n_reviews']} ({hechas})")
        tablero(outdir, estado, cola)
        if hechas % 50 == 0:
            log(f"[jsonl] {exportar_jsonl(pages_dir, os.path.join(outdir, 'reviews.jsonl'))} páginas exportadas")
        p = random.uniform(args.base_min, args.base_max)
        if random.random() < 0.06:
            p += random.uniform(15, 40)
        if hechas % 40 == 0:
            p += random.uniform(30, 60)
        time.sleep(p)

    # Rescate: páginas vacías o discos con menos reviews de las declaradas (una segunda pasada).
    if not args.limit:
        rescates = []
        for r in cola:
            e = estado.get(r["href"]) or {}
            if (e.get("total_declarado") or 0) > e.get("n_reviews", 0):
                for p in range(1, (e.get("paginas") or 1) + 1):
                    if p <= (e.get("paginas") or 1):
                        rescates.append((r["href"], p))
        if rescates:
            log(f"[rescate] {len(rescates)} páginas a reintentar (faltan reviews declaradas)")
            for href, pagina in rescates:
                url = "https://rateyourmusic.com" + href + f"reviews/{pagina}/"
                page = fetch_una(url, max_tries=2)
                if page is None:
                    continue
                html = page.html_content or ""
                total, revs = parsear_reviews(html)
                ruta = os.path.join(pages_dir, reglas.slug_release(href) + f"_reviews_{pagina}.json")
                prev = 0
                if os.path.exists(ruta):
                    try:
                        prev = json.load(open(ruta, encoding="utf-8")).get("n", 0)
                    except Exception:
                        prev = 0
                if len(revs) > prev:
                    pags_nav = [int(x) for x in RE_PAG.findall(html) if int(x) < 500] or [pagina]
                    reglas.guardar_json(ruta, {"tipo_doc": "reviews", "href": href, "page": pagina, "url": url,
                                               "total_declarado": total, "n": len(revs),
                                               "paginas_max_vista": max(pags_nav), "reviews": revs,
                                               "capturedAt": time.strftime("%Y-%m-%d %H:%M:%S")})
                    reglas.escribir_atomico(os.path.join(pages_dir, reglas.slug_release(href) + f"_reviews_{pagina}.html"), html)
                    e = estado[href]
                    e["n_reviews"] = e.get("n_reviews", 0) + (len(revs) - prev)
                    reglas.guardar_json(state_path, estado)
                    log(f"[rescate] {href} p{pagina}: {prev} -> {len(revs)} reviews")
                time.sleep(random.uniform(args.base_min, args.base_max))

    n = exportar_jsonl(pages_dir, os.path.join(outdir, "reviews.jsonl"))
    tablero(outdir, estado, cola, nota="· TERMINADA")
    huecos = [k for k, v in estado.items()
              if (v.get("total_declarado") or 0) > v.get("n_reviews", 0) or v.get("status") in ("vacia", "sin_reviews")]
    log(f"REVIEWS TERMINADAS: {hechas} páginas nuevas · jsonl {n} páginas · discos con huecos: {len(huecos)}")
    avisar(f"✅ CRV · reviews RYM: {hechas} páginas capturadas ({n} en total). Discos con reviews declaradas sin obtener: {len(huecos)} (detalle en estado.json)")


if __name__ == "__main__":
    raise SystemExit('Capturador histórico retirado por integridad; usar scripts/rym-reviews-control.py con cola auditada.')
