import { describe, it, expect } from "vitest";
import { compareWindows, type WindowSample } from "../../src/discovery/trends.js";
import { closedUtcDay } from "../../src/discovery/aggregate.js";
const sample = (impressions=1000, acceptances=200): WindowSample => ({ impressions,acceptances,searches:100,visits:50,days:7,configs:["policy-a"] });
describe("tendencia CRV: metodología y abstención", () => {
  it("normaliza exposición: más impresiones con igual proporción no implican tendencia", () => {
    expect(compareWindows(sample(),sample(2000,400)).direction).toBe("inconclusive");
  });
  it("suavizado Beta(1,1), intervalo y diferencia respaldan aumento y descenso", () => {
    const up=compareWindows(sample(),sample(1000,500));
    expect(up.status).toBe("evaluated"); expect(up.direction).toBe("rising");
    expect(up.previousRate).toBeCloseTo(201/1002);
    expect(up.interval95[0]).toBeGreaterThan(0);
    expect(compareWindows(sample(1000,500),sample()).direction).toBe("falling");
  });
  it("no interpreta bases pequeñas, días incompletos, cambios editoriales ni identidad fusionada", () => {
    expect(compareWindows({...sample(),impressions:99,acceptances:19,searches:10,visits:5},sample()).reasons).toContain("insufficient_volume");
    expect(compareWindows({...sample(),days:6},sample()).direction).toBeNull();
    expect(compareWindows(sample(),{...sample(),configs:["policy-b"]}).reasons).toContain("exposure_changed");
    expect(compareWindows({...sample(),configs:["policy-a","policy-b"]},{...sample(),configs:["policy-a","policy-b"]}).direction).toBeNull();
    expect(compareWindows(sample(),sample(),false).reasons).toContain("identity_changed");
  });
  it("rechaza embudos imposibles y no divide ventanas a medianoche local", () => {
    expect(compareWindows(sample(),{...sample(),visits:101}).reasons).toContain("invalid_funnel");
    expect(closedUtcDay(new Date("2026-10-10T00:14:59Z"))).toBe("2026-10-09");
    expect(closedUtcDay(new Date("2026-10-10T00:15:00Z"))).toBe("2026-10-10");
  });
});
