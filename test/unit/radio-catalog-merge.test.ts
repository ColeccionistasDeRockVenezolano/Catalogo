import { describe, expect, it } from "vitest";
import { mergeWithPrevious, removedShare } from "../../src/radio/catalog-merge.js";

const piece = (videoId: string, startSeconds: number, durationSeconds = 100, title = "t") =>
  ({ videoId, startSeconds, durationSeconds, title });

describe("continuidad del catálogo de radio", () => {
  it("conserva el orden anterior y añade lo nuevo al final, ordenado", () => {
    const { items, stats } = mergeWithPrevious(
      [piece("B", 0), piece("A", 0)],
      [piece("A", 0), piece("D", 0), piece("C", 0), piece("B", 0)],
    );
    expect(items.map((item) => item.videoId)).toEqual(["B", "A", "C", "D"]);
    expect(stats).toEqual({ kept: 2, added: 2, removed: 0, timingPreserved: 0 });
  });

  it("toma el texto de la base y conserva la duración si difiere solo por redondeo", () => {
    const { items, stats } = mergeWithPrevious([piece("A", 0, 132, "viejo")], [piece("A", 0, 133, "nuevo")]);
    expect(items[0]).toMatchObject({ durationSeconds: 132, title: "nuevo" });
    expect(stats.timingPreserved).toBe(1);
  });

  it("una diferencia real de duración manda la base", () => {
    const { items, stats } = mergeWithPrevious([piece("A", 472, 538)], [piece("A", 472, 262)]);
    expect(items[0]?.durationSeconds).toBe(262);
    expect(stats.timingPreserved).toBe(0);
  });

  it("cuenta lo retirado y su proporción", () => {
    const { stats } = mergeWithPrevious([piece("A", 0), piece("A", 100), piece("B", 0), piece("C", 0)], [piece("B", 0)]);
    expect(stats.removed).toBe(3);
    expect(removedShare(stats)).toBe(0.75);
    expect(removedShare({ kept: 0, added: 1, removed: 0, timingPreserved: 0 })).toBe(0);
  });
});
