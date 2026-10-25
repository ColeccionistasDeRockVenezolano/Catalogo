---
name: "CRV · Catálogo"
description: "Archivo editorial y panel de operación para la memoria del rock venezolano."
colors:
  archive-black: "#0a0a0a"
  surface-ink: "#141414"
  surface-raised: "#1c1c1c"
  surface-high: "#242424"
  border-structural: "#2a2a2a"
  border-soft: "#1e1e1e"
  text-primary: "#f5f5f5"
  text-secondary: "#ababab"
  text-faint: "#858585"
  brand-red: "#e50914"
  brand-red-strong: "#ff0f1b"
  brand-red-soft: "rgba(229, 9, 20, 0.16)"
  archive-amber: "#ffb02e"
  archive-amber-soft: "rgba(255, 176, 46, 0.16)"
  reference-violet: "#b185e3"
  reference-violet-soft: "rgba(177, 133, 227, 0.16)"
  verified-teal: "#2ec4b6"
  verified-teal-soft: "rgba(46, 196, 182, 0.16)"
typography:
  display:
    fontFamily: "Anton, Arial Black, sans-serif"
    fontSize: "clamp(28px, 5vw, 44px)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.55
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.55
  field:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "0.1em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  sm: "8px"
  md: "12px"
  lg: "18px"
  pill: "999px"
spacing:
  compact: "6px"
  control: "8px"
  field: "14px"
  mobile-gutter: "16px"
  desktop-gutter: "24px"
  section: "36px"
components:
  button-default:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-primary:
    backgroundColor: "{colors.brand-red}"
    textColor: "#fff"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "#ff8b90"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "9px 16px"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    typography: "{typography.field}"
    rounded: "{rounded.sm}"
    padding: "9px 12px"
  card:
    backgroundColor: "{colors.surface-ink}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "16px 18px"
  badge:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
---

# Design System: CRV · Catálogo

## Overview

**Creative North Star: "El Archivo en Operación"**

CRV se siente como un archivo musical editorial que está siendo consultado y cuidado, no como una aplicación de consumo ni como un dashboard corporativo genérico. El negro cálido crea continuidad y concentración; las superficies apenas elevadas organizan discos, personas, créditos y evidencia con una densidad serena. La portada, el nombre y la relación entre entidades siempre importan más que el ornamento.

Este sistema trabaja en modo **Operate**: lectura compacta, acciones directas, estados inequívocos y trazabilidad visible. El rojo es la voz de marca y acción; ámbar, violeta y teal son señales medidas para jerarquía, referencia y verificación. Los datos largos y los casos extremos deben seguir siendo legibles sin romper el flujo ni expandir el viewport.

**Key Characteristics:**

- Archivo oscuro, cálido y editorial.
- Densidad informativa con jerarquía clara y aire entre secciones.
- Rojo de marca reservado para acción, foco y selección.
- Acentos secundarios semánticos, nunca decorativos.
- Tipografía funcional: Inter para interfaz, Anton para momentos de identidad y JetBrains Mono para datos.
- Operación segura: estados, confirmaciones, evidencia y notas de auditoría visibles.

**The Evidence Before Ornament Rule.** Cada superficie debe ayudar a identificar, comparar, decidir o navegar una relación del catálogo; no se añade decoración que compita con esos trabajos.

## Colors

La paleta construye profundidad con negros próximos y usa el color saturado como señal escasa sobre un campo casi monocromo.

### Primary

- **Rojo CRV:** voz de marca, botones primarios, navegación activa, foco, selección y estados destructivos.
- **Rojo CRV intenso:** respuesta hover de la acción primaria y énfasis de controles destructivos.
- **Rojo CRV velado:** fondo de navegación activa, anillos de foco y estados de peligro sin llenar grandes superficies.

### Secondary

- **Ámbar de archivo:** marca el alias principal y avisos; su versión velada sostiene estados sin dominar la página.
- **Violeta de referencia:** identifica vínculos o información contextual, como un sello discográfico; se usa solo cuando la categoría lo justifica.

### Tertiary

- **Teal verificado:** confirma éxito y presencia activa del operador; su halo velado comunica estado sin parecer un CTA.

### Neutral

- **Negro de archivo:** fondo continuo de toda la aplicación.
- **Tinta de superficie:** tarjetas, filas y hero de entidad.
- **Superficie elevada:** cabeceras de tabla, campos y comparación de evidencia.
- **Superficie alta:** chips internos, scrollbar y toasts.
- **Borde estructural:** delimita contenedores, controles y tablas.
- **Borde suave:** separa filas internas sin fragmentar visualmente el contenido.
- **Texto principal:** títulos, valores y acciones legibles.
- **Texto secundario:** descripciones y controles de menor jerarquía.
- **Texto tenue:** metadatos, etiquetas y ayudas; ya está calibrado para el fondo oscuro y no debe reducirse más.

**The Red Is a Signal Rule.** El rojo CRV no cubre tarjetas ni secciones completas: aparece en marca, acción primaria, foco, selección y peligro.

**The Accent Has a Job Rule.** Ámbar, violeta y teal solo entran cuando comunican una categoría o estado; no se alternan para producir variedad visual.

## Typography

**Display Font:** Anton (con Arial Black y sans-serif como fallback)

**Body Font:** Inter (con system-ui, -apple-system y sans-serif como fallback)

**Data Font:** JetBrains Mono (con ui-monospace, SF Mono, Menlo y monospace como fallback)

**Character:** Anton aporta la contundencia de cartel musical únicamente en marca, placeholders y el encabezado del buscador. Inter sostiene el trabajo diario con una voz neutral y firme; JetBrains Mono estabiliza años, duraciones, IDs, conteos y payloads.

### Hierarchy

