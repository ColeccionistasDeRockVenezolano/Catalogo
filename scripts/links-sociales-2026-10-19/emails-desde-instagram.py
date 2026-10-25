#!/usr/bin/env python3
"""Propone el correo del artista a partir de la captura de Instagram (CRV, 2026-10-19).

Solo aplica correos que parecen del propio artista:
  · el buzón o el dominio contienen el nombre del artista o su handle, o
  · es el único correo de la bio una vez descartados los de terceros.
Los correos de management, sello, booking, prensa o agencia van a `emails-revision.csv`
(no se escriben en la ficha). Los teléfonos no se aplican: el core no tiene ese campo.

Salida: `emails.jsonl` con {artistId, email, evidence}.
"""
import csv
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import norm  # noqa: E402

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
THIRD_PARTY_DOMAINS = ("strongerbookings", "stateofmindtouring", "wmgmusicgroup", "firstfrequency",
                       "agency", "booking", "management", "press", "records", "label", "musicgroup")
THIRD_PARTY_LOCAL = ("booking", "bookings", "management", "mgmt", "manager", "press", "prensa",
                     "promo", "promocion", "label", "sello", "agency", "agencia", "record",
                     "records", "contacto.booking")


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

    out = open(os.path.join(outdir, "emails.jsonl"), "w", encoding="utf-8")
    rev = open(os.path.join(outdir, "emails-revision.csv"), "w", encoding="utf-8", newline="")
    writer = csv.writer(rev)
    writer.writerow(["artistId", "artista", "instagram", "emails", "elegido", "motivo"])
    stats = {"perfiles": 0, "aplicables": 0, "revision": 0}
    for row in latest.values():
        if row.get("state") != "ok":
            continue
        emails = sorted({e.strip().lower() for e in (row.get("emails") or []) if "@" in e})
        if not emails:
            continue
        stats["perfiles"] += 1
        aid = int(row["artistId"]) if row.get("artistId") else 0
        name = names.get(aid, "")
        n = norm(name)
        handle = norm(row.get("handle") or "")
        full = norm(row.get("fullName") or "")
        # Si el nombre del perfil no tiene que ver con la ficha, el handle está mal
        # asignado: su correo no se aplica a este artista.
        identity_ok = bool(full) and bool(n in full or full in n or (handle and (handle in full or full in handle)))
        if not identity_ok:
            stats["revision"] += 1
            writer.writerow([aid, name, row.get("handle"), "; ".join(emails), "", f"identidad dudosa (perfil={row.get('fullName')!r})"])
            continue
        own, third = [], []
        for email in emails:
            local, _, domain = email.partition("@")
            key = norm(local) + norm(domain)
            looks_third = any(d in domain for d in THIRD_PARTY_DOMAINS) or any(l in local for l in THIRD_PARTY_LOCAL)
            looks_own = bool(n) and (n in norm(local) or n in norm(domain) or (handle and handle in norm(local)))
            if looks_own and not looks_third:
                own.append(email)
            elif looks_third:
                third.append(email)
            else:
                own.append(email) if len(emails) == 1 else third.append(email)
        chosen = own[0] if own else None
        if chosen is None:
            stats["revision"] += 1
            writer.writerow([aid, name, row.get("handle"), "; ".join(emails), "",
                             "ninguno coincide con el nombre o el handle" if not third else "terceros (management/sello/booking)"])
            continue
        out.write(json.dumps({"artistId": aid, "email": chosen,
                              "source": f"instagram.com/{row['handle']} (bio)",
                              "evidence": f"correo publicado en la bio del Instagram oficial; full_name={row.get('fullName')!r}"},
                             ensure_ascii=False) + "\n")
        stats["aplicables"] += 1
    out.close(); rev.close()
    print("RESUMEN", stats, f"-> {outdir}/emails.jsonl · emails-revision.csv")


if __name__ == "__main__":
    main()
