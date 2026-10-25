// Imágenes del catálogo a la medida de donde se muestran. El gateway
// (web/server.mjs + web/media-variants.mjs) sirve `…/media/x.jpg?w=320` como
// una copia WebP optimizada de 320 px como máximo; mientras la copia no existe
// devuelve el original, así que pedirla nunca rompe una imagen.

/** Anchos disponibles: los mismos que MEDIA_WIDTHS en web/media-variants.mjs. */
const MEDIA_WIDTHS = [160, 320, 640, 1200] as const;
export type MediaWidth = (typeof MEDIA_WIDTHS)[number];

function isLocalMedia(url: string): boolean {
  return /^\/(?:crv\/)?media\//.test(url) && !url.includes("?");
}

function widthFor(cssPixels: number): MediaWidth {
  return MEDIA_WIDTHS.find((width) => width >= cssPixels) ?? MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1];
}

/** URL de la copia de `width` px; las imágenes externas quedan como están. */
export function mediaUrl(url: string, width: MediaWidth): string {
  return isLocalMedia(url) ? `${url}?w=${width}` : url;
}

/**
 * `src` y `srcSet` para una imagen que ocupa unos `cssPixels` en pantalla:
 * la copia justa en pantallas normales y la del doble en las de alta densidad.
 */
export function mediaImage(url: string, cssPixels: number): { src: string; srcSet?: string } {
  if (!isLocalMedia(url)) return { src: url };
  const normal = widthFor(cssPixels);
  const dense = widthFor(cssPixels * 2);
  const src = mediaUrl(url, normal);
  return dense === normal ? { src } : { src, srcSet: `${src} 1x, ${mediaUrl(url, dense)} 2x` };
}