- **Display:** peso regular y escala fluida; se reserva para el encabezado central del buscador.
- **Headline:** peso fuerte, interlineado compacto y tracking ligeramente negativo; identifica una entidad. En móvil baja de 30px a 24px para preservar el ancho.
- **Page title:** 26px, peso fuerte y tracking ligeramente negativo; abre listas y tareas.
- **Modal title:** 18px; nombra una acción contenida sin competir con el contexto de fondo.
- **Body:** 15px con interlineado 1.55; base de la aplicación. Descripciones de entidad usan 14px y un ancho máximo de 72ch; introducciones de página, 68ch.
- **Control:** 13.5px y peso 600 en botones; 13.5px regular en tablas y campos.
- **Label:** 11–12px, peso 700, mayúsculas y tracking de 0.06–0.1em para kickers, títulos de sección y cabeceras de tabla.
- **Data:** monoespaciada con cifras tabulares para números, duraciones, intervalos, conteos, comparaciones y evidencia técnica.

**The Display Is a Stamp Rule.** Anton funciona como sello de identidad, no como tipografía general de titulares o controles.

**The Metadata Stays Quiet Rule.** Metadatos y etiquetas reducen tamaño y contraste, pero mantienen el peso y espaciado necesarios para seguir siendo escaneables.

## Layout

El contenido vive en un contenedor centrado de ancho máximo 1180px, con gutter de escritorio de 24px y gutter móvil de 16px. La barra superior mide 64px, es sticky y usa fondo negro al 90%, blur de 10px y borde inferior; el contenido principal comienza con 32px de separación y conserva 96px al final. Las secciones se separan verticalmente 36px: la densidad existe dentro de cada bloque, no por comprimir toda la página.

Las fichas de entidad abren con una retícula de arte + contenido: portada de 132px, gap de 24px y padding de 24px. Las listas de entidades usan columnas automáticas de mínimo 230px; formularios, columnas automáticas de mínimo 200px; créditos, columnas de mínimo 320px; hechos de revisión, mínimo 170px; evidencia, mínimo 260px. Estos mínimos son límites de legibilidad, no objetivos para amontonar columnas.

En escritorio la barra lleva la marca completa, los destinos Home, Catálogo, Efemérides y Radio (solo texto de 13.5px, sin iconos), la lupa del buscador global y el control de la cuenta. «Catálogo» abre un menú de 660px con las cuatro entidades, su descripción y sus totales reales, y una columna con atajos a artistas por género (las ocho familias con más fichas) y a discos por década. Se abre al pasar el ratón o con un clic (que lo fija), y Escape, un clic fuera o el cambio de página lo cierran. La lupa es un botón de 40×40px que se despliega en un campo de 240–380px con las sugerencias de `CatalogSearchInput` sin ejemplos rotativos. Enter lleva a los resultados del Home (`/?q=`), y «/» o Ctrl/⌘ K la abren. En el Home no aparece, porque el buscador grande ya está en el hero. Entre 761 y 1000px la marca queda solo en logo y el menú pasa a una columna de 400px. Hasta 1180px, el buscador abierto ocupa el lugar de los destinos (hasta 560px) en vez de encogerlos.

A 760px o menos, la interfaz cambia de modelo: la navegación principal se fija abajo en cuatro columnas iguales (Home, Catálogo, Efemérides y Radio), mide 64px más el safe area y muestra iconos de 22px y etiquetas de 11.5px; es el único lugar con iconos en la navegación principal. El `body` reserva 70px más el safe area para que nunca tape contenido. La cabecera superior pasa a 58px, con fondo sólido sin blur, en tres columnas: la «R» del logo al centro y el control de operador a la derecha, con target mínimo de 44×44px. En las listas de Artistas, Discos, Personas y Organizaciones, la columna izquierda suma una lupa y un botón de filtros de 44×44px (`MobileCatalogTools`), y la barra de búsqueda y filtros de la página desaparece. La lupa convierte la cabecera en el buscador de esa entidad, con flecha para cerrar y vaciar la búsqueda. El botón de filtros abre la hoja «Filtros» en dos niveles. La primera vista es corta: los ajustes de una sola elección (orden, «Mostrar») como filas de 54px con el select a la derecha, y una fila por grupo (Tipo, Género, Década, Participación) con lo elegido y un punto rojo si filtra. Tocar una fila muestra sus opciones en lista vertical, una por fila de 52px con su conteo y un check rojo, bajo el título del grupo y una flecha para volver. En Género, los subgéneros y estilos se abren bajo el género elegido, con un filete rojo. Con un solo grupo y nada que ordenar (organizaciones), la hoja muestra sus opciones directamente. Los filtros se aplican al tocarlos y la hoja termina con «Quitar filtros» y «Ver N fichas». Un círculo rojo sobre el icono cuenta los grupos de filtros activos. Acciones de página y formularios pueden ocupar el ancho disponible. En teléfono (`mobile-type.css`, cargada al final) ningún texto de lectura baja de 13px, las etiquetas en mayúsculas no bajan de 11px y descripciones y biografías van a 15px.

A 640px o menos, el hero pasa a una columna, la imagen baja a 88px y comparaciones de revisión pasan de dos columnas a una. A 560px, el gutter se fija en 16px. En móvil, los grupos de créditos se apilan; los modales se convierten en hojas inferiores y sus acciones permanecen sticky.

Los listados de artistas, personas, discos y organizaciones y la ficha de artista usan márgenes laterales fluidos: `clamp(var(--gutter), calc(12.5vw - 40px), 320px)`, aproximadamente un 10% en escritorio y el gutter habitual en móvil. Las galerías usan columnas automáticas de al menos 200px, separación horizontal de 28px y vertical de 36px; hasta 600px, el mínimo baja a 136px, con separación horizontal de 16px y vertical de 28px. Cada imagen es cuadrada, ocupa todo el ancho de su columna y lleva un radio de 2px y sombra suave con desplazamiento vertical. Las portadas y logos se muestran completos; las fotos llenan el cuadrado. El enlace no lleva fondo, borde ni padding: nombre, subtítulo y género quedan debajo, a 10px del arte. Los textos largos se ajustan en varias líneas sin ocultar datos, con `text-wrap: pretty`. Las fichas sin imagen o con una imagen que falla conservan el mismo espacio con su inicial, una superficie discreta y una indicación «Sin portada» o «Sin imagen» con icono; esta indicación es decorativa para lectores de pantalla. La sombra permanente se reserva al arte de las galerías, como pide la referencia del usuario. La discografía del artista se pagina en grupos de 24, usando `discographyPage` en la URL; el resto de listados conserva su paginación de 30.

