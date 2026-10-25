#!/usr/bin/env python3
"""Recupera discografía y enlaces de los artistas venezolanos del volcado MP3.com 2003.

Recorre los tres tar.bz2 grandes (streaming, sin extraer a disco) y deja JSONL
estructurado sólo de los artistas venezolanos detectados antes:

  {OUT}/discografia-venezolanos.jsonl   un registro por artista: discos, pistas, sello, créditos
  {OUT}/songs-venezolanos.jsonl         una ficha por canción (género, créditos, descripción)
  {OUT}/links-venezolanos.jsonl         web propia, enlaces declarados, artistas que le gustan

Uso: python3 scripts/mp3com-recuperar.py [artists|songs|links|todo]
"""
import json, os, re, sys, html, tarfile

RAW = '/mnt/1tb/Shared/coleccionistas-rock-venezolano/data/raw/mp3com-2003'
OUT = os.environ.get('MP3COM_RAW_OUT', RAW)
INFO = os.environ.get('MP3COM_INFO', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'reports/mp3com-2003/venezolanos.jsonl'))

TAR = {
    'artists': os.path.join(RAW, 'artists.mp3s.com.artists.tar.bz2'),
    'songs': os.path.join(RAW, 'artists.mp3s.com.artist_song.tar.bz2'),
    'links': os.path.join(RAW, 'artists.mp3s.com.artist_links.tar.bz2'),
}
URL = 'http://mp3-2003.computer-legacy.com'

tag_re = re.compile(r'<[^>]+>')
SONG_LINK = re.compile(r'artist_song/(\d+)/(\d+)\.html"><b>(.*?)</b>', re.S)
ARTIST_LINK = re.compile(r'artists\.mp3s\.com/artists/(\d+)/([A-Za-z0-9_%.\-]+?)\.html')
INTERNO = re.compile(r'^(?:javascript:|mailto:|#)|(?:^|[/.])(?:mp3\.com|mp3s\.com|computer-legacy\.com)(?:[/:]|$)', re.I)
INTERNO_TXT = re.compile(r'^(?:home|help|login|log in|sign up|privacy|terms|copyright|artist extras|sign the guestbook)$', re.I)


def decode(b):
    for enc in ('utf-8', 'cp1252', 'latin-1'):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            continue
    return b.decode('utf-8', 'replace')


def txt(s):
    return re.sub(r'\s+', ' ', html.unescape(tag_re.sub(' ', s or ''))).strip()


def strip_junk(s):
    return re.sub(r'\s+', ' ', (s or '')).strip(' |')


def title_of(h):
    m = re.search(r'<phrase><title>MP3\.com:\s*(.*?)</title>', h, re.S | re.I) or \
        re.search(r'<title>MP3\.com:\s*(.*?)</title>', h, re.S | re.I)
    return txt(m.group(1)) if m else None


def uri_of(h):
    m = re.search(r'mp3\.com/([A-Za-z0-9_%.\-]+)</td>', h) or \
        re.search(r'class=ttlbarsmall>\s*mp3\.com/([^<\s]+)', h)
    return 'mp3.com/' + m.group(1) if m else None


def candidatos():
    keys, uris = {}, {}
    for line in open(INFO, encoding='utf-8'):
        d = json.loads(line)
        key = f"{d['dir']}/{d['page']}"
        keys[key] = {'name': d.get('name'), 'uri': d.get('uri'), 'tier': d['tier'],
                     'location': d.get('location'), 'page': key, 'dir': d['dir']}
        if d.get('uri'):
            uris[d['uri'].lower()] = key
    return keys, uris


