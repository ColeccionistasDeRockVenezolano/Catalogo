#!/usr/bin/env python3
"""Construye el plan de altas para las fichas venezolanas de MP3.com 2003 que faltan en CRV.

Entrada : $MP3COM_OUT/cruce.jsonl  (salida de scripts/mp3com-cruce.mts)
Salidas : $MP3COM_OUT/plan-altas.jsonl     (una ficha lista para scripts/mp3com-altas.mts)
          $MP3COM_OUT/plan-revision.jsonl  (nivel C y nombres dudosos: no se importan solos)

Sólo se planifican fichas de nivel A/B (ubicación venezolana declarada) sin coincidencia
en el catálogo. El nivel C (sólo mención en el texto) y los nombres ilegibles van a revisión.
"""
import json, os, re, sys

OUT = os.environ.get('MP3COM_OUT', os.path.expanduser('~/crv-staging/reports/mp3com-2003'))
INFO_URL = 'http://mp3-2003.computer-legacy.com/info/{page}'
ARTIST_URL = 'http://mp3-2003.computer-legacy.com/artists/{page}'

MONTHS = {m: i for i, m in enumerate(
    'january february march april may june july august september october november december'.split(), 1)}


def clean_name(raw):
    n = re.sub(r'\s+', ' ', raw or '').strip()
    n = re.sub(r'^[\s\-–—.|:,*]+|[\s\-–—.|:,*]+$', '', n)
    return n.strip()


def suspicious(n):
    if len(n) < 2 or len(n) > 120:
        return 'longitud'
    if 'mp3.com' in n.lower() or 'http' in n.lower():
        return 'url'
    if not re.search(r'[A-Za-zÁÉÍÓÚÑáéíóúñ]', n):
        return 'sin letras'
    if re.search(r'[¢¤¦¨¬]', n):
        return 'mojibake'
    if re.fullmatch(r'[\d\W]+', n):
        return 'sin letras'
    return None


