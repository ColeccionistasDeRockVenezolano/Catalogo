import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { getEnv } from "../src/config/env.js";
import { closeDb, getPool } from "../src/db/client.js";

assert.equal(getEnv().CRV_AUTH_BACKEND,"postgres");
const username = `verificacion.${randomBytes(8).toString("hex")}`;
const password = randomBytes(32).toString("base64url");
const salt = randomBytes(16);
const key = scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
const hash = `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
const pool = getPool();
const checks: string[] = [];
async function request(base: string, route: string, options: { cookie?: string; body?: object; csrf?: string } = {}) {
  const response = await fetch(base+route,{headers:{origin:new URL(base).origin,
    ...(options.cookie ? {cookie:options.cookie} : {}),...(options.csrf ? {"x-crv-csrf":options.csrf} : {}),
    ...(options.body ? {"content-type":"application/json"} : {})},
    ...(options.body ? {method:"POST",body:JSON.stringify(options.body)} : {}),signal:AbortSignal.timeout(10000)});
  const text = await response.text();
  return { status:response.status, cookie:response.headers.getSetCookie()[0]?.split(";",1)[0],
    body:text ? JSON.parse(text) as { user?: { role: string }; csrf?: string } : undefined };
}

try {
  await pool.query("INSERT INTO auth.local_accounts (username,name,password_hash,role) VALUES ($1,'Verificación temporal',$2,'reader')",[username,hash]);
  const api = "http://127.0.0.1:8080";
  const chat = "http://127.0.0.1:8081";
  const cotejo = "http://127.0.0.1:4310";
  const logged = await request(api,"/auth/login",{body:{username,password}});
  assert.equal(logged.status,200,"login del catálogo");
  assert.equal(logged.body?.user?.role,"reader");
  assert.ok(logged.cookie);
  const cookie = logged.cookie;
  assert.equal((await request(chat,"/auth/me",{cookie})).status,200,"otro proceso reconoce la misma sesión PostgreSQL");
  assert.equal((await request(api,"/review-queue",{cookie})).status,403,"el lector no obtiene permisos de curaduría");
  checks.push("login de lector y sesión compartida entre API y chat; rol restringido");
  const mesa = await request(cotejo,"/api/auth/login",{body:{username,password}});
  assert.equal(mesa.status,200,"login de la Mesa con la misma cuenta");
  assert.ok(mesa.cookie);
  assert.equal((await request(cotejo,"/api/auth/me",{cookie:mesa.cookie})).status,200);
  const sessions = await pool.query("SELECT audience FROM auth.sessions WHERE payload->>'username'=$1 ORDER BY audience",[username]);
  assert.deepEqual(sessions.rows.map(row=>row["audience"]),["cotejo","crv"]);
  checks.push("cuenta común en la Mesa y dos sesiones persistidas con audiencias separadas");
  assert.ok(logged.body?.csrf);
  assert.equal((await request(api,"/auth/logout",{cookie,csrf:logged.body.csrf,body:{}})).status,204);
  assert.equal((await request(chat,"/auth/me",{cookie})).status,401,"logout revocado entre procesos");
  assert.equal((await request(cotejo,"/api/auth/logout",{cookie:mesa.cookie,body:{}})).status,204);
  assert.equal((await request(cotejo,"/api/auth/me",{cookie:mesa.cookie})).status,401);
  checks.push("logout de lector y revocación en API, chat y Mesa");
  console.log(JSON.stringify({ok:true,at:new Date().toISOString(),checks},null,2));
} finally {
  await pool.query("DELETE FROM auth.sessions WHERE payload->>'username'=$1",[username]);
  await pool.query("DELETE FROM auth.local_accounts WHERE username=$1",[username]);
  await closeDb();
}
