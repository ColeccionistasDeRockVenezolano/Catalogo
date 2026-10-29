// CRV · Blindaje del chat (etapa 1): filtro de texto, apodos, tokens, prueba
// de trabajo, límites y detector. Todo en memoria, sin PostgreSQL; la parte
// con base de datos y WebSocket vive en test/contract/chat-safety.test.ts.
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../../src/config/env.js";
import {
  containsLink, filterText, MAX_LINE_BREAKS, repeatKey, sanitizeBody, sanitizeDisplayName, skeleton, stripInvisible,
} from "../../src/chat/moderation/text.js";
import { meetsDifficulty, sha256Hex, solvePow } from "../../src/chat/pow.js";
import {
  assertChatSecret, issueChatToken, issuePowChallenge, verifyChatToken, verifyPow,
} from "../../src/chat/session.js";
import { ChatGuard, KICK_COOLDOWN_MS, MAX_SOCKETS_PER_ACTOR, MAX_SOCKETS_PER_IP, NEW_ACCOUNT_MESSAGES } from "../../src/chat/guard.js";
import { SuspicionDetector, SUSPICION_THRESHOLD, type SuspicionTrip } from "../../src/chat/moderation/detector.js";
import { AI_THRESHOLDS, prepareForScoring, verdictFor } from "../../src/chat/moderation/ai-review.js";
import { isBannableIp } from "../../src/chat/moderation/store.js";

const ACTOR = "11111111-2222-4333-8444-555555555555";
const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
}

describe("filtro de palabras", () => {
  it("deja pasar la conversación normal y las interjecciones venezolanas", () => {
    for (const text of ["qué buen disco de Zapato 3", "marico qué temazo", "coño, se me pasó el concierto", "ese güevón toca brutal"]) {
      expect(filterText(text).verdict, text).toBe("ok");
    }
  });

  it("tapa las groserías fuertes conservando el resto", () => {
    const result = filterText("esa banda es una mierda total");
    expect(result.verdict).toBe("mask");
    expect(result.text).toMatch(/^esa banda es una \S+ total$/u);
    expect(result.text).not.toContain("mierda");
  });

  it("bloquea los insultos de odio aunque vengan disfrazados", () => {
    const disguised = [
      "fuera los venecos",
      "V3N3C0S",
      "vénécos",
      `ve${ZWSP}necos`,
      "veeeeneeecooos",
      "v e n e c o s",
      "v.e.n.e.c.o.s",
    ];
    for (const text of disguised) expect(filterText(text).verdict, text).toBe("block");
  });

  it("no confunde números ni palabras que contienen un insulto por casualidad", () => {
    expect(filterText("el disco salió en 2000, 4/4 y 120 bpm").verdict).toBe("ok");
    expect(skeleton("Ñ")).toBeTypeOf("string");
  });

  it("quita invisibles y controles bidi", () => {
    expect(stripInvisible(`ho${ZWSP}la${RLO}`)).toBe("hola");
  });
});

describe("cuerpo del mensaje", () => {
  it("rechaza mensajes vacíos o con demasiados saltos de línea", () => {
    expect(sanitizeBody(`  ${ZWSP} `)).toEqual({ problem: "empty" });
    expect(sanitizeBody("a\n".repeat(MAX_LINE_BREAKS + 2))).toEqual({ problem: "too_many_lines" });
    expect(sanitizeBody("línea 1\nlínea 2")).toEqual({ body: "línea 1\nlínea 2" });
  });

  it("la clave de repetición ignora mayúsculas, espacios y alargamientos", () => {
    expect(repeatKey("HOLAAAA   gente")).toBe(repeatKey("hola gente"));
  });

  it("detecta enlaces aunque no lleven http", () => {
    expect(containsLink("mira www.ejemplo.com")).toBe(true);
    expect(containsLink("entra a spam.xyz/gratis")).toBe(true);
    expect(containsLink("el disco cuesta 3.50")).toBe(false);
  });
});

