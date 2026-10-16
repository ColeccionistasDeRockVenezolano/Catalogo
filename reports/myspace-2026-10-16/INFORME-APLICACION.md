# MySpace/Wayback → catálogo: aplicación ejecutada (2026-10-16)

Continuación de `plan/informe-plan.md` (el plan medido). Aquí, lo APLICADO con la información
nueva sobre lo que ya había — sin pisar: bios fusionadas, géneros que faltaban, miembros que
faltaban, claims de fotos y la minería de las bios.

## Runs aplicados (todos reversibles por `undo` del run)

| Run | Qué | Números |
|---|---|---|
| 20265 | Membresías que MySpace listaba y el catálogo no tenía (planes del plan) | 4 creadas · 1 ya estaba |
| 20269 | **Géneros de época** (regla: la fuente los nombra y la ficha no los tenía) | 20 fichas · 26 términos (experimental, hardcore-punk, death-metal, thrash-metal, black-metal, rock, punk…) |
| 20273 | **Bios fusionadas** (bio actual + perfil MySpace, síntesis DeepSeek + validación de apply-biographies) | **127 fichas** · 127 claims `crv-sintesis` con evidencia por fuente · 3 ya idénticas · 3 cambiadas entretanto (no se pisó) |
| 20274 | **Claims de foto** (field `picture_url`): la foto que el perfil mostraba, con snapshot y —si hay copia local— archivo+sha256 | **132 claims** (56 con copia local verificada al momento) |
| 20275 | **Miembros minados de las bios** (persona ya existente en el catálogo) | **68 creadas** · 15 ya estaban · **14 a revisión** (posible contradicción de período) |
| 20276 | Año de formación citado en el perfil (solo fichas sin año) | 2 |

## Cómo se hizo (piezas reutilizables)

- `03-dossiers.py` → `04-sintesis.py` (DeepSeek) → `scripts/apply-biographies.ts` con
  `BIO_DOSSIERS_DIR`/`BIO_SYNTH_DIR` propios. El prompt de fusión: conservar todo dato de la
  bio actual, integrar lo del perfil, reparar los «..» de 2010 solo cuando es inequívoco, sin
  nombrar fuentes, sin markdown. La validación del aplicador (idioma, longitud, formato,
  sourcesUsed) frenó 1 caso inservible.
- `05-generos-ledger.py` → `06-apply-generos-epoca.ts` (usa `sourceSlugs` de la taxonomía;
  ficha con principal: los faltantes entran como secundarios; sin principal: el primero manda).
- `07-ledger-fotos.py` (lee la copia local del DISCO, no el CSV que solo cierra al final) →
  `08-claims-fotos.ts`.
- `09-datos-extraidos.py` (minería, cotejo de personas con `persons` + `person_aliases` +
  nombre invertido; nombres de una palabra → candidatos, nunca aplicar) → `10-apply-formacion.ts`.

## Quedó pendiente (con sus ledgers)

- **371 candidatos de miembros** (`plan/miembros-candidatos.jsonl` 62 + `mineria/miembros-candidatos.jsonl` 256 + …):
  nombres de una palabra o apodos sin persona clara — NO se crean personas a ciegas.
- **14 membresías a revisión** (run 20275): contradicción de período con lo que ya había.
- **Géneros de época no aplicados**: 9 conflictos familia/hijo («Metal» cuando ya hay
  «Death Metal»; se saltan, es correcto) y 11 fragmentos que la taxonomía no reconoce.
- **Minería informativa** (`mineria/otros.jsonl` 557 · `discos` 537 · `sellos` 108 ·
  `ciudad.jsonl` 52): discos y sellos citados en los perfiles; contraste de ciudad (mayoría
  complementarios: ciudad vs estado). Insumo para campañas de discografía/sellos.
- 3 bios sin cambios (ya cubrían el perfil) y 3 fichas editadas por otra mano (no se pisaron).

## Pitfalls medidos (para futuras campañas)

1. **psql desde python y textos multilínea**: `-tA` sin `-R` rompe las bios por saltos de línea
   (el `currentText` del dossier salió truncado a la primera línea → 106 «changedSinceExport»
   falsos y una síntesis con biografías incompletas). Fix: `-R '\x1e'` como separador de fila.
2. **`deepseek-flash` razona**: con prompts grandes agota `max_tokens` en razonamiento y
   devuelve content vacío (medido: 14k tokens de razonamiento). Para síntesis: `deepseek-chat`
   (5 s por ficha, 133 en 94 s con 6 hilos).
3. **Los JSONL de salida append duplican en re-corridas**: dedupe por caseId al consumir.
4. **Un CSV que se escribe solo al cerrar la pasada** no sirve como fuente viva: leer el disco.
