# Temas de las letras en español — 2026-10-15

Encargo de Brian: «traduce al español los temas de las letras que aparecen en las fichas de los
artistas». El campo es `public.artists.themes`, que se muestra en la ficha con la etiqueta
«Temas de las letras» (web/src/pages/ArtistDetailPage.tsx:206) y llegó desde Metal Archives, que lo
trae en inglés («Death, War, Society»).

## Cómo se hizo

1. **Glosario cerrado, no traducción libre.** Los 352 valores son combinaciones de un vocabulario
   acotado: 312 términos únicos + 2 calificadores (`early`/`later`). Se tradujo el vocabulario una
   sola vez (`glosario-en-es.json`) y la propuesta se generó por tokenización idéntica a la del
   campo (segmentos por «,» y «;», con paréntesis calificadores conservados):
   `Instrumental (early); Nature, Folklore (later)` → `Instrumental (temprano); Naturaleza, Folclore (posterior)`.
   Generador: `traducir.py` (0 átomos quedaron sin glosario). Cero invenciones por ficha.
2. **Ledger de propuesta** con el antes/después de cada artista (`propuesta.jsonl`), verificado contra
   la base antes de escribir: cualquier deriva detiene la aplicación (`drift.json`).
3. **Escritura por el camino sancionado**: `scripts/traducir-themes-2026-10-15.ts` aplica con
   `withOperatorRun` + `updateEntity` (claim humano + `merge_audit` con el valor anterior → deshacer
   = undo del run). Lotes de 80, reanudable por `aplicados.jsonl`.
4. **Respaldo previo**: `/mnt/datos/backups/crv/pre-themes-es-2026-10-15.dump` (1,3 GB, cabecera
   PGDMP verificada, 128 tablas con datos).

## Resultado medido

| | antes | después |
|---|---|---|
| Artistas con «temas de las letras» | 352 (todos en inglés) | 352 (343 en español + 9 ya coincidentes) |
| Términos en inglés visibles en la ficha | 312 únicos | 0 (salvo nombres propios) |

- Runs: **20091–20095** (80+80+80+80+23 = **343 fichas traducidas**).
- Los 9 sin cambio ya se leían igual en español: Menstrualithy, Alfredo Herrera, La Cienaga, Deus
  Irae, Walking Over Strings, Regardless, Worm, The Crow Witch, Mortoth (Gore, Instrumental, Horror,
  Trauma).
- Auditoría: 343 filas en `ingest.merge_audit` (`field='themes'`) en esos 5 runs; 342 conflictos
  resueltos por el motor al fijar el valor nuevo.
- Verificación independiente (`verificar.py`, contra la base viva, no contra el auto-reporte):
  **352/352 valores coinciden con la propuesta** y no queda ningún término inglés del glosario; los
  únicos "restos" son nombres propios que no se traducen (`League of Legends`, `Tolkien`,
  `Rhapsody of Fire`) y términos idénticos en español.
- API en vivo: `GET /artists/10` → «Permanence · Espacio, Universo, Cosmología».

## Ejemplos

| Artista | Antes | Después |
|---|---|---|
| Permanence | Space, Universe, Cosmology | Espacio, Universo, Cosmología |
| Funebria | Blasphemy, Anti-Christianity, War, Sumerian mythology | Blasfemia, Anticristianismo, Guerra, Mitología sumeria |
| Roraima | Instrumental (early); Nature, Folklore (later) | Instrumental (temprano); Naturaleza, Folclore (posterior) |
| Deus Irae | Instrumental | Instrumental |
| Veldraveth | Satanism | Satanismo |

## Criterios de traducción aplicados

- Géneros y nombres propios no se traducen: `Black metal`, `Heavy metal`, `Thrash`, `Gore`,
  `League of Legends`, `Rhapsody of Fire`, `Tolkien`, `Lucifer`, `Venezuela`.
- Calificadores de etapa: `(early)` → `(temprano)`, `(later)` → `(posterior)`.
- Términos culturales: `Native Culture` → `Cultura indígena`, `Soviets` → `Soviéticos`,
  `Voodoo` → `Vudú`, `Lycanthropy` → `Licanthropía`, `Enthropy` → `Entropía` (sic, errata de la fuente).

## Archivos

- `propuesta.jsonl` — ledger artista→antes/después (352).
- `glosario-en-es.json` — glosario cerrado (314 entradas).
- `traducir.py` / `verificar.py` — generación de la propuesta y verificación independiente.
- `aplicados.jsonl` — una fila por ficha aplicada, con su run.
- `aplicacion.log` — salida de la corrida real.
- `artistas-themes.csv` — foto del estado previo.
- Script: `scripts/traducir-themes-2026-10-15.ts` (`--confirm`, `--lote=N`, `--limit=N`).
