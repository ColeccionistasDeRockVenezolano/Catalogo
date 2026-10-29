// Integración real de entradas, acciones y stickers. Base efímera, sin tocar CRV.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { migrateUp } from "../../src/db/migrate.js";
import { resetEnvCache } from "../../src/config/env.js";
import { buildChatApp } from "../../src/chat/app.js";
import { buyEffect, createGuestActor, upsertEffect, type Actor } from "../../src/chat/repository.js";
import { issueChatToken } from "../../src/chat/session.js";
import type { ServerEvent } from "../../src/chat/protocol.js";
import type { ChatHub } from "../../src/chat/realtime.js";

const ORIGIN = "http://escenario.test";

describe("etapa 3: efectos por WebSocket", () => {
  let container: PgContainer;
  let app: FastifyInstance;
  let hub: ChatHub;
  let base = "";
  const sockets = new Set<WebSocket>();

  beforeAll(async () => {
    container = await startPgContainer();
    Object.assign(process.env, {
      DATABASE_URL: container.databaseUrl, CRV_CHAT_SECRET: "secreto-para-el-escenario-de-prueba-de-contrato",
      CRV_CHAT_GUEST_COINS: "5000", CRV_CHAT_NEW_ACCOUNT_MINUTES: "0", CRV_CHAT_AI_MODERATION: "false",
      CRV_ALLOWED_ORIGINS: ORIGIN,
    });
    resetEnvCache(); await applyCore(container.name); await migrateUp();
    // Fixtures locales: el catálogo público permanece vacío.
    for (const [code, kind, type, preset] of [
      ["telon", "entry", "scene", "curtain-scene"],
      ["vinilo-sticker", "sticker", "sprite", "vinyl-face"],
      ["cassette-sticker", "sticker", "sprite", "cassette-face"],
      ["neon", "name", "css", "neon"], ["pogo", "action", "scene", "pogo-scene"],
      ["chidori", "name", "material", "chidori"],
      ["marco-sello-maldito", "frame", "material", "curse-aura"],
      ["mensaje-karma-azul", "message", "material", "karma-aura"],
    ] as const) {
      await upsertEffect({ code, name: code, kind, description: "Fixture",
        manifest: { version: 1, triggers: ["always"], cost: 1, layers: [{ type, preset }] },
        priceCoins: 10, priceCredits: 1, durationDays: 30, enabled: true, sort: 0 });
    }
    ({ app, hub } = await buildChatApp({ logger: false }));
    base = (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http:", "ws:");
  }, 240_000);
  afterEach(async () => {
    await Promise.all([...sockets].map((socket) => new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) { resolve(); return; }
      socket.once("close", () => resolve()); socket.close();
    })));
    sockets.clear();
  });
  afterAll(async () => { await app?.close(); await closeDb(); await container?.stop(); });

  const buy = async (actor: Actor, code: string) => buyEffect({ actorId: actor.id, code, idempotencyKey: randomUUID() });
  function connect(actor: Actor) {
    const socket = new WebSocket(`${base}/chat/ws?t=${issueChatToken(actor.id, actor.tokenVersion)}&room=general`, { origin: ORIGIN });
    sockets.add(socket);
    const events: ServerEvent[] = [];
    const wake = new Set<() => void>();
    socket.on("message", (data) => { events.push(JSON.parse(String(data)) as ServerEvent); for (const run of [...wake]) run(); });
    const next = <T extends ServerEvent["type"]>(type: T): Promise<Extract<ServerEvent, { type: T }>> => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { wake.delete(check); reject(new Error(`No llegó ${type}`)); }, 4000);
      const check = () => {
        const index = events.findIndex((event) => event.type === type);
        if (index < 0) return;
        const [event] = events.splice(index, 1); clearTimeout(timer); wake.delete(check);
        resolve(event as Extract<ServerEvent, { type: T }>);
      };
      wake.add(check); check();
    });
    return { socket, events, next, send: (event: unknown) => socket.send(JSON.stringify(event)) };
  }

  it("envía una entrada a la sala una sola vez y no la guarda en el historial", async () => {
    const observer = connect(await createGuestActor("Visitante")); await observer.next("snapshot");
    const artist = await createGuestActor("Escenario"); await buy(artist, "telon");
    const first = connect(artist); await first.next("snapshot");
    const entry = await observer.next("entry");
    expect(entry).toMatchObject({ actorId: artist.id, effectCode: "telon", displayName: "Escenario" });
    expect((await first.next("entry")).id).toBe(entry.id);
    const second = connect(artist);
    const snapshot = await second.next("snapshot");
    expect(snapshot.messages.every((message) => message.kind !== "system" || !message.body.includes("Escenario"))).toBe(true);
    second.send({ type: "message", body: "Ya estoy en la sala" }); await observer.next("message");
    expect(observer.events.filter((event) => event.type === "entry")).toHaveLength(0);
    expect(second.events.filter((event) => event.type === "entry")).toHaveLength(0);
  });

  it("publica y persiste un sticker propio; un efecto de nombre no se convierte en acción", async () => {
    const actor = await createGuestActor("Coleccionista"); await buy(actor, "vinilo-sticker"); await buy(actor, "neon"); await buy(actor, "pogo");
    const client = connect(actor); await client.next("snapshot");
    client.send({ type: "message", body: "Mi vinilo", effectCode: "vinilo-sticker" });
    expect((await client.next("message")).message).toMatchObject({ kind: "sticker", effectCode: "vinilo-sticker" });
    client.send({ type: "action", code: "neon" }); expect((await client.next("error")).code).toBe("not_owned");
    client.send({ type: "action", code: "pogo" }); expect((await client.next("message")).message).toMatchObject({ kind: "action", effectCode: "pogo" });
    const { rows } = await getPool().query<{ kind: string }>("SELECT kind FROM chat.messages WHERE actor_id = $1 ORDER BY id", [actor.id]);
    expect(rows.map((row) => row.kind)).toEqual(["sticker", "action"]);
  });

  it("sincroniza, compra y equipa materiales nuevos y publica el efecto de mensaje", async () => {
    const actor = await createGuestActor("Materiales");
    for (const code of ["chidori", "marco-sello-maldito", "mensaje-karma-azul"]) await buy(actor, code);
    const client = connect(actor);
    const snapshot = await client.next("snapshot");
    expect(snapshot.effects.find((effect) => effect.code === "chidori")?.manifest).toMatchObject({
      layers: [{ type: "material", preset: "chidori" }],
    });
    for (const [slot, code] of [["name", "chidori"], ["frame", "marco-sello-maldito"]] as const) {
      const response = await app.inject({ method: "POST", url: "/chat/equip", headers: {
        origin: ORIGIN, "x-chat-token": issueChatToken(actor.id, actor.tokenVersion),
      }, payload: { slot, code } });
      expect(response.statusCode).toBe(200);
      expect(await client.next("equipped")).toMatchObject({ equipped: { [slot]: code } });
    }
    client.send({ type: "message", body: "Chakra en el escenario", effectCode: "mensaje-karma-azul" });
    expect((await client.next("message")).message).toMatchObject({
      kind: "chat", effectCode: "mensaje-karma-azul", equipped: { name: "chidori", frame: "marco-sello-maldito" },
    });
  });

  it("no dispara una entrada ni un sticker cuyo alquiler ya caducó", async () => {
    const actor = await createGuestActor("Archivo"); await buy(actor, "telon"); await buy(actor, "cassette-sticker");
    await getPool().query("UPDATE chat.effect_inventory SET expires_at = now() - interval '1 minute' WHERE actor_id = $1", [actor.id]);
    const client = connect(actor); await client.next("snapshot");
    client.send({ type: "message", body: "Cassette de prueba", effectCode: "cassette-sticker" });
    expect((await client.next("message")).message).toMatchObject({ kind: "chat", effectCode: null });
    expect(client.events.filter((event) => event.type === "entry")).toHaveLength(0);
  });

  it("equipar por HTTP avisa a las otras pestañas y la caducidad se propaga en vivo", async () => {
    const actor = await createGuestActor("Equipamiento"); await buy(actor, "neon");
    const one = connect(actor); await one.next("snapshot");
    const two = connect(actor); await two.next("snapshot");
    const observer = connect(await createGuestActor("Observador")); await observer.next("snapshot");
    const response = await app.inject({ method: "POST", url: "/chat/equip", headers: {
      origin: ORIGIN, "x-chat-token": issueChatToken(actor.id, actor.tokenVersion),
    }, payload: { slot: "name", code: "neon" } });
    expect(response.statusCode).toBe(200);
    for (const client of [one, two, observer]) expect(await client.next("equipped")).toMatchObject({ actorId: actor.id, equipped: { name: "neon" } });
    await getPool().query("UPDATE chat.effect_inventory SET expires_at = now() - interval '1 second' WHERE actor_id = $1", [actor.id]);
    await hub.refreshEquipped();
    for (const client of [one, two, observer]) expect(await client.next("equipped")).toMatchObject({ actorId: actor.id, equipped: { name: null } });
    const inventory = await app.inject({ method: "GET", url: "/chat/inventory", headers: { "x-chat-token": issueChatToken(actor.id, actor.tokenVersion) } });
    expect(inventory.json()).toMatchObject({ inventory: [], equipped: { name: null } });
  });
});
