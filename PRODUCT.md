# Coleccionistas de Rock Venezolano

Catálogo de música venezolana con fichas de artistas, personas, discos, organizaciones y pistas dentro de los discos. Los visitantes consultan y buscan; los administradores corrigen, investigan y comparan datos. Una sesión de lector conserva el acceso público sin herramientas de administración.

La interfaz usa español, fondo oscuro, tipografía y controles compartidos en web/src/styles/global.css. Las fichas conservan su identidad y estructura existentes. Las herramientas de curaduría son superficies de operación: datos legibles, resultados revisables, estados explícitos y controles accesibles, con adaptación a escritorio y móvil.

«Fiabilidad de la ficha» investiga cada dato contra fuentes y conserva informe, citas y puntaje privado. «Comparar con otra ficha» amplía esa sección con buscador, selección y contraste de artista/persona en ambos sentidos y álbum/álbum. Distingue identidad de relación de membresía o de edición. Los dos informes y sus evidencias se pueden abrir con un botón; el historial se recupera desde cualquiera de las fichas.

Los puntajes representan respaldo documental y cobertura, no probabilidades de verdad. Datos ausentes aportan cero y las fuentes deben justificar los resultados. Investigar o comparar no modifica fichas ni fusiona entidades. Cambiar datos invalida el puntaje anterior.

Referencias de producto: README.md, docs/decisions/2026-10-07-fiabilidad-individual.md y docs/decisions/2026-10-07-comparacion-desde-fichas.md. Stack real: React y React Router, Fastify, PostgreSQL y gateway de investigación existente. Los informes se guardan en el esquema ingest; no se exponen a visitantes o lectores.

En las personas, «Resolver artista y buscar información con IA» comprueba la identidad solista mediante páginas citadas, busca artistas por nombres y alias, detecta conflictos y crea o vincula el artista cuando hay respaldo suficiente. La acción explícita del administrador autoriza ese flujo automático. El vínculo y el alias quedan en el historial con opción de deshacer; después se investigan las dos fichas. Los conflictos y los datos sin respaldo permanecen pendientes. Referencia: docs/PERSONA_ARTISTA_AUTOMATICO.md.

Las propuestas con IA convierten los hallazgos de fiabilidad en decisiones individuales: el administrador acepta o rechaza cada corrección y la aceptación se aplica al momento. La IA prepara altas, ediciones, géneros, relaciones y fusiones completas. Las biografías combinadas muestran su texto íntegro; cada cambio aceptado tiene historial y deshacer. Los formularios y fuentes son detalles secundarios, sin pasos visibles de guardar, validar o implementar un lote.
