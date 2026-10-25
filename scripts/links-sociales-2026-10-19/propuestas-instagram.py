#!/usr/bin/env python3
"""Convierte la captura de Instagram en propuestas de enlaces y un censo de contactos.

Lee `instagram.jsonl` (lo escribe cosechar-instagram.py). Por cada perfil:
  · propone los enlaces de la bio (linktree, tienda, redes y escucha), resolviendo
    acortadores y páginas «link in bio» (urlgeni.us, beacons.ai, taplink, bio.link…);
  · vuelca email, teléfono, categoría y seguidores a `contactos.csv`.

Identidad: el perfil ya estaba publicado en la ficha; se refuerza si el `full_name`
coincide con el nombre del artista. Si no coincide ni el handle, va a `revision.jsonl`.
"""
import csv
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import canon, norm, resolve_short, to_link  # noqa: E402

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-F", "\t", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    return [line.split("\t") for line in out.splitlines() if line.strip()]


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "reports/links-sociales-2026-10-19/instagram")
    names = {int(aid): name for aid, name in psql("SELECT id, name FROM public.artists")}

    latest: dict[str, dict] = {}
    for line in open(os.path.join(outdir, "instagram.jsonl"), encoding="utf-8"):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        key = (row.get("handle") or "").lower()
        if key and (row.get("state") == "ok" or key not in latest):
            latest[key] = row

    prop = open(os.path.join(outdir, "propuestas.jsonl"), "w", encoding="utf-8")
    rev = open(os.path.join(outdir, "revision.jsonl"), "w", encoding="utf-8")
    contacts = open(os.path.join(outdir, "contactos.csv"), "w", encoding="utf-8", newline="")
    writer = csv.writer(contacts)
    writer.writerow(["artistId", "artista", "instagram", "nombre_instagram", "emails",
                     "telefonos", "categoria", "seguidores", "enlaces_bio"])
    stats = {"perfiles": 0, "con_enlaces": 0, "enlaces": 0, "revision": 0, "con_email": 0, "con_telefono": 0}
    for row in latest.values():
        if row.get("state") != "ok":
            continue
        stats["perfiles"] += 1
        aid = row.get("artistId")
        aid = int(aid) if aid is not None else None
        name = names.get(aid or 0, "")
        full = norm(row.get("fullName") or "")
        handle = norm(row.get("handle") or "")
        n = norm(name)
        trusted = bool(n) and bool(n in full or full in n or (handle and (n in handle or handle in n)))
        raw_links = list(row.get("bioLinks") or []) + list(row.get("bioUrls") or [])
        links, seen = [], set()
        for url in raw_links:
            for candidate in resolve_short(url):
                link = to_link(candidate, verified=trusted)
                if not link or link["platform"] == "instagram":
                    continue
                key = (link["platform"], canon(link["url"]))
                if key in seen:
                    continue
                seen.add(key)
                links.append(link)
        emails = set(row.get("emails") or [])
        phones = set(row.get("phones") or [])
        # La bio suele escribir el correo como «nombre [at] dominio» o «(at)»: se normaliza.
        bio_text = (row.get("biography") or "")
        bio_norm = re.sub(r"\s*[\[(]\s*(?:at|arroba)\s*[\])]\s*", "@", bio_text, flags=re.I)
        emails |= set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", bio_norm))
        phones |= set(re.findall(r"\+?\d[\d\s().-]{8,}\d", bio_norm))
        business = row.get("business") or {}
        if emails:
            stats["con_email"] += 1
        if phones:
            stats["con_telefono"] += 1
        writer.writerow([aid, name, row.get("handle"), row.get("fullName"),
                         "; ".join(emails), "; ".join(phones), business.get("category_name", ""),
                         row.get("followers") or "", "; ".join(raw_links)])
        if not links:
            continue
        record = {"artistId": aid, "source": f"instagram.com/{row['handle']} (bio)",
                  "evidence": f"enlace de la bio del Instagram publicado en la ficha; full_name={row.get('fullName')!r}",
                  "links": links}
        (prop if trusted else rev).write(json.dumps(record, ensure_ascii=False) + "\n")
        if trusted:
            stats["con_enlaces"] += 1
            stats["enlaces"] += len(links)
        else:
            stats["revision"] += 1
    prop.close(); rev.close(); contacts.close()
    print("RESUMEN", stats, f"-> {outdir}/propuestas.jsonl · revision.jsonl · contactos.csv")


if __name__ == "__main__":
    main()