describe("apodos", () => {
  it("normaliza y acepta apodos normales", () => {
    expect(sanitizeDisplayName("  Rockero  de   Catia ")).toEqual({ name: "Rockero de Catia" });
  });

  it("rechaza nombres reservados aunque se imiten con otros caracteres", () => {
    for (const name of ["Admin", "ADMlN", "Moderador", "ｂｒｉａｎ", `CR${ZWSP}V`, "Sistema"]) {
      expect(sanitizeDisplayName(name), name).toEqual({ problem: "reserved" });
    }
  });

  it("rechaza apodos ofensivos y los que quedan vacíos tras quitar invisibles", () => {
    expect(sanitizeDisplayName("veneco")).toEqual({ problem: "offensive" });
    expect(sanitizeDisplayName(`${ZWSP}${RLO}a`)).toEqual({ problem: "too_short" });
  });
});

describe("tokens del chat", () => {
  beforeEach(() => setEnv({ CRV_CHAT_SECRET: "secreto-de-prueba-con-mas-de-32-caracteres", CRV_CHAT_TOKEN_TTL_DAYS: "30" }));
  afterEach(() => setEnv({ CRV_CHAT_SECRET: undefined, CRV_CHAT_TOKEN_TTL_DAYS: undefined, NODE_ENV: "test" }));

  it("emite y verifica un token con versión y caducidad", () => {
    const now = Date.UTC(2026, 9, 28);
    const claims = verifyChatToken(issueChatToken(ACTOR, 3, now), { now });
    expect(claims).toMatchObject({ actorId: ACTOR, version: 3, legacy: false });
    expect(claims?.expiresAt).toBe(now + 30 * 86_400_000);
  });

  it("rechaza un token caducado", () => {
    const issued = Date.UTC(2026, 0, 1);
    const token = issueChatToken(ACTOR, 1, issued);
    expect(verifyChatToken(token, { now: issued + 31 * 86_400_000 })).toBeNull();
  });

  it("rechaza un token manipulado (versión o actor cambiados)", () => {
    const token = issueChatToken(ACTOR, 1);
    expect(verifyChatToken(token.replace(`.${1}.`, ".2."))).toBeNull();
    expect(verifyChatToken(token.replace("11111111", "99999999"))).toBeNull();
  });

  it("el formato viejo solo vale para renovar", () => {
    const signature = createHash("sha256").digest("hex"); // forma válida, firma falsa
    expect(verifyChatToken(`${ACTOR}.${signature}`, { allowLegacy: true })).toBeNull();
    const legacy = `${ACTOR}.${createHmac("sha256", process.env["CRV_CHAT_SECRET"]!).update(`chat:${ACTOR}`).digest("hex")}`;
    expect(verifyChatToken(legacy)).toBeNull();
    expect(verifyChatToken(legacy, { allowLegacy: true })).toMatchObject({ actorId: ACTOR, legacy: true });
  });

  it("en producción el chat no arranca con el secreto de desarrollo", () => {
    setEnv({ CRV_CHAT_SECRET: undefined, NODE_ENV: "production" });
    expect(() => assertChatSecret()).toThrow(/CRV_CHAT_SECRET/u);
    setEnv({ CRV_CHAT_SECRET: "otro-secreto-de-produccion-bien-largo-123", NODE_ENV: "production" });
    expect(() => assertChatSecret()).not.toThrow();
  });
});

