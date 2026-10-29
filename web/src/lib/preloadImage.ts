// Precarga y decodifica una imagen antes de mostrarla: las imágenes que rotan
// (muro de portadas, carátulas de series, visor) cambian solo cuando la
// siguiente ya está lista, sin hueco ni aparición brusca.

export interface ImageSource { src: string; srcSet?: string | undefined }

const MAX_ENTRIES = 300;
const cache = new Map<string, Promise<void>>();

function keyOf({ src, srcSet }: ImageSource): string {
  return srcSet ? `${src} ${srcSet}` : src;
}

/** Promesa que se cumple cuando la imagen está descargada y decodificada; falla si no carga. */
export function preloadImage(source: ImageSource): Promise<void> {
  const key = keyOf(source);
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    // srcset antes que src: el navegador elige el mismo candidato que usará el <img>.
    if (source.srcSet) image.srcset = source.srcSet;
    image.src = source.src;
    const loaded = () => {
      // decode() puede fallar en imágenes ya válidas (p. ej. SVG); basta con que cargó.
      if (typeof image.decode === "function") image.decode().then(resolve, () => resolve());
      else resolve();
    };
    if (image.complete && image.naturalWidth > 0) loaded();
    else {
      image.onload = loaded;
      image.onerror = () => reject(new Error(`No se pudo cargar ${source.src}`));
    }
  });
  // Un fallo no se queda en caché: un reintento posterior vuelve a pedirla.
  promise.catch(() => { if (cache.get(key) === promise) cache.delete(key); });
  cache.set(key, promise);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return promise;
}

/** Precarga sin esperar el resultado (las siguientes de una rotación o de un visor). */
export function warmImage(source: ImageSource | null | undefined): void {
  if (source?.src) preloadImage(source).catch(() => undefined);
}