CANON = {
    'caracas': ('Caracas', 'distrito capital'), 'caracas df': ('Caracas', 'distrito capital'),
    'caracas d.f.': ('Caracas', 'distrito capital'), 'caracas d.f': ('Caracas', 'distrito capital'),
    'maracaibo': ('Maracaibo', 'zulia'), 'maracay': ('Maracay', 'aragua'),
    'valencia': ('Valencia', 'carabobo'), 'barquisimeto': ('Barquisimeto', 'lara'),
    'merida': ('Mérida', 'merida'), 'ciudad guayana': ('Ciudad Guayana', 'bolivar'),
    'puerto ordaz': ('Puerto Ordaz', 'bolivar'), 'san cristobal': ('San Cristóbal', 'tachira'),
    'barcelona': ('Barcelona', 'anzoategui'), 'puerto la cruz': ('Puerto La Cruz', 'anzoategui'),
    'cumana': ('Cumaná', 'sucre'), 'maturin': ('Maturín', 'monagas'), 'barinas': ('Barinas', 'barinas'),
    'cabimas': ('Cabimas', 'zulia'), 'acarigua': ('Acarigua', 'portuguesa'), 'araure': ('Araure', 'portuguesa'),
    'guanare': ('Guanare', 'portuguesa'), 'carupano': ('Carúpano', 'sucre'),
    'porlamar': ('Porlamar', 'nueva esparta'), 'el tigre': ('El Tigre', 'anzoategui'),
    'valera': ('Valera', 'trujillo'), 'los teques': ('Los Teques', 'miranda'),
    'guarenas': ('Guarenas', 'miranda'), 'guatire': ('Guatire', 'miranda'),
    'la guaira': ('La Guaira', 'vargas'), 'coro': ('Coro', 'falcon'), 'punto fijo': ('Punto Fijo', 'falcon'),
    'ciudad bolivar': ('Ciudad Bolívar', 'bolivar'), 'carora': ('Carora', 'lara'),
    'san felipe': ('San Felipe', 'yaracuy'), 'ocumare del tuy': ('Ocumare del Tuy', 'miranda'),
    'charallave': ('Charallave', 'miranda'), 'cua': ('Cúa', 'miranda'), 'turmero': ('Turmero', 'aragua'),
    'la victoria': ('La Victoria', 'aragua'), 'el vigia': ('El Vigía', 'merida'),
    'ciudad ojeda': ('Ciudad Ojeda', 'zulia'), 'puerto cabello': ('Puerto Cabello', 'carabobo'),
    'guacara': ('Guacara', 'carabobo'), 'anaco': ('Anaco', 'anzoategui'),
    'puerto ayacucho': ('Puerto Ayacucho', 'amazonas'), 'tucupita': ('Tucupita', 'delta amacuro'),
    'trujillo': ('Trujillo', 'trujillo'), 'bocono': ('Boconó', 'trujillo'),
    'san fernando de apure': ('San Fernando de Apure', 'apure'), 'san carlos': ('San Carlos', 'cojedes'),
    'petare': ('Petare', 'miranda'), 'chacao': ('Chacao', 'miranda'), 'maiquetia': ('Maiquetía', 'vargas'),
    'catia la mar': ('Catia la Mar', 'vargas'), 'tovar': ('Tovar', 'merida'), 'rubio': ('Rubio', 'tachira'),
    'santa elena de uairen': ('Santa Elena de Uairén', 'bolivar'), 'upata': ('Upata', 'bolivar'),
    'lecheria': ('Lechería', 'anzoategui'), 'el hatillo': ('El Hatillo', 'miranda'),
    'baruta': ('Baruta', 'miranda'), 'san antonio de los altos': ('San Antonio de Los Altos', 'miranda'),
    'higuerote': ('Higuerote', 'miranda'), 'tinaquillo': ('Tinaquillo', 'cojedes'),
    'san juan de los morros': ('San Juan de Los Morros', 'guarico'),
    'calabozo': ('Calabozo', 'guarico'), 'altagracia de orituco': ('Altagracia de Orituco', 'guarico'),
    'machiques': ('Machiques', 'zulia'), 'villa del rosario': ('Villa del Rosario', 'zulia'),
    'santa barbara del zulia': ('Santa Bárbara del Zulia', 'zulia'),
    'puerto piritu': ('Puerto Píritu', 'anzoategui'), 'caripito': ('Caripito', 'monagas'),
    'tucacas': ('Tucacas', 'falcon'), 'chichiriviche': ('Chichiriviche', 'falcon'),
}
ABBREV = {'pto.': 'puerto', 'pto': 'puerto', 'sta.': 'santa', 'sta': 'santa', 'sto.': 'santo',
          's.': 'san', 'sn.': 'san', 'gral.': 'general', 'dto.': 'distrito'}
STATE_ALIAS = {'df': 'distrito capital', 'd.f': 'distrito capital', 'd.f.': 'distrito capital',
               'dtto. federal': 'distrito capital', 'dtto federal': 'distrito capital',
               'distrito federal': 'distrito capital', 'dto. federal': 'distrito capital'}
# Provincias/estados que no son ciudades: nunca van a origin_city.
NO_CITY = {'distrito federal', 'dtto. federal', 'dtto federal', 'd.f.', 'd.f', 'df',
           'distrito capital', 'miranda', 'zulia', 'carabobo', 'lara', 'aragua', 'anzoategui',
           'city', 'unknown', 'everywhere', 'online', 'internet', 'n/a', 'na', 'ninguna',
           'varios', 'various', 'worldwide', 'el mundo', 'venezuela'}


def deaccent(s):
    import unicodedata
    s = unicodedata.normalize('NFKD', s or '')
    return ''.join(c for c in s if not unicodedata.combining(c)).lower()


