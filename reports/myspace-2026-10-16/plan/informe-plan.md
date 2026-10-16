# Aplicación al catálogo de la cosecha MySpace/Wayback — plan medido

Fecha: 2026-10-16 · Campaña origen: `reports/ma-links-2026-10-15/` (263 perfiles, sección 6 del tablero)

## 1 · Lo primero: medir los huecos (antes de escribir nada)

De los 263 perfiles, **130 tienen ficha** en el catálogo y campos extraídos. Contra la BD viva:

| Campo del core | Cosechado | Hueco real en BD |
|---|---|---|
| `biography` | 112 con About | **0** (la campaña de bios ya los cubrió) |
| `picture_url` | 129 con foto | **0** (campañas de fotos ya pasaron) |
| `origin_city` | 45 con ciudad en el título | **0** |
| `formed_year` | — | 2 |
| `artist_members` (estructura) | 96 con Band Members | **0** bandas sin ninguna membresía |
| `ingest.artist_genres` | 108 géneros de época | 1 artista sin género |

Conclusión: **no hay campos que rellenar**; la aplicación aporta datos que el catálogo no tiene
(miembros que faltan) y contraste/evidencia de época (géneros 2007-2010, ciudades, bios).

## 2 · Qué se aplica, qué se archiva y qué se descarta

| Vía | Filas | Destino |
|---|---|---|
| Miembros con persona resuelta (nombre completo cotejado contra `persons` + `person_aliases`, incluido invertido) | **5** | **APLICADO**: `createRelation artist_membership` + claim fuente `myspace-wayback-machine` (run reversible) |
| Miembros candidatos (nombre de 1 palabra o sin persona) | 62 | `miembros-candidatos.jsonl` — pendiente ER/revisión manual (los apodos pueden ser alias de personas existentes) |
| Géneros de época (títulos 2007-2010 + campo Genres) | 108 | `genero-epoca.jsonl` — **no se escriben**: el vocabulario canónico está en pausa; quedan como insumo para su reanudación |
| Ciudades de contraste (MySpace vs `origin_city`) | 19 | `ciudad-epoca.jsonl` + informe — mayoría complementarios (ciudad vs estado), no conflicto |
| Bios de época (texto sin tildes rotas) | 55 | `biografia-epoca.jsonl` — evidencia histórica para la campaña de síntesis de bios |
| Influences / Sounds Like / Record Label / Type of Label / Band Website / Member Since | 68-90 c/u | **Descartados para el core**: no existe campo destino (el sello del perfil MySpace no es el sello del disco; «Member Since» es alta en MySpace, no formación) |

## 3 · Filtros de calidad aplicados (medidos sobre los datos)

- **Tildes perdidas del snapshot 2010** («Represi..n» = «Represión», «a..o» = «año»): cualquier
  texto con `letra + .. + letra` se descarta (46 de 112 About; 14 de 96 Band Members).
  Los snapshots 2011-2012 SÍ conservan UTF-8 válido.
- Rellenos de separadores («| |», «..........») y segmentos basura (<15 caracteres útiles).
- Nombres de una palabra («Antonio», «Junior»): ambiguos por homonimia → nunca se aplican solos.
- «Manager X / teléfonos» en el rol, HTML residual (`</a>`), segmentos «AKA» (el apodo ya
  apunta a la persona del nombre real).

## 4 · Reanudable

- Plan: `python3 scripts/myspace-2026-10-16/01-plan.py` (regenera los 5 ledgers + `resumen.json`).
- Aplicación de miembros: `tsx scripts/myspace-2026-10-16/02-apply-miembros-extra.ts [--confirm]`.
- Fuente: `myspace-wayback-machine` (id 30589, nace enabled=false + review_queue 1854379, patrón del flujo).

## 5 · Pendiente de decisión

1. Los **62 candidatos** de miembros: ¿ER con DeepSeek dirigido (los apodos) o revisión manual?
   Sin personas nuevas creadas a ciegas: crear personas por apodo «Umbrarum»/«Helltorment»
   duplicaría fichas existentes.
2. **Géneros de época**: esperan a la reanudación del vocabulario (o a claims crudos si se prefiere).
3. Los **55 bios de época**: insumo natural de la campaña de síntesis de bios (no copiar literal
   cuando el snapshot perdió tildes).
