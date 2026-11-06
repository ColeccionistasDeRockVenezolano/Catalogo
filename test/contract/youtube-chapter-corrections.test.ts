import { describe, expect, it } from "vitest";
import { correctionsOvertakenByDescription, type ChapterCorrection } from "../../src/youtube/timestamp-corrections.js";

const correction = (overrides: Partial<ChapterCorrection> = {}): ChapterCorrection => ({
  claimId: 2440158, position: 3, title: "Shing A Ling Rub A Dub", seconds: 734, durationSeconds: 9000, ...overrides,
});

const entry = (overrides: Partial<{ position: number; title: string; startSeconds: number }> = {}) => ({
  position: 3, title: "Shing-A-Ling Rub-A-Dub", startSeconds: 734, ...overrides,
});

describe("corrección humana frente a una descripción nueva", () => {
  it("la conserva si la descripción sigue diciendo el mismo tiempo", () => {
    expect(correctionsOvertakenByDescription([entry()], [correction()])).toEqual([]);
  });

  it("la retira si la descripción ya trae otro tiempo válido para el mismo capítulo", () => {
    const retired = correctionsOvertakenByDescription([entry({ startSeconds: 700 })], [correction()]);
    expect(retired.map((item) => item.claimId)).toEqual([2440158]);
  });

  it("no la retira con un tiempo negativo, no entero o fuera de la duración", () => {
    expect(correctionsOvertakenByDescription([entry({ startSeconds: -1 })], [correction()])).toEqual([]);
    expect(correctionsOvertakenByDescription([entry({ startSeconds: 700.5 })], [correction()])).toEqual([]);
    expect(correctionsOvertakenByDescription([entry({ startSeconds: 9500 })], [correction({ durationSeconds: 9000 })])).toEqual([]);
  });

  it("no la retira si cambió el título o la posición del capítulo", () => {
    expect(correctionsOvertakenByDescription([entry({ title: "Otra canción", startSeconds: 700 })], [correction()])).toEqual([]);
    expect(correctionsOvertakenByDescription([entry({ position: 4, startSeconds: 700 })], [correction()])).toEqual([]);
  });
});
