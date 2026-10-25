import { useSyncExternalStore } from "react";

const pending = new Set<symbol>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function beginImageUpload() {
  const key = Symbol();
  pending.add(key); emit();
  return () => { if (pending.delete(key)) emit(); };
}
export const hasPendingImageUploads = () => pending.size > 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Evita guardar la URL anterior mientras se está subiendo su sustituta. */
export const useImageUploadsPending = () => useSyncExternalStore(subscribe, hasPendingImageUploads, () => false);
