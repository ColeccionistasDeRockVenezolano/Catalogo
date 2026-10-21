#!/usr/bin/env python3
"""CRV · Capturador de páginas de reviews de RYM (campaña 2026-10-20).

Baja las páginas /reviews/N/ que el plan marca como pendientes
(scripts/rym-reviews-plan.py → <campaña>/tareas.jsonl).

Diseño, tras medir las campañas anteriores:
  · Motor: Chrome real del dueño (perfil copiado) por CDP, igual que
    ops/rym-resto/chrome.sh: Cloudflare sirve las fichas y el navegador es
    headed, con sesión viva (is_logged_in + cf_clearance).
  · Ritmo: un solo grifo global (--gap-min/--gap-max, 5-7 s medidos) con
    pestañas en paralelo que se solapan con la latencia de red, no entre sí.
    Objetivo 8-10 páginas/min sostenidas; pausas de higiene cada --pausa-cada.
  · Escritura: HTML+JSON primero al SSD (~/.cache/crv-rym-stage/<campaña>),
    y un hilo aparte los mueve a la carpeta definitiva del disco de 1 TB, para
    que la latencia del HDD no frene la captura (docs/SHARED_STORAGE.md).
  · Reanudable: lo ya presente en páginas de cualquier campaña no se repite.

Uso:
  python3 scripts/rym-reviews-bajar.py --campaign data/raw/rym-reviews-2026-10-20
  python3 scripts/rym-reviews-bajar.py --campaign ... --limit 5 --verbose
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))
from rym_reviews_parse import RE_PAG, RE_SHELL, parsear_reviews  # noqa: E402

AVISOS = REPO / 'scripts/rym-etapa3-avisos.sh'
MARCAS_MURO = ('Un momento', 'Just a moment', 'Security check', 'Attention Required',
               'Quick verification', 'Verifying you are human')


def log(msg: str) -> None:
    print(time.strftime('[%H:%M:%S]'), msg, flush=True)


def avisar(msg: str) -> None:
    try:
        subprocess.run(['timeout', '30', 'bash', str(AVISOS), msg],
                       capture_output=True, timeout=40)
    except Exception as exc:  # el aviso nunca tumba la captura
        log(f'aviso Telegram falló: {str(exc)[:80]}')


def es_muro(status: int, titulo: str) -> bool:
    if status in (403, 429, 503):
        return True
    return any(m.lower() in (titulo or '').lower() for m in MARCAS_MURO)


class Grifo:
    """Un único ritmo global para todas las pestañas."""

    def __init__(self, gap_min: float, gap_max: float):
        self.gap_min, self.gap_max = gap_min, gap_max
        self.lock = asyncio.Lock()
        self.proximo = 0.0
        self.factor = 1.0          # sube cuando RYM devuelve muros
        self.pausa_hasta = 0.0

    async def esperar(self) -> None:
        async with self.lock:
            ahora = time.monotonic()
            objetivo = max(self.proximo, self.pausa_hasta)
            if objetivo > ahora:
                await asyncio.sleep(objetivo - ahora)
            hueco = random.uniform(self.gap_min, self.gap_max) * self.factor
            self.proximo = time.monotonic() + hueco

    def castigar(self) -> None:
        self.factor = min(4.0, self.factor * 1.5)
        self.pausa_hasta = time.monotonic() + random.uniform(60, 120)

    def premiar(self) -> None:
        self.factor = max(1.0, self.factor * 0.98)


class Movedor:
    """Mueve del SSD al disco de 1 TB sin bloquear la captura."""

    def __init__(self, stage: Path, destino: Path):
        self.stage, self.destino = stage, destino
        self.cola: asyncio.Queue = asyncio.Queue()
        self.movidos = 0
        self.errores = 0

    async def correr(self) -> None:
        while True:
            rutas = await self.cola.get()
            if rutas is None:
                self.cola.task_done()
                return
            for ruta in rutas:
                try:
                    final = self.destino / Path(ruta).name
                    shutil.move(str(ruta), str(final))
                    self.movidos += 1
                except Exception as exc:
                    self.errores += 1
                    log(f'[mover] fallo {Path(ruta).name}: {str(exc)[:90]}')
            self.cola.task_done()


def tareas_pendientes(campaign: Path) -> list[dict]:
    plan = campaign / 'tareas.jsonl'
    if not plan.exists():
        raise SystemExit(f'falta el plan: {plan} (corre scripts/rym-reviews-plan.py)')
    hechas = set()
    for d in (REPO / 'data/raw').glob('rym-reviews-*/pages'):
        for f in d.glob('*_reviews_*.html'):
            hechas.add(f.name[:-5])
    pend = []
    with plan.open(encoding='utf-8') as fh:
        for linea in fh:
            t = json.loads(linea)
            if t['out'] not in hechas:
                pend.append(t)
    return pend


def escribir_atomico(ruta: Path, datos: bytes) -> None:
    tmp = ruta.with_name('.' + ruta.name + '.tmp')
    with open(tmp, 'wb') as fh:
        fh.write(datos)
    os.replace(tmp, ruta)


async def capturar(args, tareas: list[dict], campaign: Path, stage: Path, destino: Path) -> int:
    from playwright.async_api import async_playwright

    estado_path = campaign / 'estado-bajar.json'
    estado = {'hechas': 0, 'fallos': 0, 'muros': 0, 'inicio': time.strftime('%F %T'),
              'ultima': None, 'ppm': 0.0, 'murado': False, 'parado': False}
    movidos = Movedor(stage, destino)
    grifo = Grifo(args.gap_min, args.gap_max)
    cola_tareas = list(tareas)
    lock = asyncio.Lock()
    arranque = time.monotonic()
    ultimas: list[tuple[float, str, int]] = []

    async def siguiente() -> dict | None:
        async with lock:
            return cola_tareas.pop(0) if cola_tareas else None

    def guardar_estado() -> None:
        transcurrido = max(1e-6, time.monotonic() - arranque)
        estado['ppm'] = round(60 * estado['hechas'] / transcurrido, 2)
        restantes = len(cola_tareas) + args.tabs
        estado['eta_min'] = round(restantes / estado['ppm'], 1) if estado['ppm'] else None
        estado['restantes'] = len(cola_tareas)
        estado['actualizado'] = time.strftime('%F %T')
        escribir_atomico(estado_path, json.dumps(estado, ensure_ascii=False, indent=1).encode())

    async def trabajador(n: int, contexto) -> None:
        pagina = await contexto.new_page()
        fallos_seg = 0
        while True:
            t = await siguiente()
            if t is None:
                break
            await grifo.esperar()
            html, status, titulo = '', 0, ''
            try:
                resp = await pagina.goto(t['url'], wait_until='domcontentloaded', timeout=45000)
                status = resp.status if resp else 0
                for intento in range(8):
                    try:
                        html = await pagina.content()
                    except Exception:
                        # la página seguía navegando: esperar y reintentar el volcado
                        html = ''
                    if RE_SHELL.search(html) or '<h2>' in html:
                        break
                    await pagina.wait_for_timeout(700 if intento < 4 else 1200)
                titulo = await pagina.title()
            except Exception as exc:
                log(f'[err] {t["out"]}: {str(exc)[:110]}')
                estado['fallos'] += 1
                fallos_seg += 1
                await asyncio.sleep(random.uniform(5, 12))
                if fallos_seg >= 3:
                    grifo.castigar()
                    fallos_seg = 0
                continue

            if es_muro(status, titulo):
                estado['muros'] += 1
                fallos_seg += 1
                estado['murado'] = True
                grifo.castigar()
                log(f'[muro] ({status}) {titulo[:50]} · pausa {grifo.pausa_hasta - time.monotonic():.0f}s '
                    f'(seguidos {fallos_seg})')
                if fallos_seg >= 4:
                    avisar('🔒 CRV · reviews RYM: muro sostenido. Abre rateyourmusic.com en tu Chrome '
                           'unos 30 s para renovar cf_clearance; la captura sigue sola.')
                    subprocess.run(['bash', str(REPO / 'ops/rym-resto/chrome.sh'), '--force'],
                                   capture_output=True, timeout=180)
                    fallos_seg = 0
                continue
            estado['murado'] = False
            fallos_seg = 0
            grifo.premiar()

            if not html:
                estado['fallos'] += 1
                async with lock:
                    cola_tareas.append(t)
                log(f'[vacio] {t["out"]}: sin HTML, devuelta a la cola')
                await asyncio.sleep(random.uniform(3, 8))
                continue

            total, reviews = parsear_reviews(html)
            pags = [int(x) for x in RE_PAG.findall(html) if int(x) < 500]
            rec = {'tipo_doc': 'reviews', 'href': t['href'], 'page': t['page'], 'url': t['url'],
                   'total_declarado': total or t['declaradas'], 'n': len(reviews),
                   'paginas_max_vista': max(pags) if pags else t['paginas'],
                   'reviews': reviews, 'capturedAt': time.strftime('%F %T'),
                   'via': 'chrome-cdp'}
            escribir_atomico(stage / (t['out'] + '.json'),
                             json.dumps(rec, ensure_ascii=False, indent=1).encode())
            escribir_atomico(stage / (t['out'] + '.html'), html.encode())
            await movidos.cola.put([stage / (t['out'] + '.json'), stage / (t['out'] + '.html')])

            estado['hechas'] += 1
            estado['ultima'] = f"{t['href']} p{t['page']}/{t['paginas']} · {len(reviews)} reviews"
            ultimas.append((time.monotonic(), t['out'], len(reviews)))
            del ultimas[:-12]
            if args.verbose or estado['hechas'] % 10 == 0:
                log(f"+ {t['out']} · {len(reviews)} reviews · {estado['hechas']} hechas "
                    f"({estado['ppm'] or 0:.1f}/min)")
            if estado['hechas'] % 5 == 0:
                guardar_estado()
            if args.pausa_cada and estado['hechas'] % args.pausa_cada == 0:
                pausa = random.uniform(30, 60)
                log(f'[higiene] pausa {pausa:.0f}s tras {estado["hechas"]} páginas')
                await asyncio.sleep(pausa)
            if args.limit and estado['hechas'] >= args.limit:
                break
        await pagina.close()

    async with async_playwright() as pw:
        navegador = await pw.chromium.connect_over_cdp(args.cdp)
        contexto = navegador.contexts[0]
        log(f'CDP conectado a {args.cdp} · pestañas {args.tabs} · grifo {args.gap_min}-{args.gap_max}s '
            f'· pendientes {len(tareas)}')
        hilo_mover = asyncio.create_task(movidos.correr())
        guardar_estado()
        await asyncio.gather(*[trabajador(i, contexto) for i in range(args.tabs)])
        await movidos.cola.put(None)
        await hilo_mover

    guardar_estado()
    log(f'FIN · {estado["hechas"]} páginas · {estado["fallos"]} fallos · {estado["muros"]} muros · '
        f'{movidos.movidos} archivos movidos a 1 TB · {estado["ppm"]:.1f}/min')
    return estado['hechas']


def main() -> int:
    ap = argparse.ArgumentParser(description='Captura de páginas /reviews/N/ de RYM')
    ap.add_argument('--campaign', default='data/raw/rym-reviews-2026-10-20')
    ap.add_argument('--cdp', default='http://127.0.0.1:9333')
    ap.add_argument('--tabs', type=int, default=2)
    ap.add_argument('--gap-min', type=float, default=5.0)
    ap.add_argument('--gap-max', type=float, default=7.0)
    ap.add_argument('--pausa-cada', type=int, default=40, help='pausa de higiene cada N páginas (0 = nunca)')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--ssd', default=os.environ.get('CRV_RYM_SSD', os.path.expanduser('~/.cache/crv-rym-stage')))
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    campaign = (REPO / args.campaign).resolve()
    destino = campaign / 'pages'
    stage = Path(args.ssd).resolve() / campaign.name / 'pages'
    stage.mkdir(parents=True, exist_ok=True)
    destino.mkdir(parents=True, exist_ok=True)

    # Restos de una corrida anterior en el SSD: se drenan antes de seguir (nunca se
    # queda una captura huérfana fuera de la carpeta definitiva del disco de 1 TB).
    restos = [f for f in stage.iterdir() if f.is_file()]
    for f in restos:
        try:
            shutil.move(str(f), str(destino / f.name))
        except Exception as exc:
            log(f'[drenar] fallo {f.name}: {str(exc)[:90]}')
    if restos:
        log(f'drenados {len(restos)} archivos que quedaron en el SSD')

    tareas = tareas_pendientes(campaign)
    log(f'plan: {len(tareas)} páginas pendientes · stage SSD {stage} → {destino}')
    if not tareas:
        log('nada pendiente')
        return 0
    if args.limit:
        tareas = tareas[:args.limit]
    hechas = asyncio.run(capturar(args, tareas, campaign, stage, destino))
    return 0 if hechas else 1


if __name__ == '__main__':
    sys.exit(main())