def parse_artist_page(h):
    """Discos y pistas a partir de la página /artists/ del artista."""
    songs = []
    matches = list(SONG_LINK.finditer(h))
    for i, m in enumerate(matches):
        grp, sid, title = m.group(1), m.group(2), txt(m.group(3)).strip('"').strip()
        end = matches[i + 1].start() if i + 1 < len(matches) else min(len(h), m.end() + 3000)
        block = h[m.end():end]
        media = album = label = credits = size = None
        mm = re.search(r'<phrase>([^<]{2,24})</phrase>:\s*<b>(.*?)</b>', block, re.S)
        if mm:
            media, album = txt(mm.group(1)), txt(mm.group(2))
        mm = re.search(r'Label</phrase>:\s*<b>(.*?)</b>', block, re.S)
        if mm:
            label = txt(mm.group(1))
        mm = re.search(r'Credits</phrase>:\s*(.*?)(?:<br|</font|</td|$)', block, re.S)
        if mm:
            credits = txt(mm.group(1))
        mm = re.search(r'download\s*</a>?\s*\(([\d.]+ MB)\)|\((\d+\.\d) MB\)', block)
        if mm:
            size = (mm.group(1) or mm.group(2))
        songs.append({'song_id': sid, 'group': grp, 'title': title, 'media': media, 'album': album,
                      'label': label, 'credits': credits, 'size': size,
                      'url': f'{URL}/artist_song/{grp}/{sid}.html'})
    return songs


TITLE_GENRE = re.compile(r'<tr valign="bottom"><td><b>\s*"?(.*?)"?\s*</b></td><td align="right" class="small">\s*genre:\s*<a[^>]*>(.*?)</a>', re.S)


def parse_song_page(h, sid, group=None):
    rec = {'song_id': sid, 'title': None, 'genre': None, 'credits': None, 'description': None,
           'size': None, 'artist_uri': None, 'artist_key': None, 'url': f'{URL}/artist_song/{group if group is not None else int(sid) // 1000}/{sid}.html'}
    m = TITLE_GENRE.search(h)
    if m:
        rec['title'] = txt(m.group(1)).strip('"').strip()
        rec['genre'] = txt(m.group(2))
    if not rec['title']:
        # Variante sin género al lado: el título es el primer <b>"..."</b> del bloque de canción.
        m = re.search(r'<tr valign="bottom"><td><b>\s*"?(.*?)"?\s*</b></td>', h, re.S)
        if m:
            rec['title'] = txt(m.group(1)).strip('"').strip()
    if not rec['genre']:
        m = re.search(r'genre:\s*(?:<[^>]+>\s*)*([^<\n]{2,60})', h)
        if m:
            rec['genre'] = txt(m.group(1)).strip()
    m = re.search(r'Credits</phrase>:\s*(.*?)(?:<br|</font|</td|$)', h, re.S)
    if m:
        rec['credits'] = txt(m.group(1))
    for cand in re.findall(r'<tr><td colspan=3>(.*?)</td></tr>', h, re.S):
        t = txt(cand)
        if len(t) > 20 and not re.match(r'^(transfer2device|a taste of)', t, re.I):
            rec['description'] = t[:1200]
            break
    m = re.search(r'\((\d+\.\d) MB\)', h)
    if m:
        rec['size'] = m.group(1)
    m = re.search(r'images\.mp3\.com/mp3s/\d+/resources/[^"\']+\.(?:gif|jpg)', h)
    if m:
        rec['cover'] = 'http://' + m.group(0)
    m = ARTIST_LINK.search(h)
    if m:
        rec['artist_key'] = f'{m.group(1)}/{m.group(2)}.html'
        rec['artist_uri'] = uri_of(h)
    return rec


