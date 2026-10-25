#!/usr/bin/env python3
"""Informe de la búsqueda en fuentes externas (MusicBrainz, Wikidata, Discogs, dominios, Wayback)."""
import hashlib, json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REV = ROOT / 'reports/webs-oficiales-2026-10-18/revision-990'
OUT = REV / 'reintento/fuentes'


def read(path):
    try:
        return json.loads(Path(path).read_text())
    except Exception:  # noqa: BLE001
        return None


def clave(c):
    return f"{c['artistId']}-{hashlib.sha256(c['url'].encode()).hexdigest()[:18]}"


def main():
    candidatos = read(OUT / 'candidatos.json') or []
    visitas, casos = {}, {}
    for c in candidatos:
        k = clave(c)
        visitas[k] = read(OUT / 'visitas' / f'{k}.json') or {}
        casos[k] = read(OUT / 'evaluacion/casos' / f'{k}.json') or {}
    filas = []
    for c in candidatos:
        k = clave(c)
        v, e = visitas[k], casos[k]
        filas.append({**c, 'outcome': v.get('outcome', 'pendiente'), 'status': e.get('status', 'pendiente'),
                      'siteType': e.get('siteType'), 'httpStatus': v.get('httpStatus'),
                      'title': v.get('title', ''), 'reason': e.get('reason', ''),
                      'capture': (v.get('pages') or [{}])[0].get('capture') if v.get('pages') else None,
                      'evidenceRecord': str((OUT / 'evaluacion/casos' / f'{k}.json').relative_to(ROOT)) if e else None})
    mb = read(REV / 'fuentes-externas/fuentes.json') or {}
    cobertura = read(REV / 'fuentes-externas/cobertura.json') or {}
    mb_consultadas = (cobertura.get('musicbrainz') or {}).get('artistas', len(mb))
    wd_consultadas = (cobertura.get('wikidata') or {}).get('artistas', 0)
    dis = read(REV / 'discogs/fichas.json') or {}
    dom = read(REV / 'dominios/resumen.json') or {}
    way = read(REV / 'wayback/resumen.json') or {}
    resumen = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'artistasMusicBrainz': len(mb),
        'conMusicBrainz': sum(1 for f in mb.values() if f.get('musicbrainz')),
        'conWikidata': sum(1 for f in mb.values() if f.get('wikidata')),
        'artistasDiscogs': len(dis),
        'discogsConFicha': sum(1 for f in dis.values() if f.get('fichas')),
        'dominiosProbados': dom.get('dominiosProbados'),
        'dominiosCandidatos': dom.get('candidatos'),
        'nombresGenericosOmitidos': dom.get('nombresGenericosOmitidos'),
        'wayback': way,
        'candidatos': len(candidatos),
        'porFuente': dict(Counter(c['fuente'] for c in candidatos)),
        'lectura': dict(Counter(f['outcome'] for f in filas)),
        'identidad': dict(Counter(f['status'] for f in filas)),
        'websPropiasVivas': sum(1 for f in filas if f['status'] == 'matched' and f['siteType'] in ('artist_site', 'artist_blog', 'artist_archive', 'official_shop')),
        'referenciasDeTerceros': sum(1 for f in filas if f['status'] == 'matched' and f['siteType'] in ('artist_profile', 'third_party')),
    }
    (OUT / 'resumen.json').write_text(json.dumps(resumen, ensure_ascii=False, indent=2) + '\n')
    lineas = [
        '# Búsqueda de webs oficiales en fuentes externas', '',
        f"Actualizado: {resumen['generatedAt']}", '',
        f"Alcance: las **{resumen['artistasMusicBrainz']} fichas** de la cola sin web resuelta. No se relee la URL candidata: "
        'se pregunta a bases de relaciones musicales y al registro de dominios cuál es el sitio del artista.', '',
        '## Fuentes y cobertura', '',
        '| Fuente | Consulta | Cobertura | Resultado |', '| --- | --- | ---: | --- |',
        f"| MusicBrainz | relaciones `url-rels` del artista con país Venezuela | {mb_consultadas} fichas (límite 1 req/s) | "
        f"{sum(1 for c in candidatos if c['fuente'] == 'musicbrainz')} URL (bandcamp/otros) |",
        f"| Wikidata | propiedad P856 (sitio oficial) | {wd_consultadas or resumen['conWikidata']} fichas | "
        f"{sum(1 for c in candidatos if c['fuente'] == 'wikidata')} URL |",
        f"| Discogs | campo «Website» de la ficha del artista | {resumen['discogsConFicha']} de {resumen['artistasDiscogs']} con ficha | "
        f"{sum(1 for c in candidatos if c['fuente'] == 'discogs')} URL |",
        f"| Dominios derivados | DNS + lectura de {resumen['dominiosProbados']} dominios del propio nombre | "
        f"{resumen['nombresGenericosOmitidos']} nombres genéricos omitidos | {sum(1 for c in candidatos if c['fuente'] == 'dominio_probado')} URL viva |",
        f"| Internet Archive | copia histórica de dominios caídos | {way.get('casos', 'en curso')} casos | "
        f"{way.get('candidatos', 'en curso')} enlaces descubiertos |", '',
        'Los nombres de una sola palabra se omitieron en el sondeo de dominios: el dominio derivado cae casi siempre '
        'en una marca o palabra común (medido: Elektra, Mantra, Mute, Dandelion).', '',
        'MusicBrainz (1 petición/s) y Wikidata se consultaron en segundo plano y son reanudables: el recuento de la tabla es '
        'el alcanzado al cerrar este informe. Discogs, el sondeo de dominios e Internet Archive cubren la cola completa.', '',
        '## Resultado', '',
    ]
    lineas += [f"- {k}: {v}" for k, v in sorted(resumen['lectura'].items(), key=lambda t: -t[1])]
    lineas += ['', 'Identidad:', '']
    lineas += [f"- {k}: {v}" for k, v in sorted(resumen['identidad'].items(), key=lambda t: -t[1])]
    lineas += ['', f"**Webs propias vivas encontradas: {resumen['websPropiasVivas']}**. "
                   f"Referencias de terceros que documentan al artista: {resumen['referenciasDeTerceros']} (no se publican como Web).", '']
    muertas = [f for f in filas if f['fuente'] == 'discogs' and f['outcome'] in ('navigation_failed', 'inactive_domain')]
    if muertas:
        lineas += ['### El campo «Website» de Discogs está mayormente muerto', '',
                   f"De los enlaces declarados en Discogs, **{len(muertas)} no responden** (dominio caído o sin DNS). "
                   'Se conservan como evidencia de que la web existió, no como enlace publicable.', '']
    otras = [f for f in filas if f['status'] == 'different_artist']
    if otras:
        lineas += ['### Homónimos en las fuentes', '',
                   'Estos dominios declaran un artista con el mismo nombre que la ficha, pero la lectura muestra otra identidad:', '',
                   '| Ficha | URL | Motivo |', '| --- | --- | --- |']
        lineas += [f"| {f['name']} | {f['url']} | {f['reason'][:160]} |" for f in otras]
        lineas += ['']
    lineas += ['## Integridad', '',
               'Cada URL conserva visita (estado HTTP, DOM, hash) y evaluación con citas literales; el informe de cierre '
               'revisa esos hashes. Los enlaces de referencia (Wikipedia, AllMusic, RateYourMusic, ProgArchives) y las '
               'redes o Bandcamp no se publican como «Web»: Brian no los admite como web propia.', '',
               '- [Candidatos y procedencia](candidatos.json)', '- [Resumen](resumen.json)',
               '- [Fichas de MusicBrainz y Wikidata](../fuentes-externas/fuentes.json)',
               '- [Fichas de Discogs](../discogs/fichas.json)', '- [Sondeo de dominios](../dominios/sondeo.json)',
               '- [Copias de Internet Archive](../wayback/fichas.json)', '']
    (OUT / 'README.md').write_text('\n'.join(lineas) + '\n')
    print(json.dumps(resumen, ensure_ascii=False))


if __name__ == '__main__':
    main()
