#!/usr/bin/env python3
"""Piezas compartidas por los cosechadores de enlaces de la campaña 2026-10-19."""
import re
import unicodedata
from urllib.parse import urlparse

PLATFORM_BY_TYPE = {
    "FACEBOOK": "facebook", "INSTAGRAM": "instagram", "TIKTOK": "tiktok",
    "TWITTER": "x", "X": "x", "THREADS": "threads", "BLUESKY": "bluesky",
    "SPOTIFY": "spotify", "APPLE_MUSIC": "apple_music", "APPLEMUSIC": "apple_music",
    "YOUTUBE": "youtube", "YOUTUBE_MUSIC": "youtube_music", "DEEZER": "deezer",
    "TIDAL": "tidal", "BANDCAMP": "bandcamp", "SOUNDCLOUD": "soundcloud",
    "AMAZON_MUSIC": "amazon_music", "AMAZONMUSIC": "amazon_music", "QOBUZ": "qobuz",
    "WEBSITE": "website", "STORE": "store", "SHOP": "store",
}
SOCIAL = {"instagram", "facebook", "tiktok", "x", "threads", "bluesky", "website", "store", "linktree"}
STREAMING = {"spotify", "apple_music", "youtube", "youtube_music", "deezer", "tidal",
             "bandcamp", "soundcloud", "amazon_music", "qobuz"}
STORE_HOSTS = ("bigcartel.com", "myshopify.com", "tiendanube.com", "nuvemshop.com.br",
               "merchbar.com", "teespring.com", "spreadshop.com", "printful.com")
STORE_PATHS = (("etsy.com", "/shop/"), ("redbubble.com", "/people/"), ("bandcamp.com", "/merch"))
BLOCKED_HOSTS = ("cdn.shopify.com", "help.shopify.com", "www.shopify.com", "shopify.com",
                 "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com",
                 "connect.facebook.net", "platform.twitter.com", "platform.instagram.com",
                 "syndication.twitter.com", "cdninstagram.com", "fbcdn.net", "sc-static.net",
                 "google-analytics.com", "googletagmanager.com", "doubleclick.net",
                 "w3.org", "schema.org", "wordpress.org", "gstatic.com")
ASSET_RE = re.compile(r"\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|json|xml|txt|pdf|zip|mp3|mp4)(\?|#|$)", re.I)
HOST_RULES = (
    ("linktr.ee", "linktree"), ("linktree.com", "linktree"),
    ("music.youtube.com", "youtube_music"),
    ("instagram.com", "instagram"), ("facebook.com", "facebook"), ("fb.com", "facebook"),
    ("tiktok.com", "tiktok"), ("twitter.com", "x"), ("x.com", "x"), ("threads.net", "threads"),
    ("bsky.app", "bluesky"), ("open.spotify.com", "spotify"), ("music.apple.com", "apple_music"),
    ("deezer.com", "deezer"), ("tidal.com", "tidal"), ("bandcamp.com", "bandcamp"),
    ("soundcloud.com", "soundcloud"), ("amazon.com", "amazon_music"), ("qobuz.com", "qobuz"),
    ("youtube.com", "youtube"), ("youtu.be", "youtube"),
)


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "", text)


def canon(url: str) -> str:
    try:
        p = urlparse(url)
        host = (p.hostname or "").lower().replace("www.", "").replace("m.", "")
        path = re.sub(r"/+$", "", p.path or "")
        return f"{host}{path}".lower()
    except Exception:
        return (url or "").lower()


def platform_of(url: str) -> str | None:
    low = url.lower()
    host = (urlparse(low).hostname or "")
    if any(host == h or host.endswith("." + h) for h in STORE_HOSTS):
        return "store"
    if any(d in low and p in low for d, p in STORE_PATHS):
        return "store"
    for token, platform in HOST_RULES:
        if host == token or host.endswith("." + token):
            return platform
    return None


def external_id(platform: str, url: str) -> str | None:
    m = re.search(r"/artist/([A-Za-z0-9]+)", url)
    if platform == "spotify" and m:
        return m.group(1)
    m = re.search(r"/artist/[^/]+/(\d+)", url)
    if platform == "apple_music" and m:
        return m.group(1)
    m = re.search(r"/artist/(\d+)", url)
    if platform in ("deezer", "tidal") and m:
        return m.group(1)
    m = re.search(r"/interpreter/[^/]+/(\d+)", url)
    if platform == "qobuz" and m:
        return m.group(1)
    m = re.search(r"/channel/(UC[A-Za-z0-9_-]{20,24})", url)
    if platform in ("youtube", "youtube_music") and m:
        return m.group(1)
    return None


def handle_of(platform: str, url: str) -> str | None:
    if platform == "linktree":
        m = re.search(r"linktr\.ee/([A-Za-z0-9._-]+)", url)
        return m.group(1) if m else None
    if platform not in ("instagram", "facebook", "tiktok", "x", "threads"):
        return None
    m = re.search(r"(?:instagram\.com|facebook\.com|tiktok\.com/@|x\.com|twitter\.com|threads\.net/@?)/?@?([A-Za-z0-9._-]+)", url)
    if not m:
        return None
    handle = m.group(1)
    return None if handle.lower() in ("profile.php", "pages", "people") else handle


