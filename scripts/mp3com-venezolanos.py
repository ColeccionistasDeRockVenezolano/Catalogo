#!/usr/bin/env python3
"""Detecta artistas venezolanos en el volcado MP3.com 2003 (mp3-2003.computer-legacy.com).

Entrada: info-all.jsonl (una ficha /info/ por línea, generada por mp3info_extract.py).
Salida : reports/mp3com-2003/venezolanos.jsonl  (candidatos con evidencia y nivel)
         reports/mp3com-2003/venezolanos.csv     (revisión humana)

Método (tres vías independientes, se guarda la mejor):
  A  location/find_more declara «- Venezuela»            -> fuerte
  B  location da ciudad+estado venezolano sin país       -> fuerte
  C  la biografía/historia menciona Venezuela o una
     ciudad venezolana                                   -> revisar

«Valencia» a secas NUNCA cuenta (España/California). Sólo con estado venezolano
(Carabobo) o con «Venezuela» explícito.
"""
import json, re, os, sys, unicodedata, csv

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INF = '/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/raw/mp3com-2003/info-all.jsonl'
OUTDIR = os.environ.get('MP3COM_OUT', os.path.expanduser('~/crv-staging/reports/mp3com-2003'))

STATES = {
    'amazonas','anzoategui','apure','aragua','barinas','bolivar','carabobo','cojedes',
    'delta amacuro','falcon','guarico','lara','merida','miranda','monagas','nueva esparta',
    'portuguesa','sucre','tachira','trujillo','vargas','yaracuy','zulia','distrito capital',
    'distrito federal','dtto. federal','dtto federal','dependencias federales','la guaira',
}
CITY_STATE = {
    'caracas':'distrito capital','maracaibo':'zulia','maracay':'aragua','valencia':'carabobo',
    'barquisimeto':'lara','merida':'merida','ciudad guayana':'bolivar','puerto ordaz':'bolivar',
    'san cristobal':'tachira','barcelona':'anzoategui','puerto la cruz':'anzoategui',
    'cumana':'sucre','maturin':'monagas','barinas':'barinas','cabimas':'zulia',
    'acarigua':'portuguesa','araure':'portuguesa','guanare':'portuguesa','carupano':'sucre',
    'porlamar':'nueva esparta','el tigre':'anzoategui','valera':'trujillo','los teques':'miranda',
    'guarenas':'miranda','guatire':'miranda','la guaira':'vargas','coro':'falcon',
    'punto fijo':'falcon','ciudad bolivar':'bolivar','carora':'lara','san felipe':'yaracuy',
    'ocumare del tuy':'miranda','charallave':'miranda','cua':'miranda','turmero':'aragua',
    'la victoria':'aragua','el vigia':'merida','tovar':'merida','rubio':'tachira',
    'ciudad ojeda':'zulia','santa barbara del zulia':'zulia','puerto cabello':'carabobo',
    'guacara':'carabobo','mariara':'carabobo','nirgua':'yaracuy','chivacoa':'yaracuy',
    'yaritagua':'yaracuy','barinitas':'barinas','sabaneta':'barinas','zaraza':'guarico',
    'valle de la pascua':'guarico','anaco':'anzoategui','cantaura':'anzoategui',
    'puerto ayacucho':'amazonas','tucupita':'delta amacuro','san carlos':'cojedes',
    'trujillo':'trujillo','bocono':'trujillo','san fernando de apure':'apure',
    'guasdualito':'apure','santa elena de uairen':'bolivar','upata':'bolivar',
    'tumeremo':'bolivar','caripito':'monagas','la vela':'falcon','tucacas':'falcon',
    'chacao':'miranda','petare':'miranda','catia la mar':'vargas','maiquetia':'vargas',
}
CITY_RE = re.compile('|'.join(sorted((re.escape(c) for c in CITY_STATE), key=len, reverse=True)))

