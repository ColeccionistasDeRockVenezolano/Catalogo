# Reproductor flotante: revisión y mejora

## Problemas encontrados

- **Espacio ocupado:** el panel anterior medía 358 × 328 px en un móvil de 390 × 844 px: casi el 39 % del alto. Mostraba cabecera, video, título y enlaces permanentemente.
- **Posición rígida:** quedaba en la esquina inferior derecha, sin posibilidad de apartarlo para leer pistas o créditos.
- **Control de reproducción:** había que entrar en los controles del iframe para pausar. La cabecera no reflejaba el estado real.
- **Accesibilidad:** los botones tenían 44 px, pero los enlaces flotantes solo 28–32 px; faltaban alternativas de teclado para las nuevas interacciones y gestión del foco al volver.
- **Restricción técnica:** la altura mínima de 200 px impedía un compacto con proporción 16:9.

## Comportamiento implementado

- Al activar el flotante o navegar a otra ficha, aparece compacto: 224 × 126 px en escritorio y 200 × 112,5 px en móvil.
- Tocar el compacto lo amplía hasta 360 px de ancho, ajustándose a pantallas menores. Aparecen cabecera para mover, minimizar, volver, cerrar, reproducción/pausa, título, estado, tiempo y enlaces.
- Se arrastra directamente desde el compacto o desde «Mover» en el ampliado. El umbral de 6 px separa arrastre y toque. No se fuerza un anclaje a las esquinas.
- La posición se conserva durante la sesión y se ajusta al ampliar, cambiar el tamaño de pantalla y cambiar el área visible. Los límites respetan zonas seguras y navegación inferior.
- Enter/Espacio abre los controles; las flechas mueven 16 px, o 48 px con Mayúsculas. Escape minimiza y devuelve el foco al compacto. Activar el flotante enfoca el compacto; volver enfoca el reproductor integrado.
- Los controles flotantes alcanzan al menos 44 × 44 px. El iframe compacto queda fuera de la navegación por teclado mientras la superficie de apertura permanece accesible.
- La ampliación utiliza transformaciones durante 180 ms con curva de salida. El arrastre sigue al puntero sin transición. La apertura por teclado y la preferencia de movimiento reducido evitan la animación de tamaño.
- Un único iframe conserva audio, tiempo y estado al mover, ampliar, minimizar y volver a su página.
- Los avisos existentes se indican como «Revisar video» en compacto y se leen al abrir los controles.

## Validación reproducible

```sh
./scripts/with-node22.sh npm --prefix web run build
./scripts/with-node22.sh node_modules/.bin/eslint web/src/components/VideoPlayer.tsx web/src/lib/useFloatingVideo.ts web/src/lib/youtube.ts web/tests/visual/album-player-qa.mjs
./scripts/with-node22.sh node_modules/.bin/vitest run web/tests/unit/youtube.test.ts
CRV_WEB_URL=http://127.0.0.1:5173 ./scripts/with-node22.sh node web/tests/visual/album-player-qa.mjs
```

La URL debe servir la compilación actual. La prueba cubre 1440, 768, 390 y 320 px, administración con movimiento reducido, arrastre con ratón y eventos táctiles de Chromium, teclado, límites, cambio a 320 × 420 px, pausa/reanudación, errores, pistas y conservación del mismo nodo iframe al navegar.

Resultado: compilación y TypeScript correctos, ESLint sin errores, 23 pruebas unitarias de YouTube aprobadas y los cinco escenarios de navegador aprobados.

Las capturas utilizan datos e iframe de prueba; la API simulada permite comprobar órdenes de reproducción y continuidad sin anuncios ni bloqueos externos. No sustituyen una comprobación gestual en un teléfono físico ni verifican disponibilidad de videos reales.

## Capturas

- [Antes, móvil](before-390.png).
- [Compacto, móvil](compact-390.png) y [escritorio](compact-1440.png).
- [Ampliado, móvil](expanded-390.png), [320 px](expanded-320.png) y [escritorio](expanded-1440.png).

El detector de diseño no señaló problemas en `VideoPlayer.tsx`.