def parse_links_page(h):
    rec = {'website': None, 'links': [], 'artists_we_like': [], 'plays': None, 'messageboard': None}
    m = re.search(r'<a href="(http[^"]+)"[^>]*>\s*(?:<[^>]+>\s*)*Go to the artist\'s web site', h, re.I)
    if m:
        web = html.unescape(m.group(1))
        rec['website'] = None if INTERNO.search(web) else web
    m = re.search(r'([\d,]+)\s*(?:</[^>]+>\s*)*(?:<[^>]+>\s*)*Total Plays', h)
    if m:
        rec['plays'] = int(m.group(1).replace(',', ''))
    m = re.search(r'Artist Messageboard\s*</[^>]+>\s*(?:<[^>]+>\s*)*([\d,]+)', h)
    if m:
        rec['messageboard'] = int(m.group(1).replace(',', ''))
    # Bloque «Our Links»: <a href="url">texto</a> o texto suelto hasta «Sign the Guestbook»
    for label, key in (('Our Links', 'links'), ('Artists We Like', 'artists_we_like')):
        i = h.find(label)
        if i < 0:
            continue
        seg = h[i:i + 6000]
        nxt = [seg.find(x) for x in ('Sign the Guestbook', 'Sign ', 'Copyright notice', 'Artist Extras')
               if seg.find(x) > 0]
        if nxt:
            seg = seg[:min(nxt)]
        for a in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', seg, re.S):
            url, text = html.unescape(a[0]), txt(a[1])
            if not text or INTERNO.search(url) or INTERNO_TXT.search(text):
                continue
            rec[key].append({'url': url, 'text': text[:200]})
        if not rec[key]:
            rest = txt(re.sub(r'<a [^>]+>.*?</a>', ' ', seg, flags=re.S))
            rec[key] = [{'url': None, 'text': rest[:300]}] if rest.strip() else []
    return rec


def correr(kind):
    keys, uris = candidatos()
    dest = os.path.join(OUT, {'artists': 'discografia-venezolanos.jsonl',
                              'songs': 'songs-venezolanos.jsonl',
                              'links': 'links-venezolanos.jsonl'}[kind])
    n = hits = 0
    with tarfile.open(TAR[kind], 'r|bz2') as t, open(dest, 'w', encoding='utf-8') as out:
        for m in t:
            if not m.isfile() or not m.name.endswith('.html'):
                continue
            n += 1
            base = m.name.rsplit('/', 1)[-1]
            grp = m.name.rsplit('/', 2)[-2]
            if kind in ('artists', 'links'):
                key = f'{grp}/{base}'
                if key not in keys:
                    continue
                f = t.extractfile(m)
                if f is None:
                    continue
                h = decode(f.read())
                rec = {'key': key, 'name': keys[key]['name'], 'uri': keys[key]['uri'],
                       'location': keys[key]['location'], 'tier': keys[key]['tier'],
                       'url': f'{URL}/{ "artists" if kind=="artists" else "artist_links" }/{key}'}
                if kind == 'artists':
                    songs = parse_artist_page(h)
                    albumes, orden = {}, []
                    for s in songs:
                        k = (s['media'], s['album'], s['label'])
                        if k not in albumes:
                            albumes[k] = {'media': s['media'], 'album': s['album'], 'label': s['label'], 'tracks': []}
                            orden.append(k)
                        albumes[k]['tracks'].append({x: s[x] for x in ('song_id', 'title', 'credits', 'size', 'url')})
                    rec['albums'] = [albumes[k] for k in orden]
                    rec['plays'] = None
                    mm = re.search(r'([\d,]+)\s*(?:</[^>]+>\s*)*(?:<[^>]+>\s*)*Total Plays', h)
                    if mm:
                        rec['plays'] = int(mm.group(1).replace(',', ''))
                else:
                    rec.update(parse_links_page(h))
            else:
                sid = base[:-5]
                if not sid.isdigit():
                    continue
                f = t.extractfile(m)
                if f is None:
                    continue
                h = decode(f.read())
                rec = parse_song_page(h, sid, grp)
                key = rec.get('artist_key')
                if not (key and key in keys) and (rec.get('artist_uri') or '').lower() not in uris:
                    continue
                if not rec.get('artist_key') and rec.get('artist_uri'):
                    rec['artist_key'] = uris[rec['artist_uri'].lower()]
                rec['name'] = keys[rec['artist_key']]['name']
            out.write(json.dumps(rec, ensure_ascii=False) + '\n')
            hits += 1
            if hits % 200 == 0:
                print(f'{kind}: {hits} ({n} vistos)', flush=True)
    print(f'{kind}: TOTAL {hits} de {n} páginas -> {dest}', flush=True)


if __name__ == '__main__':
    modo = sys.argv[1] if len(sys.argv) > 1 else 'todo'
    for k in (['artists', 'songs', 'links'] if modo == 'todo' else [modo]):
        correr(k)
