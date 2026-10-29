# Editor de estilos del chat

El administrador abre **Chat → Tienda → Abrir editor de estilos**. El editor permite preparar efectos sobre el texto del nombre, comprobarlos junto a mensajes y fijar sus precios antes de guardarlos en la tienda. Las placas son productos `badge` independientes, se equipan a la derecha del nombre y no forman parte del estilo del nombre.

## Crear, revisar y publicar

1. En **Empezar desde**, elegir **Nuevo estilo** o una plantilla (cada tarjeta muestra el estilo en movimiento); o bien un producto en **Editar un producto existente** (agrupado por tipo) o **Duplicar** el actual.
2. Diseñar el nombre en las pestañas **Texto**, **Color**, **Borde y sombra** y **Movimiento**. En **Tienda**, completar nombre, código único, descripción, orden, precios y duración. El código admite 2–40 letras minúsculas, números o guiones; el nombre, 2–40 caracteres; la descripción, hasta 160. El código y el tipo de un producto existente no se cambian desde el formulario.
3. Revisar el **escaparate**: el nombre al doble de tamaño, con **Nombre para probar**, el estado (borrador, publicado o «Cambios sin guardar»), **Pausar animación** para ver la alternativa estática y **Fondo claro** para comprobar colores oscuros, como el negro de Loby. Debajo, la escena muestra el nombre a tamaño real junto a un mensaje propio y otro coleccionista.
4. Elegir **Visible en la tienda** y pulsar **Añadir a la tienda** o **Guardar cambios** en la barra inferior, que permanece visible. Si falta algún dato, la barra lo dice y **Revisar** abre la pestaña Tienda; cada campo muestra su propio aviso. Los cambios solo se publican al guardar (también con Ctrl+S).

Los precios los establece el administrador, por separado en monedas y créditos: enteros de 0 a 100.000. **0 permite adquirir el producto gratis con esa moneda**, aunque la otra tenga un precio mayor. La duración vacía significa permanente; de lo contrario admite entre 1 y 3.650 días. El orden admite enteros entre 0 y 10.000.

Desmarcar **Visible en la tienda** y guardar oculta el producto. Sigue disponible como «(oculto)» en **Editar un producto existente**: seleccionarlo, marcar la visibilidad y guardar permite recuperarlo. **Actualizar catálogo** vuelve a consultar los productos.

**Loby**, **Bunnita** y **Enana** se conservan como plantillas, sin publicación automática. Si ya existe su producto de nombre con ese código, la tarjeta carga ese producto («En la tienda»); en caso contrario prepara un borrador con la referencia y un nombre de prueba («Plantilla»). Revisar precios y visibilidad antes de guardar. No se vuelve a sembrar el catálogo antiguo. Las tres reproducen la captura: degradado de abajo arriba (0°) que el color recorre letra a letra; Enana añade destellos por letra.

**Deshacer** y **Rehacer** (Ctrl+Z y Ctrl+Mayús+Z fuera de los campos de texto) recorren las ediciones del borrador; un arrastre o una escritura seguida en el mismo control cuenta como un solo paso, y guardar cierra el paso en curso. **Restablecer** recupera el producto tal como se abrió o los valores de un estilo nuevo. Cambiar de producto con cambios sin guardar pide confirmación. El historial es local al editor; no representa una reversión de publicaciones en el servidor.

## Controles y límites

| Grupo | Controles y valores admitidos |
| --- | --- |
| Texto | Sans serif, serif, cursiva o monoespaciada (fichas con muestra); tamaño 10–40 px; grosor 100–900; cursiva; espaciado −1,5 a 6 px; prefijo y sufijo de hasta 12 caracteres cada uno; giro del nombre completo y giro por letra. |
| Color | Degradado opcional con tres colores (inicio, centro y final), barra de muestra, posición del color central 0–100 % y ángulo del degradado. Sin degradado, un solo color de texto. |
| Borde y sombra | Color y grosor del contorno 0–2 px; sombra opcional con color, desenfoque 0–12 px, distancia 0–8 px y dirección. |
| Movimiento | Estático, ola de color, flujo de color, destello, flotar, pulso o giro de letras. Ciclo 0,3–20 s; sentido normal, inverso, ida y vuelta o vuelta e ida; desfase por letra −1 a 1 s (salvo en el flujo, que es continuo); recorrido 0–12 px y dirección solo para «Flotar». |

Los ángulos (**0–360°**) se ajustan con un dial que se arrastra (cada 5°; con Mayús, grado a grado), con las flechas del teclado (Mayús: de 15 en 15), con el campo numérico o con los atajos ↑ → ↓ ←. Los valores numéricos combinan deslizador y campo exacto. Solo aparecen los controles que afectan al resultado: la sombra sin activar oculta sus ajustes y cada animación muestra los suyos. La ola y el flujo de color desplazan el degradado; si está desactivado, la pestaña Movimiento lo avisa y ofrece activarlo.

