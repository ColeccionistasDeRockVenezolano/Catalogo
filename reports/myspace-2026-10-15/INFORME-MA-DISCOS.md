# Cierre del hueco de discografías de Metal Archives (2026-10-15)

Encargo: «Ok» al plan — piloto 2HD (cerrado, ver `INFORME-PILOTO-2HD.md`) y los 705 discos de la
captura MA que no estaban en el catálogo. Todo con runs del operador reversibles.

## Resultado medido

| Fase | Qué | Números |
|---|---|---|
| **A** — discos de bandas con ficha | runs **20101–20116** | **570 discos** (5 de prueba + 565) · **2.493 pistas** · **473 portadas** locales · **0 fallos** |
| **B** — bandas sin ficha | run **20117** | 14 fichas creadas · 50 discos · **13 resultaron duplicadas de fichas existentes (con el otro nombre) y se corrigieron** — ver abajo · queda **1 banda legítimamente nueva: EON** |
| Corrección 1 | run **20119** | «Gillman» (banda) retirada: su discografía ya está bajo el solista **Paul Gillman (#1951)**; 22 discos / 263 pistas retirados con snapshot, 19 archivos huérfanos borrados |
| Corrección 2 | run **20120** | **7 fichas creadas con el NOMBRE ANTIGUO** de bandas que el catálogo ya tiene con el nombre actual: 11 discos duplicados retirados y **10 discos legítimos reatribuidos a la ficha buena** |
| Corrección 3 | run **20121** | **5 fichas más con el otro nombre** (el catálogo tenía el nombre *opuesto* al de MA y los alias ya estaban): Beheaded→Behated Reign, 6Sonar→Sexto Sonar, Transgresor→Neon Genesis, Desperatio Dei→Nox Desperatio, Daemonhorn→Theurgia. 5 discos reatribuidos, temas completados en Behated Reign; fichas retiradas |
| Cierre de EON | run **20122** | foto y logo de la captura + lineup actual (3 personas: Alexander Pulido, Ronald Lares, Lenin Morales) con claim de la fuente y evidencia |

Los 7 casos de nombre antiguo (la captura lo dice en `years_active`: «… (as X)»):

| Nombre en MA (creado) | Ficha real del catálogo | Movido |
|---|---|---|
| Lake of Tears | Dreams of Tears (#678) | — (1 dup) |
| Hodah | Exordium Profanum (#661) | — (3 dup) |
| Nigrium Mortualia | Moriturio (#2160) | 1 disco |
| Gorepriest | Sol Nocturno (#870) | — (4 dup) |
| Godless Crown | Godless (#609) | 3 discos |
| Okkvlt | Cthonica (#672) | — (1 dup) |
| Leviathan A.C. | Leviathan (#594) | 6 discos |

Los alias de esos nombres antiguos **ya existían** como `former_name` en las fichas buenas (campañas
previas): el cruce de bandas debió consultarlos. Lección para el próximo cierre.

## Estado del catálogo

- Álbumes: 15.764 → **16.351** · pistas: → **123.837**.
- **Única banda nueva: EON (#6979)** con sus 2 discos (EON 2016 ep, Eon 2024), foto, logo y lineup.
  Los 5 discos de las otras fichas retiradas se reatribuyeron a sus fichas reales (Behated Reign,
  Sexto Sonar, Neon Genesis, Nox Desperatio, Theurgia), que ya tenían membresías y géneros de
  campañas previas.
- Género de EON: el claim crudo de la fuente («Melodic Death Metal») existe; el **backfill de
  vocabulario global sigue en pausa** (su dry-run baja 16 principales confirmados y abre 48 avisos:
  4030→4014 artistas con principal), así que la asignación queda pendiente del flujo dirigido.
- Residual de la captura MA: **69 discos**, todos justificados:
  - 48 `Split` + 1 `Split video` + 1 `Collaboration` — el modelo de álbum tiene UN artista;
  - 10 `Video` — no son álbumes de música;
  - 9 restantes de casos ya resueltos o en revisión: 4 de Gillman («25 años», «Más vivo y en vivo»,
    «Tesoros», «Presente» — ya están bajo Paul Gillman), 2 de Blood Work (bajo Bloodwork #860),
    1 de Anatomiæ Occultii (bajo #823/#1764, que además son duplicados entre sí), 1 de Sanetoxic
    (¿= Sane Toxic #1371?) y 1 de Sorte (¿= Sorthe #2150?).

## Verificación

- Fichas creadas por error: **0** (SELECT sobre los ids retirados).
- Discos reatribuidos presentes en sus fichas buenas: Leviathan 7 · Godless 4 · Moriturio 3 · los
  demás sin cambios.
- Auditoría: cada retiro guarda snapshot (`merge_audit` / `scrape_runs.params.removed`) y cada
  reatribución su fila (`album artist_id`).

## Guardas que faltaban (para el próximo cierre de huecos)

1. **Cruce por alias**: antes de declarar una banda «sin ficha», buscar su nombre en
   `ingest.artist_aliases` (los `former_name` ya estaban).
2. **`years_active` de MA** trae los cambios de nombre («2001-? (as Leviathan )»): parsearlo y
   cotejar contra el catálogo.
3. **Banda vs solista**: «Gillman» (banda) y «Paul Gillman» (solista) comparten discografía — el
   catálogo modela la discografía bajo el solista; comprobar solapamiento de discos antes de crear
   una banda homónima.
4. **Cotejo de títulos por normalización**: «War Against Humanity: The Armageddon Chronicles» vs
   «War Against Humanity The Armageddon Chronicles» son el mismo disco (los dos puntos separan).

## Archivos

- Scripts: `scripts/ma-discos-2026-10-15.ts` (fase A), `scripts/ma-bandas-2026-10-15.ts` (fase B),
  `scripts/limpiar-gillman-2026-10-15.ts`, `scripts/former-names-fix-2026-10-15.ts`,
  `scripts/corregir-temas-2026-10-15.ts`, `scripts/piloto-2hd-2026-10-15.ts`.
- Informes y ledgers: `ma-discos-*.json/log`, `ma-bandas-*.json/log`, `limpieza-gillman.json`,
  `former-names-plan.json`, `former-names-aplicado.json`, `piloto-2hd-*.json`.
- Detalle por disco: `ma-discos-faltantes.jsonl` (los 705) y `ma-discos-aplicados.jsonl` (los creados,
  con su run).
