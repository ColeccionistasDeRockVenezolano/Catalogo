# Bandeja de Curaduría

Modo: Operate. Mantiene la identidad y los controles existentes del catálogo.

La tarea principal es evaluar muchos casos sin perder el contexto: lista compacta a la izquierda y un único detalle a la derecha. En móvil se alterna entre lista y detalle. Las acciones están separadas del desplazamiento de la evidencia.

## Funcionamiento

- Entrada «Revisar casos» en Curaduría; el resumen ofrece continuar la revisión anterior de esa cuenta.
- Búsqueda explícita por nombre, valor o ID (incluye fichas relacionadas); filtros secundarios desplegables.
- Ordenación en servidor por gravedad, antigüedad, novedad o nombre; páginas de 25, 50 o 100.
- Caso activo y filtros en la URL. `j` y `k` recorren los casos, también entre páginas; los demás atajos existentes se conservan.
- Selección de página y selección entre páginas para las acciones que admiten lotes. «Todo el filtro» conserva el alcance del detector y los demás filtros. La previsualización existente sigue siendo obligatoria.
- Tras una decisión se avanza al siguiente caso. Cancelar una fusión conserva el caso actual. Si una decisión vacía la última página, se recupera la última página disponible.
- Las tarjetas completas siguen disponibles como vista alternativa. Las métricas, el estado del detector y las decisiones previas se consultan desde el resumen.

## Investigación incorporada

`src/curation/research/album-tracklists-2026-10-15.json` conserva los 81 pares investigados individualmente del expediente `reports/discos-tracklist-2026-10-15/analisis-editorial.json`. Los casos pendientes de investigación individual de la matriz no se presentan como documentados.

El detector `investigacion_documentada` registra las recomendaciones como hallazgos. Respeta los pares declarados distintos, exige las identidades del catálogo investigado y deja de emitir el caso si una ficha desaparece. Es global: un análisis dirigido no puede cerrar un expediente que no comparó. Los cambios de título, año, tipo o lista de pistas se detectan contra la huella guardada y requieren revisar la recomendación. Los cambios de créditos, alias, portadas u otras fuentes no forman parte de esa huella.

Los casos muestran las fuentes enlazadas y permiten consultar las dos listas actuales bajo demanda. Las consolidaciones documentadas sin cambios en la huella abren la previsualización con las dos fichas, el destino sugerido y el modo `match`; la aplicación sigue requiriendo una decisión explícita. El detector no aplica cambios al catálogo ni ofrece estas fusiones como lote automático.

El análisis #1094 registró 81 casos abiertos. Dos ya presentan cambios respecto de la investigación; la interfaz lo señala. Ver `registro-curaduria.json`. No se ejecutaron fusiones ni reparaciones del catálogo.

## Validación

- 35 pruebas unitarias de análisis, investigación, clasificación global y cobertura.
- Contrato contra PostgreSQL desechable: ordenación y páginas, búsqueda por ID, números fuera de rango, autorización y correspondencia entre filtro y acción por grupo; además de los contratos existentes de revisión e historial.
- QA con 1.200 casos y las 81 investigaciones reales, en 1366, 390 y 320 px. Ver `resultado.json` y las capturas.
- El QA intercepta las decisiones y previsualizaciones; no escribe en el catálogo. Comprueba selección entre páginas, alcance de 1.119 resultados de un filtro, tamaño y orden, transición de carga sin acciones anteriores, navegación entre páginas, continuidad tras decidir, comparación de pistas, fuentes y recuperación de la revisión.
- Typecheck web, build de producción aislado y ESLint de los archivos modificados. El detector visual mecánico no reportó hallazgos.

La verificación completa del backend encontró errores de tipos en `scripts/triaje-pares-2026-10-15.ts:104`, ajeno a esta tarea. Se verifica también el código de la aplicación y los contratos de esta tarea con una configuración temporal que excluye esos scripts.

No se publicaron los bundles ni se reiniciaron los servicios compartidos. La API y la web publicadas necesitan cargar esta versión para presentar la nueva categoría y mantener el detector actualizado.

## Reproducir

Con una instancia de Vite en el puerto 5187:

```sh
./scripts/with-node22.sh node node_modules/tsx/dist/cli.mjs web/tests/visual/curation-workbench-qa.mjs
```

El host se puede cambiar con `CRV_QA_WEB_URL`. Para un árbol con muchos archivos de medios, iniciar Vite con `server.watch: null` o excluir las carpetas de medios y builds; no es necesario cambiar los límites del sistema.
