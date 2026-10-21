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
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))
from rym_reviews_parse import RE_PAG, RE_SHELL, parsear_reviews  # noqa: E402
from rym_reviews_validate import validate  # noqa: E402

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


def es_muro(status: int, titulo: str, html: str = '') -> bool:
    """Muro de verdad, no una review que se llame «Un momento contigo».

    El 2026-10-16 el capturador anterior dio 4 falsos positivos por mirar solo
    el <title>: una página 200 con reviews se marcaba como bloqueo. Si el HTML
    trae los bloques de review, hay contenido y no es muro.
    """
    # RYM devuelve a veces 403 CON el contenido completo de la página (medido
    # 2026-10-21: status 403 y 8 reviews dentro). Si el HTML trae los bloques de
    # review, hay página: no es muro.
    if RE_SHELL.search(html or ''):
        return False
    if status in (403, 429, 502, 503, 504):
        return True
    # página de error servida con 200 (RYM devuelve «502 Bad gateway» maquetado)
    if re.search(r'Bad gateway|Error 502|Error 504', html or '', re.I):
        return True
    return any(m.lower() in (titulo or '').lower() for m in MARCAS_MURO)


OG_URL = re.compile(r'<meta property="og:url" content="https://rateyourmusic\.com(/[^"]+)"')


def identidad_ok(html: str, href: str) -> tuple[bool, str]:
    """¿La página servida es la obra que se pidió?

    RYM ha servido fichas de otro artista (2026-10-21: MF DOOM → Marilyn Manson)
    a clientes que considera sospechosos. Se compara el og:url real con el href
    pedido: mismo tipo y mismo artista; el título admite variantes de slug.
    """
    m = OG_URL.search(html or '')
    if not m:
        return False, ''
    real = re.sub(r'/+$', '', m.group(1).lower())
    esp = re.sub(r'/+$', '', href.lower())
    a, b = real.split('/'), esp.split('/')
    if len(a) < 4 or len(b) < 4:
        return real == esp, m.group(1)
    if a[1] != b[1] or a[2] != b[2]:
        return False, m.group(1)
    ta, tb = a[3], b[3]
    return (ta == tb or ta in tb or tb in ta), m.group(1)


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
                    await asyncio.to_thread(shutil.move, str(ruta), str(final))
                    self.movidos += 1
                except Exception as exc:
                    self.errores += 1
                    log(f'[mover] fallo {Path(ruta).name}: {str(exc)[:90]}')
            self.cola.task_done()


