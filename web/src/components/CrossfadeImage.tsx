import { useEffect, useRef, useState, type CSSProperties, type ImgHTMLAttributes } from "react";
import { preloadImage } from "../lib/preloadImage";
import { usePrefersReducedMotion } from "../lib/usePrefersReducedMotion";
import "../styles/crossfade-image.css";

interface Layer { id: number; src: string; srcSet?: string | undefined; entering: boolean; waiting?: boolean }

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "onError" | "className" | "style">;

/**
 * Imagen que cambia con un fundido: la nueva se precarga y decodifica fuera de
 * pantalla, entra por encima de la anterior y solo entonces se retira esta.
 * Si la nueva no carga, se queda la anterior y se avisa con `onError`.
 */
export function CrossfadeImage({ src, srcSet, className, imageClassName, imageStyle, duration = 700, delay = 0, fadeIn = false, onError, ...image }: ImageProps & {
  src: string; srcSet?: string | undefined; className?: string; imageClassName?: string; imageStyle?: CSSProperties;
  /** Duración del fundido en ms. */ duration?: number;
  /** Espera antes del fundido en ms, para escalonar varias imágenes que cambian a la vez. */ delay?: number;
  /** La primera imagen también aparece con fundido al cargar, en vez de dibujarse a trozos. */ fadeIn?: boolean;
  onError?: (src: string) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const nextId = useRef(1);
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, src, srcSet, entering: false, waiting: fadeIn }]);
  const error = useRef(onError);
  error.current = onError;
  const top = layers[layers.length - 1]!;

  useEffect(() => {
    if (top.src === src && top.srcSet === srcSet) return;
    let active = true;
    preloadImage({ src, srcSet }).then(() => {
      if (!active) return;
      const layer = { id: nextId.current++, src, srcSet, entering: !reduced };
      // Sin movimiento: cambio directo, ya decodificado. Con movimiento: la anterior queda debajo
      // hasta que termina el fundido (solo se conserva una, aunque los cambios se encadenen).
      setLayers(current => reduced ? [layer] : [current[current.length - 1]!, layer]);
    }, () => { if (active) error.current?.(src); });
    return () => { active = false; };
  }, [src, srcSet, top.src, top.srcSet, reduced]);

  return <span className={`crossfade-image${className ? ` ${className}` : ""}`}
    style={{ "--crossfade-duration": `${duration}ms`, "--crossfade-delay": `${delay}ms` } as CSSProperties}>
    {layers.map(layer => <img key={layer.id} {...image} src={layer.src} srcSet={layer.srcSet}
      className={`crossfade-image__layer${layer.entering ? " is-entering" : ""}${layer.waiting ? " is-waiting" : ""}${imageClassName ? ` ${imageClassName}` : ""}`}
      style={imageStyle} aria-hidden={layer !== top || undefined}
      onAnimationEnd={layer.entering ? () => setLayers(current => current.filter(item => item.id >= layer.id).map(item => item.id === layer.id ? { ...item, entering: false } : item)) : undefined}
      onLoad={layer.waiting ? () => setLayers(current => current.map(item => item.id === layer.id ? { ...item, waiting: false, entering: !reduced } : item)) : undefined}
      onError={layer.id === 0 ? () => error.current?.(layer.src) : undefined} />)}
  </span>;
}
