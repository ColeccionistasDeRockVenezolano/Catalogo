// CRV · Detector de actividad sospechosa del chat.
//
// Reglas con puntuación por actor. Cada señal suma puntos; la puntuación se
// reduce a la mitad cada 10 minutos, así que una ráfaga aislada se olvida y
// un patrón sostenido no. Al superar el umbral, el hub silencia al actor,
// deja la acción en la auditoría y avisa a los moderadores.
//
// En memoria a propósito: las reglas miran los últimos minutos y el chat es
// un solo proceso. Lo que cuenta cuentas por IP o huella sí sale de la base
// (sobrevive a un reinicio) y llega aquí ya contado.

export type SuspicionRule =
  | "ip_many_accounts" | "fp_many_accounts" | "same_text_many_accounts" | "rate_limited"
  | "name_changes" | "new_account_active" | "blocked_words" | "new_account_link" | "repeated";

export const SUSPICION_THRESHOLD = 100;
const HALF_LIFE_MS = 10 * 60_000;
const SAME_TEXT_WINDOW_MS = 2 * 60_000;

/** Puntos por señal. */
export const SUSPICION_POINTS: Record<SuspicionRule, number> = {
  ip_many_accounts: 20,
  fp_many_accounts: 30,
  same_text_many_accounts: 40,
  rate_limited: 15,
  name_changes: 30,
  new_account_active: 25,
  blocked_words: 25,
  new_account_link: 10,
  repeated: 10,
};

export interface SuspicionTrip {
  actorId: string;
  score: number;
  rules: SuspicionRule[];
}

interface Score { value: number; at: number; rules: Set<SuspicionRule> }

export class SuspicionDetector {
  private readonly scores = new Map<string, Score>();
  private readonly texts = new Map<string, Map<string, number>>();
  private readonly renames = new Map<string, number[]>();
  private readonly newMessages = new Map<string, number[]>();

  constructor(
    private readonly onTrip: (trip: SuspicionTrip) => void,
    private readonly now: () => number = Date.now,
  ) {}

  score(actorId: string): number {
    const entry = this.scores.get(actorId);
    return entry ? this.decayed(entry) : 0;
  }

  private decayed(entry: Score): number {
    return entry.value * 0.5 ** ((this.now() - entry.at) / HALF_LIFE_MS);
  }

  /** Suma puntos y dispara el umbral una sola vez (después vuelve a cero). */
  add(actorId: string, rule: SuspicionRule, times = 1): number {
    const previous = this.scores.get(actorId);
    const value = (previous ? this.decayed(previous) : 0) + SUSPICION_POINTS[rule] * times;
    const rules = previous?.rules ?? new Set<SuspicionRule>();
    rules.add(rule);
    if (value >= SUSPICION_THRESHOLD) {
      this.scores.delete(actorId);
      this.onTrip({ actorId, score: Math.round(value), rules: [...rules] });
      return value;
    }
    this.scores.set(actorId, { value, at: this.now(), rules });
    return value;
  }

  /** Invitado recién creado: cuántas cuentas salieron de su IP y su huella en la última hora. */
  onSessionCreated(actorId: string, fromIp: number, fromFingerprint: number): void {
    // La propia cuenta cuenta: 3 cuentas en una hora ya es raro; 2 puede ser
    // una familia o un móvil y un portátil. Cada señal se queda en 60 puntos:
    // una IP compartida (CGNAT de las operadoras móviles) o una huella común
    // (mismo modelo de iPhone) no bastan solas para silenciar a nadie.
    if (fromIp >= 3) this.add(actorId, "ip_many_accounts", Math.min(fromIp - 2, 3));
    if (fromFingerprint >= 3) this.add(actorId, "fp_many_accounts", Math.min(fromFingerprint - 2, 2));
  }

  /** Mensaje aceptado. `key` es el texto canónico (repeatKey). */
  onMessage(actorId: string, key: string, accountAgeMs: number): void {
    const now = this.now();
    // Mismo texto (de al menos 8 letras) desde tres cuentas distintas en 2 min.
    if (key.replace(/\s/gu, "").length >= 8) {
      const seen = this.texts.get(key) ?? new Map<string, number>();
      for (const [id, at] of seen) if (now - at > SAME_TEXT_WINDOW_MS) seen.delete(id);
      seen.set(actorId, now);
      this.texts.set(key, seen);
      if (seen.size >= 3) {
        for (const id of seen.keys()) this.add(id, "same_text_many_accounts");
        seen.clear();
      }
    }
    // Cuenta de menos de 10 minutos con más de 12 mensajes en 5 minutos.
    if (accountAgeMs < 10 * 60_000) {
      const stamps = (this.newMessages.get(actorId) ?? []).filter((at) => now - at < 5 * 60_000);
      stamps.push(now);
      this.newMessages.set(actorId, stamps);
      if (stamps.length > 12) {
        this.add(actorId, "new_account_active");
        this.newMessages.set(actorId, []);
      }
    }
  }

  /** Tercer cambio de apodo (o más) en 10 minutos. */
  onRename(actorId: string): void {
    const now = this.now();
    const stamps = (this.renames.get(actorId) ?? []).filter((at) => now - at < 10 * 60_000);
    stamps.push(now);
    this.renames.set(actorId, stamps);
    if (stamps.length >= 3) this.add(actorId, "name_changes");
  }

  sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.scores) if (this.decayed(entry) < 1) this.scores.delete(id);
    for (const [key, seen] of this.texts) {
      for (const [id, at] of seen) if (now - at > SAME_TEXT_WINDOW_MS) seen.delete(id);
      if (seen.size === 0) this.texts.delete(key);
    }
    for (const [id, stamps] of this.renames) if (stamps.every((at) => now - at > 10 * 60_000)) this.renames.delete(id);
    for (const [id, stamps] of this.newMessages) if (stamps.every((at) => now - at > 5 * 60_000)) this.newMessages.delete(id);
  }
}
