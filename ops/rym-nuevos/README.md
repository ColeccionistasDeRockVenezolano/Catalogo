# Campaña RYM «nuevos» — operación

Captura de fichas de artista (fase 1) y de disco (fase 2) de rateyourmusic.com con Scrapling,
a ritmo humano y con las cookies del Firefox del dueño. Todo corre como unidades **permanentes**
de `systemd --user` (con linger: arrancan solas al encender la máquina, sin iniciar sesión).

## Comandos

| Para… | Comando |
|---|---|
| Ver la salud de todo | `bash ops/rym-nuevos/estado.sh` |
| Instalar / reinstalar (idempotente) | `bash ops/rym-nuevos/instalar.sh` |
| Pruebas | `npm run test:rym-nuevos` |
| Tablero | `file:///tmp/crv-recon/rym-nuevos-tablero.html` |
| Pausar el centinela | `touch reports/crv-marcas/sentinel-pausa` |
| Pausar el cliquer | `touch reports/crv-marcas/clicker-pausa` |

## Piezas

| Unidad | Script | Qué hace | Si muere |
|---|---|---|---|
| `crv-scrapling-nuevos` | `capturador.sh` → `scripts/scrapling-rym.py` | captura; reanuda desde `estado.json` | systemd lo reinicia (`on-failure`) y el supervisor también |
| `crv-scrapling-nuevos-super` | `supervisor.sh` | avisos Telegram, atascos, muros, coherencia | systemd (`always`) + centinela si se cuelga |
| `crv-nuevos-tablero` | `tablero.sh` → `scripts/rym_tablero.py --loop 10` | **único** escritor del tablero | systemd (`always`) |
| `crv-extracciones-tablero` | `extracciones-tablero.sh` | tablero de enlaces y bios + fragmentos embebidos | systemd (`always`) |
| `crv-wall-clicker` | `wall-clicker.sh` | Intenta 1 clic en un enlace confirmado de RYM cada 30-65 s en el Firefox del dueño; se pausa ante bloqueos de bots o uso del equipo | systemd (`always`) |
| `crv-bios-lanzador` | `bios-lanzador.sh` | al cerrar «nuevos» arranca `crv-rym-bios` | systemd (`on-failure`) |
| `crv-nuevos-sentinel.timer` | `centinela.sh` (cada 5 min) | supervisor colgado, unidades paradas | — |

## Reglas y datos

- **Una sola definición** de «artista listo», «disco con datos», «vacío en RYM» y de la cola
  de discos: `scripts/rym_reglas.py`. La usan el capturador, el tablero, el supervisor
  (`python3 scripts/rym_reglas.py progreso`) y las pruebas → mismos números en todas partes.
- Un disco **vacío en RYM** (sin portada, pistas ni géneros) o **404** cuenta como terminado y
  no se revisita.
- `estado.json` se escribe de forma **atómica** (temporal + rename + fsync) y cada 25 capturas
  deja una foto en `estado.json.bak`; si el principal se vuelve ilegible, capturador y tablero
  retoman desde el respaldo y el supervisor avisa.
- Fin de fases por **marcas en disco** (`FASE1_TERMINADA`, `COLA_TERMINADA` en el outdir), no
  por grep del log. El log se rota (gzip) al pasar de 20 MB.
- **Fase «bios» (cerrada 2026-10-05)**: se captura la página del artista
  `https://rateyourmusic.com/artist/<slug>` — la URL con sufijo `/biography` devuelve un
  cascarón sin la sección (trampa del primer capturador: guardaba archivos vacíos con
  `wall=true`). Primera pasada **offline**: la biografía se extrae de la ficha ya capturada
  en `rym-nuevos/pages/`; solo se toca RYM si no hay ficha. Página sin biografía queda
  `sin_bio=true` (RYM no la tiene) y cuenta como terminada; los muros (`wall=true`) se
  reintentan. Con la cola completa, el capturador firma «BIOS TERMINADAS (nada pendiente)»
  en `reports/scrapling-bios.log` y el lanzador y el centinela se retiran solos.
  Cierre medido: **774/774 — 5 con bio · 769 sin bio en RYM**.
- Nada operativo vive en `/tmp` (tmpfs: se vacía al reiniciar). En `/tmp/crv-recon` solo quedan
  vistas HTML y cachés que se regeneran solas.

## Retiradas el 2026-10-05

Las unidades transitorias sobre `/tmp/crv-*.sh` y los tableros de la campaña 222 (ya cerrada).
Las copias de `tmp-analysis/etapa3-2026-10-01/runtime/` quedan solo como histórico.
