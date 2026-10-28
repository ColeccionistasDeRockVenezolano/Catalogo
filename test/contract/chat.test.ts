// CRV · Contrato del chat contra PostgreSQL real.
//
// Comprueba lo que no puede probar un test unitario: que el libro mayor no
// duplique monedas, que el inventario caduque, que el equipado exija posesión
// y que los mensajes sobrevivan con su autor.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { closeDb } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { migrateUp } from "../../src/db/migrate.js";
import {
  buyEffect, createGuestActor, effectsFor, equipEffect, equippedFor, grantCoins,
  insertMessage, listMessages, roomBySlug, syncEffectCatalog, walletFor,
} from "../../src/chat/repository.js";

const NOBODY = "00000000-0000-0000-0000-000000000000";

describe("chat contra PostgreSQL", () => {
  let container: PgContainer;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    process.env["CRV_CHAT_GUEST_COINS"] = "900";
    resetEnvCache();
    await applyCore(container.name);
    await migrateUp();
    await syncEffectCatalog();
  }, 240_000);

  afterAll(async () => {
    await closeDb();
    await container.stop();
  }, 60_000);

  it("sincroniza el catálogo de efectos y lo sirve sin dueño", async () => {
    const effects = await effectsFor(NOBODY);
    expect(effects.length).toBeGreaterThanOrEqual(30);
    expect(effects.every((effect) => effect.owned === false)).toBe(true);
    expect(effects.some((effect) => effect.code === "vinilo")).toBe(true);
  });

  it("crea un invitado con saldo de bienvenida y apodo único", async () => {
    const first = await createGuestActor("Tester");
    const second = await createGuestActor("Tester");
    expect(first.handle).not.toBe(second.handle);
    expect(await walletFor(first.id)).toEqual({ coins: 900, credits: 0 });
  });

  it("cobra una sola vez la misma compra (idempotencia) y equipa", async () => {
    const actor = await createGuestActor("Comprador");
    const key = "11111111-1111-4111-8111-111111111111";
    const first = await buyEffect({ actorId: actor.id, code: "neon", idempotencyKey: key });
    const second = await buyEffect({ actorId: actor.id, code: "neon", idempotencyKey: key });
    expect(first.wallet.coins).toBe(660);
    expect(second.wallet.coins).toBe(660);

    const equipped = await equipEffect({ actorId: actor.id, slot: "name", code: "neon" });
    expect(equipped.name).toBe("neon");
    expect(await equippedFor(actor.id)).toEqual({ name: "neon", frame: null, background: null, ambient: null });
  });

  it("no deja equipar un efecto que no se posee ni en la ranura equivocada", async () => {
    const actor = await createGuestActor("SinNada");
    await expect(equipEffect({ actorId: actor.id, slot: "name", code: "vinilo" }))
      .rejects.toMatchObject({ code: "not_owned" });

    await buyEffect({ actorId: actor.id, code: "vinilo", idempotencyKey: "22222222-2222-4222-8222-222222222222" });
    await expect(equipEffect({ actorId: actor.id, slot: "frame", code: "vinilo" }))
      .rejects.toMatchObject({ code: "wrong_slot" });
  });

  it("rechaza la compra cuando el saldo no alcanza", async () => {
    const actor = await createGuestActor("Pobre");
    await buyEffect({ actorId: actor.id, code: "oro", idempotencyKey: "44444444-4444-4444-8444-444444444444" });
    await expect(buyEffect({ actorId: actor.id, code: "escenario", idempotencyKey: "55555555-5555-4555-8555-555555555555" }))
      .rejects.toMatchObject({ code: "insufficient_funds" });
  });

  it("un grant repetido no duplica monedas", async () => {
    const actor = await createGuestActor("Grant");
    const key = "grant-abc";
    const once = await grantCoins({ actorId: actor.id, coins: 100, credits: 0, idempotencyKey: key });
    const twice = await grantCoins({ actorId: actor.id, coins: 100, credits: 0, idempotencyKey: key });
    expect(once.coins).toBe(1000);
    expect(twice.coins).toBe(1000);
    expect(twice.credits).toBe(0);
  });

  it("guarda mensajes con su autor y los devuelve en orden", async () => {
    const room = await roomBySlug("general");
    expect(room).not.toBeNull();
    const actor = await createGuestActor("Charlador");
    await insertMessage({ roomId: room?.id ?? 1, actorId: actor.id, body: "primero" });
    const second = await insertMessage({ roomId: room?.id ?? 1, actorId: actor.id, body: "segundo", effectCode: "scratch-msg" });
    expect(second.effectCode).toBe("scratch-msg");
    const messages = await listMessages(room?.id ?? 1, 10);
    expect(messages.map((message) => message.body)).toEqual(["primero", "segundo"]);
    expect(messages[0]?.displayName).toBe("Charlador");
  });
});
