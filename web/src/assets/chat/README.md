# Materiales del chat · 2026-10-28

Imágenes originales creadas con la herramienta integrada `imagegen`, sin CLI/API
externa ni imágenes de las producciones de anime. Los colores y movimientos de
los seis materiales proceden de la especificación entregada por Brian.

Se conservan los originales generados en
`/home/brian/.codex/generated_images/01a184af-8a40-7cc0-8d3e-51625b87e615/`.
La aplicación solo necesita los WebP versionados de esta carpeta. Se codificaron
con ImageMagick, conservando el alfa del atlas; no hay eliminación de fondo.

| Archivo | Uso | Peso aproximado |
| --- | --- | --- |
| rock-material-atlas.webp | 16 objetos; escritorio de calidad alta | 403 KB |
| rock-material-atlas-small.webp | Mismos objetos; móvil y calidad menor | 155 KB |
| stage-realistic.webp | Escenario fotográfico | 39 KB |
| garage-realistic.webp | Garaje fotográfico | 89 KB |

Cada cliente selecciona un atlas, compartido por todos sus objetos. Los fondos
solo se usan al seleccionar ese fondo; calidad baja evita su textura. Los
rectángulos UV viven en `RealisticSprite.tsx`. El recorte SVG conserva las alas y
el mástil completos aunque el generador no haya respetado una cuadrícula exacta.
La textura ofrece volumen/material; el movimiento se añade en código y se pausa
fuera de pantalla. No son secuencias de animación ni modelos tridimensionales.

## Prompts finales

### Atlas (fondo transparente)

Use case: stylized-concept. Asset type: ONE production game sprite atlas for a rock music chat interface. Create a SQUARE 4 by 4 grid of 16 isolated realistic premium CGI objects on a truly transparent background. Every cell exactly one quarter of the full width/height; objects centered in each cell with at least 14% transparent padding, no shadows crossing cell boundaries. No grid lines, labels, text, watermark, backgrounds, floor, faces or eyes on inanimate objects. Consistent physically based realistic materials, crisp photographic studio key light upper left and subtle rim light, legible at small sizes. All objects entirely in their cells, no overlaps. Order REQUIRED left to right top to bottom: row 1: a black vinyl record front view with crimson center label and realistic reflective concentric grooves; a vintage black transparent cassette with red paper label and metal tape spools; a black guitar amplifier in three-quarter view with woven grille and red power light; an ivory realistic skull with black eye sockets and a red cloth headband. Row 2: an isolated realistic orange flame; a red sunburst electric guitar with full neck diagonal bottom-left to top-right and chrome strings; a realistic human hand making the rock horns gesture, black leather wristband; a realistic dark bat in front view, wings fully spread, anatomical wing membranes and fine brown fur. Row 3: a chrome dynamic microphone with black grille and slim black stand; a crimson snare drum with chrome hardware in three-quarter view; a glossy red heart shaped pendant with small ivory devil horns; a brushed dark metal classic flying saucer with cyan glass dome, red and cyan marker lights. Row 4: a pair of crossed wooden drumsticks; a full body miniature realistic male rock musician dressed black with red electric guitar in playing pose, no celebrity resemblance; two realistic hands clapping; a pair of rich red velvet theater curtain swags opened to transparent center. This is a technical atlas, exactly 16 equal square cells. Photorealistic rendered cutouts, no cartoon artwork, no vector illustration. Preserve transparent alpha in every gap.

### Escenario

Photorealistic empty Venezuelan underground rock concert stage at night, wide horizontal 16:9 environmental texture for a chat background. Aged black stage floor, dark red velvet drapes at sides, faint suspended haze illuminated by two restrained warm amber and deep red overhead spotlights, guitar amplifier and drum kit mostly in shadows far at edges. Large center area almost black with very low detail and low contrast for overlay chat text. Premium cinematic realism, true materials, no people, no lettering, no logos, no illustration, no graphic grid, no typography. Keep all lights dim, no bright white hotspot.

### Garaje

Photorealistic dark rock band rehearsal garage, wide horizontal 16:9 environmental texture for chat background. Rough aged reddish-brown brick wall with real irregular mortar, subtle damp worn plaster, black concrete floor, a single exposed warm tungsten lamp near upper right edge casting soft grazing light down the wall, cable and a black amplifier barely visible at lower left edge. Center 75 percent must be very dark, low contrast and quiet for chat text to read easily. Cinematic photographic realism, tactile textures, no people, no letters, no logos, no graphic pattern, no illustration, no saturated glow.
