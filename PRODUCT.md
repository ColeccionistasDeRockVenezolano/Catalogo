# Coleccionistas de Rock Venezolano

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Catálogo de música venezolana con fichas de artistas, personas, discos, organizaciones y pistas dentro de los discos. Los visitantes consultan y buscan; los administradores corrigen, investigan y comparan datos. Una sesión de lector conserva el acceso público sin herramientas de administración.

## Product Purpose

Consultar, descubrir y conservar la memoria musical venezolana mediante fichas relacionadas y datos cuya procedencia se pueda revisar. La escucha conecta el catálogo con los discos, sus pistas y los videos registrados.

## Positioning

El catálogo relaciona artistas, personas, discos, pistas y organizaciones. Integra investigación y comparación con fuentes, decisiones individuales de curaduría e historial de cambios, distinguiendo identidad, membresía y edición.

## Operating Context

La interfaz usa español, fondo oscuro, tipografía y controles compartidos en web/src/styles/global.css. Las fichas conservan su identidad y estructura existentes. Las herramientas de curaduría son superficies de operación: datos legibles, resultados revisables, estados explícitos y controles accesibles, con adaptación a escritorio y móvil.

React y React Router sirven la interfaz web; Fastify, PostgreSQL y el gateway de investigación existente sostienen las consultas y la curaduría. Los visitantes exploran y escuchan en escritorio o móvil. Los administradores revisan evidencia, preparan propuestas y aceptan o rechazan cada cambio desde las fichas.

## Capabilities and Constraints

### Fiabilidad y comparación

«Fiabilidad de la ficha» investiga cada dato contra fuentes y conserva informe, citas y puntaje privado. «Comparar con otra ficha» amplía esa sección con buscador, selección y contraste de artista/persona en ambos sentidos y álbum/álbum. Distingue identidad de relación de membresía o de edición. Los dos informes y sus evidencias se pueden abrir con un botón; el historial se recupera desde cualquiera de las fichas.

Los puntajes representan respaldo documental y cobertura, no probabilidades de verdad. Datos ausentes aportan cero y las fuentes deben justificar los resultados. Investigar o comparar no modifica fichas ni fusiona entidades. Cambiar datos invalida el puntaje anterior.

Referencias de producto: README.md, docs/decisions/2026-10-07-fiabilidad-individual.md y docs/decisions/2026-10-07-comparacion-desde-fichas.md. Stack real: React y React Router, Fastify, PostgreSQL y gateway de investigación existente. Los informes se guardan en el esquema ingest; no se exponen a visitantes o lectores.

### Resolución de identidad

En las personas, «Resolver artista y buscar información con IA» comprueba la identidad solista mediante páginas citadas, busca artistas por nombres y alias, detecta conflictos y crea o vincula el artista cuando hay respaldo suficiente. La acción explícita del administrador autoriza ese flujo automático. El vínculo y el alias quedan en el historial con opción de deshacer; después se investigan las dos fichas. Los conflictos y los datos sin respaldo permanecen pendientes. Referencia: docs/PERSONA_ARTISTA_AUTOMATICO.md.

### Propuestas con IA

Las propuestas con IA convierten los hallazgos de fiabilidad en decisiones individuales: el administrador acepta o rechaza cada corrección y la aceptación se aplica al momento. La IA prepara altas, ediciones, géneros, relaciones y fusiones completas. Las biografías combinadas muestran su texto íntegro; cada cambio aceptado tiene historial y deshacer. Los formularios y fuentes son detalles secundarios, sin pasos visibles de guardar, validar o implementar un lote.

### Revisión de curaduría

La bandeja de Curaduría presenta una lista compacta y el detalle del caso seleccionado. Permite buscar por nombre, valor o ID, ordenar el conjunto completo, revisar de 25 a 100 casos por página y conservar filtros y posición en la URL. La última revisión se recuerda por cuenta. Las acciones permanecen visibles mientras se consulta la evidencia; los controles por grupo indican el alcance y conservan las previsualizaciones y el historial existentes.

Las investigaciones documentadas entran como hallazgos con fuentes, conclusión y recomendación. Los datos que cambiaron desde la investigación se señalan para revisarlos; una recomendación no se aplica al registrarla. Los discos se comparan dentro del detalle y una fusión documentada abre las dos fichas en modo de emparejamiento.

### Revisión visual de aportes

