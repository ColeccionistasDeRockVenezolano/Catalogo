import { describe, expect, it } from "vitest";
import { annotateRadioRegions, excludedFromStation, regionRestrictionOf } from "../../src/radio/regions.js";
import type { YouTubeVideoPayload } from "../../src/youtube/api.js";

const many = Array.from({ length: 120 }, (_, index) =>
  String.fromCharCode(65 + Math.floor(index / 26)) + String.fromCharCode(65 + (index % 26)));

function payload(id: string, regionRestriction?: unknown): YouTubeVideoPayload {
  return { id, contentDetails: regionRestriction ? { regionRestriction } : {} } as YouTubeVideoPayload;
}

describe("restricciones regionales de la radio", () => {
  it("normaliza la restricción de YouTube", () => {
    expect(regionRestrictionOf(payload("a", { blocked: ["us", "RU", "RU", "x"] }))).toEqual({ blocked: ["RU", "US"] });
    expect(regionRestrictionOf(payload("a", { allowed: ["VE"] }))).toEqual({ allowed: ["VE"] });
    expect(regionRestrictionOf(payload("a", { blocked: [] }))).toBeNull();
    expect(regionRestrictionOf(payload("a"))).toBeNull();
  });

  it("sale para todos lo vetado en Venezuela o en casi todo el mundo", () => {
    expect(excludedFromStation({ blocked: ["VE"] })).toBe(true);
    expect(excludedFromStation({ blocked: many })).toBe(true);
    expect(excludedFromStation({ allowed: ["VE", "US"] })).toBe(true);
    expect(excludedFromStation({ blocked: ["US"] })).toBe(false);
    expect(excludedFromStation(null)).toBe(false);
  });

  it("anota cada pieza, conserva lo previo de un video sin respuesta y declara la política", () => {
    const catalog = {
      version: 3,
      items: [
        { videoId: "AAAAAAAAAAA", title: "uno" },
        { videoId: "AAAAAAAAAAA", title: "dos" },
        { videoId: "BBBBBBBBBBB", title: "tres", regionRestriction: { blocked: ["MX"] } },
        { videoId: "CCCCCCCCCCC", title: "cuatro", regionRestriction: { blocked: ["RU"] } },
        { videoId: "DDDDDDDDDDD", title: "cinco" },
      ],
    };
    const payloads = new Map([
      ["AAAAAAAAAAA", payload("AAAAAAAAAAA", { blocked: ["VE"] })],
      ["BBBBBBBBBBB", payload("BBBBBBBBBBB")],
      ["DDDDDDDDDDD", payload("DDDDDDDDDDD", { blocked: ["US"] })],
    ]);
    const { catalog: out, stats } = annotateRadioRegions(catalog, payloads);
    const items = out["items"] as Array<Record<string, unknown>>;
    expect(items[0]!["regionRestriction"]).toEqual({ blocked: ["VE"] });
    expect(items[2]).not.toHaveProperty("regionRestriction");
    expect(items[3]!["regionRestriction"]).toEqual({ blocked: ["RU"] });
    expect(items[4]!["regionRestriction"]).toEqual({ blocked: ["US"] });
    expect(out["regionPolicy"]).toEqual({ homeRegions: ["VE"], worldwideRegions: 100 });
    expect(stats).toMatchObject({ items: 5, videos: 4, restrictedVideos: 3, restrictedItems: 4, stationExcludedItems: 2, missingVideos: 1 });
  });
});
