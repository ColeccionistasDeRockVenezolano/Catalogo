# Datos ricos de las biografías (2026-10-13)

Pedido de Brian:
- La línea de tiempo de integrantes también debe salir con datos parciales.
- La persona de un solista debe llevar su nombre real cuando la biografía lo da.
- Nacimiento, ciudad y demás datos de las biografías deben pasar a sus campos.

Script: `scripts/primo-datos-ricos.mts`. DeepSeek flash propone, con una llamada por ficha, y el código valida cada dato:
- La cita tiene que estar literal en el texto.
- Tiene que nombrar a la persona.
- Tiene que contener el dato.
- Tiene que llevar la señal que lo prueba («nació», «su nombre real es», «actualmente»…), comprobada con palabras enteras sobre el texto sin tildes.

Solo se rellenan campos vacíos. Si el dato choca con lo ya guardado, no se pisa: queda en `contradicciones.jsonl`.

Respaldo previo: `/mnt/datos/backups/crv/crv-20261013T035242Z`. Cada run se deshace con `runs undo <id>`.

## Runs

| Run | Qué | Resultado |
|---|---|---|
| 19229 | Campos vacíos de persona y tipos | 1.839 campos (`personas-campos-aplicado.jsonl`): 618 géneros, 615 nacionalidades, 330 ciudades de nacimiento, 159 nacimientos, 60 nombres reales, 23 «venezolano», 18 fallecimientos (16 marcados fallecidos). 251 artistas de tipo grupo cuya biografía describe a una sola persona pasan a solista; su persona queda como titular (53 cambian de rol, 174 se enlazan). |
| 19234 | Nombres (caso Canserbero), plan `docs/decisions/2026-10-13-datos-ricos-nombres.json` | 14 renombres al nombre real, con el artístico como alias (Wendy → María del Carmen Ruescas Pujol, Ivo → Pablo Augusto Díaz Barroso, Marianella, Tania, Elena Rose, DJ MKC…). 153 alias (nombres completos y apodos con cita). |
| 19235 | «Personas» que son una banda, plan `docs/decisions/2026-10-13-datos-ricos-personas-a-banda.json` | 231 fichas de persona con nombre de banda (Epitafio, Sónica, Bronce, Stormtrash…) pasan al artista homónimo con sus créditos (`to_artist`); 112 créditos equivalentes unidos. |
| 19236 | Periodos de integrantes | 1.105 membresías: 317 años de entrada, 49 de salida y 786 «sigue». |

## Línea de tiempo

- Sale cuando dos personas tienen algún año (`web/src/lib/membersTimeline.ts`).
- Un tramo sin entrada o sin salida se dibuja difuminado.
- Quien no tiene ningún dato se nombra debajo.

Bandas con línea: antes 97 (todos los integrantes con periodo completo), ahora **1.095**. Las que tienen todos los periodos completos pasaron de 97 a 120.

La ficha del solista muestra también el lugar de nacimiento del titular.

## Para revisar a mano

- **Tipos sin tocar (41, en `personas-aplicado.md`).** Son grupos con el nombre de una persona (Claudio Corsi, Alberto Naranjo, Braulio Polanco…) o «personas» que figuran como integrantes de su grupo homónimo (Leo Castillo, Miroslava…). Pueden ser una persona real con un grupo que lleva su nombre.
- **Sin renombrar por choque.** MASA ya guarda «José Manuel Vidal» como nombre real, y la biografía dice «Miguel Vásquez». Hay dos fichas «Tania» (25632 y 12152) que parecen la misma persona, y dos «Amaranta» (30300 y 30299).
- **Contradicciones (23).** Fechas o ciudades distintas entre lo guardado y la biografía, por ejemplo María Conchita Alonso 1955/1957, Alí Primera 1941/1942 y Eduardo Serrano 1942/1911.
- **Extracción.** No hubo fallos tras el reintento. La mayoría de las biografías de banda no dan años de salida, así que muchos tramos siguen abiertos.

## Incidente

Al detener la API de prueba (puerto 8099) con `pkill -f src/api/server.ts`, se detuvo también `crv-api` de producción, que se arranca con el mismo comando. systemd la reinició en unos 15 segundos (01:18). Al reiniciar cargó el árbol de trabajo de ese momento, que incluye cambios sin commit de otra sesión en `src/verification`, `src/ai` y otros. Sus migraciones 0069–0071 no están aplicadas. `/crv/api/health` respondió 200 y el diario no muestra errores.