Las tablas no se remaquetan como tarjetas: preservan un ancho mínimo de 620px dentro de un contenedor con desplazamiento horizontal y una pista visible “Desliza para ver más →”. Las tablas largas limitan su alto a 60vh con scroll vertical. Ningún nombre, biografía, badge o subtítulo puede ampliar el viewport; se usa truncado en tarjetas y corte seguro en contenido largo.

La comparación dentro de «Fiabilidad de la ficha» usa el ancho de la ficha, sin otro shell. El buscador dispone sus campos en una fila flexible con separación de 1rem; el campo de nombre puede crecer y parte de una base de 16rem. Los datos de ambas fichas y sus investigaciones usan dos columnas iguales con `minmax(0, 1fr)` y separación de 1.5rem; a 720px o menos pasan a una columna, manteniendo primero la ficha de origen y luego la seleccionada. El resumen individual de fiabilidad conserva tres columnas con separación de 24px y se apila en ese mismo breakpoint con separación de 16px. Textos largos, valores y citas admiten corte seguro dentro del ancho disponible.

**The Density Inside, Air Between Rule.** Filas, créditos y campos son compactos; los grupos semánticos conservan 22–36px de separación para que el archivo siga siendo escaneable.

**The Viewport Never Expands Rule.** Los datos extremos se truncan, cortan o desplazan dentro de su contenedor; el documento no admite overflow horizontal.

## Elevation & Depth

La profundidad es híbrida pero contenida. En reposo, el sistema se organiza con capas tonales y bordes de 1px; las sombras permanentes se reservan al arte de las galerías. Los tokens originales de sombra combinan varias capas con desplazamiento: la pequeña (`0 7px 10px #00000060, -7px 4px 4px #2525251e, 4px 14px 6px #2525251c`), la media (`0 14px 14px #00000091, -14px 8px 5px #2525252b, 8px 28px 8px #25252529`) y la grande (`0 24px 28px #000000b0, -20px 12px 10px #25252548, 12px 40px 14px #25252540`). La media sostiene menús de selección y toasts; la grande separa modales y el reproductor flotante del archivo subyacente. Carbón y Estudio sustituyen estos tokens con sus sombras propias en `web/src/styles/site-appearance.css`. El botón primario del tema Actual añade un halo rojo (`0 8px 20px rgba(229, 9, 20, 0.35)`) solo al hover; Estudio lo elimina.

El topbar desktop usa blur para mantener contexto durante el scroll. En móvil se elimina ese blur del topbar para no crear un containing block que desplace la navegación fija; el bottom nav conserva blur de 16px sobre un fondo casi opaco.

**The Flat-at-Rest Rule.** Tarjetas, filas y tablas dependen de tono y borde; las sombras aparecen donde existe elevación funcional o respuesta interactiva, con la excepción documentada del arte de las galerías.

## Shapes

La geometría es suavemente redondeada y utilitaria. El radio pequeño redondea botones, campos, navegación y filas compactas; el medio pertenece a tarjetas y tablas; el grande identifica heroes, búsqueda y modales. El radio píldora se reserva para badges, chips, estado del operador y ayudas flotantes. Los bordes de 1px son estructurales y de bajo contraste.

Las imágenes de entidad son cuadrados redondeados y recortados con `object-fit: cover`. Los placeholders mantienen la misma silueta y usan Anton, de modo que una imagen ausente no cambie la composición. En móvil, las hojas inferiores conservan únicamente las esquinas superiores grandes; los lados y el borde inferior llegan limpios al viewport.

**The Radius Signals Scale Rule.** 8px para controles, 12px para contenedores y 18px para superficies protagonistas o superpuestas; no se elige un radio por ornamento.

## Components

### Navigation

- **Desktop:** marca a la izquierda, destinos en una fila flexible y operador a la derecha. Los destinos son Home y Catálogo; Catálogo abre Artistas y queda activo en cualquier ficha, lugar o serie del catálogo. Los links usan texto secundario y pasan a texto principal sobre superficie de tinta al hover; el activo usa blanco sobre rojo velado.
- **Catálogo:** las listas de Artistas, Discos, Personas y Organizaciones comparten una barra segmentada de cuatro pestañas con icono, encima del título; el activo usa blanco sobre rojo velado con icono rojo. Vive fuera del Suspense de la página para no parpadear al cambiar de entidad. En móvil ocupa el ancho en cuatro columnas con icono sobre etiqueta corta («Organiz.»).
- **Mobile:** bottom nav fija con icono sobre etiqueta. El topbar retiene marca y operador, pero no duplica los links.
- **Accessibility:** el `nav` se nombra “Principal”; los iconos son decorativos y la etiqueta de texto siempre permanece en el árbol accesible.

### Buttons

- **Shape:** control compacto con radio pequeño, borde de 1px y gap interno de 6px.
- **Primary:** rojo CRV, texto blanco y padding de 9px × 16px; el hover intensifica el rojo y añade halo. El active baja 1px.
- **Default:** superficie elevada, texto principal y borde estructural; el hover eleva el contraste del borde.
- **Danger:** fondo transparente, borde rojizo y texto rojo claro; llena con rojo velado al hover. Se usa para retirar o rechazar, no como alternativa estilística.
- **Ghost:** sin borde ni fondo; sirve para acciones subordinadas dentro de una sección o fila.
- **Small:** padding de 5px × 10px, 12.5px y radio de 7px. En móvil conserva altura táctil mínima de 44px.
- **States:** foco visible de 2px en rojo con offset de 2px; disabled a 45% de opacidad, sin desplazamiento ni sombra.

### Badges & Chips

