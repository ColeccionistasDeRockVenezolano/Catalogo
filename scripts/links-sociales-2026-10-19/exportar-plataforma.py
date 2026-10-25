import subprocess, sys
platform = sys.argv[1] if len(sys.argv) > 1 else "linktree"
target = sys.argv[2] if len(sys.argv) > 2 else f"/tmp/{platform}_handles.tsv"
SQL = f"""SELECT a.id, a.name, s.platform, s.handle, s.url
FROM public.social_links s JOIN public.artists a ON a.id=s.artist_id
WHERE s.platform='{platform}' AND s.handle IS NOT NULL AND s.handle<>'' ORDER BY a.id"""
out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-F", "\t", "-c", SQL],
                     capture_output=True, text=True, check=True).stdout
lines = [l for l in out.split("\n") if l.strip()]
open(target, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(len(lines), "handles de", platform, "->", target)
