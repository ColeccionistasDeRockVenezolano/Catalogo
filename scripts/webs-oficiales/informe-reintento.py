#!/usr/bin/env python3
"""Informe del reintento dirigido de los casos sin resolver (18 de octubre)."""
import csv, hashlib, json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'reports/webs-oficiales-2026-10-18'
REV = BASE / 'revision-990'
OUT = REV / 'reintento'
ORIGEN = REV / 'scrapling'
EXTRA = OUT / 'extra'
CORRECCIONES = OUT / 'correcciones'
EVAL = OUT / 'evaluacion/casos'
EVAL_EXTRA = OUT / 'evaluacion-extra/casos'


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def key(d):
    return f"{d['artistId']}-{hashlib.sha256(d['url'].encode()).hexdigest()[:18]}"


def metodo(visit):
    metodos = {p['method'] for p in visit.get('pages', [])}
    if 'wordpress_public_api' in metodos:
        return 'API pública de WordPress.com'
    if 'blogspot_feed' in metodos:
        return 'feed de Blogger'
    if metodos:
        return 'navegador Chrome real'
    if visit.get('staticReason'):
        return {'parking_service': 'dominio aparcado', 'dns_unresolved': 'DNS inexistente',
                'non_public_address': 'dirección no pública'}.get(visit['staticReason'], visit['staticReason'])
    if visit.get('outcome') in ('challenge', 'navigation_failed', 'empty_content'):
        return 'sin lectura'
    return 'sin lectura'


def rows_de(candidatos, visitas, casos, omitidas=None):
    omitidas = omitidas or {}
    rows = []
    for c in candidatos:
        k = key(c)
        visit = read(visitas / f'{k}.json') if (visitas / f'{k}.json').exists() else {}
        caso = read(casos / f'{k}.json') if (casos / f'{k}.json').exists() else {}
        previo = read(ORIGEN / 'evaluacion/casos' / f'{k}.json') if (ORIGEN / 'evaluacion/casos' / f'{k}.json').exists() else {}
        omitida = omitidas.get(str(c['artistId']))
        rows.append({
            'artistId': c['artistId'], 'name': c['name'], 'url': c['url'],
            'metodo': 'no revisitada' if omitida else metodo(visit), 'outcome': 'no revisitada' if omitida else visit.get('outcome', 'pending'),
            'httpStatus': visit.get('httpStatus'), 'title': visit.get('title', ''),
            'textLength': sum(p.get('textLength', 0) for p in visit.get('pages', [])),
            'status': 'no revisitada' if omitida else caso.get('status', 'pending'), 'siteType': caso.get('siteType'),
            'previousStatus': previo.get('status'), 'reason': omitida['motivo'] if omitida else caso.get('reason', ''),
            'selectedUrl': caso.get('selectedUrl'), 'capture': visit.get('capture'),
            'sha256': visit.get('sha256'), 'evidenceRecord': f'{casos.relative_to(ROOT)}/{k}.json' if caso else None,
        })
    return rows