El nombre de prueba admite hasta 48 caracteres. Los controles de nombre se muestran para productos `name`; los demás tipos solo muestran la pestaña Tienda. Los demás tipos conservan su manifiesto y permiten editar sus metadatos y precios; sus propiedades se ajustan mediante JSON avanzado.

## JSON y conservación de productos

**Importar, exportar y JSON avanzado**, al final de la pestaña Tienda, permite exportar el producto completo a JSON, incluidas las capas de productos existentes. Importar un JSON válido lo carga como borrador; no lo publica. Revisar código y precios: un código que ya existe impide crear una copia y requiere elegir el producto del catálogo para editarlo, o usar otro código.

**Cargar manifiesto actual** copia el manifiesto al campo avanzado; **Aplicar JSON al borrador** lo valida y aplica al formulario. Guardar sigue siendo una acción posterior. El formulario y el servidor comparten el contrato de validación de productos; un JSON inválido no se aplica.

## Espacio, adaptación y movimiento reducido

El editor amplía la interfaz oscura CRV en modo **Operate**: campos etiquetados, superficies tonales, foco rojo y pestañas navegables con las flechas. Desde 760 px, la vista previa ocupa la columna izquierda y queda fija mientras se recorren los controles de la derecha. Por debajo de 760 px solo el escaparate queda fijo arriba (a escala reducida), los controles siguen debajo y la escena de conversación va al final. La barra de guardado queda fija abajo en ambos casos. La escena tiene desplazamiento propio para contener ejemplos grandes.

El nombre reserva una huella calculada a partir del ancho y alto del texto, su giro, sombra, contorno y recorrido. Las letras giradas disponen de espacio adicional. Los encabezados y listas del chat permiten envolver el nombre, y los mensajes mantienen separación vertical para que el texto estilizado no invada el mensaje siguiente. El texto limita su ancho a `min(65vw, 420px)` y admite salto de línea.

**Cómo se anima el degradado.** Cada letra recorta un degradado repetible (inicio → centro → final al 85 % → inicio) y la propiedad registrada `--ns-phase` lo desplaza un periodo entero, así el ciclo vuelve a empezar sin salto. El color avanza siempre en la dirección del **ángulo del degradado**: antes se desplazaba según la dirección del movimiento y, con el degradado horizontal por defecto (90°) y el movimiento vertical (0°), el fondo se movía en perpendicular y no cambiaba nada visible. Ese era el motivo de que Loby, Bunnita y Enana no se movieran. En la ola, cada letra tiene su propio desfase; en el flujo, cada letra se desplaza lo que avanza sobre el eje y el color es continuo a lo largo del nombre. Con degradado, la sombra se aplica como `drop-shadow`, porque `text-shadow` se pintaba encima del color recortado.

La animación requiere un cupo de movimiento concedido y visible con calidad media o alta. Con calidad baja, con la vista previa pausada o con `prefers-reduced-motion: reduce`, el nombre conserva el estilo estático. Su nombre accesible incluye prefijo y sufijo; los glifos visuales no se anuncian por separado.

## Implementación y verificación

Fuentes: [NameStyleEditor.tsx](../web/src/components/chat/NameStyleEditor.tsx), [NameStyleControls.tsx](../web/src/components/chat/NameStyleControls.tsx), [StyledName.tsx](../web/src/components/chat/StyledName.tsx), [name-style.ts](../src/chat/name-style.ts) y [name-editor.css](../web/src/styles/name-editor.css). La dirección visual general se mantiene en [DESIGN.md](../DESIGN.md).

`web/tests/visual/name-style-editor-qa.ts` comprueba además que las tres plantillas animan (dos fotogramas del escaparate distintos), que se guardan precio, giro, ángulo del degradado y dirección de «Flotar», y que Deshacer agrupa un cambio por control. La comprobación de interfaz del 2026-10-29 cubrió 1440 × 960 y 390 × 844: guardado de precios, giro del nombre de 37°, ángulo del degradado de 271° y movimiento de 123°, sin errores registrados ni expansión horizontal en esos casos. El registro de límites conserva 16 px entre el nombre y el mensaje probado. Las capturas `editor-1440.png`, `editor-390.png` y `results.json` pertenecen a la campaña `reports/chat-name-editor-20261029`, que se publica desde el staging SSD al almacén compartido al cerrar. Estos casos verifican las muestras indicadas; no equivalen a una prueba exhaustiva de todas las combinaciones.
