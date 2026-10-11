import { describe, expect, it } from "vitest";
import { ageText, formatDate } from "../../src/lib/format";

describe("fechas de vida con precisión explícita", () => {
  it("muestra únicamente los componentes conocidos, aproximación e intervalos", () => {
    expect(formatDate("1973")).toBe("1973");
    expect(formatDate("1973-05")).toBe("mayo de 1973");
    expect(formatDate("1973-05-06")).toBe("6 de mayo de 1973");
    expect(formatDate("~1973")).toBe("1973 (aprox.)");
    expect(formatDate("1973/1975")).toBe("Entre 1973 y 1975");
    expect(formatDate("/1973-05")).toBe("Hasta mayo de 1973");
    expect(formatDate("1973/")).toBe("Desde 1973");
  });
  it("no convierte una fecha parcial de muerte en una edad calculada hasta hoy", () => {
    expect(ageText("1973-05-06", "2020")).toBeNull();
    expect(ageText("1973-05-06", "~2020-05-06")).toBeNull();
    expect(ageText("1973", "2020-05-06")).toBeNull();
    expect(ageText("1973-05-06", "2020-05-05")).toBe("46 años");
    expect(ageText("1973-05-06", "2020-05-06")).toBe("47 años");
  });
  it("conserva una fecha histórica inválida sin convertirla en otro día", () => {
    expect(formatDate("1973-02-29")).toBe("1973-02-29");
    expect(ageText("1973-02-29", "2020-05-06")).toBeNull();
    expect(formatDate(null)).toBeNull();
  });
});