NON_PROFILE_PATHS = {
    "p", "reel", "reels", "stories", "explore", "tv", "share", "watch", "hashtag",
    "groups", "events", "pages", "photo", "video", "photos", "posts", "story.php",
    "marketplace", "login", "signup", "about", "help", "legal", "privacy",
    "2008", "tr", "sharer", "sharer.php", "plugins", "dialog", "intent", "connect",
    "v2.0", "policies", "policy.php", "business", "ads", "developer",
}


def valid_for_artist(platform: str, url: str) -> bool:
    """Solo perfiles del artista: un álbum, una playlist o un post no son el enlace del artista."""
    low = url.lower()
    if platform in ("spotify", "apple_music"):
        return "/artist/" in low
    if platform == "deezer":
        return "deezer.com/artist/" in low
    if platform == "tidal":
        return bool(re.search(r"tidal\.com/(browse/)?artist/", low))
    if platform in ("youtube", "youtube_music"):
        return bool(re.search(r"youtube\.com/(channel/|@|user/|c/)", low))
    if platform == "bandcamp":
        return bool(re.search(r"^https?://[a-z0-9-]+\.bandcamp\.com/?$", low)) or "/artist/" in low
    if platform == "soundcloud":
        return bool(re.search(r"^https?://(www\.)?soundcloud\.com/[a-z0-9_-]+/?$", low)) and "/player" not in low
    if platform == "qobuz":
        return "/interpreter/" in low
    if platform == "amazon_music":
        return "/artists/" in low or "/artist/" in low
    if platform == "linktree":
        return bool(re.search(r"^https?://(www\.)?linktr\.ee/[A-Za-z0-9._-]+/?$", low))
    if platform in ("instagram", "facebook", "tiktok", "x", "threads"):
        if platform == "tiktok" and "/video/" in low:
            return False
        if platform == "instagram" and ("/p/" in low or "/reel/" in low or "/stories/" in low):
            return False
        segments = [s for s in urlparse(low).path.split("/") if s]
        if not segments:
            return False
        first = segments[0].lstrip("@")
        return first not in NON_PROFILE_PATHS and not first.endswith(".php")
    return True


def clean_url(url: str) -> str:
    """Normaliza el enlace: sin parámetros de campaña, sin hosts móviles y sin embeds."""
    import html as html_lib
    url = html_lib.unescape(url).strip().rstrip(".,;:!?\"')]}>")
    p = urlparse(url)
    raw_host = (p.hostname or "").lower()
    host = raw_host[4:] if raw_host.startswith("www.") else raw_host
    host = host[2:] if host.startswith("m.") else host
    if host in ("facebook.com", "fb.com", "es-es.facebook.com", "web.facebook.com", "es-la.facebook.com"):
        host = "www.facebook.com"
    if host == "instagram.com":
        host = "www.instagram.com"
    if host in ("twitter.com", "mobile.twitter.com"):
        host = "twitter.com"
    if host == "youtube.com" and "music." not in (p.hostname or ""):
        host = "www.youtube.com"
    path = p.path or ""
    # Spotify: un embed es el mismo perfil.
    m = re.match(r"^/embed/(artist|album|track|playlist)/([A-Za-z0-9]+)", path)
    if host == "open.spotify.com" and m:
        path = f"/{m.group(1)}/{m.group(2)}"
    query = ""
    if "profile.php" in path and "id=" in (p.query or ""):
        m = re.search(r"(?:^|&)id=(\d+)", p.query)
        if m:
            query = f"?id={m.group(1)}"
    path = re.sub(r"/+$", "", path)
    return f"{p.scheme or 'https'}://{host}{path}{query}"


SHORTENERS = ("urlgeni.us", "beacons.ai", "beacons.page", "taplink.cc", "bio.link",
              "linkr.bio", "milkshake.app", "linkin.bio", "allmylinks.com", "lnk.bio",
              "solo.to", "bio.site", "komi.io", "sleekbio.com", "carrd.co", "msha.ke",
              "withkoji.com", "linkfly.to")


def resolve_short(url: str, depth: int = 0) -> list[str]:
    """Sigue un acortador o página «link in bio» y devuelve las URLs finales candidatas."""
    import requests
    host = re.sub(r"^https?://(www\.)?", "", url.lower()).split("/")[0]
    if depth > 2 or not any(host.endswith(s) for s in SHORTENERS):
        return [url]
    try:
        response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=8, allow_redirects=True)
    except Exception:
        return [url]
    final = response.url
    if final.rstrip("/") != url.rstrip("/"):
        return [final]
    found = []
    for candidate in re.findall(r"https?://[^\s\"'<>]+", response.text):
        candidate = candidate.replace("\\/", "/").replace("&amp;", "&").rstrip(".,;)")
        if to_link(candidate):
            found.append(candidate)
    return found or [url]


def to_link(url: str, verified: bool = True) -> dict | None:
    url = clean_url(url)
    low = url.lower()
    host = urlparse(low).hostname or ""
    if ASSET_RE.search(urlparse(low).path or ""):
        return None
    if any(host == h or host.endswith("." + h) for h in BLOCKED_HOSTS):
        return None
    platform = platform_of(url)
    if not platform or not valid_for_artist(platform, url):
        return None
    return {
        "category": "social" if platform in SOCIAL else "streaming",
        "platform": platform,
        "url": url,
        "handle": handle_of(platform, url),
        "externalId": external_id(platform, url),
        "verified": verified,
    }