- **Badges:** píldoras de 11px, peso 700, mayúsculas y tracking de 0.04em. Por defecto usan superficie elevada, borde estructural y texto secundario.
- **Semantic badges:** fondos velados y texto saturado en rojo, ámbar, violeta o teal. La variante outline es transparente y mantiene el borde.
- **Chips:** píldoras de texto de 12.5px con padding asimétrico para alojar acciones circulares de 18px. El alias principal usa borde ámbar y estrella ámbar; las acciones internas responden con rojo velado.
- **Mobile:** las acciones internas del chip crecen a 44×44px y el padding derecho se reduce para absorber el target sin hinchar toda la píldora.

### Cards / Containers

- **Entity card:** superficie de tinta, borde estructural, radio medio y padding de 16px × 18px. Miniatura cuadrada de 52px, título en una línea y subtítulo truncado.
- **Entity hero:** radio grande, superficie de tinta y borde estructural. Es la única tarjeta que recibe padding de 24px y arte de 132px.
- **Credit row:** superficie de tinta, borde suave, radio pequeño y padding de 8px × 10px; contrapone quién a la izquierda y rol a la derecha.
- **Review surfaces:** hechos, comparaciones y claims mantienen bordes y tonos; los payloads usan mono, pre-wrap, corte seguro y scroll interno.

### Dense Tables

- **Container:** superficie de tinta, borde estructural y radio medio; recorta la tabla y asume el scroll.
- **Header:** sticky, superficie elevada, 11px en mayúsculas, peso 700, tracking de 0.07em y padding de 11px × 14px.
- **Rows:** texto de 13.5px, celdas de 10px × 14px y divisores suaves. El hover cambia la fila completa a superficie elevada.
- **Numeric data:** alineación derecha, JetBrains Mono y cifras tabulares. Las acciones se agrupan al extremo derecho.
- **Mobile:** se mantiene la geometría tabular y se desplaza dentro del contenedor; nunca se aplastan títulos o columnas numéricas hasta volverlos ilegibles.

### Inputs / Fields

- **Style:** etiqueta secundaria de 12px y peso 600; campo sobre superficie elevada, borde estructural, radio pequeño y padding de 9px × 12px.
- **Focus:** borde rojo y halo de 3px en rojo velado; el filtro compacto usa solo el cambio de borde.
- **Search:** campo protagonista de 16px, padding de 16px × 20px y radio grande dentro de un shell máximo de 720px.
- **Error:** borde rojo, mensaje de 12px rojo claro y banner rojo velado con borde rojizo. Las ayudas usan 11.5px en texto tenue.
- **Entity picker:** combobox con listbox elevado, altura máxima de 220px y navegación por flechas, Enter y Escape; conserva `aria-expanded`, `aria-controls`, `aria-activedescendant` y selección activa.

### Modals

- **Desktop:** overlay negro al 60%, panel de hasta 560px o 760px en variante amplia, máximo 86vh, radio grande, borde estructural, sombra grande y padding de 22px × 24px.
- **Mobile:** hoja inferior de ancho completo, máximo `min(92dvh, 820px)`, solo esquinas superiores redondeadas y padding compatible con safe area. Las acciones permanecen visibles al final mediante posición sticky.
- **Behavior:** portal a `body`, scroll de fondo bloqueado, foco inicial, trampa de Tab, cierre con Escape o clic exterior y restauración del foco al origen.
- **Accessibility:** `role="dialog"`, `aria-modal="true"`, título conectado por `aria-labelledby` y botón de cierre con nombre accesible.

### Operator, State & Feedback

- **Operator pill:** comunica solo lectura o identidad activa. El dot neutral pasa a teal con halo cuando hay credenciales; en móvil queda un control circular mínimo de 44px. Con cuenta administradora muestra avatar teal, nombre, contador teal de cambios sin deshacer y caret; al pasar el puntero (120ms) o con clic abre el menú de la cuenta: identidad, «Cambios de esta sesión» con su deshacer y Ctrl/⌘+Z, Historial, el grupo Administrar (Buscador y descubrimiento, Curaduría, Configuración) y Cerrar sesión. El borde se tiñe de rojo dentro de esas áreas. Sin sesión o con solo lectura, el clic abre el diálogo de acceso.
- **Loading:** spinner de 22px con borde de 2.5px y rotación lineal de 0.7s; skeleton con shimmer de 1.4s ease.
- **Empty/error:** bloque centrado con 56px × 20px; error usa rol de alerta y ofrece reintento cuando aplica.
- **Toasts:** esquina inferior derecha, superficie alta, borde y sombra media; `aria-live="polite"`. Éxito y error cambian el borde a teal o rojo.

### Fiabilidad y comparación dentro de fichas

Esta superficie conserva el fondo, tipografía, controles y estructura de las fichas de artista, persona y álbum. «Fiabilidad de la ficha» aparece solo para administradores, separada por un borde superior estructural y 20px de padding. Su cabecera contrapone el título y la condición privada al puntaje individual en monoespaciada; permite envolver ambos en pantallas pequeñas. El texto explicativo tiene un ancho máximo de 75ch.

«Comparar con otra ficha» abre un panel en el flujo de la página mediante un botón pequeño. La acción de apertura y el detalle usan `aria-expanded`, `aria-controls` y contenido oculto con `hidden`. La comparación de artista o persona presenta un selector de tipo y un campo de búsqueda; álbum presenta solo la búsqueda de otro álbum. Los resultados son una lista de botones nativos de ancho completo, con nombre en negrita y tipo, ID y contexto debajo. No es el combobox flotante de otros formularios: la lista permanece dentro de la sección. Cada opción usa fondo transparente, padding de .8rem, separadores estructurales, superficie elevada al hover y foco rojo interior de 2px. La búsqueda empieza con dos caracteres y comunica «Buscando fichas…» durante el debounce de 250ms y la solicitud; vacío y error tienen mensajes explícitos.

El resultado comienza tras otro separador y 1.5rem de separación y padding. Vincula la ficha seleccionada, ofrece investigar ambas fichas y presenta conclusión, puntaje de correspondencia, explicación, desglose y recuentos antes de desplegar el detalle. El puntaje individual conserva su etiqueta en cada investigación; no se confunde con la correspondencia de la pareja. La evidencia conjunta contiene enlace, cita y origen. El detalle incluye cada campo con sus valores de ambos lados, explicación y estado en texto, seguido por los dos informes completos con sus datos registrados, cobertura, hallazgos, citas, fuentes y limitaciones. Los artículos y hallazgos se separan con bordes, sin añadir tarjetas elevadas; las citas llevan una línea vertical estructural y .75rem de sangría.

