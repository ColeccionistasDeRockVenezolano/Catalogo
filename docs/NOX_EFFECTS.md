# Colección NOX

Adaptación de `NOX_chat_demo.html`, entregado por Brian el 2026-10-29.
La colección contiene once acabados con tres productos independientes por acabado:
nombre (`name`), marco (`frame`) y burbuja persistente (`bubble`). Las placas
continúan en su propia ranura. No se restaura el catálogo retirado.

Las 33 recetas están disponibles en Administración → Editor de estilos →
«Colección NOX · 33 variantes». Se pueden probar y guardar individualmente.
El editor conserva la elección entre Bloodfall original y mejorado.

## Fidelidad y Bloodfall

`src/chat/nox.ts` conserva nombres, descripciones, monedas y rarezas del demo.
`web/src/styles/nox-effects.css` conserva sus reglas, con selectores y nombres de
animación aislados. Se mantienen gradientes, paradas, sombras, velocidades,
retardos, curvas y decoraciones de las tres superficies. El motor comparte
el presupuesto y la visibilidad de `chatMotion`; reducir movimiento y gama baja
reciben una representación estática.

Bloodfall original permanece disponible para comparación. La versión mejorada:

- Conserva la paleta roja y el brillo metálico del demo.
- Obtiene las posiciones del borde inferior de la tinta rasterizada; los
  espacios y las columnas transparentes no originan gotas.
- Ajusta la cantidad al nombre, con un máximo de siete puntos de goteo.
- Separa alimentación, estiramiento del cuello y desprendimiento de la gota,
  con ciclos desfasados y variaciones deterministas de tamaño.
- Reserva el recorrido para no invadir mensajes o filas contiguas.
- Rasteriza al cambiar texto, medidas o fuentes; no realiza trabajo JavaScript
  por fotograma. La animación de las gotas solo modifica transform y opacity.
- Limita los nombres que exceden el ancho disponible con elipsis; el nombre
  completo se conserva en el texto accesible y en el título.

## Publicación

Primero desplegar el backend y frontend que entienden el manifiesto `nox` y la
ranura `bubble`, y aplicar `0116_chat_nox_bubbles`. La migración amplía los CHECK;
no modifica cuentas, saldos, inventarios o efectos existentes.

La importación masiva es explícita, transaccional e idempotente:

```bash
npm exec -- tsx scripts/import-nox-effects.ts
npm exec -- tsx scripts/import-nox-effects.ts --apply
```

La primera orden solo presenta los productos. La segunda añade los ausentes y
conserva íntegramente cualquier código existente. Comprueba que la migración
esté registrada. No debe ejecutarse antes de desplegar el renderer.

El demo solo define precios en monedas. Las recetas mantienen esas cantidades;
la tarifa inicial en créditos usa la misma cifra, sin suponer una equivalencia
monetaria ni ofrecer una compra gratuita accidental. Ambas tarifas pueden
editarse antes o después de publicar.

Las sesiones anteriores pueden omitir `bubble`; se interpretan sin burbuja. El
servidor persiste la ranura nueva en `chat.equipped` y la entrega en mensajes y
WebSocket como el resto de los productos equipados.

## Verificación

`web/tests/visual/nox-effects-qa.mjs` compara los 33 renderers reales con el HTML
original en escritorio y móvil, en tres instantes por variante (198
comparaciones de CSS calculado). Además verifica Bloodfall con Unicode,
espacios, nombres largos, movimiento reducido, calidad estática y métricas de
layout durante la animación.

`web/tests/visual/nox-shop-qa.ts` prueba el chat y la tienda con API/WS simulados:
11 burbujas, equipamiento independiente, recetas del editor, versión original y
mejorada, precios, guardado y pausa. Las pruebas de contrato usan PostgreSQL
aislado para comprobar migración, compra, posesión, equipamiento e historial.

Las evidencias se publican en `reports/nox-effects-2026-10-29`, incluyendo el HTML
fuente y su SHA-256. Para repetir las capturas, crear una campaña nueva mediante
`staging.py` y configurar `CRV_QA_OUT` con su ruta SSD y `CRV_QA_CDP` con el navegador
existente. `CRV_NOX_HTML` permite usar otra ruta del HTML fuente.
