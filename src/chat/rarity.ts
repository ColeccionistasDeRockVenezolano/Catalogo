// CRV · Rareza de un efecto del chat.
//
// No se guarda: se deriva del precio y de la duración, así un efecto
// publicado desde el editor de administración ya sale con su rareza sin
// tocar el esquema. Compartido por servidor, pruebas y tienda.

export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type Rarity = typeof RARITIES[number];

export const RARITY_LABEL: Readonly<Record<Rarity, string>> = {
  common: "Común",
  rare: "Rara",
  epic: "Épica",
  legendary: "Legendaria",
};

/** Umbrales en monedas: < 200 común, < 300 rara, < 420 épica, resto legendaria. */
export function rarityOf(effect: { priceCoins: number; durationDays: number | null }): Rarity {
  // Un permanente caro (p. ej. «Primera edición») siempre es legendario.
  if (effect.durationDays === null && effect.priceCoins >= 600) return "legendary";
  if (effect.priceCoins >= 420) return "legendary";
  if (effect.priceCoins >= 300) return "epic";
  if (effect.priceCoins >= 200) return "rare";
  return "common";
}
