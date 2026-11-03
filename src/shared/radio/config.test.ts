import { describe, expect, it } from "vitest";
import { parseRadioConfig } from "./config.js";

const base = { catalogFile: "radio/catalogo.json", stationName: "Prueba", crossfadeSeconds: 3, epoch: "2026-09-07T12:19:47.774Z" };
const cuna = { src: "radio/sweeper-v2.wav", durationSeconds: 13.404422, leadSeconds: 4.5, overlapSeconds: 6, everyPieces: 3 };
const leer = (sweeper: Record<string, unknown>) => parseRadioConfig({ ...base, sweeper }, 1)?.sweeper;

describe("cuña por YouTube en la configuración", () => {
  it("acepta un ID válido y su segundo de inicio", () => {
    expect(leer({ ...cuna, videoId: "MPIwJFKsjVE", videoStartSeconds: 0 })).toMatchObject({ videoId: "MPIwJFKsjVE", videoStartSeconds: 0 });
  });
  it("sin ID sigue siendo la cuña de siempre", () => {
    const sweeper = leer(cuna);
    expect(sweeper).toMatchObject({ src: cuna.src });
    expect(sweeper?.videoId).toBeUndefined();
  });
  it("descarta un ID mal formado y su inicio", () => {
    const sweeper = leer({ ...cuna, videoId: "corto", videoStartSeconds: 4 });
    expect(sweeper?.videoId).toBeUndefined();
    expect(sweeper?.videoStartSeconds).toBeUndefined();
  });
  it("ignora un inicio negativo", () => {
    expect(leer({ ...cuna, videoId: "MPIwJFKsjVE", videoStartSeconds: -1 })?.videoStartSeconds).toBeUndefined();
  });
});
