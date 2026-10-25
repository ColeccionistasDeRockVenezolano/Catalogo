# Reproducción persistente: cuatro modos

Solo una fuente puede estar activa en la ventana del catálogo. `claimMedia`
retira la fuente anterior antes de activar la siguiente; `releaseMedia` solo
libera al propietario indicado. Los reproductores de audio se muestran
directamente, sin una pantalla de activación. Al interactuar con un iframe
se reclama la reproducción exclusiva; SoundCloud además comunica su evento
PLAY mediante su API oficial. La fuente anterior se pausa y su documento
externo se descarga al ser sustituido. Los controles nativos permanecen visibles.

| Modo | Comportamiento |
| --- | --- |
| Miniatura | Ventana de hasta 224 px, arrastre, cierre y acceso a controles. Video en proporción 16:9 sin franjas añadidas por el contenedor; YouTube conserva pausa directa. |
| Pequeño | Flotante de hasta 360 px con controles. Sin anclar, tocar fuera lo devuelve a miniatura. La chincheta mantiene su tamaño mientras se navega. |
| Modal | Videos ajenos a discos y listas de videos: hasta 860 px, fondo negro translúcido. Tocar el fondo o Escape lo devuelve a miniatura. |
| Incrustado | Los videos de discos se muestran en la ficha. Los reproductores externos de audio también se muestran directamente en su sección. |

`VideoProvider` y `ExternalMediaProvider` viven fuera de las rutas. Los slots
de página solo determinan dónde dibujar sus paneles; los iframes no se mueven
de nodo ni se desmontan al navegar. Un reproductor externo activo conserva su
iframe cuando desaparece su slot y pasa a flotante. Las vistas previas sin
interacción se retiran al salir de la página. Volver al disco o a la sección
de origen restaura el panel conservando el tiempo de escucha.

El reproductor pequeño de YouTube ofrece saltos de pista y progreso. El modal añade
volumen, silencio, saltos de diez segundos y lista de pistas/capítulos. Los
saltos usan exclusivamente las marcas registradas para cada video. El estado
de carga se distingue de la reproducción y los errores permiten reintentar.

Con el panel enfocado: Espacio/K reproduce o pausa; M silencia; las flechas
izquierda/derecha buscan diez segundos. En «Mover», las flechas desplazan el
panel. Escape minimiza el modal o el reproductor pequeño; el cierre es explícito.

Verificación reproducible, usando Vite ya iniciado y dobles de las plataformas
externas (no requiere modificar la base de datos ni reproducir videos reales):

```sh
node web/tests/visual/media-player-modal-qa.mjs
npm --prefix web run typecheck
```

La prueba cubre 1440, 390 y 320 px, movimiento reducido, los cuatro modos,
anclaje, minimización al tocar fuera, exclusividad en ambos sentidos, listas,
identidad del iframe y estado interno del audio después de desmontar la ruta,
controles y cierre. `CRV_PLAYER_CAPTURE_DIR` permite guardar capturas; debe apuntar
a una campaña de staging según `docs/SHARED_STORAGE.md`.
