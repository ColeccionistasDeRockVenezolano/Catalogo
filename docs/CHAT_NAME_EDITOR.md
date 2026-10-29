# Editor de estilos del chat

El administrador abre **Chat → Tienda → Abrir editor de estilos**. El editor permite preparar efectos sobre el texto del nombre, comprobarlos junto a mensajes y fijar sus precios antes de guardarlos en la tienda. Las placas son productos `badge` independientes, se equipan a la derecha del nombre y no forman parte del estilo del nombre.

## Crear, revisar y publicar

1. Elegir **Nuevo estilo**, **Duplicar**, un producto existente o una referencia conservada.
2. Completar nombre, código único, descripción, orden, precios y duración. El código admite 2–40 letras minúsculas, números o guiones; el nombre, 2–40 caracteres; la descripción, hasta 160. El código y el tipo de un producto existente no se cambian desde el formulario.
3. Probar el resultado en **Nombre para probar**. La escena muestra el nombre, un mensaje propio y otro coleccionista para comprobar separación y legibilidad. **Pausar animación** permite revisar su alternativa estática.
4. Elegir **Visible en la tienda** y pulsar **Añadir a la tienda** o **Guardar cambios**. Los cambios del formulario solo se publican al guardar; se muestran el resultado y los errores de la operación.

Los precios los establece el administrador, por separado en monedas y créditos: enteros de 0 a 100.000. **0 permite adquirir el producto gratis con esa moneda**, aunque la otra tenga un precio mayor. La duración vacía significa permanente; de lo contrario admite entre 1 y 3.650 días. El orden admite enteros entre 0 y 10.000.

Desmarcar **Visible en la tienda** y guardar oculta el producto. Sigue disponible como «(oculto)» en **Editar un producto existente**: seleccionarlo, marcar la visibilidad y guardar permite recuperarlo. **Actualizar catálogo** vuelve a consultar los productos.

**Loby**, **Bunnita** y **Enana** se conservan como plantillas, sin publicación automática. Si ya existe su producto de nombre con ese código, el botón carga ese producto; en caso contrario prepara un borrador con la referencia y un nombre de prueba. Revisar precios y visibilidad antes de guardar. No se vuelve a sembrar el catálogo antiguo.

**Deshacer** y **Rehacer** recorren las ediciones del borrador; **Restablecer** recupera el producto seleccionado originalmente o los valores de un estilo nuevo. El historial es local al editor; no representa una reversión de publicaciones en el servidor.

## Controles y límites

| Grupo | Controles y valores admitidos |
| --- | --- |
| Tipografía | Sans serif, serif, cursiva o monoespaciada; tamaño 10–40 px; peso 100–900; cursiva; espaciado −1,5 a 6 px; prefijo y sufijo de hasta 12 caracteres cada uno. |
| Orientación | Giro del nombre completo, giro por letra, ángulo del degradado, dirección de sombra y dirección del movimiento: **0–360°**, mediante deslizador y campo numérico. |
| Color | Tres colores hexadecimales, degradado opcional y posición del color central 0–100 %. |
| Contorno y sombra | Color y grosor del contorno 0–2 px; sombra opcional con color, desenfoque 0–12 px y distancia 0–8 px. |
| Movimiento | Estático, degradado por letra, flujo de color, onda de movimiento, pulso, destello o giro de letras. Sentido normal, inverso, ida y vuelta o ida y vuelta inversa; ciclo 0,3–20 s; recorrido 0–12 px; desfase por letra −1 a 1 s. |

El nombre de prueba admite hasta 48 caracteres. Los controles de nombre se muestran para productos `name`. Los demás tipos conservan su manifiesto y permiten editar sus metadatos y precios; sus propiedades se ajustan mediante JSON avanzado.

## JSON y conservación de productos

**Importar, exportar y opciones avanzadas** permite exportar el producto completo a JSON, incluidas las capas de productos existentes. Importar un JSON válido lo carga como borrador; no lo publica. Revisar código y precios: un código que ya existe impide crear una copia y requiere elegir el producto del catálogo para editarlo, o usar otro código.

**Cargar manifiesto actual** copia el manifiesto al campo avanzado; **Aplicar JSON al borrador** lo valida y aplica al formulario. Guardar sigue siendo una acción posterior. El formulario y el servidor comparten el contrato de validación de productos; un JSON inválido no se aplica.

## Espacio, adaptación y movimiento reducido

El editor amplía la interfaz oscura CRV en modo **Operate**: campos etiquetados, separadores entre grupos, superficies tonales y foco rojo. Desde 760 px, controles y vista previa ocupan dos columnas; la vista previa permanece junto al formulario. Por debajo de 760 px, la vista previa aparece antes de los controles. La escena tiene desplazamiento propio para contener ejemplos grandes.

El nombre reserva una huella calculada a partir del ancho y alto del texto, su giro, sombra, contorno y recorrido. Las letras giradas disponen de espacio adicional. Los encabezados y listas del chat permiten envolver el nombre, y los mensajes mantienen separación vertical para que el texto estilizado no invada el mensaje siguiente. El texto limita su ancho a `min(65vw, 420px)` y admite salto de línea.

La animación requiere un cupo de movimiento concedido y visible con calidad media o alta. Con calidad baja, con la vista previa pausada o con `prefers-reduced-motion: reduce`, el nombre conserva el estilo estático. Su nombre accesible incluye prefijo y sufijo; los glifos visuales no se anuncian por separado.

## Implementación y verificación

Fuentes: [NameStyleEditor.tsx](../web/src/components/chat/NameStyleEditor.tsx), [StyledName.tsx](../web/src/components/chat/StyledName.tsx), [name-style.ts](../src/chat/name-style.ts) y [name-editor.css](../web/src/styles/name-editor.css). La dirección visual general se mantiene en [DESIGN.md](../DESIGN.md).

La comprobación de interfaz del 2026-10-29 cubrió 1440 × 960 y 390 × 844: guardado de precios, giro del nombre de 37°, ángulo del degradado de 271° y movimiento de 123°, sin errores registrados ni expansión horizontal en esos casos. El registro de límites conserva 16 px entre el nombre y el mensaje probado. Las capturas `editor-1440.png`, `editor-390.png` y `results.json` pertenecen a la campaña `reports/chat-name-editor-20261029`, que se publica desde el staging SSD al almacén compartido al cerrar. Estos casos verifican las muestras indicadas; no equivalen a una prueba exhaustiva de todas las combinaciones.
