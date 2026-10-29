import { describe, expect, it } from "vitest";
import { generateGuestName, GUEST_FOODS, GUEST_MUSIC_NAMES } from "../../src/chat/guest-names.js";
import { sanitizeDisplayName } from "../../src/chat/moderation/text.js";

describe("apodos automáticos del chat", () => {
  const names = GUEST_FOODS.flatMap(([food, gender]) =>
    GUEST_MUSIC_NAMES.map((music) => `${food}${music[gender === "f" ? 1 : 0]}`));

  it("permite todas las combinaciones en la moderación de nombres", () => {
    for (const name of names) {
      expect(sanitizeDisplayName(name), name).toEqual({ name });
      expect(name).toMatch(/^\p{Lu}\p{Ll}+\p{Lu}\p{Ll}+$/u);
    }
    expect(names).toEqual(expect.arrayContaining(["ChichaMetalera", "PabellónReggaetonero", "OcumoRockero"]));
  });

  it("genera nombres de comida y música con concordancia", () => {
    for (let index = 0; index < 100; index += 1) expect(names).toContain(generateGuestName());
  });
});
