import re, unicodedata
from urllib.parse import urlsplit

def norm(s):
    return re.sub(r'[^a-z0-9]+','', ''.join(c for c in unicodedata.normalize('NFKD',s.lower()) if not unicodedata.combining(c)))
# Estas plataformas no son una web propia; sus enlaces se conservan como evidencia de búsqueda.
EXCLUDED={'wikipedia.org','wikidata.org','discogs.com','musicbrainz.org','youtube.com','youtu.be','spotify.com','apple.com','facebook.com','instagram.com','tiktok.com','reddit.com','last.fm','musicavenezuela.com','sincopa.com','lobotoradio.com','venciclopedia.org','amazon.com','deezer.com','qobuz.com','shazam.com','tidal.com','allmusic.com','rateyourmusic.com','rockhechovenezuela.com','soundcloud.com','bandcamp.com','linktr.ee','twitter.com','x.com','metal-archives.com','reverbnation.com','myspace.com','pinterest.com','letras.com','musica.com','vagalume.com.br','genius.com','setlist.fm','songkick.com','bandsintown.com','ticketmaster.com','fandom.com','rocktambulos.com','rockzuela.com','spinnradio.com','tumblr.com','blogger.com','archive.org','google.com','bing.com','yahoo.com','yandex.com','t.co'}
def own_site(url):
    try:
        p=urlsplit(url); h=p.hostname or ''
        return p.scheme in ('http','https') and bool(h) and not any(h==x or h.endswith('.'+x) for x in EXCLUDED) and not re.search(r'\.(pdf|jpg|png|mp3|zip)$',p.path,re.I)
    except ValueError:return False