describe("prueba de trabajo", () => {
  beforeEach(() => setEnv({ CRV_CHAT_SECRET: "secreto-de-prueba-con-mas-de-32-caracteres", CRV_CHAT_POW_BITS: "8" }));
  afterEach(() => setEnv({ CRV_CHAT_SECRET: undefined, CRV_CHAT_POW_BITS: undefined }));

  it("el SHA-256 en JavaScript coincide con el de Node", () => {
    for (const text of ["", "abc", "La Rockola ¿🤘?", "x".repeat(1000)]) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });

  it("cuenta bits a cero, incluso en medio de un dígito", () => {
    expect(meetsDifficulty("00ff", 8)).toBe(true);
    expect(meetsDifficulty("01ff", 8)).toBe(false);
    expect(meetsDifficulty("1fff", 3)).toBe(true);
    expect(meetsDifficulty("2fff", 3)).toBe(false);
  });

  it("un desafío resuelto vale una sola vez y solo para su IP", async () => {
    const { challenge, bits } = issuePowChallenge("10.0.0.1");
    const nonce = await solvePow(challenge, bits);
    expect(verifyPow("10.0.0.2", challenge, nonce)).toBe("forged");
    expect(verifyPow("10.0.0.1", challenge, nonce)).toBeNull();
    expect(verifyPow("10.0.0.1", challenge, nonce)).toBe("spent");
  });

  it("rechaza desafíos ausentes, caducados o sin resolver", () => {
    const now = Date.now();
    const { challenge } = issuePowChallenge("10.0.0.1", now);
    expect(verifyPow("10.0.0.1", undefined, undefined)).toBe("missing");
    expect(verifyPow("10.0.0.1", "basura", "1")).toBe("malformed");
    expect(verifyPow("10.0.0.1", challenge, "1", now + 6 * 60_000)).toBe("expired");
    let wrong = 0;
    while (meetsDifficulty(sha256Hex(`${challenge}:${wrong}`), 8)) wrong += 1;
    expect(verifyPow("10.0.0.1", challenge, String(wrong), now)).toBe("weak");
  });

  it("un desafío con menos bits que el mínimo vigente no vale", async () => {
    const { challenge } = issuePowChallenge("10.0.0.1");
    const nonce = await solvePow(challenge, 8);
    setEnv({ CRV_CHAT_POW_BITS: "12" });
    expect(verifyPow("10.0.0.1", challenge, nonce)).toBe("weak");
  });
});

describe("límites por actor e IP", () => {
  beforeEach(() => setEnv({ CRV_CHAT_RATE_LIMIT: "5" }));
  afterEach(() => setEnv({ CRV_CHAT_RATE_LIMIT: undefined }));

  it("el cupo de mensajes es del actor, no de cada conexión", () => {
    const guard = new ChatGuard();
    const results = Array.from({ length: 6 }, () => guard.take("message", { actorId: "a", ip: "1.1.1.1" }));
    expect(results.slice(0, 5).every((result) => result.ok)).toBe(true);
    expect(results[5]).toEqual({ ok: false, scope: "actor" });
  });

  it("varias cuentas desde la misma IP comparten un tope mayor", () => {
    const guard = new ChatGuard();
    let blocked: unknown = null;
    for (let index = 0; index < 20 && !blocked; index += 1) {
      const result = guard.take("message", { actorId: `bot-${index}`, ip: "6.6.6.6" });
      if (!result.ok) blocked = result;
    }
    expect(blocked).toEqual({ ok: false, scope: "ip" });
  });

  it("una cuenta nueva tiene menos ritmo", () => {
    const guard = new ChatGuard();
    const results = Array.from({ length: NEW_ACCOUNT_MESSAGES + 1 }, () => guard.take("message", { actorId: "n", ip: "2.2.2.2", newAccount: true }));
    expect(results.at(-1)?.ok).toBe(false);
  });

  it("limita las conexiones por actor e IP y respeta la expulsión", () => {
    let now = 0;
    const guard = new ChatGuard(() => now);
    for (let index = 0; index < MAX_SOCKETS_PER_ACTOR; index += 1) expect(guard.openSocket("a", "3.3.3.3")).toBe("ok");
    expect(guard.openSocket("a", "3.3.3.3")).toBe("actor_limit");
    for (let index = 0; index < MAX_SOCKETS_PER_IP - MAX_SOCKETS_PER_ACTOR; index += 1) {
      expect(guard.openSocket(`b${index}`, "3.3.3.3")).toBe("ok");
    }
    expect(guard.openSocket("z", "3.3.3.3")).toBe("ip_limit");
    guard.releaseSocket("a", "3.3.3.3");
    expect(guard.openSocket("a", "3.3.3.3")).toBe("ok");

    guard.kick("k");
    expect(guard.openSocket("k", "4.4.4.4")).toBe("kicked");
    now += KICK_COOLDOWN_MS + 1;
    expect(guard.openSocket("k", "4.4.4.4")).toBe("ok");
  });

  it("modo lento y mensajes repetidos", () => {
    let now = 1_000_000;
    const guard = new ChatGuard(() => now);
    guard.recordMessage("general", "a", "hola gente");
    expect(guard.slowModeWait("general", "a", 30)).toBeGreaterThan(0);
    expect(guard.slowModeWait("general", "a", 0)).toBe(0);
    expect(guard.checkRepeat("a", "HOLA   gente")).toBe("repeated");
    now += 20_000;
    expect(guard.checkRepeat("a", "hola gente")).toBe("ok");
    guard.recordMessage("general", "a", "hola gente");
    now += 20_000;
    // Tercera vez en tres minutos.
    expect(guard.checkRepeat("a", "hola gente")).toBe("repeated");
  });
});