def tareas_pendientes(campaign: Path) -> list[dict]:
    plan = campaign / 'tareas.jsonl'
    if not plan.exists():
        raise SystemExit(f'falta el plan: {plan} (corre scripts/rym-reviews-plan.py)')
    # Existing filenames are not evidence of a successful capture.
    candidates = {}
    for directory in (REPO / 'data/raw').glob('rym-reviews-*/pages'):
        for f in directory.glob('*_reviews_*.json'):
            candidates.setdefault(f.stem, []).append(f)
    pend = []
    for linea in plan.read_text(encoding='utf-8').splitlines():
        t = json.loads(linea)
        valid = False
        for f in candidates.get(t['out'], []):
            try:
                rec = json.loads(f.read_text())
                if rec.get('href') == t['href'] and rec.get('page') == t['page']:
                    valid = validate(f.with_suffix('.html').read_text(), t)['valid']
                if valid:
                    break
            except (OSError, ValueError):
                continue
        if not valid:
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
    abortar = asyncio.Event()

    async def vigia() -> None:
        """Si no entra ninguna página en --stall-seg, la corrida está muerta: se sale
        con 75 y systemd la relanza con conexión CDP nueva (el estado es reanudable)."""
        marca = (estado['hechas'], time.monotonic())
        while not abortar.is_set():
            await asyncio.sleep(20)
            if estado['hechas'] != marca[0]:
                marca = (estado['hechas'], time.monotonic())
            elif time.monotonic() - marca[1] > args.stall_seg:
                log(f'[vigía] {args.stall_seg}s sin capturar — se reinicia la corrida')
                avisar('🟠 CRV · reviews RYM: la captura se quedó muda; reinicio automático. '
                       'Si se repite, abre rateyourmusic.com en tu Chrome ~30 s.')
                estado['parado'] = True
                guardar_estado()
                abortar.set()
                return

    async def siguiente() -> dict | None:
        async with lock:
            return cola_tareas.pop(0) if cola_tareas else None

    bloqueadas_path = campaign / 'no-capturadas.jsonl'

    def registrar_bloqueada(t: dict, status: int, titulo: str) -> None:
        with open(bloqueadas_path, 'a', encoding='utf-8') as fh:
            fh.write(json.dumps({'url': t['url'], 'out': t['out'], 'page': t['page'],
                                 'status': status, 'titulo': (titulo or '')[:120],
                                 'at': time.strftime('%F %T')}, ensure_ascii=False) + '\n')

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
        en_esta_pestana = 0
        while not abortar.is_set():
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
                    if RE_SHELL.search(html):
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

            if es_muro(status, titulo, html):
                estado['muros'] += 1
                intentos = t.get('_intentos', 0) + 1
                t['_intentos'] = intentos
                # 403 de una página concreta (review restringida): se reintenta al final
                # sin frenar el grifo global; si insiste, se anota y se sigue.
                if status == 403:
                    if intentos >= 3:
                        registrar_bloqueada(t, status, titulo)
                        log(f'[bloqueada] {t["out"]} (403) — anotada en no-capturadas.jsonl')
                        continue
                    async with lock:
                        cola_tareas.append(t)
                    log(f'[403] {t["out"]}: se reintenta al final ({intentos}/3)')
                    await asyncio.sleep(random.uniform(2, 5))
                    continue
                fallos_seg += 1
                estado['murado'] = True
                grifo.castigar()
                async with lock:
                    cola_tareas.append(t)
                log(f'[muro] ({status}) {titulo[:50]} · pausa {grifo.pausa_hasta - time.monotonic():.0f}s '
                    f'(seguidos {fallos_seg})')
                if fallos_seg >= 4:
                    avisar('🔒 CRV · reviews RYM: muro sostenido. Abre rateyourmusic.com en tu Chrome '
                           'unos 30 s para renovar cf_clearance; la captura se reinicia sola.')
                    subprocess.run(['bash', str(REPO / 'ops/rym-resto/chrome.sh'), '--force'],
                                   capture_output=True, timeout=180)
                    estado['parado'] = True
                    guardar_estado()
                    abortar.set()
                    break
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

            checked = validate(html, t, pagina.url, status)
            if not checked['valid']:
                registrar_bloqueada(t, status, ','.join(checked['errors']))
                estado['fallos'] += 1
                log(f"[invalida] {t['out']}: {','.join(checked['errors'])}")
                continue
            total, reviews = checked['total'], checked['reviews']
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
            en_esta_pestana += 1
            if args.reciclar_cada and en_esta_pestana % args.reciclar_cada == 0:
                try:
                    await pagina.close()
                except Exception:
                    pass
                pagina = await contexto.new_page()
                log(f'[reciclar] pestaña {n} renovada tras {en_esta_pestana} páginas')
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
        tarea_vigia = asyncio.create_task(vigia())
        guardar_estado()
        await asyncio.gather(*[trabajador(i, contexto) for i in range(args.tabs)])
        abortar.set()
        tarea_vigia.cancel()
        await movidos.cola.put(None)
        await hilo_mover

    guardar_estado()
    log(f'FIN · {estado["hechas"]} páginas · {estado["fallos"]} fallos · {estado["muros"]} muros · '
        f'{movidos.movidos} archivos movidos a 1 TB · {estado["ppm"]:.1f}/min'
        f'{" · ABORTADO (se reintenta)" if estado.get("parado") else ""}')
    return 75 if estado.get('parado') else 0


def main() -> int:
    print('Capturador retirado por integridad. Usar scripts/rym-reviews-control.py con cola auditada en staging SSD.', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
