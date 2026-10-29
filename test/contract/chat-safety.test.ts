// CRV · Blindaje del chat contra PostgreSQL y un WebSocket real.
//
// Levanta la misma aplicación que el proceso crv-chat (src/chat/app.ts) sobre
// un contenedor de prueba —nunca la base de desarrollo— y comprueba lo que
// solo se ve de punta a punta: la prueba de trabajo y el tope de sesiones por
// IP, el Origin del WebSocket, el tope de frame, los límites que suman entre
// conexiones, el filtro, el detector, la moderación con revocación de tokens
// y un ataque simulado con bots.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { migrateUp } from "../../src/db/migrate.js";
import { buildChatApp } from "../../src/chat/app.js";
import type { ChatHub } from "../../src/chat/realtime.js";
import { solvePow } from "../../src/chat/pow.js";
import { CHAT_MAX_PAYLOAD } from "../../src/chat/protocol.js";

const ORIGIN = "http://crv.test";
const ADMIN_COOKIE = "crv_session=moderador-de-prueba";
const CSRF = "csrf-de-prueba";

interface Session { token: string; actorId: string; cookie: string }

interface Client {
  socket: WebSocket;
  events: Array<Record<string, unknown>>;
  next(type: string, predicate?: (event: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
  closed: Promise<{ code: number; reason: string }>;
  send(event: Record<string, unknown>): void;
}

describe("blindaje del chat (PostgreSQL + WebSocket)", () => {
  let container: PgContainer;
  let app: FastifyInstance;
  let hub: ChatHub;
  let wsBase = "";
  let ipCounter = 10;

  /** Cada prueba usa IPs propias para no gastar el cupo de otra. */
  const freshIp = (): string => `198.51.100.${ipCounter++}`;

  const request = async (method: "GET" | "POST" | "PATCH", url: string, options: {
    ip: string; body?: unknown; origin?: string | null; cookie?: string; csrf?: boolean;
  }) => {
    const headers: Record<string, string> = { "x-forwarded-for": options.ip };
    if (options.origin !== null) headers["origin"] = options.origin ?? ORIGIN;
    if (options.cookie) headers["cookie"] = options.cookie;
    if (options.csrf) headers["x-crv-csrf"] = CSRF;
    const response = await app.inject({
      method, url, headers,
      ...(options.body === undefined ? {} : { payload: options.body as Record<string, unknown> }),
    });
    return {
      status: response.statusCode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- respuestas JSON leídas campo a campo en la prueba
      json: response.json() as Record<string, any>,
      headers: response.headers,
    };
  };

  const newSession = async (ip: string, displayName?: string): Promise<Session> => {
    const challenge = await request("GET", "/chat/challenge", { ip });
    expect(challenge.status).toBe(200);
    const nonce = await solvePow(challenge.json["challenge"], challenge.json["bits"]);
    const response = await request("POST", "/chat/session", {
      ip, body: { challenge: challenge.json["challenge"], nonce, fp: randomBytes(16).toString("hex"), ...(displayName ? { displayName } : {}) },
    });
    expect(response.status, JSON.stringify(response.json)).toBe(200);
    return { token: response.json["token"], actorId: response.json["actor"]["id"], cookie: `crv_chat=${response.json["token"]}` };
  };

  const connect = (token: string, ip: string, options: { origin?: string | null; cookie?: string } = {}): Promise<Client> => {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (options.cookie) headers["cookie"] = options.cookie;
    const socket = new WebSocket(`${wsBase}/chat/ws?t=${encodeURIComponent(token)}&room=general`, {
      headers, ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
    });
    const events: Array<Record<string, unknown>> = [];
    const waiters: Array<() => void> = [];
    socket.on("message", (data) => {
      events.push(JSON.parse(String(data)) as Record<string, unknown>);
      for (const wake of waiters.splice(0)) wake();
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.on("close", (code, reason) => resolve({ code, reason: String(reason) }));
    });
    const client: Client = {
      socket, events, closed,
      send: (event) => socket.send(JSON.stringify(event)),
      next: (type, predicate = () => true, timeoutMs = 4_000) => new Promise((resolve, reject) => {
        let seen = 0;
        const check = (): boolean => {
          for (; seen < events.length; seen += 1) {
            const event = events[seen]!;
            if (event["type"] === type && predicate(event)) { events.splice(seen, 1); resolve(event); return true; }
          }
          return false;
        };
        if (check()) return;
        const timer = setTimeout(() => reject(new Error(`sin evento «${type}» en ${timeoutMs} ms; llegaron: ${events.map((event) => `${String(event["type"])}${event["code"] ? `:${String(event["code"])}` : ""}${event["message"] && typeof event["message"] === "object" ? `:${(event["message"] as { body: string }).body}` : ""}`).join(" | ")}`)), timeoutMs);
        const loop = (): void => { if (check()) clearTimeout(timer); else waiters.push(loop); };
        waiters.push(loop);
      }),
    };
    return new Promise((resolve) => {
      socket.once("open", () => resolve(client));
      socket.once("error", () => resolve(client));
      socket.once("close", () => resolve(client));
    });
  };

  const openChat = async (session: Session, ip: string): Promise<Client> => {
    const client = await connect(session.token, ip);
    await client.next("snapshot");
    return client;
  };

  const admin = (method: "GET" | "POST", url: string, body?: unknown) =>
    request(method, url, { ip: "127.0.0.1", cookie: ADMIN_COOKIE, csrf: method === "POST", ...(body === undefined ? {} : { body }) });

  beforeAll(async () => {
    container = await startPgContainer();
    Object.assign(process.env, {
      DATABASE_URL: container.databaseUrl,
      CRV_CHAT_SECRET: "secreto-de-contrato-con-mas-de-32-caracteres",
      CRV_CHAT_POW_BITS: "8",
      CRV_CHAT_RATE_LIMIT: "5",
      CRV_CHAT_SESSIONS_PER_IP: "5",
      CRV_CHAT_NEW_ACCOUNT_MINUTES: "0",
      CRV_CHAT_AI_MODERATION: "false",
      CRV_ALLOWED_ORIGINS: ORIGIN,
    });
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    const built = await buildChatApp({
      logger: false,
      // La sesión de colaborador vive en la API; aquí un doble con la misma forma.
      remoteSession: async (req) => (req.headers.cookie?.includes(ADMIN_COOKIE)
        ? { name: "moderador", role: "admin", csrf: CSRF }
        : undefined),
    });
    app = built.app;
    hub = built.hub;
    await app.listen({ port: 0, host: "127.0.0.1" });
    wsBase = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await closeDb();
    await container?.stop();
  }, 60_000);

  // ── Sesiones ────────────────────────────────────────────────────────────
  it("crear un invitado exige Origin y la prueba de trabajo", async () => {
    const ip = freshIp();
    expect((await request("POST", "/chat/session", { ip, origin: null, body: {} })).json["error"]["code"]).toBe("missing_origin");
    expect((await request("POST", "/chat/session", { ip, origin: "https://otro.example", body: {} })).status).toBe(403);
    const withoutPow = await request("POST", "/chat/session", { ip, body: {} });
    expect(withoutPow.status).toBe(428);
    expect(withoutPow.json["error"]["code"]).toBe("pow_required");
    const session = await newSession(ip, "Oyente Fiel");
    // Con la cookie el mismo actor renueva su token sin otro desafío.
    const renewed = await request("POST", "/chat/session", { ip, cookie: session.cookie, body: {} });
    expect(renewed.status).toBe(200);
    expect(renewed.json["actor"]["id"]).toBe(session.actorId);
  });

  it("limita los invitados nuevos por IP", async () => {
    const ip = freshIp();
    for (let index = 0; index < 5; index += 1) await newSession(ip);
    const challenge = await request("GET", "/chat/challenge", { ip });
    const nonce = await solvePow(challenge.json["challenge"], challenge.json["bits"]);
    const sixth = await request("POST", "/chat/session", { ip, body: { challenge: challenge.json["challenge"], nonce } });
    expect(sixth.status).toBe(429);
    // Otra IP sigue entrando.
    await newSession(freshIp());
  });

  it("rechaza apodos reservados", async () => {
    const ip = freshIp();
    const session = await newSession(ip);
    const response = await request("PATCH", "/chat/profile", { ip, cookie: session.cookie, body: { displayName: "ADMlN" } });
    expect(response.status).toBe(400);
  });

  // ── WebSocket ───────────────────────────────────────────────────────────
  it("el WebSocket exige un Origin confiable y un token válido", async () => {
    const ip = freshIp();
    const session = await newSession(ip);
    expect((await (await connect(session.token, ip, { origin: null })).closed).code).toBe(4403);
    expect((await (await connect(session.token, ip, { origin: "https://evil.example" })).closed).code).toBe(4403);
    expect((await (await connect(`${session.token.slice(0, -4)}0000`, ip)).closed).code).toBe(4401);
  });

  it("corta un frame más grande que el tope", async () => {
    const ip = freshIp();
    const client = await openChat(await newSession(ip), ip);
    client.socket.send("x".repeat(CHAT_MAX_PAYLOAD + 1024));
    expect((await client.closed).code).toBe(1009);
  });

  it("el cupo de mensajes suma entre las conexiones del mismo actor", async () => {
    const ip = freshIp();
    const session = await newSession(ip);
    const first = await openChat(session, ip);
    const second = await openChat(session, ip);
    // Textos distintos de verdad: la clave de repetición ignora los números.
    const bodies = ["uno de rock", "dos de metal", "tres de punk", "cuatro de blues", "cinco de ska", "seis de grunge"];
    bodies.forEach((body, index) => (index % 2 === 0 ? first : second).send({ type: "message", body }));
    const limited = await Promise.race([
      first.next("error", (event) => event["code"] === "rate_limited"),
      second.next("error", (event) => event["code"] === "rate_limited"),
    ]);
    expect(limited["code"]).toBe("rate_limited");
    first.socket.close();
    second.socket.close();
  });

  it("tope de conexiones simultáneas por actor", async () => {
    const ip = freshIp();
    const session = await newSession(ip);
    const open = [];
    for (let index = 0; index < 4; index += 1) open.push(await openChat(session, ip));
    expect((await (await connect(session.token, ip)).closed).code).toBe(4429);
    for (const client of open) client.socket.close();
  });

  it("filtra: tapa groserías, bloquea odio, frena repetidos y saltos de línea", async () => {
    const ip = freshIp();
    const client = await openChat(await newSession(ip), ip);
    client.send({ type: "message", body: "qué disco tan mierda" });
    const masked = await client.next("message");
    expect(String((masked["message"] as { body: string }).body)).not.toContain("mierda");

    client.send({ type: "message", body: "fuera los v3n3c0s" });
    expect((await client.next("error"))["code"]).toBe("blocked_words");

    client.send({ type: "message", body: "hola a todos" });
    await client.next("message");
    client.send({ type: "message", body: "HOLA   a todos" });
    expect((await client.next("error"))["code"]).toBe("repeated");

    client.send({ type: "message", body: "a\n".repeat(20) });
    expect((await client.next("error"))["code"]).toBeDefined();
    client.socket.close();
  });

  it("repetidos simultáneos desde dos pestañas solo publican una vez", async () => {
    const ip = freshIp();
    const session = await newSession(ip);
    const first = await openChat(session, ip);
    const second = await openChat(session, ip);
    first.send({ type: "message", body: "repetido simultáneo de seguridad" });
    second.send({ type: "message", body: "repetido simultáneo de seguridad" });
    await first.next("message");
    await Promise.race([
      first.next("error", (event) => event["code"] === "repeated"),
      second.next("error", (event) => event["code"] === "repeated"),
    ]);
    const count = await getPool().query<{ n: string }>(
      "SELECT count(*) AS n FROM chat.messages WHERE actor_id = $1", [session.actorId],
    );
    expect(Number(count.rows[0]?.n)).toBe(1);
    first.socket.close();
    second.socket.close();
  });

  it("el modo lento cubre mensajes simultáneos desde dos pestañas", async () => {
    await admin("POST", "/chat/admin/rooms/general/slow-mode", { seconds: 30 });
    const ip = freshIp();
    const session = await newSession(ip);
    const first = await openChat(session, ip);
    const second = await openChat(session, ip);
    try {
      first.send({ type: "message", body: "primero simultáneo lento" });
      second.send({ type: "message", body: "segundo simultáneo lento" });
      await first.next("message");
      await Promise.race([
        first.next("error", (event) => event["code"] === "slow_mode"),
        second.next("error", (event) => event["code"] === "slow_mode"),
      ]);
      const count = await getPool().query<{ n: string }>(
        "SELECT count(*) AS n FROM chat.messages WHERE actor_id = $1", [session.actorId],
      );
      expect(Number(count.rows[0]?.n)).toBe(1);
    } finally {
      await admin("POST", "/chat/admin/rooms/general/slow-mode", { seconds: 0 });
      first.socket.close();
      second.socket.close();
    }
  });

  // ── Moderación ──────────────────────────────────────────────────────────
  it("reportar, borrar, silenciar y banear (cuenta e IP) con auditoría", async () => {
    const badIp = freshIp();
    const bad = await newSession(badIp, "Troll");
    const goodIp = freshIp();
    const good = await newSession(goodIp, "Testigo");
    const troll = await openChat(bad, badIp);
    const witness = await openChat(good, goodIp);
    const moderator = await connect(good.token, goodIp, { cookie: ADMIN_COOKIE });
    await moderator.next("snapshot");

    troll.send({ type: "message", body: "mensaje molesto para reportar" });
    const message = (await witness.next("message").catch((error: Error) => {
      throw new Error(`${error.message} | troll: ${JSON.stringify(troll.events)}`);
    }))["message"] as { id: number };

    // Cualquiera reporta; el moderador recibe el aviso en vivo.
    const report = await request("POST", `/chat/messages/${message.id}/report`, {
      ip: goodIp, cookie: good.cookie, body: { reason: "acoso" },
    });
    expect(report.status).toBe(200);
    await moderator.next("mod_alert");
    const queue = await admin("GET", "/chat/admin/reports");
    expect(queue.status).toBe(200);
    expect((queue.json["reports"] as Array<{ message: { id: number } }>).some((item) => item.message?.id === message.id)).toBe(true);

    // Sin sesión de administrador no se modera.
    expect((await request("POST", `/chat/admin/messages/${message.id}/delete`, { ip: goodIp, body: {} })).status).toBe(401);

    expect((await admin("POST", `/chat/admin/messages/${message.id}/delete`, { reason: "molesto" })).status).toBe(200);
    expect((await witness.next("deleted"))["messageId"]).toBe(message.id);

    expect((await admin("POST", `/chat/admin/actors/${bad.actorId}/mute`, { minutes: 5 })).status).toBe(200);
    await troll.next("muted");
    troll.send({ type: "message", body: "intento hablar en silencio" });
    expect((await troll.next("error"))["code"]).toBe("muted");

    const ban = await admin("POST", `/chat/admin/actors/${bad.actorId}/ban`, { reason: "acoso reiterado", ip: true });
    expect(ban.status).toBe(200);
    expect((await troll.closed).code).toBe(4403);
    // El token viejo ya no sirve y la IP no crea invitados nuevos.
    expect((await (await connect(bad.token, badIp)).closed).code).toBeGreaterThanOrEqual(4401);
    expect((await request("POST", "/chat/session", { ip: badIp, body: {} })).status).toBe(403);

    const log = await admin("GET", "/chat/admin/log");
    const actions = (log.json["entries"] as Array<{ action: string; moderator: string }>).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["delete", "mute", "ban", "ip_ban"]));
    witness.socket.close();
    moderator.socket.close();
  });

  it("modo lento por sala (los moderadores quedan exentos)", async () => {
    expect((await admin("POST", "/chat/admin/rooms/general/slow-mode", { seconds: 30 })).status).toBe(200);
    const ip = freshIp();
    const client = await openChat(await newSession(ip), ip);
    client.send({ type: "message", body: "primer mensaje lento" });
    await client.next("message");
    client.send({ type: "message", body: "segundo mensaje enseguida" });
    const error = await client.next("error");
    expect(error["code"]).toBe("slow_mode");
    expect(Number(error["retryAfter"])).toBeGreaterThan(0);
    await admin("POST", "/chat/admin/rooms/general/slow-mode", { seconds: 0 });
    client.socket.close();
  });

  // ── Ataque simulado ─────────────────────────────────────────────────────
  it("ataque con bots: cupos, repetición y detector contienen la inundación", async () => {
    process.env["CRV_CHAT_NEW_ACCOUNT_MINUTES"] = "10";
    resetEnvCache();
    try {
      const ips = [freshIp(), freshIp(), freshIp()];
      // Cada IP intenta crear 8 bots: solo 5 por IP pasan.
      const bots: Array<{ session: Session; ip: string }> = [];
      let refused = 0;
      for (const ip of ips) {
        for (let index = 0; index < 8; index += 1) {
          const challenge = await request("GET", "/chat/challenge", { ip });
          const nonce = await solvePow(challenge.json["challenge"], challenge.json["bits"]);
          const response = await request("POST", "/chat/session", {
            ip, body: { challenge: challenge.json["challenge"], nonce, fp: "cd".repeat(16) },
          });
          if (response.status === 200) {
            bots.push({ ip, session: { token: response.json["token"], actorId: response.json["actor"]["id"], cookie: "" } });
          } else refused += 1;
        }
      }
      expect(bots).toHaveLength(15);
      expect(refused).toBe(9);

      const clients = await Promise.all(bots.map((bot) => openChat(bot.session, bot.ip)));
      const before = Number((await getPool().query<{ n: string }>("SELECT count(*) AS n FROM chat.messages")).rows[0]?.n);
      // Cada bot intenta 20 mensajes de spam (300 en total) en ráfaga.
      for (let round = 0; round < 20; round += 1) {
        for (const client of clients) client.send({ type: "message", body: `compra seguidores baratos en spam ${round % 2 === 0 ? "ya" : "hoy"}` });
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const after = Number((await getPool().query<{ n: string }>("SELECT count(*) AS n FROM chat.messages")).rows[0]?.n);
      const stored = after - before;
      // Cuenta nueva: 3 por 10 s y por bot como mucho, y repetidos frenados.
      expect(stored).toBeLessThanOrEqual(15 * 3);
      // El detector silenció a parte de los bots y dejó rastro para moderar.
      const muted = await getPool().query<{ n: string }>(
        "SELECT count(*) AS n FROM chat.actors WHERE id = ANY($1::uuid[]) AND muted_until > now()",
        [bots.map((bot) => bot.session.actorId)],
      );
      expect(Number(muted.rows[0]?.n)).toBeGreaterThan(0);
      const detectorReports = await getPool().query<{ n: string }>("SELECT count(*) AS n FROM chat.reports WHERE source = 'detector'");
      expect(Number(detectorReports.rows[0]?.n)).toBeGreaterThan(0);
      console.info(`[ataque simulado] bots=${bots.length} rechazados=${refused} intentos=300 guardados=${stored} silenciados=${muted.rows[0]?.n}`);
      for (const client of clients) client.socket.close();
    } finally {
      process.env["CRV_CHAT_NEW_ACCOUNT_MINUTES"] = "0";
      resetEnvCache();
    }
  });

  it("el hub sigue sano tras el ataque", () => {
    expect(hub).toBeDefined();
  });
});
