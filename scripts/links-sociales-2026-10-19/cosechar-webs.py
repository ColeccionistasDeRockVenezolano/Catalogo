#!/usr/bin/env python3
"""Cosecha enlaces de las webs oficiales ya capturadas (campaña webs-oficiales-2026-10-18).

Lee reports/webs-oficiales-2026-10-18/verificaciones/*.json, se queda con los casos
cuya identidad quedó confirmada como sitio del artista y extrae del HTML capturado
los enlaces a redes, tiendas y plataformas de escucha. Salida en el mismo JSONL que
consume aplicar.ts.
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import canon, to_link  # noqa: E402

ROOT = "/home/brian/apps/Coleccionistas De Rock Venezolano"
VERIF = os.path.join(ROOT, "reports/webs-oficiales-2026-10-18/verificaciones")
URL_RE = re.compile(r"https?://[^\s\"'<>\\\\)\]}]+", re.I)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
JUNK_EMAIL_DOMAINS = ("sentry.io", "wixpress.com", "example.com", "domain.com", "email.com",
                      "wordpress.org", "squarespace.com", "godaddy.com", "shopify.com", "wix.com")


def extract_emails(html: str) -> list[str]:
    """Correos del sitio: solo los que aparecen como mailto: o en el texto visible."""
    from html import unescape
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.S | re.I)
    text = unescape(re.sub(r"<[^>]+>", " ", text))
    found = set(EMAIL_RE.findall(text))
    found |= set(re.findall(r"mailto:([^\"'?>\s]+)", html, re.I))
    clean = []
    for email in found:
        email = email.strip().rstrip(".,;)").lower()
        if "@" in email and not any(junk in email for junk in JUNK_EMAIL_DOMAINS):
            if email not in clean:
                clean.append(email)
    return clean


def main() -> None:
    outdir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/webs"
    os.makedirs(outdir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(VERIF, "*.json")))
    prop = open(f"{outdir}/propuestas.jsonl", "w", encoding="utf-8")
    summary = open(f"{outdir}/resumen.tsv", "w", encoding="utf-8")
    summary.write("artistId\tnombre\tsitio\tstatus\tenlaces\tcorreos\n")
    stats = {"casos": 0, "sitios": 0, "con_enlaces": 0, "enlaces": 0, "sin_captura": 0}
    for path in files:
        try:
            case = json.load(open(path, encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        stats["casos"] += 1
        status = (case.get("status") or "").lower()
        if status != "artist_site":
            continue
        stats["sitios"] += 1
        artist_id = int(case["artistId"])
        capture = case.get("capture") or ""
        html_path = os.path.join(ROOT, capture) if capture else ""
        if not html_path or not os.path.exists(html_path):
            stats["sin_captura"] += 1
            continue
        html = open(html_path, encoding="utf-8", errors="replace").read()
        site_host = (case.get("finalUrl") or "").split("/")[2] if "//" in (case.get("finalUrl") or "") else ""
        links, by_platform = [], {}
        for raw in URL_RE.findall(html):
            link = to_link(raw, verified=True)
            if not link:
                continue
            if site_host and site_host.replace("www.", "") in link["url"]:
                continue
            previous = by_platform.get(link["platform"])
            # una sola URL por plataforma: se queda la que trae identificador estable
            if previous is None or (not previous.get("externalId") and link.get("externalId")):
                by_platform[link["platform"]] = link
        links = list(by_platform.values())
        emails = extract_emails(html)
        if links or emails:
            stats["con_enlaces"] += 1
            stats["enlaces"] += len(links)
            record = {"artistId": artist_id, "source": case.get("finalUrl") or capture,
                      "evidence": f"web oficial verificada ({(case.get('title') or '')[:80]})", "links": links}
            if emails:
                record["email"] = emails[0]
                stats["con_email"] = stats.get("con_email", 0) + 1
            prop.write(json.dumps(record, ensure_ascii=False) + "\n")
        summary.write(f"{artist_id}\t{case.get('name') or ''}\t{case.get('finalUrl') or ''}\t{status}\t{len(links)}\t{'; '.join(emails)}\n")
        print(f"{artist_id}\t{case.get('name')}\t{len(links)} enlaces\t{len(emails)} correos", flush=True)
    prop.close(); summary.close()
    print("RESUMEN", stats, f"-> {outdir}/propuestas.jsonl")


if __name__ == "__main__":
    main()
