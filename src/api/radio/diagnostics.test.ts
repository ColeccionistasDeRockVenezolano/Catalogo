import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendRadioDiagnostic, isRadioDiagnosticKind, recentRadioDiagnostics, sanitizeDiagnostic, summarizeUserAgent, summarizeRadioQuality } from "./diagnostics.js";

describe("diagnóstico de la radio", () => {
  it("acota lo que recibe y descarta lo que no es JSON simple", () => {
    const clean = sanitizeDiagnostic({
      ok: 1.23456, bad: Number.NaN, long: "x".repeat(500), "clave rara": 1, deep: { a: { b: { c: { d: { e: { f: 1 } } } } } },
      list: Array.from({ length: 150 }, (_, index) => index), fn: () => 1,
    }) as Record<string, unknown>;
    expect(clean["ok"]).toBe(1.235);
    expect(clean["bad"]).toBeNull();
    expect((clean["long"] as string).length).toBe(301);
    expect(clean["clave rara"]).toBeUndefined();
    expect(clean["fn"]).toBeUndefined();
    expect((clean["list"] as number[])[0]).toBe(50);
    expect(JSON.stringify(clean["deep"])).not.toContain('"f"');
    // __proto__ de un JSON no contamina nada.
    const hostile = sanitizeDiagnostic(JSON.parse('{"__proto__":{"x":1},"constructor":1,"y":2}')) as Record<string, unknown>;
    expect(Object.keys(hostile)).toEqual(["y"]);
    expect(({} as Record<string, unknown>)["x"]).toBeUndefined();
  });

  it("resume el navegador sin guardar el texto completo", () => {
    expect(summarizeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36", true))
      .toEqual({ browser: "Brave", version: "130", os: "Android 14", mobile: true });
    expect(summarizeUserAgent(undefined)).toEqual({ browser: "otro", version: null, os: "otro", mobile: false });
    const ipadDesktop = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
    expect(summarizeUserAgent(ipadDesktop, false, true)).toMatchObject({ browser: "Safari", os: "iPadOS", mobile: true });
    expect(summarizeUserAgent(ipadDesktop)).toMatchObject({ os: "macOS", mobile: false });
  });

  it("solo acepta los tipos conocidos", () => {
    expect(isRadioDiagnosticKind("stall")).toBe(true);
    expect(isRadioDiagnosticKind("playback_quality")).toBe(true);
    expect(isRadioDiagnosticKind("cualquiera")).toBe(false);
  });

  it("evalúa por dispositivo y pieza sin sumar lotes acumulados ni reenvíos", () => {
    const quality = (page: string, seq: number, samples: number, ms: number, outcome = "ongoing", device = "tablet") => ({
      kind: "playback_quality", browser: "Safari", os: "iPadOS", device: { type: device },
      report: { reportId: `${page}:${seq}`, measurement: { schema: 1, pieces: [{
        id: "music:abc", kind: "music", firstObservedAt: 1000, sampleCount: samples, outcome,
        observedMs: ms, interruptedMs: 750, frozenMs: 0, unobservedMs: 0,
        maxAheadMs: 250, maxBehindMs: 750, issues: ["interruption"],
      }] } },
    });
    const final = quality("session:page1", 3, 100, 25000, "ended");
    const summary = summarizeRadioQuality([
      quality("session:page1", 1, 50, 12500), final, final,
      quality("session:page1", 2, 75, 18750),
      quality("session:page2", 1, 80, 20000, "ended", "desktop"),
    ]);
    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({ device: "tablet", pieces: 1, observedMs: 25000, interruptedMs: 750, withIssues: 1, issues: { interruption: 1 } });
    expect(summary[1]).toMatchObject({ device: "desktop", pieces: 1, observedMs: 20000 });
    expect(summarizeRadioQuality([{ kind: "playback_quality", report: {} }])).toEqual([]);
    // La API sanea el cuerpo (report), no el envoltorio que ella añade al log.
    expect(summarizeRadioQuality([{ ...final, report: sanitizeDiagnostic(final.report) }])).toEqual(summarizeRadioQuality([final]));
  });

  it("anota, rota y resume para el panel", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crv-radio-diag-"));
    appendRadioDiagnostic(dir, { kind: "stall", receivedAt: "a", country: "VE", report: { secreto: 1 } });
    appendRadioDiagnostic(dir, { kind: "stall", receivedAt: "b" });
    appendRadioDiagnostic(dir, { kind: "player_error", receivedAt: "c" });
    const summary = recentRadioDiagnostics(dir, 2);
    expect(summary.total).toBe(3);
    expect(summary.byKind).toEqual({ stall: 2, player_error: 1 });
    expect(summary.recent.map((entry) => entry["receivedAt"])).toEqual(["c", "b"]);
    expect(JSON.stringify(summary)).not.toContain("secreto");
    appendRadioDiagnostic(dir, { kind: "stall" }, 1);
    expect(fs.existsSync(path.join(dir, "radio-diagnostics.jsonl.1"))).toBe(true);
    expect(recentRadioDiagnostics(path.join(dir, "nada")).total).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
