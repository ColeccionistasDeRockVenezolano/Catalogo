import os, re

OUT = "/home/brian/crv-staging/data/research/punkenvenezuela-fanzines-2026-10-23"

# 1) informe: falsos positivos conocidos + criterio
inf = os.path.join(OUT, "informe.md")
t = open(inf, encoding="utf-8").read()
if "Falsos positivos conocidos" not in t:
    t += """
## Falsos positivos conocidos (revisados a mano)

| Caso | Por qué aparece | Qué hacer |
|---|---|---|
| `Nicolás Maduro` (artist 5940) | la página habla de un video musical difundido por Telesur | verificar si esa fila del catálogo es una banda real; si no, es basura de ingesta |
| `Sepultura` (737), `Death` (2558) | los fanzines citan bandas extranjeras como referencia | mención correcta: el catálogo los tiene con su país real |
| `suei` (alias 5805) | alias muy corto que cae dentro de texto normal | ruido de alias corto; no usar sin leer la página |
| Nombres de una palabra | el filtro exige contexto de banda, pero un fanzine habla de bandas en casi cada página | leer el `contexto` de `matches.jsonl` antes de dar por buena una mención |

Criterio aplicado: una mención es **fuerte** si el nombre aparece en ≤3% de las
páginas y, cuando es de una sola palabra, en una ventana con vocabulario de
banda (banda, grupo, tocan, concierto, maqueta, integrantes, disco…). Todo lo
demás queda en `matches-debiles.jsonl` y **no** se usa como evidencia.
"""
    open(inf, "w", encoding="utf-8").write(t)

# 2) README: añadir las dos salidas nuevas
rd = os.path.join(OUT, "README.md")
t = open(rd, encoding="utf-8").read()
if "fichas-a-completar.tsv" not in t:
    t = t.replace(
        "| `informe.md` | resultados: artistas, personas, años, ciudades y duplicados |",
        "| `fichas-a-completar.tsv` | artistas citados con ficha incompleta (ciudad/año), ordenados por prioridad |\n"
        "| `duplicados-catalogo.tsv` | nombres de artista repetidos en el catálogo (barrido completo) |\n"
        "| `informe.md` | resultados: artistas, personas, años, ciudades, duplicados y falsos positivos |")
    open(rd, "w", encoding="utf-8").write(t)
print("ok")
