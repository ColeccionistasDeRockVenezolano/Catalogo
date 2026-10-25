#!/usr/bin/env python3
"""Cosecha la bio de Instagram de los artistas del catálogo (CRV, 2026-10-19).

Usa el perfil de Chrome del dueño COPIADO (nunca el original) con
`--password-store=gnome-libsecret`, que es lo único que descifra la cookie de sesión.
Por cada handle abre https://www.instagram.com/<handle>/ en headless y extrae del JSON
embebido: full_name, biography y bio_links[].url (el enlace de la bio).

Salida (reanudable, una línea por handle ya procesado):
  instagram.jsonl   {artistId, handle, fullName, biography, bioLinks, followers, blocked}
  propuestas.jsonl  enlaces de la bio que se pueden publicar (linktree, tienda, redes)
  resumen.tsv       artistId, handle, estado, enlaces
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

CHROME = "/opt/google/chrome/chrome"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36")
SRC_PROFILE = os.path.expanduser("~/.config/google-chrome")


def prepare_profile(dest: str) -> None:
    if os.path.exists(os.path.join(dest, "Default", "Cookies")):
        return
    os.makedirs(os.path.join(dest, "Default"), exist_ok=True)
    for rel in ("Local State", "Default/Cookies", "Default/Cookies-journal",
                "Default/Preferences", "Default/Local Storage", "Default/Session Storage"):
        src = os.path.join(SRC_PROFILE, rel)
        dst = os.path.join(dest, rel)
        if not os.path.exists(src):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
        else:
            shutil.copy2(src, dst)


def capture(handle: str, profile: str, outdir: str) -> dict:
    html_path = os.path.join(outdir, f"_tmp_{os.getpid()}_{handle}.html")
    command = [
        CHROME, f"--user-data-dir={profile}", "--password-store=gnome-libsecret",
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled", f"--user-agent={UA}",
        "--virtual-time-budget=8000", "--dump-dom", f"https://www.instagram.com/{handle}/",
    ]
    try:
        with open(html_path, "w", encoding="utf-8", errors="replace") as out:
            subprocess.run(command, stdout=out, stderr=subprocess.DEVNULL, timeout=90)
        html = open(html_path, encoding="utf-8", errors="replace").read()
    except (subprocess.TimeoutExpired, OSError):
        return {"handle": handle, "state": "timeout"}
    finally:
        if os.path.exists(html_path):
            os.remove(html_path)

    if len(html) < 50000 and "Login" in html[:20000]:
        return {"handle": handle, "state": "login-wall"}
    full = re.search(r'"full_name":"((?:[^"\\]|\\.)*)"', html)
    bio = re.search(r'"biography":"((?:[^"\\]|\\.)*)"', html)
    followers = re.search(r'"edge_followed_by":\{"count":(\d+)\}', html)
    username = re.search(r'"username":"([A-Za-z0-9._]+)"', html)
    def unescape(value: str | None) -> str | None:
        if not value:
            return None
        try:
            return json.loads(f'"{value}"')
        except json.JSONDecodeError:
            return value

    links = []
    for block in re.findall(r'"bio_links":\[(.*?)\]', html, re.S):
        for url in re.findall(r'"url":"((?:[^"\\]|\\.)*)"', block):
            url = unescape(url) or ""
            if url.startswith("http"):
                links.append(url)
    for url in re.findall(r'"external_url":"((?:[^"\\]|\\.)*)"', html):
        url = unescape(url) or ""
        if url.startswith("http"):
            links.append(url)
    if not full and not links and not bio:
        return {"handle": handle, "state": "sin-datos"}
    # Si Instagram devuelve la página de la cuenta logueada (perfil inexistente, privado
    # o bloqueado), el username del JSON no es el pedido: no se usa nada de esa página.
    seen_user = (username.group(1) if username else handle).lower()
    if seen_user != handle.lower():
        return {"handle": handle, "state": "no-carga", "sawUsername": seen_user}
    business = {}
    for key in ("public_email", "business_email", "contact_phone_number",
                "category_name", "business_contact_method"):
        found = re.search(rf'"{key}":"((?:[^"\\]|\\.)*)"', html)
        if found and found.group(1):
            business[key] = unescape(found.group(1))
    bio_text = unescape(bio.group(1)) if bio else ""
    emails = set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", bio_text or ""))
    for key in ("public_email", "business_email"):
        if business.get(key):
            emails.add(business[key])
    phones = set(re.findall(r"\+?\d[\d\s().-]{8,}\d", bio_text or ""))
    if business.get("contact_phone_number"):
        phones.add(business["contact_phone_number"])
    bio_urls = [u.rstrip(".,;)") for u in re.findall(r"https?://[^\s\"<>]+", bio_text or "")]
    return {"handle": handle, "state": "ok", "fullName": unescape(full.group(1) if full else None),
            "biography": bio_text or None,
            "followers": int(followers.group(1)) if followers else None,
            "bioLinks": sorted(set(links)),
            "emails": sorted(emails),
            "phones": sorted(phones),
            "bioUrls": sorted(set(bio_urls) - set(links)),
            "business": business}


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ig_handles.tsv"
    outdir = sys.argv[2] if len(sys.argv) > 2 else "/tmp/instagram"
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    os.makedirs(outdir, exist_ok=True)
    done_path = os.path.join(outdir, "instagram.jsonl")
    done = set()
    if os.path.exists(done_path):
        for line in open(done_path, encoding="utf-8"):
            try:
                row = json.loads(line)
                # Solo los perfiles leídos con datos cuentan como hechos: los no-carga y
                # los sin-datos se reintentan en la pasada siguiente.
                if row.get("state") == "ok":
                    done.add(row["handle"].lower())
            except (json.JSONDecodeError, KeyError):
                pass
    rows = []
    for line in open(src, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 2 and parts[1].strip() and parts[1].lower() not in done:
            rows.append({"artistId": int(parts[0]), "handle": parts[1].strip().lstrip("@")})
    print(f"{len(rows)} handles pendientes ({len(done)} ya hechos)", flush=True)

    profiles = [f"/tmp/chrome-ig-w{i}" for i in range(1, workers + 1)]
    for profile in profiles:
        prepare_profile(profile)

    started = time.time()
    with open(done_path, "a", encoding="utf-8") as store:
        def work(item: tuple[int, dict]) -> dict:
            index, row = item
            result = capture(row["handle"], profiles[index % workers], outdir)
            result.update({"artistId": row["artistId"], "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%S")})
            return result

        with ThreadPoolExecutor(max_workers=workers) as pool:
            for i, result in enumerate(pool.map(work, enumerate(rows)), 1):
                store.write(json.dumps(result, ensure_ascii=False) + "\n")
                store.flush()
                if i % 25 == 0:
                    elapsed = time.time() - started
                    eta = elapsed / i * (len(rows) - i) / 60
                    print(f"  {i}/{len(rows)} · {elapsed/60:.1f} min · ETA {eta:.0f} min", flush=True)

    print("captura terminada ->", done_path)


if __name__ == "__main__":
    main()