El historial usa `details` y `summary` nativos, con cantidad de comparaciones, opciones de la misma lista y estado de investigación o informe. La ficha de origen ocupa siempre el primer lado, incluso al recuperar la misma pareja desde el otro extremo. Los estados de carga y trabajo en segundo plano usan `role="status"`; los errores, `role="alert"`. Una versión anterior se conserva con aviso y sin puntaje vigente. Los botones desactivados reutilizan la opacidad existente; en móvil los botones pequeños mantienen el mínimo táctil de 44px. La variante `btn--outline` usada por el panel conserva el aspecto del botón por defecto: el CSS actual no declara una variante adicional.

### Motion & Accessibility

Las transiciones de estado duran 120–150ms: transform de botón a 120ms y color, fondo, borde o sombra a 150ms. El overlay y los toasts entran con fade de 150ms. El movimiento es feedback, no espectáculo; no se animan reordenamientos de datos ni navegación entre registros.

Con `prefers-reduced-motion: reduce`, scroll animado se desactiva y toda animación o transición se reduce a 0.01ms con una sola iteración. Los links y botones deben conservar foco visible aun sin movimiento. Los targets móviles de operador, botones pequeños, cierre modal y acciones de chip alcanzan 44px. Inputs y selectores conservan etiquetas asociadas; los estados de carga y error usan roles de estado/alerta; imágenes decorativas o redundantes llevan texto alternativo vacío.

**The Motion Confirms Rule.** Una animación solo confirma entrada, carga o presión; nunca retrasa el acceso a datos o decisiones.

**The Keyboard Completes the Task Rule.** Todo flujo modal, selector y acción crítica debe poder completarse y abandonarse con teclado, con foco visible y restaurado.

### Informes y búsqueda del catálogo

El informe de fiabilidad usa un círculo de 80px con porcentaje tabular ámbar, barras nativas para el respaldo de cada área y para el avance de la etapa en curso. Un estado pendiente muestra un guion; los porcentajes provisionales se rotulan. Los contadores son botones que filtran el detalle. Las acciones de verificación y comparación comparten `page-actions`, `btn btn--sm` e iconos Phosphor de 14px con las acciones de la ficha.


Los informes privados de verificación y comparación muestran el resumen y los estados primero. Sus áreas y datos usan desplegables nativos, búsqueda y paginación de 20 filas. Evidencias, propuestas nuevas y límites de la investigación se consultan a petición, conservando todo el contenido. Las dos investigaciones de una comparación usan el mismo componente. Los datos pendientes por un fallo se distinguen de los evaluados sin respaldo.

Los informes de verificación distinguen coincidencia documental y falta de evidencia. Sin verificar, pendientes y faltantes muestran su estado sin porcentaje y quedan fuera del puntaje. El resumen indica cuántos datos se contrastaron y cuántos se excluyeron; un informe completo sin datos contrastados muestra «Sin datos contrastados», con porcentaje vacío.

Los buscadores principal, de artistas, personas, discos y organizaciones comparten `CatalogSearchInput`. El campo vacío alterna ejemplos reales del catálogo cada 3.5 segundos con una transición de opacidad y desplazamiento vertical de 200ms, compartida con el filtro musical mediante `RotatingSearchExample`. Se detiene al escribir, cuando la pestaña queda oculta o con movimiento reducido. La principal intercala artistas, personas, discos, organizaciones, géneros, subgéneros y estilos; las barras secundarias muestran solo su tipo. El filtro musical alterna los tres niveles de la taxonomía, con fichas disponibles según la ampliación activa. Las entidades y los géneros se eligen mediante muestras reproducibles del ciclo editorial común y se recorren sin repetir nombres en la vuelta. La selección diaria solo cambia con el ciclo de `src/shared/daily-cycle.ts`, a las 00:00 de `America/Caracas`, con autoridad horaria del servidor; la rotación visual de los ejemplos no cambia ese ciclo. La rotación evita repetir el mismo texto consecutivamente. Los ejemplos conservan una etiqueta accesible estable. Con el campo vacío, Tab o el botón «Usar» escribe la recomendación visible y mantiene el foco para editarla. Escape permite descartarla y continuar al siguiente control con Tab; Shift+Tab conserva la navegación hacia atrás. Un consejo contextual explica ambos caminos y su X lo oculta en todas las barras del navegador durante 24 horas, conservando el atajo y el botón. Al escribir aparecen sugerencias mediante Autocomplete de Base UI, con nombre, tipo y contexto. Flechas y Enter seleccionan; Escape y clic exterior cierran. Las fichas abren su ruta y los géneros abren el filtro existente, conservando familia, subgénero y estilo. El principal empieza con una letra y comparte su consulta; las listas, con dos y retardo de 250ms, cancelan consultas anteriores. La página de resultados muestra miniatura (portada, foto o logo, con icono del tipo si falta), filtra por tipo con chips y conteos guardados en la URL (`?tipo=`), enseña cinco por grupo en «Todos» con «Ver los N», y sin resultados ofrece buscar palabra por palabra y explorar el catálogo. Los estados de carga, vacío y error son explícitos. El desplegable usa superficies, bordes y radios del catálogo, opciones de al menos 44px y foco rojo, con ancho ajustado al campo y scroll contenido en móvil.

### Origen de los datos (administración)

La procedencia conserva la identidad oscura, la tipografía y los separadores de las fichas. Aparece como pestaña en artistas, personas y organizaciones, y como sección en discos, solo para administradores; visitantes y lectores no ven ni consultan estos datos. Cada aporte ocupa una fila plana de dos columnas en escritorio: campo, valor, estado, confianza y fecha a la izquierda; fuente y evidencia a la derecha. En móvil (hasta 640px) se apilan en una columna. La lista se pagina en grupos de 15 aportes.