def lev(a, b):
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def canon_city(city, state):
    """Devuelve (ciudad canónica, duda). Corrige abreviaturas y erratas de una letra."""
    if not city:
        return None, None
    raw = re.sub(r'\s+', ' ', city).strip(' .,-')
    parts = [ABBREV.get(w.lower(), w) for w in raw.split()]
    key = deaccent(' '.join(parts)).strip(' .,-')
    key = re.sub(r'\s+', ' ', key)
    if key in NO_CITY:
        return None, None
    if key in CANON:
        return CANON[key][0], None
    st = STATE_ALIAS.get(deaccent(state or '').strip(' .'), deaccent(state or ''))
    cands = [(k, v) for k, v in CANON.items() if v[1] == st] if st else list(CANON.items())
    best = min(cands, key=lambda kv: lev(key, kv[0])) if cands else None
    if best:
        d = lev(key, best[0])
        if d == 1 or (len(key) >= 6 and d <= 2 and key[:1] == best[0][:1]):
            return best[1][0], f'corregida «{raw}» → «{best[1][0]}»'
    return ' '.join(w if w.isupper() and len(w) <= 3 else w.capitalize() for w in parts), f'ciudad sin canonizar «{raw}»'


def formed_year(history):
    if not history:
        return None
    m = re.search(r'(?:formed|founded|started|created|since|desde|fundad[oa]|naci[oó]|began)\D{0,24}(19[5-9]\d|200[0-3])', history, re.I)
    if m:
        return int(m.group(1))
    return None


def member_count(members):
    if not members:
        return 0
    parts = re.split(r';|\s+and\s+|\s+y\s+|,(?![^(]*\))', members)
    return len([p for p in parts if re.search(r'[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}', p)])


BAND_RE = re.compile(r'\b(banda|band|grupo|group|trio|trío|duo|dúo|quartet|cuarteto|ensemble|colectivo)\b', re.I)
SOLO_RE = re.compile(r'\b(solo|one[- ]man|one[- ]woman|my (own )?(project|music|band)|i am|i\'m|soy|proyecto personal|myself|just me|hombre orquesta)\b', re.I)


def artist_type(members, text):
    """Tipo documentado: miembros > marcas textuales > 'other' (se marca para revisión)."""
    n = member_count(members)
    if members and re.match(r'^(me\b|myself|i\b|yo\b|solo\b|just me)', members.strip(), re.I):
        return 'solo_artist', None
    if n >= 2:
        return 'band', None
    if BAND_RE.search(text):
        return 'band', None
    if SOLO_RE.search(text):
        return 'solo_artist', None
    if n == 1:
        return 'other', 'una entrada de integrantes no documenta un solista'
    return 'other', 'tipo sin documentar: queda «other»'


def good(v):
    """Texto útil: no vacío ni sólo puntuación/guiones."""
    if not v:
        return False
    return len(re.sub(r'[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]', '', v)) >= 2


def ficha(rec):
    name = clean_name(rec['name'])
    loc = re.sub(r'\s+', ' ', rec.get('location') or rec.get('find_more') or '').strip(' |')
    city, city_note = canon_city(rec.get('loc_city'), rec.get('loc_state'))
    desc = re.sub(r'\s+', ' ', rec.get('ficha', {}).get('description') or '').strip()
    hist = re.sub(r'\s+', ' ', rec.get('ficha', {}).get('history') or '').strip()
    style = re.sub(r'\s+', ' ', rec.get('style') or '').strip()
    infl = re.sub(r'\s+', ' ', rec.get('ficha', {}).get('influences') or '').strip()
    sim = re.sub(r'\s+', ' ', rec.get('ficha', {}).get('similar') or '').strip()
    mem = re.sub(r'\s+', ' ', rec.get('ficha', {}).get('members') or '').strip()
    ins = re.sub(r'\s+', ' ', rec.get('ficha', {}).get('instruments') or '').strip()
    alb = re.sub(r'\s+', ' ', rec.get('ficha', {}).get('albums') or '').strip()
    plays = rec.get('plays')

    bio_parts = [p for p in (desc, hist) if good(p)]
    biography = '\n\n'.join(bio_parts)[:6000] or None
    notes = [f'MP3.com 2003 · {loc}' if loc else 'MP3.com 2003']
    for label, val in (('Estilo', style), ('Influencias', infl), ('Similares', sim),
                       ('Integrantes', mem), ('Instrumentos', ins), ('Discos en MP3.com', alb)):
        if good(val):
            notes.append(f'{label}: {val[:400]}')
    if plays:
        notes.append(f'Reproducciones en MP3.com: {plays:,}')
    notes.append(f'Fichas: {ARTIST_URL.format(page=rec["page"])} · {INFO_URL.format(page=rec["page"])}')
    note_txt = '\n'.join(notes)[:4000]

    t, type_note = artist_type(mem, ' '.join((desc, hist, style)))
    vals = {'name': name, 'artist_type': t, 'origin_city': city, 'origin_country': 'Venezuela',
            'biography': biography, 'notes': note_txt}
    fy = formed_year(hist)
    if fy:
        vals['formed_year'] = fy
    dudas = [d for d in (city_note, type_note) if d]
    return {k: v for k, v in vals.items() if v not in (None, '')}, dudas