Curaduría → Revisar aportes agrupa los claims candidatos y en conflicto por ficha, con imagen, nombre y contexto. Cada dato compara el valor actual y la propuesta; sus fuentes se despliegan a demanda y las contradicciones presentan la evidencia abierta. Las decisiones individuales y la selección múltiple afectan solo los claims indicados. Las dudas de identidad abren una comparación visual con el contexto disponible. Se puede dejar pendiente, continuar desde la URL guardada y deshacer cada decisión. Referencia: docs/CLAIM_REVIEW.md.

### Descubrimiento diario

Todas las selecciones diarias usan el reloj editorial común de `src/shared/daily-cycle.ts`, con cambio a las 00:00 de `America/Caracas` y autoridad horaria del servidor. React usa `DailyCycleProvider`, `useDailyCycle` y `useDailyAsync`; las APIs reciben la fecha del ciclo y devuelven `dailyCycle`. Al cambiar el ciclo no se muestra la selección anterior mientras se carga la nueva. No se usa la fecha local del navegador ni un sorteo por visita. Referencia: docs/DAILY_CYCLE.md.

### Escucha y reproducción

Los enlaces y reproductores disponibles se conservan por plataforma. Solo puede estar activa una fuente de reproducción: iniciar otra detiene la anterior, incluidos los reproductores externos de audio, que se muestran directamente sin pantalla de activación. Los videos de discos se incrustan en su ficha; los demás se abren en modal con fondo negro translúcido. Hay miniatura y flotante pequeño con chincheta: sin anclar, tocar fuera devuelve el pequeño a miniatura; anclado conserva su tamaño. Todos los flotantes mantienen su iframe y la reproducción al navegar, incluidos SoundCloud y las demás plataformas. Cerrar detiene el audio. Anterior y próxima pista usan las marcas de tiempo registradas, incluidos discos con videos distintos, y conservan la lista al navegar en modo flotante. Las pistas sin marca de tiempo se omiten; los extremos de la lista desactivan el salto correspondiente. En los videos del canal, los controles recorren la lista de videos. Ver docs/MEDIA_PLAYER.md.

### Apariencia y consulta de imágenes

La configuración de administración permite aplicar los temas Actual, Carbón y Estudio al catálogo para todos los visitantes. Home mantiene su apariencia original. Fotos, logos y portadas comparten un visor con zoom, arrastre, ajuste a pantalla y tamaño real. Referencias: DESIGN.md, web/src/lib/SiteAppearanceContext.tsx y web/src/components/ImageViewer.tsx.

## Brand Commitments

Conservar el nombre Coleccionistas de Rock Venezolano y el idioma español de la interfaz. La identidad y sus variantes implementadas se documentan en DESIGN.md; la actualización de metadatos no establece una identidad nueva.

## Evidence on Hand

- `README.md` y `docs/CRV_IMPLEMENTATION_CONTRACT.md`: modelo, operación y restricciones del catálogo.
- `docs/decisions/2026-10-07-fiabilidad-individual.md`, `docs/decisions/2026-10-07-comparacion-desde-fichas.md` y `docs/PERSONA_ARTISTA_AUTOMATICO.md`: flujos confirmados de investigación y curaduría.
- `AGENTS.md`, `src/shared/daily-cycle.ts` y `docs/DAILY_CYCLE.md`: contrato del día editorial.
- `web/src/components/`, `web/src/pages/` y `web/src/styles/`: implementación de las superficies y los controles compartidos.
- `web/src/assets/`, `web/public/media/` y `docs/ui-qa/`: identidad, contenido visual del catálogo y capturas de verificación.
- `web/tests/visual/album-player-qa.mjs`: verificación de reproducción, saltos de pistas, navegación y tamaños de pantalla.

## Product Principles

1. Conservar la identidad y las relaciones entre entidades, distinguiendo pertenencia, crédito y edición.
2. Respaldar las decisiones con evidencia y conservar el historial y las opciones de deshacer existentes.
3. Mantener informes privados y herramientas de curaduría dentro del acceso de administración.
4. Compartir un único día editorial entre visitantes, dispositivos y superficies diarias.
5. Conservar el acceso a la información y la continuidad de escucha al navegar, también en móvil.

## Accessibility & Inclusion

Los controles usan nombres accesibles, foco visible y navegación por teclado. Los diálogos conservan y restauran el foco; los estados de carga y error se comunican mediante roles accesibles. El movimiento respeta `prefers-reduced-motion` y los controles táctiles del reproductor alcanzan 44 × 44 px. Las pautas visuales y adaptaciones existentes se documentan en DESIGN.md.
