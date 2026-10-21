# Reviews de RYM: estado, bloqueo y plan para el siguiente intento

Corte: **2026-10-21**. Este documento deja cerrado lo hecho, documenta por qué
se detuvo la captura y qué hace falta para retomarla sin repetir errores.

---

## 1. Lo que está terminado y verificado

| Campaña | Alcance | Resultado |
| --- | --- | --- |
| Catálogo (`rym-reviews-2026-10-20`) | 582 fichas con reviews que sí están en `public.albums` (tras excluir 255 artistas internacionales del reporte y reintegrar 12 proyectos de venezolanos) | **607 capturadas**: 606 válidas en `pages/` + 1 en cuarentena (`thealbertoz_eco`, era un 502) · **3.263 reviews** · `reviews.jsonl` de 4,9 MB |
| Validación de identidad | todas las páginas de las tres campañas | **941 correctas · 0 contaminadas** · 4 apartadas (eran `502 Bad gateway`) |

Comprobaciones que quedan como norma:

```bash
# identidad de cada página (og:url real vs disco pedido)
python3 scripts/rym-reviews-validar.py

# totales del plan
cat data/raw/rym-reviews-2026-10-20/resumen.json
```

Universo medido antes de empezar: 22.568 fichas de release, 3.216 con reviews
declaradas, 5.537 páginas en el plan completo, 1.268 tras acotar al catálogo.

## 2. Campaña detenida: 938 discos venezolanos fuera del catálogo

Discos con reviews en RYM que **no están en `public.albums`** (por eso no se
pudieron ingerir): sirven para tener el material listo antes del alta.

```
data/raw/rym-reviews-938-2026-10-21/
  tareas.jsonl ........... 1.028 páginas (938 de página 1 + 90 subpáginas)
  pages/ ................. 116 válidas (3 más en pages-sospechosas, eran 502)
  pages-sospechosas/ ..... 3 apartadas (502)
  pendientes ............. 912
unidad ................... crv-rym-reviews-938 (inactive + disabled)
```

## 3. El bloqueo de RYM: qué pasa exactamente

**Señuelos a cuentas logueadas.** La sesión del dueño empezó a recibir fichas de
otro artista: Danny Ocean mostraba a Michael Jackson, `artist/mf-doom` mostraba a
Marilyn Manson. No es caché ni DNS: es la medida antibot de RYM contra clientes
que considera sospechosos. Deslogueado, las fichas de artista salen correctas.

**Sin login no hay reviews.** Deslogueado se puede leer portada y fichas de
artista, pero `/release/…` y `/release/…/reviews/N/` devuelven 403 duro o
`Security check required`. O sea: no existe la vía «anónima y limpia».

**El clon de la sesión ya no sirve para contenido.** Con el perfil copiado
(`cf_clearance` + `username` presentes, `is_logged_in` ausente):

```
portada .................. 200
/artist/… ................ 200 y correcto
/release/album/… ......... 403 duro (ERR_HTTP_RESPONSE_CODE_FAILURE)
/release/…/reviews/N/ .... 403 duro
```

Copiar el perfil **completo** (344 MB, con Service Worker e IndexedDB) da lo
mismo: el problema no son las cookies, es la marca sobre cuenta + IP + huella.

**Navegar por clics es intermitente.** Artista → clic al disco → clic en
«Reviews» funcionó una vez (8 reviews, `og:url` correcto) y veinte segundos
después cayó en «Verification». No es una solución estable.

## 4. Matriz de pruebas (todas ejecutadas)

| Vía | Resultado |
| --- | --- |
| Chrome clon CDP + sesión (la que hizo las 607 páginas) | funcionó hasta el 21-10; ahora 403 en `/release/` |
| Chrome clon con perfil completo (SW + IndexedDB) | igual, 403 |
| Chrome anónimo con `cf_clearance` recién emitida | portada y artista 200; `/release/` y `/reviews/` 403 |
| Navegación por clics reales | intermitente: 1 éxito, luego «Verification» |
| camofox-browser (Camoufox) con cookies del Firefox real | portada carga; `/reviews/` error de red/`Verification`; la `cf_clearance` no se puede transplantar entre navegadores |
| Firefox del keeper (Xvfb) | solo renueva `cf_clearance`; no captura |

## 5. Plan para el siguiente intento

1. **IP nueva de verdad.** Apagar el WiFi del teléfono para salir por datos
   móviles (o VPN). Comprobar que cambia:
   `curl -s https://api.ipify.org` ≠ `177.0.148.246`.
2. **Cuenta limpia.** Iniciar sesión en el Chrome del dueño y abrir 2-3 discos
   con reviews para que la sesión se asiente.
3. **Refrescar la copia:** `bash ops/rym-resto/chrome.sh --force`
   → debe reportar `sesión(cf_clearance/is_logged_in/username)` lo más alto posible.