def dup_reason(r, city):
    """Decide si el candidato es en realidad una ficha que ya existe con otro nombre.

    Reglas deterministas sobre el mejor parecido del catálogo (Dice por bigramas):
    contención de nombres, ≥0.90, o ≥0.82 con la misma ciudad (o ciudad desconocida).
    """
    f = r.get('fuzzy')
    if not f:
        return None
    d = float(f.get('dice') or 0)
    fcity = deaccent(f.get('city') or '')
    same_city = bool(fcity) and deaccent(city or '') == fcity
    if f.get('contiene'):
        return f"posible duplicado de #{f['id']} «{f['name']}»: el nombre está contenido"
    if d >= 0.90:
        return f"posible duplicado de #{f['id']} «{f['name']}»: parecido {d:.2f}"
    if d >= 0.82 and (same_city or not fcity):
        return f"posible duplicado de #{f['id']} «{f['name']}»: parecido {d:.2f}, misma ciudad o sin ciudad"
    return None


def main():
    src = os.path.join(OUT, 'cruce.jsonl')
    if not os.path.exists(src):
        sys.exit(f'falta {src}: corre antes scripts/mp3com-venezolanos.py y scripts/mp3com-cruce.mts')
    faltan = [json.loads(l) for l in open(src, encoding='utf-8') if l.strip()]
    plan, revision = [], []
    for r in faltan:
        if r['tiene']:
            continue
        name = clean_name(r['name'])
        bad = suspicious(name)
        values, dudas = ficha(r)
        dup = dup_reason(r, values.get('origin_city'))
        item = {
            'clave': f'mp3com:{r["page"]}',
            'tipo': 'artist',
            'nombre': name,
            'values': values,
            'evidencia': {
                'url': INFO_URL.format(page=r['page']),
                'url_artista': ARTIST_URL.format(page=r['page']),
                'excerpt': f'MP3.com 2003 · Location: {r["location"]} · Style: {(r.get("style") or "")[:160]}',
                'motivo': r['why'],
            },
            'origen': 'mp3-2003.computer-legacy.com',
            'nivel': r['tier'],
        }
        if dudas:
            item['dudas'] = dudas
        if dup:
            item['revision'] = dup
            item['duplicado'] = r['fuzzy']
            revision.append(item)
        elif bad or r['tier'] == 'C' or (not r['loc_country'] and r['tier'] == 'B'):
            item['revision'] = bad or ('nivel C: sólo mención en el texto' if r['tier'] == 'C' else 'nivel B: ciudad sin país')
            revision.append(item)
        elif r['tier'] in ('A', 'B'):
            plan.append(item)
        else:
            revision.append(item)
    with open(os.path.join(OUT, 'plan-altas.jsonl'), 'w', encoding='utf-8') as fh:
        for it in plan:
            fh.write(json.dumps(it, ensure_ascii=False) + '\n')
    with open(os.path.join(OUT, 'plan-revision.jsonl'), 'w', encoding='utf-8') as fh:
        for it in revision:
            fh.write(json.dumps(it, ensure_ascii=False) + '\n')
    print(json.dumps({'a_importar': len(plan), 'a_revision': len(revision),
                      'con_biografia': sum(1 for i in plan if i['values'].get('biography')),
                      'con_tipo': sum(1 for i in plan if i['values'].get('artist_type')),
                      'con_anio': sum(1 for i in plan if i['values'].get('formed_year')),
                      'con_ciudad': sum(1 for i in plan if i['values'].get('origin_city')),
                      'con_dudas': sum(1 for i in plan if i.get('dudas')),
                      'tipo_other': sum(1 for i in plan if i['values'].get('artist_type') == 'other')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
