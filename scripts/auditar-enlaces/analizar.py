#!/usr/bin/env python3
"""Juzga cada enlace con la evidencia del colector. No escribe en la base.

Veredictos: ok · ajeno (el nombre no es el del artista) · homonimo (mismo nombre,
ningún disco o pista en común) · disco_ajeno · disco_distinto (mismo artista,
otro título) · muerto · sin_evidencia.

  python3 scripts/auditar-enlaces/analizar.py DIR
"""
import collections, difflib, json, re, sys, unicodedata
from pathlib import Path
from urllib.parse import unquote

OUT = Path(sys.argv[1])
VACIAS = {"the", "los", "las", "el", "la", "le", "les", "de", "del", "y", "and", "band", "banda", "grupo", "group", "oficial", "official", "music", "musica", "topic", "tema", "vevo", "artist"}
PLAZA = re.compile(r"(?<![a-z])(japan|jp|jpn|indonesia|indo|nola|korea|kr|brasil|brazil|mexico|mx|argentina|arg|chile|colombia|peru|spain|espana|italia|italy|france|german|germany|deutschland|uk|usa|sweden|swedish|russia|turkey|turkiye|tokyo|nyc)(?![a-z])")
EXT_PLAZA = {"jp", "de", "fr", "it", "es", "ru", "br", "mx", "ar", "cl", "co", "pe", "uk", "kr", "id", "tr", "pl", "nl", "se", "no", "fi", "dk"}


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").lower()
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip()


def nucleo(s):
    s = re.sub(r"\s*-\s*(topic|tema)\s*$", "", s or "", flags=re.I)
    return " ".join(t for t in norm(s).split() if t not in VACIAS) or norm(s)


def compacto(s):
    return nucleo(s).replace(" ", "")


def llano(s):
    return norm(s).replace(" ", "")


COLA = re.compile(r"(oficial|official|ofic|ofc|music|musica|musik|band|banda|vevo|ve|vzla|venezuela|tv|rock|metal|hq|real|the|el|la|los|las)+$")
GENERICAS = {"wix", "vevo", "umusicjapan", "youtube", "facebook", "instagram", "twitter", "tiktok", "spotify", "linktree", "squarespace", "wordpress", "soundcloud", "bandcamp", "reverbnation", "myspace", "discogs", "sharer", "share", "pages"}


