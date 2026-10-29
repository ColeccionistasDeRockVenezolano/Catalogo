// CRV · Contrato del chat contra PostgreSQL real.
//
// Comprueba lo que no puede probar un test unitario: que el libro mayor no
// duplique monedas, que el inventario caduque, que el equipado exija posesión
// y que los mensajes sobrevivan con su autor.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { applyCore } from "../support/apply-core.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { migrateUp } from "../../src/db/migrate.js";
import {
  buyEffect, createGuestActor, effectsFor, equipEffect, equippedFor, grantCoins,
  insertMessage, listMessages, roomBySlug, syncEffectCatalog, walletFor,
  auditWallets, dailyCover, retainMessages, upsertEffect,
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
    expect(await effectsFor(NOBODY)).toEqual([]);
    // Datos exclusivos de prueba para validar compras sin repoblar la tienda real.
    for (const [code, kind, price] of [
      ["neon", "name", 240], ["vinilo", "name", 320], ["oro", "name", 400],
      ["escenario", "background", 700], ["fuente-test", "name_font", 120],
    ] as const) {
      await upsertEffect({ code, name: code, kind, description: "Fixture de prueba",
        manifest: {}, priceCoins: price, priceCredits: price / 10,
        durationDays: 30, enabled: true, sort: 0 });
    }
    await syncEffectCatalog();
  }, 240_000);

  afterAll(async () => {
    await closeDb();
    await container.stop();
  }, 60_000);

  it("sincroniza el catálogo de efectos y lo sirve sin dueño", async () => {
    const effects = await effectsFor(NOBODY);
    expect(effects).toHaveLength(5);
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
    expect(await equippedFor(actor.id)).toEqual({ name: "neon", frame: null, background: null, ambient: null, name_font: null, badge: null });
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

  it("una misma clave compra para dos actores y conserva el recibo aun sin saldo", async () => {
    const a = await createGuestActor("Recibo Uno");
    const b = await createGuestActor("Recibo Dos");
    const key = "clave-compartida";
    const [first, other] = await Promise.all([
      buyEffect({ actorId: a.id, code: "neon", idempotencyKey: key }),
      buyEffect({ actorId: b.id, code: "neon", idempotencyKey: key }),
    ]);
    expect(other.wallet).toEqual(first.wallet);
    await buyEffect({ actorId: a.id, code: "oro", idempotencyKey: "resto" });
    const again = await buyEffect({ actorId: a.id, code: "neon", idempotencyKey: key });
    expect(again.rentedUntil).toBe(first.rentedUntil);
    await expect(buyEffect({ actorId: a.id, code: "vinilo", idempotencyKey: key }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("las compras gratuitas son idempotentes sin movimientos de cero", async () => {
    await upsertEffect({ code: "gratis-test", name: "Gratis", kind: "name", description: "", manifest: {},
      priceCoins: 0, priceCredits: 0, durationDays: 30, sort: 1, enabled: true });
    const actor = await createGuestActor("Gratis");
    const input = { actorId: actor.id, code: "gratis-test", idempotencyKey: "gratis" };
    const [first, second] = await Promise.all([buyEffect(input), buyEffect(input)]);
    expect(first).toEqual(second);
    expect(first.wallet.coins).toBe(900);
    expect((await getPool().query("SELECT 1 FROM chat.ledger WHERE actor_id = $1 AND reason = 'purchase'", [actor.id])).rowCount).toBe(0);
    await expect(grantCoins({ actorId: actor.id, coins: 1, credits: 0, idempotencyKey: "gratis" }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("no cobra dos veces un permanente con claves distintas y renueva desde el vencimiento", async () => {
    await upsertEffect({ code: "permanente-test", name: "Permanente", kind: "name", description: "", manifest: {},
      priceCoins: 100, priceCredits: 0, durationDays: null, sort: 1, enabled: true });
    const actor = await createGuestActor("Permanente");
    const [first, second] = await Promise.all([
      buyEffect({ actorId: actor.id, code: "permanente-test", idempotencyKey: "uno" }),
      buyEffect({ actorId: actor.id, code: "permanente-test", idempotencyKey: "dos" }),
    ]);
    expect(first.wallet.coins).toBe(800);
    expect(second.wallet.coins).toBe(800);
    const rent = await buyEffect({ actorId: actor.id, code: "neon", idempotencyKey: "alquiler" });
    const renewed = await buyEffect({ actorId: actor.id, code: "neon", idempotencyKey: "renovado" });
    expect(Date.parse(renewed.rentedUntil!) - Date.parse(rent.rentedUntil!)).toBe(30 * 86400_000);
    expect((await getPool().query("SELECT qty FROM chat.effect_inventory WHERE actor_id = $1", [actor.id])).rows.every((row) => row.qty === 1)).toBe(true);
  });

  it("las fuentes se equipan y los alquileres vencidos desaparecen también del historial", async () => {
    const actor = await createGuestActor("Tipografia");
    const font = (await effectsFor(actor.id)).find((effect) => effect.kind === "name_font")!;
    await buyEffect({ actorId: actor.id, code: font.code, idempotencyKey: "fuente" });
    await equipEffect({ actorId: actor.id, code: font.code, slot: "name_font" });
    expect((await equippedFor(actor.id)).name_font).toBe(font.code);
    const room = (await roomBySlug("general"))!;
    const message = await insertMessage({ actorId: actor.id, roomId: room.id, body: "fuente vencida" });
    await getPool().query("UPDATE chat.effect_inventory SET expires_at = now() - interval '1 second' WHERE actor_id = $1", [actor.id]);
    expect((await equippedFor(actor.id)).name_font).toBeNull();
    expect((await effectsFor(actor.id)).find((effect) => effect.code === font.code)).toMatchObject({ owned: false, equipped: false });
    expect((await listMessages(room.id, 100)).find((item) => item.id === message.id)?.equipped?.name_font).toBeNull();
  });

  it("leer un monedero no escribe y una discrepancia aborta el movimiento", async () => {
    const actor = await createGuestActor("Auditoria");
    const before = (await getPool().query("SELECT xmin::text AS version FROM chat.accounts WHERE actor_id = $1", [actor.id])).rows[0];
    await walletFor(actor.id);
    expect((await getPool().query("SELECT xmin::text AS version FROM chat.accounts WHERE actor_id = $1", [actor.id])).rows[0]).toEqual(before);
    await getPool().query("UPDATE chat.accounts SET coins = coins + 1 WHERE actor_id = $1", [actor.id]);
    expect(await auditWallets()).toContain(actor.id);
    await expect(grantCoins({ actorId: actor.id, coins: 10, credits: 0, idempotencyKey: "descuadrado" }))
      .rejects.toMatchObject({ code: "wallet_mismatch" });
    expect((await walletFor(actor.id)).coins).toBe(901);
    expect((await getPool().query("SELECT 1 FROM chat.ledger WHERE actor_id = $1 AND idempotency_key = 'descuadrado'", [actor.id])).rowCount).toBe(0);
    await getPool().query("UPDATE chat.accounts SET coins = coins - 1 WHERE actor_id = $1", [actor.id]);
    expect(await auditWallets()).toEqual([]);
  });

  it("los grants comparten clave solo entre actores y rechazan reutilizarla para otro importe", async () => {
    const a = await createGuestActor("Abono Uno"); const b = await createGuestActor("Abono Dos");
    for (const actor of [a, b]) expect((await grantCoins({ actorId: actor.id, coins: 5, credits: 2, idempotencyKey: "misma" })).coins).toBe(905);
    await expect(grantCoins({ actorId: a.id, coins: 6, credits: 2, idempotencyKey: "misma" }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("pagina el historial sin solapamientos y retiene solo mensajes antiguos sin reportes abiertos", async () => {
    const room = (await roomBySlug("general"))!;
    const actor = await createGuestActor("Retencion");
    const old = await insertMessage({ actorId: actor.id, roomId: room.id, body: "viejo" });
    const review = await insertMessage({ actorId: actor.id, roomId: room.id, body: "revisar" });
    const recent = await insertMessage({ actorId: actor.id, roomId: room.id, body: "reciente" });
    const page = await listMessages(room.id, 2);
    expect(page.map((item) => item.id)).toEqual([review.id, recent.id]);
    expect((await listMessages(room.id, 1, review.id)).map((item) => item.id)).toEqual([old.id]);
    await getPool().query("UPDATE chat.messages SET created_at = now() - interval '91 days' WHERE id = ANY($1::bigint[])", [[old.id, review.id]]);
    await getPool().query("INSERT INTO chat.reports (source, message_id, reason) VALUES ('ai', $1, 'revisión pendiente')", [review.id]);
    expect(await retainMessages(90)).toBe(1);
    expect((await getPool().query("SELECT id FROM chat.messages WHERE id = ANY($1::bigint[]) ORDER BY id", [[old.id, review.id, recent.id]])).rows.map((row) => Number(row.id))).toEqual([review.id, recent.id]);
  });

  it("conserva la portada del ciclo si cambia el catálogo", async () => {
    const pool = getPool();
    const artist = (await pool.query("INSERT INTO artists (name) VALUES ('Artista portada') RETURNING id")).rows[0];
    await pool.query("INSERT INTO albums (artist_id, title, cover_url) VALUES ($1, 'Portada fija', '/cover-one.jpg')", [artist.id]);
    const first = await dailyCover("2026-10-28");
    expect(first?.dailyCycle.timeZone).toBe("America/Caracas");
    await pool.query("INSERT INTO albums (artist_id, title, cover_url) VALUES ($1, 'Nuevo', '/cover-two.jpg')", [artist.id]);
    await pool.query("UPDATE albums SET title = 'Editado' WHERE id = $1", [first?.albumId]);
    expect(await dailyCover("2026-10-28")).toEqual(first);
    expect((await dailyCover("2026-10-29"))?.dailyCycle.date).toBe("2026-10-29");
  });
  it("compra y equipa una placa sin cambiar el efecto ni el estilo del nombre", async () => {
    const actor = await createGuestActor("Placa");
    await upsertEffect({ code: "placa-test", name: "Placa de prueba", kind: "badge", description: "",
      manifest: { version: 1, triggers: ["always"], layers: [], cost: 1,
        badge: { imageUrl: "/media/placa.webp", animated: false } },
      priceCoins: 10, priceCredits: 1, durationDays: 30, enabled: true, sort: 0 });
    await buyEffect({ actorId: actor.id, code: "neon", idempotencyKey: "efecto" });
    await buyEffect({ actorId: actor.id, code: "fuente-test", idempotencyKey: "estilo" });
    await buyEffect({ actorId: actor.id, code: "placa-test", idempotencyKey: "placa" });
    await equipEffect({ actorId: actor.id, slot: "name", code: "neon" });
    await equipEffect({ actorId: actor.id, slot: "name_font", code: "fuente-test" });
    expect(await equipEffect({ actorId: actor.id, slot: "badge", code: "placa-test" }))
      .toMatchObject({ name: "neon", name_font: "fuente-test", badge: "placa-test" });
    await expect(equipEffect({ actorId: actor.id, slot: "name", code: "placa-test" }))
      .rejects.toMatchObject({ code: "wrong_slot" });
    expect(await equipEffect({ actorId: actor.id, slot: "badge", code: null }))
      .toMatchObject({ name: "neon", name_font: "fuente-test", badge: null });
  });

  it("guarda estilos editables y precios, permite ocultarlos y recuperarlos para editar", async () => {
    const product = {
      code: "editor-contract", name: "Estilo editable", kind: "name", description: "Prueba del editor",
      manifest: { version: 1, layers: [], triggers: ["always"], cost: 2,
        nameStyle: { rotation: 37, gradientAngle: 271, motionAngle: 123 } },
      priceCoins: 275, priceCredits: 12, durationDays: null, enabled: false, sort: 99,
    };
    await upsertEffect(product);
    expect((await effectsFor(NOBODY)).some((item) => item.code === product.code)).toBe(false);
    expect((await effectsFor(NOBODY, true)).find((item) => item.code === product.code)).toMatchObject({
      enabled: false, priceCoins: 275, priceCredits: 12, manifest: product.manifest,
    });
    await upsertEffect({ ...product, enabled: true, priceCoins: 175 });
    const actor = await createGuestActor("Editor de prueba");
    const purchase = await buyEffect({ actorId: actor.id, code: product.code, idempotencyKey: "editor-price-contract" });
    expect(purchase.wallet.coins).toBe(725);
    expect((await effectsFor(actor.id)).find((item) => item.code === product.code)).toMatchObject({
      priceCoins: 175, priceCredits: 12, durationDays: null, owned: true,
    });
  });

});