El nombre de la fuente lleva un enlace subrayado HTTP/S hacia la evidencia registrada, priorizando la referencia del aporte y luego la página capturada. Si solo existe el sitio general, se identifica como «Enlace general de la fuente»; sin URL web válida, el nombre queda en texto con «Sin enlace web registrado». Los aportes conservan su estado y se advierte que un valor aceptado puede haber cambiado después.

Los valores extensos, extractos y referencias adicionales usan desplegables nativos. Sus controles conservan foco visible rojo de CRV (2px) y una altura mínima de 44px en móvil. Carga y error tienen roles accesibles, el error permite reintentar y el vacío explica que el origen no puede determinarse con la evidencia disponible.

En los créditos del disco y sus pistas, la fuente y su estado aparecen bajo el nombre acreditado, conservando el rol a la derecha y las filas existentes. «Fuente: Sincopa» enlaza la referencia registrada; una edición manual sin URL se identifica dentro del detalle. El desplegable nativo «Ver origen del crédito» muestra campos, fechas, extractos y referencias adicionales, con foco rojo y mínimo de 44px. Los créditos agrupados de varias pistas conservan todos sus aportes y evidencias. Estas fuentes mantienen el acceso exclusivo de administración y comparten una carga por disco.

### Propuestas con IA: decisiones individuales

Superficie de operación con filas planas separadas por borde superior. Cada fila nombra una corrección concreta y muestra «¿Aceptas el cambio?» con «Sí, aceptar» y «No». Aceptar aplica exclusivamente esa propuesta; la respuesta aparece en un aviso con Deshacer y queda accesible en Ver todas. Los textos combinados se muestran completos y los cambios de campos comparan actual/propuesto. Las fuentes, el motivo y la edición avanzada se despliegan a petición. Los hallazgos de verificación enlazan una preparación enfocada en ese dato. Se conservan el fondo oscuro, los tokens y los controles compartidos; en móvil las acciones ocupan una fila amplia con altura mínima de 44px.

Antes de los borradores, la lista «Recomendaciones y datos faltantes» conserva todos los pendientes del informe y ofrece búsqueda, filtro por área y páginas de 12 filas. Cada fila permite preparar ese dato o recuperar su propuesta guardada. Los valores desconocidos ofrecen investigar; las fuentes se abren a petición. El alcance de cada borrador se puede consultar en «Qué se pidió en esta propuesta».

### Portada pública: descubrimiento diario

La home conserva la identidad editorial negra y roja. «Rock Venezolano» usa rojo sólido con un halo discreto, sin degradado en las letras. El buscador principal tiene etiqueta visible, ejemplo separado debajo y navegación Tab convencional; las otras barras conservan sus ejemplos y atajos existentes. Géneros, décadas y los recorridos diarios se alcanzan desde el primer bloque.

El ciclo editorial común de `src/shared/daily-cycle.ts`, sincronizado con el servidor, determina las recomendaciones y cambia a las 00:00 de `America/Caracas`. React lo consume mediante `DailyCycleProvider`, `useDailyCycle` y `useDailyAsync`; las APIs reciben su fecha y devuelven `dailyCycle`. Al comenzar un ciclo no se muestra la selección anterior durante la carga de la nueva. Artistas con foto, biografía y disco con portada rotan por una permutación diaria; las recomendaciones de escucha conservan portadas y enlaces verificados. Los aniversarios mantienen su año y cambian su selección de discos cada día. Sellos y recorridos también varían por fecha; las cifras y las taxonomías siguen representando el catálogo. La página revalida cada cinco minutos y al volver a una pestaña pendiente de actualización.

El muro usa una reserva diaria de 90 portadas y cambia 3, 4 o 6 posiciones simultáneamente cada cuatro segundos mediante un fundido de 250 ms. Su deriva lateral recorre un 6 % del ancho del muro en ciclos alternos de 90 segundos. Los carruseles de aniversarios y videos avanzan por páginas cada siete segundos. Se pausan al usar el teclado, tocar, salir de pantalla u ocultar la pestaña; el hover conserva el avance. Su control de pausa explícita y sus flechas tienen 44 px. Al terminar un recorrido, aniversarios selecciona el siguiente grupo. La selección intercala familias musicales confirmadas siempre que haya discos elegibles. Con movimiento reducido se conserva el control manual y se desactiva el avance automático.

Las fundas dejan salir el vinilo hacia abajo. El plato de «Un disco para hoy» conserva su salida a la derecha y su giro. El artista destacado toma el ambiente de la portada de su disco; su fotografía permanece recta, sin sombra, giro ni transición. Los artistas similares ocupan una fila completa en escritorio y dos columnas compactas en móvil. El siguiente disco se elige con una flecha al centro del lateral derecho; los selectores inferiores tienen área táctil de 44 × 44 px y las plataformas de escucha muestran texto.

Los videos se consultan al canal oficial con caché de cinco minutos y alternativa de feed público. Se ordenan por publicación y comunican cuándo se verificó el canal o cuándo se conserva una consulta anterior. Cada miniatura abre un modal con fondo negro translúcido, con «Abrir desde YouTube» y opción de minimizar. Un único iframe vive fuera de las rutas y cambia de posición sin remontarse ni perder el tiempo de reproducción; al navegar a otra página continúa flotante. Ampliar restaura el modal y Cerrar detiene el audio. Las fichas de disco comparten el mismo reproductor y conservan los saltos a pistas. En móvil la ventana flotante se coloca sobre la navegación inferior, sin taparla. Los géneros mantienen su geometría al interactuar, conservando los surcos y la flecha internos. Las décadas forman un gráfico de barras verticales rojas con altura proporcional, recuentos y años clicables: sin bisel, brillo ni animaciones. En móvil el gráfico se desplaza horizontalmente dentro de la sección. «Antes de 1950» enlaza un filtro real.

El pie presenta el archivo, sus fuentes generales, el blog, el canal y el contacto oficial por Instagram. No se exponen informes privados de administración.

