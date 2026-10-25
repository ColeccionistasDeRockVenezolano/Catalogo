#!/usr/bin/env python3
"""Preserve and independently restore-check localized media or application files.

No .env, account credentials, runtime databases or ignored raw captures enter
the application snapshot. Database/raw backup has its own verified artifact.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def digest(file):
    value = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["media", "application"])
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    if args.kind == "media":
        base = ROOT / "web/public/media"
        if not base.is_dir():
            raise RuntimeError("localized media directory is missing")
        files = sorted(file for file in base.rglob("*") if file.is_file())
    else:
        listing = subprocess.check_output(["git", "ls-files", "-c", "-o", "--exclude-standard", "-z"], cwd=ROOT)
        allowed_dirs = ("src/", "scripts/", "test/", "migrations/", "web/src/", "web/scripts/", "web/tests/", ".github/", "docs/", "data/genres/")
        allowed_roots = {"package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "eslint.config.js", "crv_simple_v1.sql", ".env.example", ".gitignore", "Dockerfile", "compose.yaml", "README.md", "DESIGN.md", "PRODUCT.md", "AGENTS.md", "CLAUDE.md", "SYNAPSE.md"}
        files = sorted({ROOT / name for raw in listing.split(b"\0") if raw
                        for name in [raw.decode()]
                        if name.startswith(allowed_dirs) or name in allowed_roots
                        or (name.startswith("web/") and len(Path(name).parts) == 2 and Path(name).suffix in {".json", ".ts", ".html"})})
        files = [file for file in files if file.is_file()]
    if any(file.is_symlink() for file in files):
        raise RuntimeError("snapshot contains a symbolic link; resolve its archival scope explicitly")
    checksums = {str(file.relative_to(ROOT)): digest(file) for file in files}
    archive = args.output / f"{args.kind}.tar.gz"
    with tarfile.open(archive, "w:gz", compresslevel=1) as bundle:
        for file in files:
            bundle.add(file, arcname=str(file.relative_to(ROOT)), recursive=False)
    # Always validate an actual extraction in an empty directory, not just tar headers.
    with tempfile.TemporaryDirectory(prefix="crv-file-restore-") as work:
        destination = Path(work)
        with tarfile.open(archive) as bundle:
            bundle.extractall(destination, filter="data")
        restored = {str(file.relative_to(destination)): digest(file) for file in destination.rglob("*") if file.is_file()}
        if restored != checksums:
            raise RuntimeError("restored contents differ from the captured file inventory")
    if any(digest(ROOT / name) != sha for name, sha in checksums.items()):
        raise RuntimeError("source files changed during capture; snapshot must be repeated")
    manifest = {"format": "crv-file-preservation-1", "kind": args.kind,
                "gitCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip(),
                "archive": archive.name, "sha256": digest(archive), "files": checksums,
                "restore": {"verified": True, "files": len(restored)}}
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"{args.kind}: {len(files)} files preserved and restored; {archive}")


if __name__ == "__main__":
    main()