BIO_TOKENS = re.compile(
    r'\bvenezuela\b|\bvenezolan[oa]s?\b|\bcaracas\b|\bmaracaibo\b|\bmaracay\b|\bbarquisimeto\b'
    r'|\bpuerto la cruz\b|\bciudad guayana\b|\bvalencia, ?carabobo\b|\bmerida, ?merida\b'
    r'|\bsan cristobal, ?tachira\b', re.I)


def norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', s).strip().lower()


def split_location(loc):
    """'Maracaibo, Zulia - Venezuela' -> (city, state, country). Tolera variantes."""
    if not loc:
        return None, None, None
    loc = re.sub(r'\s+', ' ', loc).strip(' |')
    country = None
    m = re.search(r'-\s*([A-Za-zÁÉÍÓÚÑáéíóúñ.\' ]{2,40})\s*$', loc)
    if m:
        country = m.group(1).strip(' .')
        loc = loc[:m.start()].strip(' ,-')
    parts = [p.strip(' .') for p in loc.split(',') if p.strip(' .-')]
    city = parts[0] if parts else None
    state = parts[1] if len(parts) > 1 else None
    return city, state, country


def classify(rec):
    loc = rec.get('location') or rec.get('find_more') or ''
    city, state, country = split_location(loc)
    c, s, co = norm(city), norm(state), norm(country)
    tier, why = None, None
    declared_other = bool(co) and 'venezuela' not in co
    if co and 'venezuela' in co:
        tier, why = 'A', 'location declara Venezuela'
    elif not declared_other and s in STATES and c:
        tier, why = 'A', f'estado venezolano «{state}»'
    elif not declared_other and c in CITY_STATE and (not s or s in STATES):
        tier, why = 'B', f'ciudad venezolana «{city}» sin país'
    else:
        blob = ' '.join(str(rec.get(k) or '') for k in ('description', 'history', 'style', 'members', 'albums'))
        m = BIO_TOKENS.search(blob)
        if m:
            tier, why = 'C', f'texto menciona «{m.group(0)}»'
    if not tier:
        return None
    out = {'tier': tier, 'why': why, 'loc_city': city, 'loc_state': state, 'loc_country': country}
    if tier == 'C':
        # Contexto exacto de la mención: es la evidencia que decide si es venezolano o no.
        blob = ' '.join(str(rec.get(k) or '') for k in ('description', 'history', 'members', 'albums'))
        m = BIO_TOKENS.search(blob)
        if m:
            a = max(0, m.start() - 110)
            out['bio_snippet'] = re.sub(r'\s+', ' ', blob[a:m.end() + 110]).strip()
    return out


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    rows, n = [], 0
    with open(INF, encoding='utf-8') as fh:
        for line in fh:
            n += 1
            rec = json.loads(line)
            cl = classify(rec)
            if not cl:
                continue
            rec.update(cl)
            rows.append(rec)
    order = {'A': 0, 'B': 1, 'C': 2}
    rows.sort(key=lambda r: (order[r['tier']], norm(r.get('name') or '')))
    with open(os.path.join(OUTDIR, 'venezolanos.jsonl'), 'w', encoding='utf-8') as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    with open(os.path.join(OUTDIR, 'venezolanos.csv'), 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['tier', 'nombre', 'ciudad', 'estado', 'pais_declarado', 'motivo', 'uri', 'page', 'style', 'plays'])
        for r in rows:
            w.writerow([r['tier'], r.get('name'), r.get('loc_city'), r.get('loc_state'), r.get('loc_country'),
                        r['why'], r.get('uri'), r['dir'] + '/' + r['page'], (r.get('style') or '')[:120], r.get('plays')])
    tiers = {t: sum(1 for r in rows if r['tier'] == t) for t in 'ABC'}
    print(json.dumps({'fichas_leidas': n, 'candidatos': len(rows), 'por_nivel': tiers}, ensure_ascii=False))


if __name__ == '__main__':
    main()