Las tarjetas del catálogo separan los enlaces de portada, título, artista, fecha, tipo y géneros. Los años llevan al filtro de su década para discos o artistas; los géneros mantienen familia, género y estilo en la URL. La discografía recibe los géneros confirmados de cada álbum, sin copiarlos del artista. Los textos de género pendientes de confirmación siguen identificados y no generan filtros engañosos.

### Apariencia del catálogo y visor de imágenes

«Administrar», dentro del menú de la cuenta, agrupa «Buscador y descubrimiento», «Curaduría» y «Configuración» para cuentas administradoras. Configuración tiene navegación lateral con «Temas» y ofrece tres opciones mediante botones de radio: Actual, Carbón y Estudio. Seleccionar una opción deja un cambio pendiente; solo «Aplicar tema al catálogo» guarda la preferencia en el servidor para todos los visitantes. Actual es el valor predeterminado y siempre se puede volver a él.

Actual conserva los tokens originales. Carbón utiliza negros mate, un grano fino de contraste bajo, paneles con iluminación interior tenue, bordes grises y carmesí para selección y reproducción. Distingue las superficies por tono, refuerza el contraste del texto y conserva un foco visible rosado. Los controles de reproducción de pistas son circulares; los textos secundarios y las cifras de duración mantienen una lectura clara.

