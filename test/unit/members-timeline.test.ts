import { describe, expect, it } from "vitest";
import { timelineReady } from "../../web/src/lib/membersTimeline.js";
import type { ArtistMember } from "../../web/src/lib/types.js";

const member = (personId: number, fromYear: number | null, toYear: number | null, isCurrent = false): ArtistMember =>
  ({ id: personId, personId, personName: `P${personId}`, role: "Miembro", fromYear, toYear, isCurrent });

describe("línea de tiempo de integrantes con datos parciales (Brian, 2026-10-13)", () => {
  it("sale con dos personas que tengan algún año, aunque falten salidas", () => {
    expect(timelineReady([member(1, 1998, null), member(2, 1998, null), member(3, null, null)])).toBe(true);
  });
  it("cuenta a quien solo tiene la salida", () => {
    expect(timelineReady([member(1, 1984, null), member(2, null, 1993)])).toBe(true);
  });
  it("«sigue» sin entrada cuenta solo si se conoce el inicio de la banda", () => {
    expect(timelineReady([member(1, null, null, true), member(2, null, null, true)])).toBe(false);
    expect(timelineReady([member(1, null, null, true), member(2, null, null, true)], 2005)).toBe(true);
  });
  it("no sale sin fechas, ni con una sola persona", () => {
    expect(timelineReady([member(1, null, null), member(2, null, null)])).toBe(false);
    expect(timelineReady([member(1, 1990, 1995), { ...member(1, 1997, null, true), id: 9 }])).toBe(false);
  });
});
