/** Datos editoriales de una fotografía del archivo de un artista. */
export const GALLERY_CATEGORIES = ["artist", "concert", "poster", "related", "logo"] as const;
export type GalleryCategory = typeof GALLERY_CATEGORIES[number];
export const GALLERY_CATEGORY_LABELS: Record<GalleryCategory, string> = {
  artist: "Artista", concert: "Conciertos", poster: "Pósters", related: "Imágenes relacionadas", logo: "Logotipos",
};
export interface ArtistGalleryPhoto {
  id: number;
  imageUrl: string;
  category: GalleryCategory;
  title: string | null;
  description: string | null;
  date: string | null;
  location: string | null;
}
export type GalleryPhotoInput = Omit<ArtistGalleryPhoto, "id">;