Estudio utiliza grafito cálido de fondo (#151411), paneles (#1e1d19), texto marfil (#f4efe5) y acentos champán (#d9ba82). Sus superficies son planas, con líneas finas; los títulos de ficha usan Inter de peso 650 y las portadas conservan esquinas discretas (4 px). Carbón y Estudio mantienen la composición y los datos del catálogo, el foco de teclado visible y los colores de marca de las plataformas de escucha. El peligro conserva su semántica roja, también en Estudio: el acento champán no sustituye ese significado.

Home siempre recibe los tokens originales, con independencia de la preferencia global. En escritorio su enlace muestra el texto «Home» sin icono; en teléfono muestra solo la casa, sin texto visible, y conserva el nombre accesible mediante `aria-label="Home"`.

Las portadas se amplían con el mismo gesto visible que las fotos de artistas. Fotos, logos y portadas comparten un diálogo dedicado a imágenes con fondo oscuro, imagen completa sin recorte, zoom anclado al cursor o al pellizco, arrastre limitado a los bordes, doble clic, ajuste a pantalla y tamaño real. Esc cierra y devuelve el foco al botón de origen; Tab permanece en el visor. La imagen usa el archivo original, conserva su proporción y ofrece estado de carga y reintento. El visor conserva sus propios colores para ofrecer una superficie estable con todos los temas.

### Galería de artistas

La pestaña pública «Galería» prolonga el archivo oscuro existente y da protagonismo a las imágenes completas, sin recorte. Una retícula adaptable presenta cada fotografía con categoría, título y pie de foto cuando existen; fecha y ubicación quedan en una línea secundaria que admite salto. Los filtros muestran categoría, cantidad y selección explícita. Las categorías son Artista, Conciertos, Pósters e Imágenes relacionadas. Las herramientas de edición aparecen solo para administradores y reutilizan los botones, campos, modales y confirmaciones compartidos.

El editor conserva el modo **Operate**: cola de miniaturas a la izquierda e inspector de una imagen a la derecha, con previsualización completa y campos etiquetados. Hasta 600px la cola pasa a una franja horizontal desplazable y los campos se apilan en una columna, sin ampliar el documento. La categoría del lote indica que afecta a todas las fotos y permite ajustes individuales posteriores; su selector mantiene una altura mínima de 44px. La miniatura seleccionada combina borde visible y estado accesible. El progreso y los errores se comunican mediante estado y alerta.

Ampliar una imagen de la galería abre la variante «Mesa de luz» del visor compartido. «Sobre la foto» reúne la descripción completa y los metadatos registrados, con desplazamiento contenido; cuando falta la descripción se comunica su ausencia. La categoría, fecha y ubicación se muestran únicamente cuando están registradas.

**The Gallery Preserves the Image Rule.** La galería y su inspector muestran la imagen completa; los pies y metadatos acompañan su consulta y las acciones de administración conservan los controles compartidos del catálogo.

### Consulta de galería, archivo y secciones

La consulta de la galería conserva la identidad oscura y roja de CRV y prioriza la imagen. Títulos y descripciones se limitan a dos líneas en la retícula; la descripción completa se consulta en «Sobre la foto» dentro del visor a pantalla completa. Hasta 600px la retícula mantiene dos columnas y los filtros de categoría se desplazan horizontalmente. «Editar galería» activa las acciones por foto únicamente para administradores.

La Mesa de luz usa fondo cálido (#131212), lienzo negro (#090909) y panel plegable (#211d1d), con tipografía del catálogo y selección roja. El panel derecho ocupa 350px en escritorio y 310px entre 701px y 1000px. Abre en «Colección»: dos columnas y hasta cuatro filas de miniaturas completas, numeradas y con selección visible; las colecciones extensas se desplazan dentro del panel y mantienen visible la foto seleccionada. «Sobre la foto» comparte ese panel y ofrece también «Abrir imagen original». Los botones textuales «Colección» y «Sobre la foto», junto al título de la imagen, abren el contexto correspondiente. El lomo del panel —una tira de 44px en el borde derecho con el icono y «Plegar»/«Archivo»— pliega y vuelve a desplegar el mismo panel: plegado no ocupa espacio, queda `inert` y la foto gana su ancho; el mando sigue en su sitio y conserva el foco. En pantallas de hasta 700px ese lomo pasa a una barra inferior de 44px. Hasta 700px el panel pasa debajo de la imagen: Colección ocupa 230px y distribuye ocho miniaturas en cuatro columnas y dos filas; la información ocupa hasta el menor valor entre 42dvh y 360px. Se conservan las áreas seguras y los controles táctiles de al menos 44px. En horizontal de poca altura se compactan cabecera y controles y se oculta el pie de ayuda.

El visor recorre las fotos del filtro activo con botones anterior/siguiente, flechas izquierda/derecha y miniaturas; los extremos enlazan circularmente y Home/End llevan a la primera/última imagen. Las pestañas del panel tienen navegación de teclado propia con flechas y Home/End, sin cambiar de foto. Al pasar a otra imagen se restablece el ajuste a pantalla y se actualizan los metadatos, conservando la pestaña y el estado plegado del panel. El ajuste inicial respeta la proporción y no amplía el original por encima del 100%; rueda, pellizco, zoom y arrastre permiten explorarla. Con la imagen ajustada, tocar a la derecha avanza y tocar a la izquierda retrocede; el toque espera 280ms para distinguir el doble toque, que alterna ampliación y ajuste. El gesto horizontal cambia de foto solo con la imagen ajustada. El diálogo nativo mantiene el foco dentro del visor, con foco visible; Escape cierra y restaura el foco al origen. Estos cambios son directos, sin animaciones añadidas.

«Archivo del artista» presenta documentos como filas con categoría, contexto y extractos de dos líneas. La búsqueda consulta título, contenido y etiquetas sin distinguir tildes ni mayúsculas y se combina con el filtro de categoría. «Leer documento» abre un lector dedicado de ancho cómodo, con texto completo, fuentes, etiquetas y navegación por los resultados filtrados; sus extremos desactivan el salto correspondiente. «Organizar documentos» es un modo explícito para administradores: solo al activarlo aparecen selección y reclasificación. En móvil los filtros se desplazan horizontalmente y los controles de organización se apilan.

Las secciones de la ficha mantienen pestañas horizontales con contadores, selección subrayada en rojo y botones visibles para desplazar la lista, desactivados al alcanzar cada extremo. Flechas, Home y End permiten cambiar de sección con teclado y mantienen visible la pestaña elegida. Hasta 760px se añade el selector nativo «Explorar perfil», conservando también las pestañas. Ambos controles comparten la selección en `?tab=` y preservan los demás parámetros de la URL; solo se monta el panel activo. El desplazamiento animado respeta la preferencia de movimiento reducido.

### Reproductor compartido y controles de pistas

Los videos de discos se incrustan en su ficha; los demás abren un diálogo nativo centrado de hasta 860px con fondo negro al 76%. Pulsar el fondo o Escape los minimiza. La miniatura ocupa hasta 224px, con arrastre, pausa y acceso a los controles; el flotante pequeño ocupa hasta 360px y muestra pistas y progreso. Sin anclar, tocar fuera devuelve el pequeño a miniatura; la chincheta conserva su tamaño al navegar. El viewport de YouTube mantiene al menos 200 × 200px. Los reproductores externos de audio se muestran directamente con sus controles nativos, sin pantalla de activación, y conservan su iframe al navegar. Cabeceras de superficie mate, título truncado y metadatos secundarios agrupan los controles de ventana; el acento del tema identifica reproducción y anclaje. Las flechas sobre «Mover» ajustan la posición. La entrada del modal usa opacidad y desplazamiento de 8px, 200ms y `cubic-bezier(0.23, 1, 0.32, 1)`; con movimiento reducido se omite.

Los controles aparecen en orden anterior, reproducir/pausar y próxima pista, con áreas de 44 × 44px. Reproducir/pausar usa el acento del tema y las flechas tienen fondo transparente, con respuesta tonal al hover. Los controles desactivados conservan su posición. A continuación se muestran título de pista, estado y tiempo con cifras tabulares; el grupo admite salto de línea en espacios estrechos.

Los saltos usan las marcas de tiempo registradas y pueden cambiar al video de otro lado o disco. La lista y la página de origen permanecen en la sesión del reproductor al navegar. Se omiten las pistas sin marca; anterior y próxima se desactivan en los extremos y mientras no hay reproducción conectada. En el canal recorren los videos de la lista. Un salto dentro del mismo video conserva el iframe. «Ampliar video» abre de nuevo el modal y «Cerrar» detiene la reproducción. El modal añade volumen, silencio, búsqueda de diez segundos y lista de pistas; los errores incluyen reintento. Ver docs/MEDIA_PLAYER.md.

## Do's and Don'ts

### Do:

- **Do** mantener el fondo negro de archivo y construir jerarquía mediante superficies cercanas y bordes discretos.
- **Do** reservar el rojo para marca, CTA primario, foco, selección y peligro.
- **Do** usar JetBrains Mono y cifras tabulares en años, IDs, duraciones, conteos y evidencia técnica.
- **Do** conservar tablas densas como tablas con scroll contenido en móvil.
- **Do** probar nombres, biografías, créditos y listas extremos sin overflow horizontal.
- **Do** mantener targets de 44px, safe areas, foco atrapado en modales y etiquetas accesibles.
- **Do** presentar valor actual, propuesta, confianza y fuente antes del payload completo en tareas de revisión.

### Don't:

- **Don't** convertir el panel en un dashboard de tarjetas grandes, gradientes o métricas decorativas.
- **Don't** usar ámbar, violeta o teal como colores alternos sin una semántica concreta.
- **Don't** cubrir superficies grandes con rojo ni usar sombras permanentes para elevar cada tarjeta.
- **Don't** sustituir la navegación inferior móvil por una cabecera horizontal comprimida o desplazable.
- **Don't** colapsar una tabla compleja en texto ilegible; desplázala dentro de su contenedor y muestra la pista de scroll.
- **Don't** ocultar acciones críticas bajo la navegación inferior o fuera de una hoja modal larga.
- **Don't** usar Anton para cuerpo, labels, tablas o formularios.
- **Don't** depender solo del color, del hover o del movimiento para comunicar estado y acción.


### Bandeja visual de aportes

`/curaduria/aportes` conserva los colores y las tipografías del catálogo. En escritorio, la cola muestra miniaturas y contexto a la izquierda y el detalle presenta la imagen de la ficha y comparaciones de valores a la derecha. En móvil, lista y detalle se alternan con un botón «Fichas». Las fuentes permanecen identificadas en cada dato y los extractos se despliegan; en contradicciones se muestran abiertos. Las acciones de selección aparecen al seleccionar y declaran su alcance visible. Las imágenes ausentes o fallidas usan iconos; no se inventan fotos. La comparación de identidades presenta ambas referencias con sus imágenes y contexto disponibles.
