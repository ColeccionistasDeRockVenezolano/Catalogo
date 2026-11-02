// CRV · Reemisión de invitaciones y activaciones de comunidad (CLI).
//
// La 2B no publica /curaduria en el dominio y la API del catálogo (:8080) tiene
// la comunidad apagada: no hay panel desde el que reemitir los enlaces que
// quedaron vivos en Herra. Este guion habla directamente con la base, con las
// mismas funciones que usa la API (hash SHA-256, TTL y revocación incluidas).
//
// Reglas de seguridad:
//   - exige CRV_ENV_FILE explícito (nunca el .env por defecto);
//   - exige --expect-db y comprueba current_database() antes de escribir;
//   - imprimir el token es el objetivo, pero solo por stdout.
//
// Uso:
//   CRV_ENV_FILE=$HOME/apps/crv-staging/staging.env \
//     tsx scripts/community-tokens.ts --expect-db crv_staging --list
//
//   ... --expect-db crv_staging --reissue-invite --base http://127.0.0.1:3141
//   ... --expect-db crv_staging --reissue-activation 12 --base http://127.0.0.1:3141

const args = process.argv.slice(2);
const has = (name: string): boolean => args.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const next = args[index + 1];
  return next && !next.startsWith("--") ? next : undefined;
};

function die(message: string, code = 1): never {
  console.error(`community-tokens: ${message}`);
  process.exit(code);
}

const envFile = process.env["CRV_ENV_FILE"];
if (!envFile) die("falta CRV_ENV_FILE explícito; no se usa el .env del repo por defecto", 2);
const expectedDb = value("expect-db");
if (!expectedDb) die("falta --expect-db (crv_staging en ensayo, crv en producción)", 2);
const base = (value("base") ?? "").replace(/\/+$/u, "");
const action = has("reissue-invite") ? "invite" : has("reissue-activation") ? "activation" : "list";
const activationUser = Number(value("reissue-activation") ?? "");
if (action === "activation" && (!Number.isInteger(activationUser) || activationUser <= 0)) {
  die("--reissue-activation necesita un id de usuario", 2);
}
if (action !== "list" && !base) die("--base es obligatorio para emitir enlaces", 2);

const { getPool, closeDb } = await import("../src/db/client.js");
const { projectId } = await import("../src/api/community/store.js");
const { createActivation, createInvite, listActivations, listInvites } = await import("../src/api/community/tokens.js");

try {
  const { rows } = await getPool().query<{ db: string }>("SELECT current_database() AS db");
  const db = rows[0]?.db ?? "";
  if (db !== expectedDb) die(`la base es «${db}», no «${expectedDb}»; no se escribe`, 3);
  const project = await projectId();

  if (action === "list") {
    const [invites, activations] = await Promise.all([listInvites(project), listActivations(project)]);
    console.log(`base ${db} · proyecto ${project}`);
    console.log(`invitaciones vivas: ${invites.length}`);
    for (const row of invites) {
      console.log(`  id=${row.id} expires_at=${row.expires_at} usos=${row.use_count} creada_por=${row.created_by}`);
    }
    console.log(`activaciones pendientes: ${activations.length}`);
    for (const row of activations) {
      const nombre = [row.first_name, row.last_name].filter(Boolean).join(" ") || row.name;
      console.log(`  id=${row.id} user_id=${row.user_id} ${nombre} expires_at=${row.expires_at}`);
    }
    process.exitCode = 0;
  } else if (action === "invite") {
    const { token, expiresAt } = await createInvite(project, "cli-2b");
    console.log(`invitación creada (expira ${expiresAt})`);
    console.log(`${base}/registro?token=${encodeURIComponent(token)}`);
    process.exitCode = 0;
  } else {
    const { token, expiresAt } = await createActivation(project, activationUser, "cli-2b");
    console.log(`activación creada para user_id=${activationUser} (expira ${expiresAt}); las anteriores quedaron revocadas`);
    console.log(`${base}/activar?token=${encodeURIComponent(token)}`);
    process.exitCode = 0;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  die(message);
} finally {
  await closeDb();
}
