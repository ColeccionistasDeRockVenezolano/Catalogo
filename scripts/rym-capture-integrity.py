#!/usr/bin/env python3
"""Conserve legacy captures under collision-safe filenames, with URL/hash manifest.

Stop the corresponding collector before --confirm (state is one shared file).
No network or database writes. Missing captures remain retryable, not invented.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

import rym_reglas as rules


def audit(directory, confirm=False):
    directory = Path(directory)
    pages = directory / "pages"
    archive = directory / "conservation-legacy"
    changes, manifest, errors = [], [], []
    for filename in sorted(pages.glob("*.json")):
        try:
            data = json.loads(filename.read_text())
            href = rules.norm_href(data.get("href"))
            kind = (data.get("rec") or {}).get("kind")
            if not href or kind not in ("release", "artist"):
                continue
            slug = rules.slug_release(href) if kind == "release" else rules.slug_artist(href)
            target = pages / (slug + ".json")
            html = filename.with_suffix(".html")
            if target != filename:
                if target.exists() and rules.norm_href(json.loads(target.read_text()).get('href')) != href:
                    raise ValueError(f"Existing destination has another URL: {target}")
                if not target.exists():
                    changes.append({"href": href, "old": filename.name, "new": target.name})
                if confirm and not target.exists():
                    archive.mkdir(exist_ok=True)
                    for source in [html, filename]:
                        if source.exists():
                            saved = archive / source.name
                            if saved.exists() and saved.read_bytes() != source.read_bytes():
                                raise ValueError(f"Archive differs: {saved}")
                            shutil.copy2(source, saved)
                            rules.escribir_atomico(str(target.with_suffix(source.suffix)), source.read_text())
                    # Keep the legacy path too: an existing claim/raw_page may
                    # reference it. Consumers deduplicate by canonical URL.
            manifest.append({"href": href, "kind": kind, "json": target.name,
                             "jsonSha256": hashlib.sha256((target if target.exists() else filename).read_bytes()).hexdigest(),
                             "htmlSha256": hashlib.sha256((target.with_suffix('.html') if target.with_suffix('.html').exists() else html).read_bytes()).hexdigest()
                             if html.exists() or target.with_suffix('.html').exists() else None})
        except (OSError, ValueError, TypeError) as exc:
            errors.append({"file": filename.name, "error": str(exc)})
    state, _ = rules.cargar_estado(str(directory / "estado.json"))
    if confirm:
        before = (directory / "estado.json").read_text()
        backup = directory / "estado-before-conservation.json"
        if not backup.exists():
            rules.escribir_atomico(str(backup), before)
        rules.verificar_conservacion(state, str(pages))
        rules.guardar_json(str(directory / "estado.json"), state, respaldo=True)
    missing = [{"href": href, "kind": entry.get("kind")} for href, entry in state.items()
               if entry.get("status") != 404 and entry.get("kind") in ("release", "artist")
               and not rules.captura_conservada(str(pages), href, entry["kind"])]
    manifest = list({row['href']: row for row in manifest}.values())
    return {"directory": str(directory), "confirmed": confirm, "renamed": changes,
            "captures": len(manifest), "missing": missing, "errors": errors, "manifest": manifest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    result = audit(args.outdir, args.confirm)
    path = Path(args.report)
    path.parent.mkdir(parents=True, exist_ok=True)
    rules.guardar_json(str(path), result, indent=2)
    print(json.dumps({key: len(value) if isinstance(value, list) else value
                      for key, value in result.items() if key != "manifest"}))
    if result["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
