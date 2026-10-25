# Audiovisuales: tarjetas compartidas con Home

Fecha: 2026-10-15. Disposición de revisión final: **ship**. Alcance: igualar las tarjetas de Audiovisuales a los videos del canal del Home y mostrar el documental de Gasolina junto con su disco conservado.

## Contrato de dirección

**THESIS.** Reutilizar las tarjetas existentes de videos del canal de Home para explorar audiovisuales por artista.

**OWN-WORLD.** Fondo oscuro CRV; miniatura 16:9, radio de 14px, play circular de vidrio de 54px; tipografía, fecha y enlace exactos de Home.

**STORY.** Identificar la obra, reproducir, abrir YouTube y consultar capítulos.

**FIRST VIEWPORT.** Hero y pestañas preexistentes; grilla de tres columnas en escritorio (1440 × 1000) y una en móvil (390 × 844).

**SIGNATURE.** Play abre el reproductor compartido; los capítulos saltan dentro del video; la reproducción persiste entre pestañas.

**MOTION.** Hover y foco heredados de Home, con el tratamiento existente de movimiento reducido.

## Sistema observado

La autoridad visual es el Home aportado por el usuario (`/tmp/codex-clipboard-P8JDw7.png`). Esta intervención reutiliza esa identidad; no establece una identidad nueva, una composición aprobada aparte ni un criterio independiente de calidad. Mantiene los compromisos de [PRODUCT.md](../../../PRODUCT.md) y el sistema de [DESIGN.md](../../../DESIGN.md).

[ChannelVideoCard.tsx](../../../web/src/components/ChannelVideoCard.tsx) comparte miniatura, título, fecha de publicación, distintivo «Nuevo» y enlace «Abrir desde YouTube» entre [HomeSections.tsx](../../../web/src/components/HomeSections.tsx) y [ArtistAudiovisuals.tsx](../../../web/src/components/ArtistAudiovisuals.tsx). Las reglas visuales siguen en [global.css](../../../web/src/styles/global.css); [channel-video-card.css](../../../web/src/styles/channel-video-card.css) añade el estado sin reproducción y el icono de respaldo.

La tarjeta conserva el fondo transparente, separación de 10px, miniatura con sombra y play con blur de 6px. El título usa Inter, 14.5px, peso 600, interlineado 1.4 y límite de dos líneas; la fecha usa 12.5px y el enlace 13px con altura mínima de 44px. El foco dibuja un contorno rojo de 2px. En dispositivos con hover y puntero preciso, la miniatura sube 5px, la imagen aumenta a 1.06 y el play se vuelve rojo. El movimiento reducido elimina las transiciones de miniatura e imagen conforme a Home.

[audiovisuals.css](../../../web/src/styles/audiovisuals.css) dispone columnas automáticas con mínimo de 280px y separaciones de 32px verticales y 24px horizontales. Filtros, capítulos y despliegues conservan controles de al menos 44px. Tipo, año de la obra y duración quedan separados de la fecha de publicación en YouTube. «Nuevo» utiliza la fecha del ciclo editorial compartido; el inventario audiovisual no introduce una selección diaria.

## Contenido y reproducción

Se mantiene [AUDIOVISUALS.md](../../../docs/AUDIOVISUALS.md): capítulos y descripciones pertenecen al audiovisual; las obras sin reproducción siguen visibles con su estado. El reproductor compartido recibe el video y sus capítulos concretos.

El [informe de Gasolina](../../../reports/gasolina-audiovisual-2026-10-15.json), ejecución 20167, registra artista 102, audiovisual 153 «Blues Criollo», tipo documental y `allows_music_release: true`. Coexiste con el disco 5122 y sus cinco pistas. Es la excepción editorial expresa, sin generalizarla a otros audiovisuales.

## Evidencia y límites

La revisión final confirma fidelidad en ocho capturas de [.impeccable/review/av-home-cards](../../../.impeccable/review/av-home-cards): `desktop.png`, `mobile.png`, `desktop-audiovisuales.png`, `mobile-audiovisuales.png`, `desktop-gasolina-full.png`, `mobile-gasolina-full.png`, `desktop-gasolina.png` y `mobile-gasolina.png`.

[audiovisuales-qa.json](../../../.impeccable/review/av-home-cards/audiovisuales-qa.json) registra filtros, salto a 246s, reproductor compartido único, pestañas por teclado y ausencia de desbordamiento horizontal y errores de página en ambos tamaños. La validación de cierre reporta 29 pruebas, typecheck, lint y build satisfactorios. Los datos y la disponibilidad proceden del catálogo real; la API del iframe fue simulada. Esta evidencia no acredita reproducción externa real de YouTube.

No se canonizan los cuatro avisos de imágenes de otras secciones de Home recogidos en [detector.json](../../../.impeccable/review/av-home-cards/detector.json): son hallazgos preexistentes fuera de este alcance, no reglas del sistema visual.
