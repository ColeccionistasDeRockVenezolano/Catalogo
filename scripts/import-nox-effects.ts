/** Nueva colección NOX; no toca efectos existentes, posesiones ni saldos.
 * npm exec -- tsx scripts/import-nox-effects.ts          (revisar)
 * npm exec -- tsx scripts/import-nox-effects.ts --apply  (después de desplegar y migrar)
 */
import { NOX_PRODUCTS } from "../src/chat/nox.js";
import { effectPublicationSchema, effectProductSchema } from "../src/chat/effects-catalog.js";
import { getPool, closeDb } from "../src/db/client.js";
// `--only=nox-bats-name[,otro]` publica solo esos códigos: el resto de la
// colección NOX no se siembra hasta que se pida expresamente.
const only = process.argv.find(argument => argument.startsWith("--only="))?.slice("--only=".length)
  .split(",").map(code => code.trim()).filter(Boolean);
const selected = only ? NOX_PRODUCTS.filter(product => only.includes(product.code)) : NOX_PRODUCTS;
const unknown = only?.filter(code => !NOX_PRODUCTS.some(product => product.code === code)) ?? [];
if (unknown.length) throw new Error(`Códigos desconocidos en --only: ${unknown.join(", ")}`);
const products = selected.map(product => {
  const parsed = effectPublicationSchema.parse({ ...product, enabled: true });
  effectProductSchema.parse(parsed);
  return parsed;
});
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ mode: "preview", products }, null, 2));
} else {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('crv:nox-import'))");
    const migration = await client.query("SELECT 1 FROM ingest.schema_migrations WHERE version = '0116_chat_nox_bubbles'");
    if (!migration.rowCount) throw new Error("Aplica primero 0116_chat_nox_bubbles y despliega los renderers NOX.");
    let inserted = 0;
    for (const p of products) {
      const result = await client.query(`INSERT INTO chat.effects
        (code,name,kind,description,manifest,price_coins,price_credits,duration_days,sort,enabled)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) ON CONFLICT (code) DO NOTHING`,
      [p.code,p.name,p.kind,p.description,JSON.stringify(p.manifest),p.priceCoins,p.priceCredits,p.durationDays,p.sort,p.enabled]);
      inserted += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ inserted, preserved: products.length - inserted }));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await closeDb(); }
}
