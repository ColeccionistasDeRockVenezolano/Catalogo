# Verificación del lote MA completo (2026-10-15)

A pedido de Brian («verifica otras bandas de este lote»): barrido de **las 611 bandas de la captura
de Metal Archives** (no solo las del hueco) buscando el patrón que causó los duplicados: cambios de
nombre registrados en `years_active` («… (as X)»).

## Método

1. Extraer de `band-details-full.jsonl` las bandas con `(as X)` en `years_active` → **58 bandas**.
2. Cruzar cada nombre (el de MA y el alternativo) contra los 4.786 artistas del catálogo y sus
   alias (`ingest.artist_aliases`).
3. Además, detectar pares de fichas del catálogo cuyos alias apuntan a otra ficha existente
   (posible duplicación interna).
4. Comprobar solapamiento de discos y de personas entre los pares.

## Resultado

- **14 casos de ficha cruzada ya corregidos** en la jornada (13 con los runs 20119–20121) y **1 más
  detectado y corregido aquí** (run 20129):
  - **EON (#6979) → «Enlighten Our Nature» (#898)**: misma ciudad (Coro, Falcón), misma formación
    (Alexander Pulido, Ronald Lares, Lenin Morales) y el catálogo ya tenía el alias «EON» [acronym].
    Se reatribuyeron sus 2 discos (EON 2016 ep · Eon 2024), se retiraron las 3 membresías duplicadas
    (la ficha buena ya las tenía), se trasladó «Arioth» [former_name] y se retiró la ficha.
- **Alias**: los 13 nombres antiguos/nuevos ya estaban registrados (`former_name` / `name_variant`)
  en sus fichas; solo faltaba «Arioth», añadido a #898. Total de `former_name` en el catálogo: 55.
- **9 pares nuevos para triaje de curaduría** (NO tocados; cada uno necesita decisión):
  - `Baphometh (#960)` ↔ `Baphomet (#1144)`: **mismo disco** («In The Beginning», con typo en
    #1144) → duplicado claro de ficha.
  - `Bajo Zero (#623)` ↔ `Bajo Cero (#531)`: probable duplicado por grafía (discos distintos:
    «Caminos Inhumanos» vs «Manifestación»).
  - `REMEMBRANCE (#2284)` ↔ `Across The Ruins (#518)`: MA tiene AMBAS fichas (cambio de nombre);
    el catálogo también. Discos distintos por era.
  - `Kolman (#332)` ↔ `Abraxas (#3228)`: ídem (MA ambas).
  - `Blodmåne (#3186)` ↔ `Heylel (#3241)`: ídem.
  - `Arkangel (#46)` ↔ `Power Age`: la banda clásica de Valencia cambió de nombre a Power Age (MA
    la lista con ese nombre); el catálogo la tiene como «Arkangel» → decisión editorial de renombrar.
  - `Drahcko (#589)` ↔ `Anti-Régimen`: ídem (la ficha es Drahcko; MA la llama Anti-Régimen).
  - `Natastor (#335)` ↔ `Abaddon (#963)` y `Lithopedion (#937)` ↔ `Wismar (#1448)`: **dudosos**
    (ciudades distintas, discos distintos) — probable falso positivo del cotejo por nombre.
- **Deuda de curaduría preexistente**: **28 fichas del catálogo** cuyo alias coincide con otra ficha
  existente (p. ej. `Azucar Cacao Leche (#269)` ↔ `Azúcar, Cacao & Leche (#289)`, `Nemesis (Lara)
  (#1287)` ↔ `Nemesis (#590)`, `Agonia (Caracas) (#1288)` ↔ `Agonía (#748)`, `Necrosis (Zulia)
  (#1289)` ↔ `Necrosis (#23)`, `Ora Pro Nobis`, `Basilisk`, `Osteoporosis Aguda`, `Aborigen`,
  `Joudy Ju`, `Retrovisor`, `Contra Marcha`, `Mango`, `María Márquez`, `Underaiki`, `Hocus Potus`,
  `Aseari`, `Susan Justice`, `Nico Manzano`, `PI XPRNC`, `Replinter`, `La Venz`…) → insumo directo
  para la cola de fusiones (`/personas/duplicados` / entity-merge).
- **La fase A no introdujo duplicación**: los discos se crearon bajo la ficha cuyo nombre coincide
  con el de MA; en los pares con dos fichas (REMEMBRANCE/Across The Ruins, Kolman/Abraxas,
  Blodmåne/Heylel) cada disco cayó en su ficha correcta por nombre y sin títulos repetidos.

## Archivos

- `scripts/eon-a-898-2026-10-15.ts` — corrección de EON (reapertura y traslado, run 20129).
- `verificacion-lote.json` — volcado del cruce (casos y pares con alias cruzados).
- `/tmp/verifica-lote-ma.py` — script de la verificación (re-ejecutable).
