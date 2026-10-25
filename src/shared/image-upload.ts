/** Contrato común de las subidas del catálogo. El servidor valida también los bytes. */
export const IMAGE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
export const IMAGE_UPLOAD_MAX_PIXELS = 40_000_000;
export const IMAGE_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
export interface UploadedImage {
  url: string;
  width: number;
  height: number;
  bytes: number;
}
