import { useEffect, useRef } from "react";
import type { Quality } from "../../lib/chatEffects";
import { subscribeFrame } from "../../lib/chatMotion";
import { drift, randomAt } from "../../lib/chatMaterials";
import { smokeTexture } from "./MaterialStage";

/** One low-resolution atmospheric layer per room/preview, behind its text. */
export function SmokeClouds({ quality, active = true }: { quality: Quality; active?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !active || (quality !== "high" && quality !== "medium")) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let width = 1; let height = 1; let age = 0; let last = 0;
    const resize = () => {
      width = canvas.clientWidth; height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * .5)); canvas.height = Math.max(1, Math.round(height * .5));
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const texture = smokeTexture("#9aa0aa");
    const stop = subscribeFrame((now, delta) => {
      age += delta / 1000;
      if (now - last < 1000 / 24) return;
      last = now;
      ctx.setTransform(.5, 0, 0, .5, 0, 0); ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < 12; i++) {
        const period = 5 + randomAt(i) * 4;
        const phase = ((age + randomAt(i + 7) * period) % period) / period;
        const size = Math.min(260, Math.max(90, width * .23)) * (1 + phase * .5);
        const x = randomAt(i + 12) * width + drift(age * .3, i) * 30;
        const y = height * .9 - phase * height * .5;
        ctx.globalAlpha = Math.sin(phase * Math.PI) * .4;
        ctx.drawImage(texture, x - size / 2, y - size / 2, size, size * .65);
      }
      ctx.globalAlpha = 1;
    });
    return () => { observer.disconnect(); stop(); };
  }, [quality, active]);
  if (!active || quality === "low" || quality === "reduced") return <span className="crv-smoke-still" aria-hidden="true" />;
  return <canvas ref={ref} className="crv-smoke-clouds" aria-hidden="true" />;
}
