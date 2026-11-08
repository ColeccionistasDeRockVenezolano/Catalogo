import { afterEach, describe, expect, it, vi } from "vitest";
import { LayaScorer } from "../../src/chat/moderation/ai-review.js";

afterEach(() => vi.useRealTimers());

describe("trabajador de Laya del chat", () => {
  it("se cierra tras el silencio y no antes", async () => {
    vi.useFakeTimers();
    const scorer = new LayaScorer(1000);
    // Sin Python: el arranque se sustituye y el lote falla sin trabajador, pero cuenta como actividad.
    (scorer as unknown as { start: () => Promise<void> }).start = async () => {};
    const close = vi.spyOn(scorer, "close");
    await expect(scorer.score([{ id: 1, text: "hola" }])).rejects.toThrow("Laya no está disponible");
    vi.advanceTimersByTime(900);
    await expect(scorer.score([{ id: 2, text: "otra" }])).rejects.toThrow();
    vi.advanceTimersByTime(900);
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
