// CRV · Clasificación de odio, discriminación y amenazas con Laya (local).
//
// Laya corre en este equipo (gratis, sin red): un trabajador Python
// persistente (scripts/chat-laya-moderation.py) carga el modelo una vez y
// responde dos probabilidades por mensaje: ataque a un colectivo y amenaza.
//
// Nunca frena el envío: el mensaje ya salió cuando Laya lo mira. Cada pocos
// segundos se recoge un lote de mensajes sin revisar:
//   ok       → se marca revisado;
//   doubtful → sigue visible, pasa a 'review' y abre un reporte para moderar;
//   hate     → se oculta (auditoría «ia»), abre un reporte y avisa a los moderadores.
// Las palabras evidentes ya las paró el filtro (text.ts); aquí llega el
// contexto: insultos sin palabra prohibida, deshumanización, amenazas.
//
// Umbrales medidos con una muestra pequeña (2026-10-28, 11 mensajes): odio a
// un colectivo 0,79–0,89 en los casos reales y ≤ 0,15 en conversación normal;
// amenaza 0,91 en la real. Son provisionales: ocultar exige mucha certeza y lo
// intermedio va a revisión humana, nunca a una sanción automática.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { getEnv } from "../../config/env.js";
import { projectRoot } from "../../config/project-root.js";
import { moduleLogger } from "../../logger/index.js";
import { markAiChecked, pendingAiMessages, type PendingMessage } from "./store.js";

const log = moduleLogger("chat-ai-review");

export const AI_THRESHOLDS = { hideHate: 0.85, hideThreat: 0.9, reviewHate: 0.5, reviewThreat: 0.6 } as const;

export interface LayaScores { id: number; hate: number; threat: number }

export interface AiVerdict {
  id: number;
  verdict: "ok" | "doubtful" | "hate";
  category: "colectivo" | "amenaza" | "";
  reason: string;
  scores: { hate: number; threat: number };
}

/** Quien puntúa los mensajes: el trabajador de Laya o un doble en las pruebas. */
export interface ModerationScorer {
  score(messages: Array<{ id: number; text: string }>): Promise<LayaScores[]>;
  close(): void;
}

// Interjecciones venezolanas que la política del chat permite («marico» entre
// panas). Sin cambiarlas, Laya las lee como ataque homófobo (0,78 medido).
const COLLOQUIAL = /\b(?:maric[oa]s?|g[uü]ev[oó]n(?:a|es)?|hu[e]v[oó]n(?:a|es)?|co[ñn]o|pana)\b/giu;

export function prepareForScoring(body: string): string {
  return body.replace(COLLOQUIAL, "amigo");
}

/** Veredicto a partir de las dos probabilidades. */
export function verdictFor(scores: LayaScores): AiVerdict {
  const { hate, threat } = scores;
  const base = { id: scores.id, scores: { hate, threat } };
  if (threat >= AI_THRESHOLDS.hideThreat) {
    return { ...base, verdict: "hate", category: "amenaza", reason: `Amenaza de violencia (Laya ${threat.toFixed(2)})` };
  }
  if (hate >= AI_THRESHOLDS.hideHate) {
    return { ...base, verdict: "hate", category: "colectivo", reason: `Ataque a un colectivo (Laya ${hate.toFixed(2)})` };
  }
  if (threat >= AI_THRESHOLDS.reviewThreat) {
    return { ...base, verdict: "doubtful", category: "amenaza", reason: `Posible amenaza (Laya ${threat.toFixed(2)})` };
  }
  if (hate >= AI_THRESHOLDS.reviewHate) {
    return { ...base, verdict: "doubtful", category: "colectivo", reason: `Posible ataque a un colectivo (Laya ${hate.toFixed(2)})` };
  }
  return { ...base, verdict: "ok", category: "", reason: "" };
}

/**
 * Trabajador persistente de Laya. Se arranca al primer lote (carga perezosa:
 * el chat no paga la GPU si nadie escribe) y se relanza si muere.
 */