def parecido(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


artistas = {}
for line in open(OUT / "artistas.jsonl", encoding="utf8"):
    d = json.loads(line)
    d["nombres"] = {d["name"]}
    artistas[d["id"]] = d
for line in open(OUT / "alias.jsonl", encoding="utf8"):
    d = json.loads(line)
    if d["artist_id"] in artistas:
        artistas[d["artist_id"]]["nombres"].add(d["alias"])
discos = {}
for line in open(OUT / "discos.jsonl", encoding="utf8"):
    d = json.loads(line)
    discos[d["id"]] = d
relaciones = OUT / "relacionados.jsonl"
if relaciones.exists():
    for line in open(relaciones, encoding="utf8"):
        d = json.loads(line)
        if d["artist_id"] in artistas:
            artistas[d["artist_id"]].setdefault("relacionados", set()).add(d["name"])
ev = {}
for f in OUT.glob("evidencia-*.jsonl"):
    for line in open(f, encoding="utf8"):
        d = json.loads(line)
        ev[d["url"]] = d
# Créditos por pista releídos: el crédito del álbum solo nombra al principal.
CRED_PISTA = {}
if (OUT / "creditos-pista-spotify.jsonl").exists():
    for line in open(OUT / "creditos-pista-spotify.jsonl", encoding="utf8"):
        d = json.loads(line)
        CRED_PISTA[d["id"]] = d.get("creditos_pista") or []


def nombre(artista, otro):
    """exacto · parcial (contiene, casi igual, siglas) · relacionado · miembro · no"""
    n, plano = compacto(otro), llano(otro)
    if not n:
        return "no"
    plano_corto = COLA.sub("", plano) or plano
    if {n, plano, plano_corto} & ({compacto(x) for x in artista["nombres"]} | {llano(x) for x in artista["nombres"]}):
        return "exacto"
    for x in artista["nombres"]:
        for c in {compacto(x), llano(x)}:
            if len(c) >= 4 and (c in plano or (len(plano_corto) >= 4 and plano_corto in c)):
                return "parcial"
            if len(c) >= 5 and parecido(c, plano) >= 0.86:
                return "parcial"
            if len(c) >= 2 and plano.startswith(c) and COLA.fullmatch(plano[len(c):] or "ve"):
                return "parcial"
        fichas = [t for t in norm(x).split() if t not in VACIAS]
        if len(fichas) >= 2:
            if max(fichas, key=len) in plano and len(max(fichas, key=len)) >= 5:
                return "parcial"
            if llano(x) and "".join(t[0] for t in norm(otro).split() if t not in VACIAS) == llano(x):
                return "parcial"
            if artista.get("artist_type") == "solo_artist" and len(fichas[-1]) >= 4 and fichas[-1] in plano:
                return "parcial"
        iniciales = "".join(t[0] for t in norm(otro).split())
        if len(llano(x)) >= 2 and iniciales == llano(x):
            return "parcial"
    if any(llano(r) and (llano(r) == plano or llano(r) in plano) for r in artista.get("relacionados", ())):
        return "relacionado"
    for m in artista["members"]:
        fichas = norm(m).split()
        if llano(m) == plano or (fichas and len(fichas[-1]) >= 5 and fichas[-1] in plano):
            return "miembro"
    return "no"


def comunes(artista, e):
    propios = {norm(t) for t in artista["albums"] + artista["tracks"] if len(norm(t)) > 3}
    ajenos = {norm(t) for t in (e.get("albums") or []) + (e.get("tracks") or []) if t}
    base = {norm(re.sub(r"\s*[\(\[].*?[\)\]]", "", t)) for t in (e.get("albums") or []) + (e.get("tracks") or []) if t}
    return sorted(propios & (ajenos | base))


def nombre_qobuz(e):
    if e.get("tipo") == "artist":
        return re.sub(r"\s*Discography.*$", "", e.get("name", ""), flags=re.I)
    return None


# Estas campañas casaron el perfil por un disco del catálogo; lo que devuelve el perfil es parcial.
PROBADAS = {"spotify-search-album", "tidal-search", "ytmusic-search", "qobuz-public-catalog", "deezer-reeleccion", "spotify-web-sesion", "spotify-lote-confirmado"}


def juzgar_musica(link, artista, e):
    if e is None:
        return "pendiente", "sin evidencia recogida"
    if e.get("err"):
        # Apple y Tidal responden por tienda de un país; /c/ y /user/ no se resuelven por identificador.
        firme = link["platform"] in ("deezer", "soundcloud") or (link["platform"] == "youtube" and "/channel/" in link["url"] or "watch?v=" in link["url"])
        if e["err"] in ("no existe", "HTTP 404", "HTTP 410") and firme:
            return "muerto", e["err"]
        return "sin_evidencia", e["err"]
    tipo = e.get("tipo")
    if link["platform"] == "qobuz" and tipo == "album":
        t = re.sub(r"\s*-\s*Qobuz\s*$", "", e.get("name", ""))
        partes = t.rsplit(",", 1)
        e = {**e, "name": partes[0], "artists": [partes[1].strip()] if len(partes) == 2 else []}
        if len(partes) < 2:
            return "sin_evidencia", "título sin artista"
    if link["platform"] == "qobuz" and tipo == "artist":
        e = {**e, "name": nombre_qobuz(e)}
    if link["album_id"]:
        disco = discos.get(link["album_id"])
        creditos = [a for a in (e.get("artists") or []) if a]
        creditos += e.get("creditos_pista") or []
        if link["platform"] == "spotify":
            creditos += CRED_PISTA.get(link["id"], [])
        if not creditos:
            return "sin_evidencia", "sin créditos"
        va = any(norm(c) in ("various artists", "varios artistas", "various", "varios") for c in creditos)
        mejor = max(((nombre(artista, x)) for x in creditos), key=["no", "relacionado", "miembro", "parcial", "exacto"].index)
        if artista and norm(artista["name"]) in ("various artists", "varios artistas", "varios"):
            mejor = "exacto"
        a, b = nucleo(disco["title"]) if disco else "", nucleo(e.get("name"))
        similar = bool(a and b) and (a == b or a in b or b in a or parecido(a, b) >= 0.72)
        if tipo == "video":
            todo = norm(" ".join([e.get("name") or "", e.get("desc") or ""]))
            if mejor != "no" or (a and a in nucleo(todo)) or any(nucleo(x) and nucleo(x) in nucleo(todo) for x in artista["nombres"]):
                return "ok", ""
            return "dudoso", f"video de «{', '.join(creditos)[:50]}», título «{(e.get('name') or '')[:60]}»"
        if mejor == "no" and not va:
            if similar and tipo != "video":
                return "disco_ajeno", f"título parecido, crédito «{', '.join(creditos)[:80]}»"
            return "disco_ajeno", f"crédito «{', '.join(creditos)[:80]}», título «{(e.get('name') or '')[:60]}»"
        if not similar and tipo != "video":
            return "disco_distinto", f"título «{(e.get('name') or '')[:70]}» ≠ «{disco['title'][:70] if disco else ''}»"
        return "ok", ""
    if re.fullmatch(r"\s*-?\s*Topic\s*", e.get("name") or ""):
        return "sin_evidencia", "canal automático «Topic» sin nombre en la API"
    e = {**e, "name": re.sub(r"\s*-\s*Topic\s*$", "", e.get("name") or "")}
    # Título genérico de la plataforma (portada de Qobuz, «Home» de Spotify): no dice quién es.
    if re.search(r"qobuz", e.get("name") or "", re.I) or (e.get("name") or "").strip().lower() == "home":
        return "sin_evidencia", "la plataforma devolvió un título genérico"
    n = nombre(artista, e.get("name"))
    if n == "no" and tipo in ("channel", "perfil") and any(nucleo(x) and nucleo(x) in nucleo(e.get("desc") or "") for x in artista["nombres"]):
        return "ok", "lo nombra su descripción"
    if n == "no":
        return ("canal_distinto" if tipo in ("channel", "perfil") else "ajeno"), f"se llama «{(e.get('name') or '')[:70]}»"
    if tipo in ("channel", "perfil", "video", "web"):
        return "ok", n
    cm = comunes(artista, e)
    if cm:
        return "ok", f"en común: {'; '.join(cm[:3])[:90]}"
    if not artista["albums"] and not artista["tracks"]:
        return "sin_evidencia", "la ficha no tiene discos para comparar"
    if not (e.get("albums") or e.get("tracks")):
        return "sin_evidencia", "el perfil no lista discos"
    if link["platform"] == "tidal" and len(e.get("albums") or []) >= 20:
        return "sin_evidencia", "Tidal solo enseña 20 discos: no prueba nada"
    if link.get("source") in PROBADAS:
        return "sin_evidencia", f"sin títulos en común, pero {link['source']} casó por disco"
    return "homonimo", f"«{(e.get('name') or '')[:50]}»: nada en común ({len(e.get('albums') or [])} discos, {len(e.get('tracks') or [])} pistas)"


def asa(url):
    u = unquote(url).split("?")[0].rstrip("/")
    if not re.search(r"instagram\.com|twitter\.com|//x\.com|tiktok\.com|threads\.net|facebook\.com|linktr\.ee", u, re.I):
        # Web propia: lo que identifica es el dominio (o el subdominio en wixsite y compañía), nunca /home ni /bio.
        partes = re.sub(r"^www\.", "", re.sub(r"^https?://", "", u).split("/")[0]).split(".")
        return partes[0]
    m = re.search(r"(?:instagram\.com|twitter\.com|x\.com|tiktok\.com/@?|threads\.net/@?|facebook\.com(?:/pages)?)/@?([^/]+)", u, re.I)
    h = m.group(1) if m else u.rsplit("/", 1)[-1]
    return "" if re.fullmatch(r"(people|profile\.php|pg|groups)", h, re.I) else h


def juzgar_red(link, artista, e, malos):
    if e and e.get("err") in ("HTTP 404", "HTTP 410"):
        return "muerto", e["err"]
    url = link["url"]
    if link["platform"] in ("website", "linktree", "store"):
        if e and e.get("err") and re.search(r"Name or service|HTTP 40[04]|HTTP 410", e["err"]):
            return "muerto", e["err"]
        if e and not e.get("err"):
            cuerpo = norm(" ".join([e.get("name", ""), e.get("og", ""), e.get("desc", ""), e.get("cuerpo", "")]))
            dominio = re.sub(r"^www\.", "", re.sub(r"^https?://", "", url).split("/")[0])
            if any(len(compacto(x)) >= 3 and (nucleo(x) in cuerpo or compacto(x) in compacto(cuerpo) or compacto(x) in compacto(dominio)) for x in artista["nombres"]):
                return "ok", ""
            return "ajeno", f"la página no nombra al artista: «{e.get('name', '')[:70]}»"
    h = asa(url)
    if not h or re.fullmatch(r"\d+", h):
        return ("sin_evidencia", "URL sin nombre legible")
    if e and e.get("name") and nombre(artista, e["name"]) == "no" and nombre(artista, h) == "no":
        return "ajeno", f"perfil «{e['name'][:50]}»"
    n = nombre(artista, h)
    resto = norm(re.sub(r"[._-]+", " ", h))
    plaza = PLAZA.search(resto) or PLAZA.search(re.sub(compacto(artista["name"]) or "\0", " ", resto.replace(" ", "")))
    origen = norm(" ".join(filter(None, [artista.get("country"), artista.get("city")])))
    if plaza and plaza.group(1) not in origen and n != "miembro":
        return "otro_lugar", f"la cuenta indica otro lugar: «{h}»"
    if llano(h) in GENERICAS:
        return "ajeno", f"cuenta genérica «{h}», recogida de la página de otra cosa"
    if n == "no" and malos and link.get("source") in malos:
        return "ajeno", f"usuario «{h}» distinto y de la misma fuente ({link['source']}) que un enlace de otra banda de esta ficha"
    if n == "no":
        return "dudoso", f"el usuario «{h}» no se parece al nombre"
    return "ok_nombre", "el usuario coincide; la red no deja comprobar más"


enlaces = [json.loads(line) for line in open(OUT / "enlaces.jsonl", encoding="utf8")]
for l in enlaces:
    if not l["artist_id"] and l["album_id"] and l["album_id"] in discos:
        l["artist_id"] = discos[l["album_id"]]["artist_id"]

salida, malos = [], collections.defaultdict(set)
MUSICA_FUENTE = re.compile(r"musicbrainz|wikidata|discogs")
for l in enlaces:
    if l["k"] != "stream":
        continue
    a = artistas.get(l["artist_id"])
    if not a:
        continue
    if l["platform"] == "amazon_music":
        v, por = "sin_evidencia", "Amazon no ofrece vía pública"
    elif l["platform"] == "bandcamp":
        sub = re.sub(r"^https?://", "", l["url"]).split(".bandcamp")[0]
        n = nombre(a, sub.replace("-", " ")) if not l["album_id"] else nombre(a, sub.replace("-", " "))
        v, por = ("ok_nombre", "") if n != "no" else ("dudoso", f"Bandcamp «{sub}» no se parece; podría ser un sello")
    else:
        v, por = juzgar_musica(l, a, ev.get(l["url"]))
    if v in ("ajeno", "homonimo") and not l["album_id"] and MUSICA_FUENTE.search(l.get("source") or ""):
        malos[l["artist_id"]].add(l["source"])
    salida.append({**l, "v": v, "por": por, "artista": a["name"]})
# Un perfil sin títulos en común deja de parecer homónimo si la ficha ya tiene discos bien
# atribuidos en la misma plataforma.
discos_bien = {(x["artist_id"], x["platform"]) for x in salida if x["album_id"] and x["v"] == "ok"}
for x in salida:
    if x["v"] == "homonimo" and (x["artist_id"], x["platform"]) in discos_bien:
        x["v"], x["por"] = "sin_evidencia", "sin títulos en común en el perfil, pero sus discos en esta plataforma son correctos"
for l in enlaces:
    if l["k"] != "social":
        continue
    a = artistas.get(l["artist_id"])
    if a:
        v, por = juzgar_red(l, a, ev.get(l["url"]), malos.get(l["artist_id"]))
        salida.append({**l, "v": v, "por": por, "artista": a["name"]})

# Un mismo perfil en varias fichas: al menos en una sobra.
por_url = collections.defaultdict(set)
for x in salida:
    if not x["album_id"]:
        por_url[x["url"].rstrip("/").lower()].add(x["artist_id"])
for x in salida:
    if not x["album_id"] and len(por_url[x["url"].rstrip("/").lower()]) > 1:
        x["compartido"] = sorted(por_url[x["url"].rstrip("/").lower()])
        if x["v"] in ("ok", "ok_nombre") and nombre(artistas[x["artist_id"]], asa(x["url"])) == "no":
            x["v"], x["por"] = "dudoso", f"el mismo perfil está en las fichas {x['compartido']}"

with open(OUT / "veredictos.jsonl", "w", encoding="utf8") as f:
    for x in salida:
        f.write(json.dumps(x, ensure_ascii=False) + "\n")
t = collections.Counter((x["k"], "disco" if x["album_id"] else "artista", x["platform"], x["v"], x["verified"]) for x in salida)
tabla = collections.defaultdict(collections.Counter)
for (k, nivel, p, v, ver), c in t.items():
    if ver:
        tabla[(nivel, p)][v] += c
for k in sorted(tabla):
    print(k, dict(tabla[k].most_common()))
print("visibles por veredicto:", collections.Counter(x["v"] for x in salida if x["verified"]).most_common())
