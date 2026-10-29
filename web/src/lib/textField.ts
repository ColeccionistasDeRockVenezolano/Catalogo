// CRV · Campo del texto para los shaders del nombre.
//
// El shader no sabe dónde están las letras: este campo se lo cuenta. Se
// calcula una vez por nombre (y se reutiliza para los mensajes del mismo
// autor) a partir del texto rasterizado, y se sube como textura RGBA:
//
// - R: cobertura de la letra (0-255, con su antialias).
// - G: distancia con signo al borde, positiva dentro, en ±`range` píxeles.
//      Da el relieve (normales), los halos y el grosor del trazo.
// - B: dentro de una letra, profundidad desde el borde de arriba del trazo;
//      fuera, distancia hacia abajo desde la letra que hay encima.
//      Así las gotas cuelgan del borde inferior de cada letra.
// - A: dentro, altura sobre el borde inferior del trazo; fuera, distancia
//      hacia arriba hasta la letra que hay debajo. Así el fuego sube y la
//      nieve se posa sobre los bordes superiores, sigan la forma que sigan.
//
// B y A van normalizados por el alto del lienzo (255 = sin letra).

const SQRT2 = Math.SQRT2;

/**
 * Distancia (en píxeles) desde cada píxel hasta el conjunto marcado, con un
 * chamfer de dos pasadas. Error < 8 % frente a la euclídea: de sobra para
 * relieves y halos de unos pocos píxeles.
 */
export function chamferDistance(mask: Uint8Array, width: number, height: number): Float32Array {
  const far = width + height;
  const out = new Float32Array(width * height);
  for (let index = 0; index < out.length; index += 1) out[index] = mask[index] ? 0 : far;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      let best = out[at]!;
      if (best === 0) continue;
      if (x > 0) best = Math.min(best, out[at - 1]! + 1);
      if (y > 0) {
        best = Math.min(best, out[at - width]! + 1);
        if (x > 0) best = Math.min(best, out[at - width - 1]! + SQRT2);
        if (x < width - 1) best = Math.min(best, out[at - width + 1]! + SQRT2);
      }
      out[at] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const at = y * width + x;
      let best = out[at]!;
      if (best === 0) continue;
      if (x < width - 1) best = Math.min(best, out[at + 1]! + 1);
      if (y < height - 1) {
        best = Math.min(best, out[at + width]! + 1);
        if (x < width - 1) best = Math.min(best, out[at + width + 1]! + SQRT2);
        if (x > 0) best = Math.min(best, out[at + width - 1]! + SQRT2);
      }
      out[at] = best;
    }
  }
  return out;
}

/**
 * Convierte la cobertura (un byte por píxel) en el campo RGBA descrito arriba.
 * `range` es la distancia, en píxeles, que cabe en el canal G.
 */
export function buildTextField(coverage: Uint8Array, width: number, height: number, range: number): Uint8Array {
  const size = width * height;
  const inside = new Uint8Array(size);
  const outside = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    const solid = coverage[index]! >= 128;
    inside[index] = solid ? 1 : 0;
    outside[index] = solid ? 0 : 1;
  }
  const toInside = chamferDistance(inside, width, height);
  const toOutside = chamferDistance(outside, width, height);
  const field = new Uint8Array(size * 4);
  const scale = 255 / Math.max(1, height);

  for (let index = 0; index < size; index += 1) {
    const cover = coverage[index]!;
    // Distancia con signo al borde (positiva dentro). En el borde antialiasado
    // manda la cobertura, que es más precisa que el chamfer.
    let signed = inside[index] ? toOutside[index]! - 0.5 : 0.5 - toInside[index]!;
    if (Math.abs(signed) < 1) signed = cover / 255 - 0.5;
    const normalized = Math.max(-1, Math.min(1, signed / range));
    field[index * 4] = cover;
    field[index * 4 + 1] = Math.round(127.5 + normalized * 127.5);
  }

  // Columnas: tramos verticales dentro de las letras y huecos entre ellos.
  for (let x = 0; x < width; x += 1) {
    let y = 0;
    let lastBottom = -1; // fila del último borde inferior visto (encima)
    while (y < height) {
      const start = y;
      const solid = inside[y * width + x] === 1;
      while (y < height && (inside[y * width + x] === 1) === solid) y += 1;
      const end = y; // exclusivo
      for (let row = start; row < end; row += 1) {
        const at = (row * width + x) * 4;
        if (solid) {
          field[at + 2] = Math.min(255, Math.round((row - start) * scale));
          field[at + 3] = Math.min(255, Math.round((end - 1 - row) * scale));
        } else {
          field[at + 2] = lastBottom < 0 ? 255 : Math.min(255, Math.round((row - lastBottom) * scale));
          field[at + 3] = end >= height ? 255 : Math.min(255, Math.round((end - row) * scale));
        }
      }
      if (solid) lastBottom = end - 1;
    }
  }
  return field;
}
