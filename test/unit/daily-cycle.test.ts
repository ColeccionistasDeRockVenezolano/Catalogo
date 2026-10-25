import { describe, expect, it } from "vitest";
import { dailyCycleAt, dailyCycleForDate, dailyIndex, dailyRandom } from "../../src/shared/daily-cycle.js";

describe("reloj editorial compartido", () => {
  it("cambia todas las selecciones a medianoche de Venezuela, no de UTC", () => {
    const before = dailyCycleAt(new Date("2026-10-15T03:59:59.999Z"));
    const after = dailyCycleAt(new Date("2026-10-15T04:00:00.000Z"));
    expect(before).toMatchObject({ date: "2026-10-14", timeZone: "America/Caracas", startsAt: "2026-10-14T04:00:00.000Z", changesAt: "2026-10-15T04:00:00.000Z" });
    expect(after.date).toBe("2026-10-15");
    expect(after.day).toBe(before.day + 1);
    expect(after.startsAt).toBe(before.changesAt);
  });
  it.each(["2026-12-31", "2028-02-29", "2027-02-28"])("encadena los límites de calendario de %s", date => {
    const cycle = dailyCycleForDate(date);
    expect(dailyCycleAt(new Date(cycle.changesAt)).day).toBe(cycle.day + 1);
    expect(dailyCycleAt(new Date(Date.parse(cycle.changesAt) - 1)).date).toBe(date);
  });
  it("rechaza fechas inexistentes", () => {
    expect(() => dailyCycleForDate("2026-02-30")).toThrow();
  });
  it.each([1, 2, 3, 5, 17])("recorre los %i videos sin repetir hasta agotar la vuelta", size => {
    const indices = Array.from({ length: size }, (_, index) => dailyIndex(`2026-10-${String(1 + index).padStart(2, "0")}`, size));
    expect(new Set(indices).size).toBe(size);
  });
  it("usa la misma selección en todas las sesiones de un día", () => {
    const sample = (date: string, scope = "example") => { const random = dailyRandom(date, scope); return Array.from({ length: 8 }, random); };
    expect(sample("2026-10-14")).toEqual(sample("2026-10-14"));
    expect(sample("2026-10-15")).not.toEqual(sample("2026-10-14"));
    expect(sample("2026-10-14", "other")).not.toEqual(sample("2026-10-14"));
  });
});
