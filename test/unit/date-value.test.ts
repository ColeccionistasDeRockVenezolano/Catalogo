import { describe, expect, it } from "vitest";
import { dateValueText, definitelyBefore, exactDateProjection, exactYear, parseDateValue } from "../../src/catalog/date-value.js";

describe("precisión de fechas sin días inventados", () => {
  it.each(["1973", "1973-05", "1973-05-06", "~1973", "~1973-05", "~1973-05-06", "1973/1975", "1973-05/1975-06", "/1975", "1973/", "~1973/~1975"])("conserva y serializa %s", text => {
    expect(dateValueText(parseDateValue(text))).toBe(text);
  });
  it("guarda la precisión real y proyecta únicamente días completos no aproximados", () => {
    expect(parseDateValue("1973")).toEqual({ kind: "point", year: 1973, month: null, day: null, precision: "year", approximate: false });
    expect(parseDateValue("1973-05")).toMatchObject({ month: 5, day: null, precision: "month" });
    for (const text of ["1973", "1973-05", "~1973-05-06", "1973/1975"]) expect(exactDateProjection(parseDateValue(text))).toBeNull();
    expect(exactDateProjection(parseDateValue("1973-05-06"))).toBe("1973-05-06");
    expect(exactYear(parseDateValue("~1973"))).toBeNull(); expect(exactYear(parseDateValue("1973/1975"))).toBeNull();
    expect(exactYear(parseDateValue("1973-05"))).toBe(1973);
  });
  it.each(["", "/", "1973/1975/1976", "0000", "10000", "1973-00", "1973-13", "1973-05-00", "1973-04-31", "1973-02-29", "1900-02-29", "1973-05-32", "1973-5", "1975/1973"])("rechaza %s", text => {
    expect(() => parseDateValue(text)).toThrow();
  });
  it("valida años bisiestos, intervalos abiertos y extremos solapados", () => {
    expect(dateValueText(parseDateValue("2000-02-29"))).toBe("2000-02-29");
    expect(parseDateValue("1973-12/1973")).toMatchObject({ kind: "interval" });
    expect(definitelyBefore(parseDateValue("1973"), parseDateValue("1974"))).toBe(true);
    expect(definitelyBefore(parseDateValue("1973"), parseDateValue("1973-06"))).toBe(false);
    expect(definitelyBefore(parseDateValue("~1973"), parseDateValue("1974"))).toBe(false);
    expect(definitelyBefore(parseDateValue("/1973"), parseDateValue("1974/"))).toBe(true);
    expect(definitelyBefore(parseDateValue("1973/"), parseDateValue("1974"))).toBe(false);
  });
});
