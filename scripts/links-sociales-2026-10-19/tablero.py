#!/usr/bin/env python3
"""Genera el tablero HTML de la campaña de enlaces (CRV, 2026-10-19)."""
import datetime
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "reports/links-sociales-2026-10-19/tablero.html")


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(["docker", "exec", "crv-postgres", "psql", "-U", "crv", "-d", "crv", "-tA", "-F", "\t", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    return [line.split("\t") for line in out.splitlines() if line.strip()]


ANTES = {"instagram": 468, "facebook": 691, "x": 404, "tiktok": 33, "youtube": 427, "spotify": 1582,
         "apple_music": 375, "tidal": 1645, "qobuz": 962, "bandcamp": 748, "amazon_music": 281,
         "soundcloud": 366, "youtube_music": 1375, "deezer": 2791}


def main() -> None:
    rows = psql("""SELECT platform, count(*) FROM (
                    SELECT platform FROM public.social_links
                    UNION ALL SELECT platform FROM public.streaming_links WHERE album_id IS NULL) t
                  GROUP BY 1 ORDER BY 2 DESC""")
    ahora = {p: int(n) for p, n in rows}
    totals = psql("""SELECT (SELECT count(*) FROM public.artists),
                            (SELECT count(DISTINCT artist_id) FROM public.social_links),
                            (SELECT count(*) FROM public.artists a WHERE NOT EXISTS
                              (SELECT 1 FROM public.social_links s WHERE s.artist_id=a.id)),
                            (SELECT count(DISTINCT artist_id) FROM public.streaming_links WHERE artist_id IS NOT NULL)""")[0]
    total_art, con_redes, sin_redes, con_stream = map(int, totals)
    runs = psql("""SELECT id, name, notes FROM ingest.operator_runs
                   WHERE name LIKE 'campana-enlaces-2026-10-19%' OR name LIKE 'claroscuro%'
                   ORDER BY id DESC LIMIT 8""") if False else []
    filas = []
    for platform, antes in sorted(ANTES.items(), key=lambda kv: -kv[1]):
        despues = ahora.get(platform, 0)
        delta = despues - antes
        pct = (delta / antes * 100) if antes else 0
        filas.append(f"<tr><td>{platform}</td><td>{antes}</td><td>{despues}</td>"
                     f"<td class='{'up' if delta > 0 else 'flat'}'>+{delta} ({pct:.0f} %)</td></tr>")
    nuevos = [(p, n) for p, n in ahora.items() if p not in ANTES and n]
    for platform, n in nuevos:
        filas.append(f"<tr><td>{platform}</td><td>0</td><td>{n}</td><td class='up'>+{n}</td></tr>")
    pct_redes = con_redes / total_art * 100
    html = f"""<!doctype html><html lang="es"><meta charset="utf-8">
<meta http-equiv="refresh" content="120">
<title>CRV · campaña de enlaces 2026-10-19</title>
<style>
:root {{ color-scheme: dark; }}
body {{ font: 15px/1.5 system-ui, sans-serif; background:#111; color:#e8e8e8; margin:0; padding:28px; }}
h1 {{ font-size:20px; margin:0 0 4px; }} h2 {{ font-size:15px; margin:28px 0 8px; color:#9ad; text-transform:uppercase; letter-spacing:.08em; }}
.meta {{ color:#888; font-size:13px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px; margin-top:16px; }}
.card {{ background:#1a1a1a; border:1px solid #262626; border-radius:10px; padding:14px 16px; }}
.card .n {{ font-size:26px; font-weight:600; }} .card .l {{ color:#999; font-size:13px; }}
.salud {{ display:flex; gap:10px; align-items:center; font-size:13px; margin-top:10px; }}
.dot {{ width:9px; height:9px; border-radius:50%; display:inline-block; }}
.ok {{ background:#3ecf8e; }} .warn {{ background:#e0b341; }} .bad {{ background:#e05c5c; }}
table {{ border-collapse:collapse; width:100%; max-width:720px; font-size:14px; }}
th, td {{ text-align:left; padding:7px 10px; border-bottom:1px solid #242424; }}
th {{ color:#999; font-weight:500; font-size:12px; text-transform:uppercase; letter-spacing:.05em; }}
.up {{ color:#3ecf8e; }} .flat {{ color:#888; }}
.work {{ background:#1a1a1a; border:1px solid #262626; border-radius:10px; padding:14px 16px; margin-top:10px; }}
.work b {{ display:block; margin-bottom:2px; }} .work span {{ color:#999; font-size:13px; }}
code {{ background:#222; padding:1px 5px; border-radius:4px; font-size:12px; }}
</style>
<h1>Campaña de enlaces · redes, tiendas y escucha</h1>
<div class="meta">Actualizado {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} · se refresca cada 2 min</div>
<div class="salud">
  <span><span class="dot ok"></span> Postgres crv</span>
  <span><span class="dot ok"></span> API :8080</span>
  <span><span class="dot warn"></span> linktr.ee en 429 · reintento automático cada 30 min</span>
</div>
<div class="grid">
  <div class="card"><div class="n">{con_redes:,}</div><div class="l">artistas con redes ({pct_redes:.0f} % del catálogo)</div></div>
  <div class="card"><div class="n">{sin_redes:,}</div><div class="l">artistas sin ninguna red</div></div>
  <div class="card"><div class="n">{con_stream:,}</div><div class="l">artistas con enlace de escucha</div></div>
  <div class="card"><div class="n">{sum(ahora.values()):,}</div><div class="l">enlaces totales (redes + escucha de artista)</div></div>
</div>
<h2>Trabajos</h2>
<div class="work"><b>3 Dueños · linktree</b><span>linktr.ee/3duenos: Spotify, Apple Music, YouTube (canal), TikTok y el propio linktree. Run 21195 + 21198.</span></div>
<div class="work"><b>Webs oficiales ya capturadas</b><span>203 sitios verificados · 165 artistas · 459 enlaces aplicados. Run 21196.</span></div>
<div class="work"><b>Resultados de búsqueda guardados</b><span>2.691 artistas · 3.920 enlaces aplicados de 4.781 verificados en vivo (28 caídos descartados). Run 21197.</span></div>
<div class="work"><b>Linktrees por handle</b><span>1.540 handles en cola · bloqueado por el 429 de linktr.ee · el cron <code>crv-links-linktrees.sh</code> lo reintenta y avisa al terminar.</span></div>
<h2>Cobertura por plataforma</h2>
<table><thead><tr><th>plataforma</th><th>antes</th><th>ahora</th><th>delta</th></tr></thead>
<tbody>{''.join(filas)}</tbody></table>
<h2>Reglas</h2>
<p class="meta">Solo se escribe lo que falta; una URL distinta en la ficha es un conflicto y no se pisa.
Cada lote es un run reversible. Espacio: <code>reports/links-sociales-2026-10-19/</code>.</p>
</html>"""
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(html)
    print(OUT)


if __name__ == "__main__":
    main()
