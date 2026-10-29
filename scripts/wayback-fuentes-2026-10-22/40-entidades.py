#!/usr/bin/env python3
"""Convierte paginas.jsonl en entidades para el catálogo (sin tocar la base).

Salidas en reports/wayback-fuentes-2026-10-22/entidades/:
  bandas.jsonl        fichas de banda (musica.com.ve, skaypunk, caracaspunk, okradioweb)
  obras.jsonl         banda + obra + año (La Galería del Rock, musica records)
  tracklists.jsonl    programas de radio con temas (Los Andes Eléctronicos)
  artistas.jsonl      artistas de Fusible FM con sus temas
  paginas-genericas.jsonl  resto de páginas con encabezados/tablas (para revisión)

Uso: ~/.venvs/scrapling/bin/python scripts/wayback-fuentes-2026-10-22/40-entidades.py
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
_STAGING = Path.home() / "crv-staging"
_BASE = _STAGING if (_STAGING / "data/raw/wayback-fuentes-2026-10-22").exists() else REPO
RAW = _BASE / "data/raw/wayback-fuentes-2026-10-22"
REPORTS = _BASE / "reports/wayback-fuentes-2026-10-22"
PAGINAS = REPORTS / "paginas.jsonl"
SALIDA = REPORTS / "entidades"

ETIQUETAS = {
    "biografia": r"biograf[ií]a|historia|rese[ñn]a",
    "integrantes": r"integrantes|miembros|formaci[oó]n|alineaci[oó]n",
    "discografia": r"discograf[ií]a|discos|trabajos|demos",
    "influencias": r"influencias",
    "contacto": r"contacto|correo|e-?mail|msn",
    "web": r"p[aá]gina web|sitio web|web|website|myspace|facebook",
    "ciudad": r"ciudad|origen|procedencia",
    "genero": r"g[eé]nero|estilo",
    "links": r"links|enlaces",
    "telefono": r"telfs?|tel[eé]fonos?",
    "fotos": r"fotograf[ií]as|fotos",
    "noticias": r"noticias",
    "miscelanea": r"miscel[aá]neas",
}


def limpia(t: str) -> str:
    t = unicodedata.normalize("NFC", t or "")
    return re.sub(r"\s+", " ", t).strip()


def secciones(texto: str) -> dict[str, str]:
    """Corta el texto por etiquetas tipo «Biografía:» «Integrantes:» etc."""
    patron = re.compile(
        r"(?im)^[ \t]*(%s)[ \t]*:[ \t]*" % "|".join(ETIQUETAS.values()))
    marcas = list(patron.finditer(texto))
    campos: dict[str, str] = {}
    for i, marca in enumerate(marcas):
        etiqueta = marca.group(1).lower()
        clave = "otros"
        for nombre, rx in ETIQUETAS.items():
            if re.fullmatch(rx, etiqueta):
                clave = nombre
                break
        inicio = marca.end()
        fin = marcas[i + 1].start() if i + 1 < len(marcas) else len(texto)
        campos[clave] = limpia(texto[inicio:fin])[:6000]
    return campos


def parsea_musica(pagina: dict) -> dict | None:
    url = pagina["url"]
    if not url.lower().endswith((".htm", ".html")):
        return None
    texto = pagina.get("texto") or ""
    if len(texto) < 200 or "biograf" not in texto.lower():
        return None
    campos = secciones(texto)
    # nombre: título limpio; si el título es basura de plantilla, el archivo
    titulo = limpia(pagina.get("title") or "")
    titulo = re.sub(r"(?i)^musica\.com\.ve\s*[-:]*[|:\s]*", "", titulo).strip(" -:|")
    archivo = url.rstrip("/").rsplit("/", 1)[-1].rsplit(".", 1)[0]
    nombre = titulo if 2 <= len(titulo) <= 80 and "|" not in titulo else archivo.replace("_", " ").title()
    if not nombre or re.match(r"(?i)^(home|index|-)", nombre):
        return None
    return {
        "fuente": "musica.com.ve",
        "url_origen": url,
        "ts": pagina.get("ts", ""),
        "nombre": nombre,
        "nombre_archivo": archivo,
        "biografia": campos.get("biografia", ""),
        "integrantes": campos.get("integrantes", ""),
        "discografia": campos.get("discografia", ""),
        "influencias": campos.get("influencias", ""),
        "contacto": campos.get("contacto", ""),
        "web": campos.get("web", ""),
        "ciudad": campos.get("ciudad", ""),
        "genero": campos.get("genero", ""),
        "links": campos.get("links", ""),
        "telefono": campos.get("telefono", ""),
        "fotos": campos.get("fotos", ""),
        "noticias": campos.get("noticias", ""),
        "miscelanea": campos.get("miscelanea", ""),
        "texto": texto[:12000],
        "encabezado": limpia(texto.split("\n")[0])[:120],
    }


OBRA_RX = re.compile(r"(.{2,120}?)\s*[–—-]\s*(.{2,160}?)\s*\((\d{4})\)")


BANDA_DISCO_RX = re.compile(
    r"^([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .\-\+&'’()]{1,60}?)\s+"      # BANDA en mayúsculas
    r"([A-ZÁÉÍÓÚÑ][a-záéíóúñ].{0,80})$"                            # Álbum en Tipo Título
)


def parsea_caracaspunk(pagina: dict) -> list[dict]:
    """Discos de la sección «discos A-Z» y de «mp3» de caracaspunk.com.

    Cada entrada del sitio es «BANDA Álbum SERVIDOR: … Pal rule: <nick/email> BANDA2 Álbum2».
    El nombre útil está al final del bloque, después del último «Pal rule:».
    """
    url = pagina["url"].lower()
    if "caracaspunk" not in url:
        return []
    texto = " ".join((pagina.get("texto") or "").split())
    filas: list[dict] = []
    if re.search(r"/disco-[a-z0-9]\.asp", url):
        for bloque in re.split(r"SERVIDOR:\s*", texto)[1:]:
            if "Pal rule:" not in bloque:
                continue
            cola = bloque.split("Pal rule:")[-1].strip()
            # fuera el nick/email de créditos: tokens iniciales en minúscula o correos
            for _ in range(4):
                primero = cola.split(" ", 1)[0]
                if not primero:
                    break
                if cola[0].islower() or "@" in primero or primero.lower().endswith((".com", ".es", ".net")):
                    if " " not in cola:
                        cola = ""
                        break
                    cola = cola.split(" ", 1)[1]
                else:
                    break
            m = BANDA_DISCO_RX.match(cola)
            if not m:
                continue
            banda, obra = limpia(m.group(1)), limpia(m.group(2))
            if len(banda) < 2 or len(obra) < 2 or banda.startswith(("PARA", "SECCION")):
                continue
            filas.append({"fuente": "caracaspunk", "tipo": "disco", "url_origen": pagina["url"],
                          "ts": pagina.get("ts", ""), "banda": banda, "obra": obra, "anio": ""})
    elif url.endswith("/mp3.asp"):
        for m in re.finditer(r">>\s*([^<>]{2,60}?)\s*<<", texto):
            filas.append({"fuente": "caracaspunk", "tipo": "banda", "url_origen": pagina["url"],
                          "ts": pagina.get("ts", ""), "banda": limpia(m.group(1)),
                          "obra": "", "anio": ""})
    return filas


def parsea_lagaleria(pagina: dict) -> list[dict]:
    if "lagaleriadelrock" not in pagina["url"]:
        return []
    if not re.search(r"lista-de-arte|galeria|listado-de-obras|flyers|^http://lagaleriadelrock\.com/?$",
                     pagina["url"]):
        return []
    texto = " ".join((pagina.get("texto") or "").split())
    filas: list[dict] = []
    vistos = set()

    def añade(banda: str, obra: str, anio: str, tipo: str = "", diseno: str = "") -> None:
        banda, obra = limpia(banda), limpia(obra)
        # el menú del sitio se cuela en los recortes: quedarse con lo posterior a la marca
        for marca in ("Lo más reciente", "Sube tu arte", "Listado de obras", "Nosotros",
                      "Contacto", "Menu", "Videos Blog"):
            if marca in obra:
                obra = obra.split(marca)[-1]
            if marca in banda:
                banda = banda.split(marca)[-1]
        if "Dise" in obra:
            obra = obra.split("Dise")[0]
        obra = obra.strip(" A○·-–|")
        banda = banda.strip(" A○·-–|")
        if len(banda) < 2 or len(obra) < 2 or len(banda) > 90 or ":" in obra:
            return
        clave = (banda.lower(), obra.lower(), anio)
        if clave in vistos:
            return
        vistos.add(clave)
        filas.append({"fuente": "lagaleriadelrock", "url_origen": pagina["url"],
                      "ts": pagina.get("ts", ""), "banda": banda, "obra": obra,
                      "anio": anio, "tipo": tipo, "diseno": diseno})

    # listado «Banda – Obra (año)» (una sola línea larga en el sitio)
    for m in OBRA_RX.finditer(texto):
        añade(m.group(1), m.group(2), m.group(3))
    # fichas de portada: «<Obra> Artista: X Tipo: Álbum Año: 2013 Diseño: Y»
    for m in re.finditer(
            r"([A-ZÁÉÍÓÚÑ0-9][^:]{1,80}?)\s+Artista:\s*(.{2,90}?)\s*Tipo:\s*(.{2,40}?)\s*A[ñn]o:\s*(\d{4})"
            r"(?:\s*Dise[ñn]o(?:\s+gr[aá]fico)?:?\s*(.{2,90}?))?(?=\s*(?:[A-ZÁÉÍÓÚÑ][^:]{1,80}?\s+Artista:|$))",
            texto):
        añade(m.group(2), m.group(1), m.group(4), limpia(m.group(3)), limpia(m.group(5) or ""))
    return filas


FECHA_RX = re.compile(r"(?:TRACK LIST|PLAYLIST)\s*(\d{2}[-/.]\d{2}[-/.]\d{2,4})", re.I)


def parsea_losandes(pagina: dict) -> list[dict]:
    if "losandeselectronicos" not in pagina["url"]:
        return []
    texto = pagina.get("texto") or ""
    fecha = FECHA_RX.search(texto)
    fecha = fecha.group(1) if fecha else ""
    filas = []
    for tabla in pagina.get("tablas") or []:
        for fila in tabla:
            celdas = [limpia(c) for c in fila if limpia(c)]
            if len(celdas) < 2:
                continue
            if celdas[0].upper().startswith(("TRACK LIST", "ARTIST", "ARTISTA")):
                continue
            artista, tema = celdas[0], celdas[1]
            sello = celdas[2] if len(celdas) > 2 else ""
            if len(artista) > 90 or len(tema) > 120:
                continue
            filas.append({
                "fuente": "losandeselectronicos",
                "url_origen": pagina["url"], "ts": pagina.get("ts", ""),
                "fecha_programa": fecha, "artista": artista, "tema": tema, "sello": sello,
            })
    return filas


def parsea_skaypunk(pagina: dict) -> list[dict]:
    """Toques (conciertos) de skaypunk: fecha, recinto y bandas separadas por «+»."""
    if "skaypunk" not in pagina["url"] or not re.search(r"/toques\.htm", pagina["url"]):
        return []
    texto = " ".join((pagina.get("texto") or "").split())
    texto = re.sub(r"(?i)^.*?skaypunk\s*toques\s*", "", texto)
    filas = []
    for parte in re.split(r"(?=\d{2}/\d{2}/\d{2})", texto)[1:]:
        m = re.match(r"(\d{2}/\d{2}/\d{2})\s*(.{5,500}?)(?:\s+\d+\s*Bs|\s*$)", parte)
        if not m:
            continue
        fecha, resto = m.group(1), limpia(m.group(2))
        bandas = [limpia(b) for b in resto.split("+") if len(limpia(b)) > 1]
        filas.append({"fuente": "skaypunk", "url_origen": pagina["url"], "ts": pagina.get("ts", ""),
                      "fecha": fecha, "descripcion": resto[:400], "bandas": bandas})
    return filas


def parsea_fusiblefm(pagina: dict) -> dict | None:
    """Perfil de músico/DJ de Fusible FM (CMS Jamroom)."""
    url = pagina["url"]
    if "fusiblefm" not in url:
        return None
    texto = " ".join((pagina.get("texto") or "").split())
    m = re.search(r"(Male|Female)\s+(\d{1,2}) years old\s+(.{2,60}?)\s+Profile Views", texto)
    if not m:
        return None
    miembro = re.search(r"MEMBER SINCE:\s*([\d/]+)", texto)
    nombre = url.rstrip("/").rsplit("/", 1)[-1]
    return {"fuente": "fusiblefm", "url_origen": url, "ts": pagina.get("ts", ""),
            "nombre": nombre, "sexo": m.group(1), "edad": m.group(2),
            "ciudad": limpia(m.group(3)), "miembro_desde": miembro.group(1) if miembro else "",
            "texto": texto[:4000]}


def main() -> None:
    if not PAGINAS.exists():
        raise SystemExit("sin paginas.jsonl: ejecuta 20-extrae.py")
    SALIDA.mkdir(parents=True, exist_ok=True)
    bandas, obras, tracklists, genericas = [], [], [], []
    eventos, perfiles = [], []
    contador: Counter = Counter()
    for linea in open(PAGINAS, encoding="utf-8"):
        pagina = json.loads(linea)
        site = pagina["site"]
        contador[site] += 1
        if site == "musica-bandas":
            banda = parsea_musica(pagina)
            if banda:
                bandas.append(banda)
                continue
        if site == "lagaleriadelrock":
            filas = parsea_lagaleria(pagina)
            if filas:
                obras.extend(filas)
                continue
        if site == "caracaspunk":
            filas = parsea_caracaspunk(pagina)
            if filas:
                obras.extend(filas)
                continue
        if site == "losandes":
            filas = parsea_losandes(pagina)
            if filas:
                tracklists.extend(filas)
                continue
        if site == "skaypunk":
            filas = parsea_skaypunk(pagina)
            if filas:
                eventos.extend(filas)
                continue
        if site == "fusiblefm":
            perfil = parsea_fusiblefm(pagina)
            if perfil:
                perfiles.append(perfil)
                continue
        if site in ("okradioweb", "caracaspunk", "skaypunk", "fusiblefm"):
            genericas.append({
                "fuente": site, "url_origen": pagina["url"], "ts": pagina.get("ts", ""),
                "title": pagina.get("title", ""), "headings": pagina.get("headings", []),
                "texto": (pagina.get("texto") or "")[:8000],
                "tablas": pagina.get("tablas", []),
            })

    def escribe(nombre: str, filas: list[dict]) -> None:
        with open(SALIDA / nombre, "w", encoding="utf-8") as fh:
            for fila in filas:
                fh.write(json.dumps(fila, ensure_ascii=False) + "\n")
        print(f"{nombre}: {len(filas)}")

    escribe("bandas.jsonl", bandas)
    escribe("obras.jsonl", obras)
    escribe("tracklists.jsonl", tracklists)
    escribe("eventos.jsonl", eventos)
    escribe("perfiles.jsonl", perfiles)
    escribe("paginas-genericas.jsonl", genericas)
    print("páginas leídas:", dict(contador))


if __name__ == "__main__":
    main()
