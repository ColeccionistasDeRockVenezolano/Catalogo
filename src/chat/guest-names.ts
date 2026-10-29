import { randomInt } from "node:crypto";

// Cada alimento lleva su género para concordar el apodo musical.
export const GUEST_FOODS = [
  ["Chicha", "f"], ["Pabellón", "m"], ["Ocumo", "m"],
  ["Arepa", "f"], ["Cachapa", "f"], ["Hallaca", "f"],
  ["Empanada", "f"], ["Mandoca", "f"], ["Hallaquita", "f"],
  ["Tequeño", "m"], ["Casabe", "m"], ["Cazón", "m"],
  ["Caraota", "f"], ["Yuca", "f"], ["Auyama", "f"],
  ["Apio", "m"], ["Topocho", "m"], ["Cambur", "m"],
  ["Lechosa", "f"], ["Parchita", "f"], ["Patilla", "f"],
  ["Guanábana", "f"], ["Guayaba", "f"], ["Mamón", "m"],
  ["Mango", "m"], ["Níspero", "m"], ["Jobo", "m"],
  ["Quesillo", "m"], ["Golfeado", "m"], ["Bienmesabe", "m"],
  ["Majarete", "m"], ["Catalina", "f"], ["Naiboa", "f"],
  ["Cocada", "f"], ["Papelón", "m"], ["Guarapo", "m"],
  ["Carato", "m"], ["Tizana", "f"], ["Chicharrón", "m"],
] as const;

// Formas masculina y femenina; los nombres invariantes conservan su grafía.
export const GUEST_MUSIC_NAMES = [
  ["Metalero", "Metalera"], ["Reggaetonero", "Reggaetonera"],
  ["Rockero", "Rockera"], ["Punkero", "Punkera"],
  ["Salsero", "Salsera"], ["Rapero", "Rapera"],
  ["Gaitero", "Gaitera"], ["Joropero", "Joropera"],
  ["Merenguero", "Merenguera"], ["Bachatero", "Bachatera"],
  ["Blusero", "Blusera"], ["Jazzero", "Jazzera"],
  ["Funkero", "Funkera"], ["Reggaero", "Reggaera"],
  ["Ska", "Ska"], ["Pop", "Pop"], ["Grunge", "Grunge"],
] as const;

/** Se asigna una vez al crear la sesión y se conserva con el actor. */
export function generateGuestName(): string {
  const [food, gender] = GUEST_FOODS[randomInt(GUEST_FOODS.length)]!;
  const music = GUEST_MUSIC_NAMES[randomInt(GUEST_MUSIC_NAMES.length)]!;
  return `${food}${music[gender === "f" ? 1 : 0]}`;
}
