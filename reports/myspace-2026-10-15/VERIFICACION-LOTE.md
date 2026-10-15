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

---

# Verificación externa (2026-10-15) y triaje aplicado

Contraste del informe externo contra el catálogo vivo y aplicación de sus decisiones
(`scripts/triaje-pares-2026-10-15.ts`, runs **20139–20145**, reversibles).

## Los 9 pares

| Par | Decisión aplicada |
|---|---|
| Baphometh #960 ↔ Baphomet #1144 | **Fusión** (run 20139): 11 de 12 miembros en común y el mismo disco «In The Beginning» (1988-1992). La bio del duplicado (formación inicial) se unió y quedó marcada para reescritura (ingest.text_rewrites). #960 queda con 7 discos, 14 miembros y el alias «Baphomet». |
| Bajo Zero #623 ↔ Bajo Cero #531 | **Fusión** (run 20140): los 4 miembros de #531 están en #623. #623 queda con 9 discos y el alias «Bajo Cero». |
| Lithopedion #937 ↔ Wismar #1448 | **Fusión** (run 20141): mismo disco «BlackHymn» (2011) y Wismar Pulido. Bio del duplicado unida y marcada para reescritura. |
| Remembrance #2284 ↔ Across The Ruins #518 | **Separadas** (decisión externa: conservar etapas). Alias «Remembrance» [former_name] añadido a #518 (run 20144) + par declarado distinto (2632). |
| Blodmåne #3186 ↔ Heylel #3241 | **Separadas**: alias «Heylel» [former_name] a #3186 (run 20145) + par distinto (2633); registra la interrupción 2022-2023. |
| Arkangel #46 ↔ Power Age | Alias «Power Age» [former_name] **ya estaba** en #46 (campaña previa). Sin cambios. |
| Drahcko #589 ↔ Anti-Régimen | Alias «Anti-Régimen» [former_name] **ya estaba** en #589. Sin cambios. |
| **Natastor #335 ↔ Abaddon #963** | **NO fusionar** (recomendación explícita): alias «Abaddon» [former_name] a #335 con la advertencia de homonimia en la nota (run 20143) + par declarado distinto (2630). |
| Kolman #332 ↔ Abraxas #3228 | **NO fusionar — la externa emparejó mal.** La Abraxas que pasó a llamarse Kolman es la de Cabimas 2012-2017 (alias «Abraxas» ya en #332 desde el 2026-10-01, vía la fusionada #651); #3228 es la Abraxas clásica de Caracas 1987-1996 (8 miembros distintos), separada ese mismo día por homonimia. Ambas fuentes coinciden en no fusionar. |

## Los 28 (revisión de los ejemplos)

- `Azucar Cacao Leche #269 ↔ Azúcar, Cacao & Leche #289` — **consolidado**: mismo LP de 1971 (comprobado en el catálogo). **Fusión** (run 20142); #289 queda con 6 discos y el alias «Azucar Cacao Leche».
- `Nemesis (Lara) #1287 ↔ Nemesis #590` — ya declarados **distintos** (par 3, campaña previa); coincide con Metal Archives (Barquisimeto thrash 1988 vs Caracas heavy).
- `Agonia (Caracas) #1288 ↔ Agonía #748` — ya declarados **distintos** (par 32); coincide (Mérida 2002 vs Caracas 2009).
- `Necrosis (Zulia) #1289 ↔ Necrosis #23`, `Ora Pro Nobis`, `Basilisk`, `Osteoporosis Aguda`, `Aborigen` — **pendientes de fuentes**; sin evidencia suficiente para declarar (ni fusionar ni separar).

## EON (cierre)

La verificación externa confirma procedencia y formación de Eon (CusicaPlus, julio 2024: Coro;
Alexander Pulido, Ronald Lares y Lenin Morales; Spotify: Pulido y Lares fundadores en 2013), lo que
**respalda la unificación con «Enlighten Our Nature» #898** (misma ciudad, misma formación y el alias
«EON» [acronym] ya registrado desde campañas previas). El alias «Arioth» procede de la fuente Metal
Archives (`years_active`); queda pendiente de contraste adicional.

## Restos que deja este triaje

- **Discos con títulos casi gemelos** bajo las fichas fusionadas (el merge solo descartó equivalencias
  exactas): `2074 «In thte Beginning» (2003)` vs `3262 «In The Beginning» (2003)` en #960;
  `1404 «Manifestación» (1995)` vs `2117 «Manifestación» (1998)` y `1115 «Caminos Inhumanos EP»` vs
  `2997 «Caminos Inhumanos»` (2008) en #623; `2582` vs `28529 «BlackHymn» (2011)` en #937;
  `520 «Azucar Cacao Leche» (1971)` vs `660 «Azúcar, Cacao & Leche Vol. 1» (1971)` en #289 →
  limpieza de discos duplicados (con verificación de pistas antes de unificar).
- **Cola de curaduría** (comportamiento diseñado del merge): 4 membresías con períodos contradictorios
  (banda #623), 2 reescrituras de bio pendientes (#960, #937), 1 género principal discrepante
  (#623, se conservó el del keep).
- 0 archivos huérfanos: ninguna de las 4 fichas retiradas tenía imagen en disco.