describe("detector de abuso", () => {
  it("suma señales, dispara una vez al pasar el umbral y olvida con el tiempo", () => {
    let now = 0;
    const trips: SuspicionTrip[] = [];
    const detector = new SuspicionDetector((trip) => trips.push(trip), () => now);
    detector.add("a", "rate_limited");
    expect(detector.score("a")).toBe(15);
    now += 10 * 60_000;
    expect(detector.score("a")).toBeCloseTo(7.5);
    detector.add("a", "blocked_words", 4);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.score).toBeGreaterThanOrEqual(SUSPICION_THRESHOLD);
    expect(trips[0]?.rules).toEqual(expect.arrayContaining(["rate_limited", "blocked_words"]));
    expect(detector.score("a")).toBe(0);
  });

  it("el mismo texto desde tres cuentas en dos minutos marca a las tres", () => {
    const trips: SuspicionTrip[] = [];
    const detector = new SuspicionDetector((trip) => trips.push(trip));
    for (const id of ["b1", "b2", "b3"]) detector.onMessage(id, repeatKey("compra seguidores baratos"), 86_400_000);
    for (const id of ["b1", "b2", "b3"]) expect(detector.score(id)).toBeCloseTo(40, 2);
  });

  it("muchas cuentas desde una IP o huella suben la sospecha de la nueva", () => {
    const trips: SuspicionTrip[] = [];
    const detector = new SuspicionDetector((trip) => trips.push(trip));
    detector.onSessionCreated("c", 2, 1);
    expect(detector.score("c")).toBe(0);
    detector.onSessionCreated("d", 4, 1);
    expect(detector.score("d")).toBeCloseTo(20 * 2, 2);
    // Ninguna señal sola silencia, por muchas cuentas que haya (CGNAT, mismo móvil).
    detector.onSessionCreated("f", 50, 1);
    detector.onSessionCreated("g", 1, 50);
    expect(detector.score("f")).toBeCloseTo(60, 2);
    expect(detector.score("g")).toBeCloseTo(60, 2);
    // Quinta cuenta de la IP con la misma huella: 60 + 60 pasa el umbral.
    detector.onSessionCreated("e", 5, 4);
    expect(trips.map((trip) => trip.actorId)).toEqual(["e"]);
  });
});

describe("clasificación con Laya", () => {
  it("cambia las interjecciones permitidas antes de puntuar", () => {
    expect(prepareForScoring("Marico, qué temazo pana")).toBe("amigo, qué temazo amigo");
    expect(prepareForScoring("los maricones")).toBe("los maricones");
  });

  it("decide ocultar, revisar o dejar según los umbrales", () => {
    expect(verdictFor({ id: 1, hate: AI_THRESHOLDS.hideHate, threat: 0 }).verdict).toBe("hate");
    expect(verdictFor({ id: 1, hate: 0, threat: AI_THRESHOLDS.hideThreat })).toMatchObject({ verdict: "hate", category: "amenaza" });
    expect(verdictFor({ id: 1, hate: AI_THRESHOLDS.reviewHate, threat: 0 }).verdict).toBe("doubtful");
    expect(verdictFor({ id: 1, hate: 0.1, threat: AI_THRESHOLDS.reviewThreat })).toMatchObject({ verdict: "doubtful", category: "amenaza" });
    expect(verdictFor({ id: 1, hate: 0.15, threat: 0.1 }).verdict).toBe("ok");
  });
});

describe("baneo de IP", () => {
  it("nunca banea loopback, redes privadas ni Tailscale", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.0.1", "100.101.1.1", "fd7a:115c::1", "desconocida"]) {
      expect(isBannableIp(ip), ip).toBe(false);
    }
    for (const ip of ["190.202.10.1", "200.44.1.1", "2800:200::1"]) expect(isBannableIp(ip), ip).toBe(true);
  });
});