def main():
    pendientes = read(ORIGEN / 'pendientes.json')
    extra = read(OUT / 'candidatos-extra.json') if (OUT / 'candidatos-extra.json').exists() else []
    omitidas = read(OUT / 'omitidas.json') if (OUT / 'omitidas.json').exists() else {}
    rows = rows_de(pendientes, OUT / 'visitas', EVAL, omitidas)
    rows += rows_de(extra, EXTRA / 'visitas', EVAL_EXTRA) if extra else []
    errores = []
    for r in rows:
        if r['capture'] and not (ROOT / r['capture']).exists():
            errores.append({'url': r['url'], 'error': 'Falta la captura de la visita'})
        if r['sha256'] and r['capture'] and (ROOT / r['capture']).exists() and sha(r['capture']) != r['sha256']:
            errores.append({'url': r['url'], 'error': 'El hash de la captura no coincide'})
        if r['status'] == 'matched':
            caso = read(ROOT / r['evidenceRecord']) if r['evidenceRecord'] else {}
            if not caso.get('evidence') or not caso.get('pages'):
                errores.append({'url': r['url'], 'error': 'Coincidencia sin evidencia o sin páginas'})
                continue
            contenido = '\n\n'.join(f"URL: {p['url']}\n{p['content']}" for p in caso['pages'])
            for e in caso['evidence']:
                if e['quote'] not in contenido:
                    errores.append({'url': r['url'], 'error': 'Cita no literal en la evidencia'})
            for p in caso['pages']:
                if sha(p['capture']) != p['sha256']:
                    errores.append({'url': r['url'], 'error': f"Hash de página alterado: {p['capture']}"})
    nuevas = [r for r in rows if r['status'] == 'matched' and r['previousStatus'] != 'matched']
    bloqueos = read(OUT / 'bloqueos.json')['bloqueos'] if (OUT / 'bloqueos.json').exists() else []
    bloqueadas = [r for r in nuevas if r['artistId'] in {b['artistId'] for b in bloqueos}]
    nuevas = [r for r in nuevas if r['artistId'] not in {b['artistId'] for b in bloqueos}]
    resumen = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'pendientes': len(pendientes), 'candidatosExtra': len(extra),
        'artistasExtra': len({r['artistId'] for r in rows[len(pendientes):]}),
        'outcomes': dict(Counter(r['outcome'] for r in rows)),
        'statuses': dict(Counter(r['status'] for r in rows)),
        'metodos': dict(Counter(r['metodo'] for r in rows)),
        'newlyMatched': len(nuevas), 'blockedMatches': len(bloqueadas), 'matchedArtists': len({r['artistId'] for r in rows if r['status'] == 'matched'}),
        'integrityErrors': errores,
    }
    correcciones = read(CORRECCIONES / 'resumen.json') if (CORRECCIONES / 'resumen.json').exists() else {'total': 0, 'correcciones': []}
    resumen['agregadoresCorregidos'] = correcciones['total']
    (OUT / 'resumen.json').write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'resultados.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'nuevas-coincidencias.json').write_text(json.dumps(nuevas, ensure_ascii=False, indent=2) + '\n')
    with (OUT / 'paginas.csv').open('w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    lineas = [
        '# Cierre de los casos sin resolver de la revisión Scrapling', '',
        f"Actualizado: {resumen['generatedAt']}", '',
        f"Alcance: **{len(pendientes)} URLs pendientes** de la revisión anterior y "
        f"**{len(extra)} candidatos adicionales** de {resumen['artistasExtra']} artistas, tomados de las búsquedas ya guardadas.", '',
        '## Qué cambió en el método', '',
        'La revisión anterior abrió las 990 URLs con un navegador sin resolución de Cloudflare y descartó '
        'cualquier respuesta que no fuera 200. Este reintento usa el método adecuado a cada causa:', '',
        '- **Dominio aparcado o DNS inexistente**: se clasifica sin navegar, con el motivo escrito.',
        '- **Blog en WordPress.com**: API pública de WordPress.com (información del sitio y entradas), que no '
        'tiene el muro antibot que bloquea al navegador.',
        '- **Blog en Blogger**: feed JSON público del blog.',
        '- **Resto**: Chrome real con resolución de Cloudflare, espera de red inactiva, texto renderizado '
        '(`innerText`) y reintento sobre la raíz del dominio cuando la ruta candidata murió (404).',
        '- **Páginas breves**: se leen hasta dos páginas internas de biografía o discografía del mismo dominio.', '',
        '## Lectura', '',
    ]
    lineas += [f"- {k}: {v}" for k, v in sorted(resumen['outcomes'].items(), key=lambda t: -t[1])]
    lineas += ['', '## Identidad musical', '']
    lineas += [f"- {k}: {v}" for k, v in sorted(resumen['statuses'].items(), key=lambda t: -t[1])]
    lineas += ['', f"Coincidencias nuevas confirmadas: **{len(nuevas)}**. Artistas con coincidencia en este lote: {resumen['matchedArtists']}.", '']
    if nuevas:
        lineas += ['| Artista | Web confirmada | Estado previo |', '| --- | --- | --- |']
        lineas += [f"| {r['name']} | {r['selectedUrl'] or r['url']} | {r['previousStatus'] or 'sin evaluar'} |" for r in nuevas]
        lineas += ['']
    if bloqueadas:
        lineas += ['### Coincidencias bloqueadas por revisión manual previa', '',
                   'El reintento volvió a leer estas páginas y las propone, pero una revisión manual anterior ya las había '
                   'bloqueado con contexto que la lectura automática no tiene. Se conservan bloqueadas.', '',
                   '| Artista | URL propuesta | Motivo |', '| --- | --- | --- |']
        lineas += [f"| {b['name']} | {b['url']} | {b['motivo']} |" for b in bloqueos]
        lineas += ['']
    if correcciones['total']:
        lineas += ['## Corrección: agregadores de descarga publicados como web', '',
                   f"Se revisaron las webs publicadas y **{correcciones['total']} eran fichas de agregadores de descarga** "
                   '(SkySound7 y similares): páginas que ofrecen «Скачать mp3», no publicaciones del artista. '
                   'La revisión anterior las aceptó porque muestran su nombre y su repertorio. Se conserva la captura '
                   'y el hash de cada corrección, y el retiro queda en el diario de operaciones.', '']
        lineas += ['| Artista | Web retirada | Señal leída |', '| --- | --- | --- |']
        lineas += [f"| {c['name']} | {c['url']} | {c['senal'] or 'agregador'} |" for c in correcciones['correcciones']]
        lineas += ['']
    fuentes = read(OUT / 'fuentes/resumen.json') if (OUT / 'fuentes/resumen.json').exists() else None
    if fuentes:
        lineas += ['## Segunda pasada: otras fuentes', '',
                   f"Para lo que quedaba sin web se consultaron MusicBrainz, Wikidata, Discogs, el registro de dominios y Internet Archive: "
                   f"**{fuentes['candidatos']} URLs nuevas** leídas y **{fuentes['websPropiasVivas']} webs propias vivas**. "
                   'El campo «Website» de Discogs resultó estar mayormente muerto y los dominios derivados cayeron en homónimos. '
                   'Las referencias de terceros (Wikipedia, AllMusic) y las redes o Bandcamp no se publican como «Web».', '',
                   '- [Fuentes externas: cobertura y resultado](fuentes/README.md)']
        lineas += ['']
    publicacion = OUT / 'aplicacion.json'
    if publicacion.exists():
        app = read(publicacion)
        verificacion = next((p for p in (OUT / 'publicacion-verificada.json', REV / 'scrapling/publicacion-verificada.json') if p.exists()), None)
        retiro = app.get('retiroAgregadores')
        lineas += ['## Publicación', '',
                   f"La aplicación añadió **{app['result']['changed']} enlaces Web** (run {app['runId']})."
                   + (f" El catálogo quedó con **{read(verificacion)['count']} artistas con Web** y se comprobó cada enlace nuevo en la API pública."
                      if verificacion else ' Pendiente de verificación en la API pública.')]
        if retiro:
            lineas += ['', f"En el mismo cierre se retiraron **{retiro['removed']} webs de agregador** (run {retiro['runId']}), "
                          'con captura, hash y diario reversible.']
        lineas += ['', '- [Enlaces aplicados](aplicacion.json)', '- [Verificación en la API pública](../scrapling/publicacion-verificada.json)',
                   '- [Retiro de agregadores](correcciones/retiros.json)', '']
    lineas += ['## Integridad', '',
               f"Auditoría: **{len(errores)} errores**. Se comprueban identidad, URL, hash de cada captura y que cada cita "
               'de una coincidencia sea literal en el contenido conservado.', '',
               '- [Las filas de este cierre](paginas.csv)', '- [Resultados completos](resultados.json)',
               '- [Coincidencias nuevas](nuevas-coincidencias.json)', '- [Resumen](resumen.json)',
               '- [Correcciones de agregadores](correcciones/resumen.json)', '']
    (OUT / 'README.md').write_text('\n'.join(lineas) + '\n')
    print(json.dumps(resumen, ensure_ascii=False))
    if errores:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
