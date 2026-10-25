#!/usr/bin/env python3
"""Exporta los handles sociales publicados a /tmp/handles.tsv (artistId, name, platform, handle, url)."""
import subprocess
import sys

SQL = """SELECT a.id, a.name, s.platform, s.handle, s.url
FROM public.social_links s JOIN public.artists a ON a.id=s.artist_id
WHERE s.handle IS NOT NULL AND s.handle<>''
  AND s.platform IN ('instagram','facebook','tiktok','x','threads')
ORDER BY a.id"""
target = sys.argv[1] if len(sys.argv) > 1 else "/tmp/handles.tsv"
out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-F", "\t", "-c", SQL],
                     capture_output=True, text=True, check=True).stdout
lines = [line for line in out.split("\n") if line.strip()]
open(target, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"{len(lines)} handles -> {target}")