4. **Puerta de identidad** (no captura si hay señuelo):
   `python3 scripts/rym-reviews-probar-sesion.py --campaign data/raw/rym-reviews-938-2026-10-21`
   → debe decir `VEREDICTO: LIMPIA`.
5. **Arrancar despacio** para no volver a marcar la cuenta:
   `TABS=1 GAP_MIN=7 GAP_MAX=9 systemctl --user start crv-rym-reviews-938`
6. **Cerrar con validación:** `python3 scripts/rym-reviews-validar.py`.

Si el paso 4 dice `SEÑUELO` o todo da 403: no insistir. Esperar 24-72 h con la
cuenta en reposo o cambiar de IP; insistir solo alarga la marca.

## 6. Dónde está todo

```
scripts/rym-reviews-plan.py ............ mide fichas y emite tareas (5.537 → alcance)
scripts/rym-reviews-alcance.py ......... filtra a catálogo, excluye internacionales, reintegra venezolanos
scripts/rym-reviews-bajar.py ........... capturador CDP: grifo 5-7 s, 2 pestañas, SSD→1 TB, identidad
scripts/rym-reviews-probar-sesion.py ... puerta previa: LIMPIA / SEÑUELO
scripts/rym-reviews-validar.py ......... auditoría og:url y cuarentena
scripts/rym_reviews_parse.py ........... selectores y parseo compartidos
ops/rym-reviews/bajar.sh ............... lanzador (CAMPAIGN, TABS, GAP_MIN/MAX, RECICLAR, STALL)
ops/rym-reviews/README.md .............. pipeline y cifras
ops/rym-resto/chrome.sh ................ Chrome con perfil copiado + CDP 9333
data/raw/rym-reviews-2026-10-20/ ....... campaña cerrada (607 páginas, reviews.jsonl)
data/raw/rym-reviews-938-2026-10-21/ ... campaña pendiente (116/1.028)
reports/rym-reviews-2026-10-2*/ ....... logs, journal, informe de identidad
docs/SHARED_STORAGE.md ................. regla SSD→HDD
unidades: crv-rym-reviews · crv-rym-reviews-938 · crv-rym-keeper · crv-extraccion-tablero
panel: file:///tmp/crv-recon/extraccion-2026-10-16.html (sección 8 cerrada, 9 en pausa)
```

## 7. Cómo encaja Laya en el siguiente intento

Laya es un modelo de **decisiones tipadas** (choice / score / sí-no), no de texto
libre. Encaja en tres puntos del pipeline, y conviene usarla como filtro previo
o de control, nunca como sustituto del `og:url`:

```python
# /home/brian/.venvs/laya/bin/python
from laya import Router

router = Router(default="multilingual")

state = """Página pedida: /release/album/mf-doom/mm-food/
og:url servido: /release/album/marilyn-manson/antichrist-superstar/
title: Reviews of Antichrist Superstar by Marilyn Manson"""

questions = {
    "triaje": {
        "type": "choice",
        "instructions": "¿Qué es esta página respecto al disco pedido?",
        "criteria": {
            "correcta": "La página es del disco pedido",
            "senuelo": "La página es de otro artista o disco",
            "bloqueo": "Es un reto de verificación o muro antibot",
            "error": "Error de servidor, página vacía o 502",
        },
    },
    "mismo_disco": {
        "type": "noul",
        "instructions": "¿El og:url servido corresponde al disco pedido?",
    },
    "aprovechable": {
        "type": "score",
        "instructions": "¿Cuánto se puede aprovechar esta página?",
        "criteria": ["nada, descartar", "parcial, revisar", "completa, ingerir"],
    },
}
r = router.predict(state, questions)
print(r["answers"]["triaje"]["choice"], r["answers"]["mismo_disco"]["noul"])
```

Usos concretos que dejaría preparados para la siguiente pasada:

- **Triaje de páginas** antes de escribir: señuelo / bloqueo / error / correcta,
  como segunda Opinion tras la comprobación exacta de `og:url`.
- **Nacionalidad de artistas** (choice: `venezolano`, `diaspora_venezolana`,
  `extranjero_con_vinculo`, `extranjero_sin_vinculo`) para el filtro de alcance,
  alimentado con la biografía y las relaciones del catálogo.
- **Calidad de la review** (`aprovechable`: score) para decidir qué se ingiere
  primero cuando el material llegue incompleto.

Límites: el checkpoint multilingüe acepta hasta 8.192 tokens; mide precisión con
una muestra etiquetada antes de automatizar el descarte. Para texto corto revisa
`result["routing"]["model"]`.

## 8. Riesgos aprendidos (no repetir)

- No usar la cuenta del dueño para volumen alto: se marca y empiezan los señuelos.
- Nunca guardar una página sin comprobar que su `og:url` es el disco pedido.
- RYM devuelve **403 con la página completa**: si hay `review_shell_std_`, se
  acepta; si no, es muro.
- Un 403 de una review concreta no es muro global: reencolar, no frenar todo.
- El `502 Bad gateway` llega con 200 y cuerpo corto: contarlo como error.
