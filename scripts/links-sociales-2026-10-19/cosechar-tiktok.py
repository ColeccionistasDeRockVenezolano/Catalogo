#!/usr/bin/env python3
"""Cosecha la bio y el enlace de la bio de TikTok (CRV, 2026-10-19).

TikTok no sirve el perfil a curl sin JS, pero sí a Chrome con `--dump-dom` y el perfil
del dueño copiado. Del JSON embebido se leen `signature` (bio), `bioLink.link` y el
correo si está en la bio.

Salida: `tiktok.jsonl` (crudo) y `propuestas.jsonl` ({artistId, source, links, email}).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import norm, resolve_short, to_link  # noqa: E402

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
CHROME = "/opt/google/chrome/chrome"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36")
SRC_PROFILE = os.path.expanduser("~/.config/google-chrome")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def prepare_profile(dest: str) -> None:
    if os.path.exists(os.path.join(dest, "Default", "Cookies")):
        return
    os.makedirs(os.path.join(dest, "Default"), exist_ok=True)
    for rel in ("Local State", "Default/Cookies", "Default/Preferences"):
        src, dst = os.path.join(SRC_PROFILE, rel), os.path.join(dest, rel)
        if os.path.exists(src):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)


def capture(handle: str, profile: str, outdir: str) -> dict:
    path = os.path.join(outdir, f"_tmp_{os.getpid()}_{handle}.html")
    command = [CHROME, f"--user-data-dir={profile}", "--password-store=gnome-libsecret",
               "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
               "--disable-blink-features=AutomationControlled", f"--user-agent={UA}",
               "--virtual-time-budget=9000", "--dump-dom", f"https://www.tiktok.com/@{handle}"]
    try:
        with open(path, "w", encoding="utf-8", errors="replace") as out:
            subprocess.run(command, stdout=out, stderr=subprocess.DEVNULL, timeout=90)
        html = open(path, encoding="utf-8", errors="replace").read()
    except (subprocess.TimeoutExpired, OSError):
        return {"handle": handle, "state": "timeout"}
    finally:
        if os.path.exists(path):
            os.remove(path)
    signature = re.search(r'"signature":"((?:[^"\\]|\\.)*)"', html)
    bio_link = re.search(r'"bioLink":\{"link":"((?:[^"\\]|\\.)*)"', html)
    nickname = re.search(r'"nickname":"((?:[^"\\]|\\.)*)"', html)
    seen = re.search(r'"uniqueId":"([A-Za-z0-9._]+)"', html)

    def unescape(value: str) -> str:
        return value.replace("\\u002F", "/").replace("\\/", "/").replace("\\u0026", "&")

    if not signature and not bio_link:
        return {"handle": handle, "state": "sin-datos"}
    if seen and seen.group(1).lower() != handle.lower():
        return {"handle": handle, "state": "no-carga", "saw": seen.group(1)}
    bio = unescape(signature.group(1)) if signature else ""
    link = unescape(bio_link.group(1)) if bio_link else None
    emails = sorted(set(EMAIL_RE.findall(bio)))
    return {"handle": handle, "state": "ok", "bio": bio,
            "nickname": unescape(nickname.group(1)) if nickname else None,
            "bioLink": link, "emails": emails}


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "reports/links-sociales-2026-10-19/redes/tiktok")
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    os.makedirs(outdir, exist_ok=True)
    out_tsv = sys.argv[3] if len(sys.argv) > 3 else "/tmp/tiktok_handles.tsv"
    rows = []
    for line in open(out_tsv, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 4 and parts[3].strip():
            rows.append({"artistId": int(parts[0]), "name": parts[1], "handle": parts[3].strip().lstrip("@")})
    done_path = os.path.join(outdir, "tiktok.jsonl")
    done = set()
    if os.path.exists(done_path):
        for line in open(done_path, encoding="utf-8"):
            try:
                row = json.loads(line)
                if row.get("state") == "ok":
                    done.add(row["handle"].lower())
            except json.JSONDecodeError:
                pass
    rows = [row for row in rows if row["handle"].lower() not in done]
    print(f"{len(rows)} pendientes ({len(done)} hechos)", flush=True)
    profiles = [f"/tmp/chrome-tt-w{i}" for i in range(1, workers + 1)]
    for profile in profiles:
        prepare_profile(profile)
    started = time.time()
    with open(done_path, "a", encoding="utf-8") as store:
        def work(item):
            index, row = item
            result = capture(row["handle"], profiles[index % workers], outdir)
            result.update({"artistId": row["artistId"], "name": row["name"]})
            return result
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for i, result in enumerate(pool.map(work, enumerate(rows)), 1):
                store.write(json.dumps(result, ensure_ascii=False) + "\n"); store.flush()
                if i % 25 == 0:
                    print(f"  {i}/{len(rows)} · {(time.time()-started)/60:.1f} min", flush=True)
    print("captura terminada", flush=True)

    prop = open(os.path.join(outdir, "propuestas.jsonl"), "w", encoding="utf-8")
    stats = {"ok": 0, "con_enlace": 0, "con_email": 0, "revision": 0}
    for line in open(done_path, encoding="utf-8"):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("state") != "ok":
            continue
        stats["ok"] += 1
        n = norm(row.get("name") or "")
        nick = norm(row.get("nickname") or "")
        handle = norm(row.get("handle") or "")
        trusted = bool(n) and (n in nick or nick in n or n in handle)
        links = []
        for url in ([row["bioLink"]] if row.get("bioLink") else []):
            for candidate in resolve_short(url):
                link = to_link(candidate, verified=trusted)
                if link and link["platform"] != "tiktok":
                    links.append(link)
        record = {"artistId": row["artistId"], "source": f"tiktok.com/@{row['handle']} (bio)",
                  "evidence": f"enlace de la bio de TikTok; nickname={row.get('nickname')!r}", "links": links}
        if row.get("emails"):
            record["email"] = row["emails"][0]
        if links or row.get("emails"):
            if trusted:
                prop.write(json.dumps(record, ensure_ascii=False) + "\n")
                stats["con_enlace"] += 1 if links else 0
                stats["con_email"] += 1 if row.get("emails") else 0
            else:
                stats["revision"] += 1
    prop.close()
    print("RESUMEN", stats, f"-> {outdir}/propuestas.jsonl")


if __name__ == "__main__":
    main()