export class LayaScorer implements ModerationScorer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (value: LayaScores[]) => void; reject: (error: Error) => void }>();

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const script = path.join(projectRoot(import.meta.url), "scripts", "chat-laya-moderation.py");
    const child = spawn(getEnv().CRV_LAYA_PYTHON, [script], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Laya no arrancó en 180 s")), 180_000);
      createInterface({ input: child.stdout }).on("line", (line) => {
        let payload: { ready?: boolean; id?: number; results?: LayaScores[]; error?: string };
        try { payload = JSON.parse(line) as typeof payload; } catch { return; }
        if (payload.ready) { clearTimeout(timer); resolve(); return; }
        const pending = payload.id === undefined ? undefined : this.waiting.get(payload.id);
        if (!pending || payload.id === undefined) return;
        this.waiting.delete(payload.id);
        if (payload.error || !payload.results) pending.reject(new Error(payload.error ?? "respuesta vacía de Laya"));
        else pending.resolve(payload.results);
      });
      child.stderr.on("data", () => { /* avisos de PyTorch/HF: ruido */ });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Laya terminó (código ${code ?? "?"})`));
        for (const pending of this.waiting.values()) pending.reject(new Error("Laya terminó"));
        this.waiting.clear();
        this.child = null;
        this.ready = null;
      });
      child.on("error", (error) => reject(error));
    });
    return this.ready;
  }

  async score(messages: Array<{ id: number; text: string }>): Promise<LayaScores[]> {
    await this.start();
    const child = this.child;
    if (!child) throw new Error("Laya no está disponible");
    const id = this.nextId++;
    return new Promise<LayaScores[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("Laya no respondió en 60 s"));
      }, 60_000);
      this.waiting.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ id, messages })}\n`);
    });
  }

  close(): void {
    this.child?.kill();
    this.child = null;
    this.ready = null;
  }
}

export interface AiReviewHooks {
  /** Mensaje clasificado como odio o amenaza: el hub lo oculta y avisa. */
  onHate(message: PendingMessage, verdict: AiVerdict): Promise<void>;
  /** Mensaje dudoso: el hub abre un reporte y avisa. */
  onDoubtful(message: PendingMessage, verdict: AiVerdict): Promise<void>;
}

export class AiReviewer {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private backoffUntil = 0;

  constructor(
    private readonly hooks: AiReviewHooks,
    private readonly scorer: ModerationScorer = new LayaScorer(),
    private readonly intervalMs = 5_000,
  ) {}

  static enabled(): boolean {
    return getEnv().CRV_CHAT_AI_MODERATION;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.scorer.close();
  }

  /** Una pasada: un lote. Devuelve cuántos mensajes revisó. */
  async tick(): Promise<number> {
    if (this.running || Date.now() < this.backoffUntil) return 0;
    this.running = true;
    try {
      const batch = await pendingAiMessages(25);
      if (batch.length === 0) return 0;
      const scores = await this.scorer.score(batch.map((message) => ({ id: message.id, text: prepareForScoring(message.body) })));
      const byId = new Map(scores.map((item) => [item.id, verdictFor(item)]));
      const review: number[] = [];
      for (const message of batch) {
        const verdict = byId.get(message.id);
        if (!verdict) continue;
        if (verdict.verdict === "hate") await this.hooks.onHate(message, verdict);
        else if (verdict.verdict === "doubtful") {
          review.push(message.id);
          await this.hooks.onDoubtful(message, verdict);
        }
      }
      // Los que no volvieron se reintentan en la próxima pasada.
      await markAiChecked(batch.filter((message) => byId.has(message.id)).map((message) => message.id), review);
      return byId.size;
    } catch (error) {
      // Laya caído o respuesta inválida: espera un minuto antes de reintentar.
      this.backoffUntil = Date.now() + 60_000;
      log.warn({ err: error }, "la revisión con Laya falló; se reintenta en un minuto");
      return 0;
    } finally {
      this.running = false;
    }
  }
}
