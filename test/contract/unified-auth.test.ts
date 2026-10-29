import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { importHerra } from "../../src/db/import-herra.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth } from "../../src/api/auth.js";
import { toApiError } from "../../src/api/http-errors.js";
import { registerCotejoAuth } from "../../src/cotejo/auth.js";

const PASSWORD = "clave-para-la-migracion";
function hash(encoding: "hex" | "base64url" = "hex") {
  const salt = randomBytes(16);
  const key = scryptSync(PASSWORD,salt,64,{N:16384,r:8,p:5,maxmem:64*1024*1024});
  return `scrypt$16384$8$5$${salt.toString(encoding)}$${key.toString(encoding)}`;
}

describe("cuentas unificadas: importación y sesiones PostgreSQL", () => {
  let container: PgContainer;
  let directory: string;
  let source: string;
  let sqlite: DatabaseSync;
  let app: FastifyInstance;
  let cotejo: FastifyInstance;
  const migratedHash = hash();
  const localHash = hash("base64url");

  async function application() {
    const server = Fastify();
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);
    server.setErrorHandler((error,_request,reply) => { const api = toApiError(error); if (api) void reply.code(api.statusCode).send({error:{code:api.code,message:api.message}}); else void reply.send(error); });
    await registerOperatorAuth(server);
    server.post("/edit", async request => ({ operator: request.operator }));
    return server;
  }
  const login = (username: string) => app.inject({ method:"POST",url:"/auth/login",payload:{username,password:PASSWORD} });
  const cookie = (response: Awaited<ReturnType<typeof login>>) => String(response.headers["set-cookie"]).split(";",1)[0]!;

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    process.env["CRV_AUTH_BACKEND"] = "postgres";
    delete process.env["CRV_COLLABORATORS_JSON"];
    delete process.env["CRV_OPERATOR_TOKEN"];
    resetEnvCache();
    await getPool().query(readFileSync("migrations/0112_unified_auth.up.sql","utf8"));
    directory = mkdtempSync(path.join(tmpdir(),"crv-auth-pg-"));
    source = path.join(directory,"herra.db");
    sqlite = new DatabaseSync(source);
    sqlite.exec(readFileSync("test/fixtures/herra/schema.sql","utf8"));
    sqlite.exec("PRAGMA foreign_keys=ON; INSERT INTO projects (id,slug,name) VALUES (1,'coleccionistas-rock-venezolano','CRV'),(2,'ajeno','Ajeno')");
    sqlite.prepare("INSERT INTO users (id,project_id,name,first_name,last_name,status,access_code_hash) VALUES (1,1,'Pedro','Pedro','Pérez','approved',?), (2,1,'Pendiente',NULL,NULL,'pending',?), (3,2,'Ajeno',NULL,NULL,'approved',?)").run(migratedHash,migratedHash,migratedHash);
    sqlite.prepare("INSERT INTO admins (id,username,password_hash,role,project_id) VALUES (1,'Brian',?,'admin',1), (2,'Jefe',?,'superadmin',NULL)").run(migratedHash,migratedHash);
    sqlite.prepare("INSERT INTO admins (id,username,password_hash,role,project_id,user_id) VALUES (3,'vinculado',?,'admin',1,1)").run(migratedHash);
    sqlite.prepare("INSERT INTO project_assets (project_id,kind,mime_type,bytes,byte_size,checksum) VALUES (1,'favicon','image/png',?,4,'sample')").run(Buffer.from([0,1,254,255]));
    // El contador puede estar por encima del mayor id por cuentas eliminadas.
    sqlite.exec("UPDATE sqlite_sequence SET seq=80 WHERE name='users'");
    await importHerra(getPool(),source,[{username:"local",name:"Local",passwordHash:localHash}]);
    app = await application();
  });

  afterAll(async () => {
    await app?.close();
    await cotejo?.close();
    sqlite?.close();
    await closeDb();
    await container?.stop();
    if (directory) rmSync(directory,{recursive:true,force:true});
    process.env["CRV_AUTH_BACKEND"] = "legacy";
    resetEnvCache();
  });

  it("conserva hashes, binarios, secuencias y verifica cada tabla; repetir no sobrescribe",async () => {
    const same = await importHerra(getPool(),source,[{username:"local",name:"Local",passwordHash:localHash}]);
    expect(same.alreadyImported).toBe(true);
    expect((await importHerra(getPool(),source)).alreadyImported).toBe(true);
    expect(same.tables["users"]?.count).toBe(3);
    expect((await getPool().query("SELECT password_hash FROM auth.admins WHERE id=1")).rows[0].password_hash).toBe(migratedHash);
    expect((await getPool().query("SELECT bytes FROM auth.project_assets")).rows[0].bytes).toEqual(Buffer.from([0,1,254,255]));
    expect((await getPool().query("INSERT INTO auth.users (project_id,name) VALUES (1,'Nuevo') RETURNING id")).rows[0].id).toBe(81);
    sqlite.exec("INSERT INTO users (project_id,name) VALUES (1,'Otra')");
    await expect(importHerra(getPool(),source)).rejects.toThrow("ya contiene datos");
    expect((await getPool().query("SELECT count(*)::int n FROM auth.users")).rows[0].n).toBe(4);
  });

  it("mantiene contraseñas, roles y alcance del proyecto",async () => {
    expect((await login("BRIAN")).json().user.role).toBe("admin");
    expect((await login("pedro")).json().user.role).toBe("reader");
    expect((await login("local")).json().user.role).toBe("admin");
    expect((await login("jefe")).json().user.role).toBe("admin");
    expect((await login("pendiente")).statusCode).toBe(401);
    expect((await login("ajeno")).statusCode).toBe(401);
    const reader = await login("pedro");
    expect((await app.inject({method:"POST",url:"/edit",headers:{cookie:cookie(reader),"x-crv-csrf":reader.json().csrf}})).statusCode).toBe(403);
  });

  it("una sesión sobrevive a otra aplicación/pool y logout la revoca",async () => {
    const logged = await login("brian");
    const headers = {cookie:cookie(logged)};
    await app.close();
    await closeDb();
    app = await application();
    expect((await app.inject({url:"/auth/me",headers})).statusCode).toBe(200);
    expect((await app.inject({method:"POST",url:"/edit",headers})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:"/auth/logout",headers:{...headers,"x-crv-csrf":logged.json().csrf}})).statusCode).toBe(204);
    expect((await app.inject({url:"/auth/me",headers})).statusCode).toBe(401);
  });

  it("revoca por cambio de contraseña, rechazo, borrado y rol local",async () => {
    const admin = await login("brian");
    await getPool().query("UPDATE auth.admins SET password_hash=password_hash || 'invalidated' WHERE id=1");
    expect((await app.inject({url:"/auth/me",headers:{cookie:cookie(admin)}})).statusCode).toBe(401);
    await getPool().query("UPDATE auth.admins SET password_hash=$1 WHERE id=1",[migratedHash]);
    const linked = await login("vinculado");
    const reader = await login("pedro");
    await getPool().query("UPDATE auth.users SET status='rejected' WHERE id=1");
    expect((await app.inject({url:"/auth/me",headers:{cookie:cookie(reader)}})).statusCode).toBe(401);
    expect((await app.inject({url:"/auth/me",headers:{cookie:cookie(linked)}})).statusCode).toBe(401);
    expect((await login("vinculado")).statusCode).toBe(401);
    await getPool().query("DELETE FROM auth.users WHERE id=1");
    expect((await getPool().query("SELECT 1 FROM auth.admins WHERE id=3")).rowCount).toBe(0);
    const local = await login("local");
    await getPool().query("UPDATE auth.local_accounts SET role='reader' WHERE username='local'");
    expect((await app.inject({url:"/auth/me",headers:{cookie:cookie(local)}})).statusCode).toBe(401);
    const jefe = await login("jefe");
    await getPool().query("DELETE FROM auth.admins WHERE id=2");
    expect((await app.inject({url:"/auth/me",headers:{cookie:cookie(jefe)}})).statusCode).toBe(401);
  });

  it("la Mesa comparte las cuentas y conserva su sesión entre reinicios",async () => {
    cotejo = Fastify();
    registerCotejoAuth(cotejo);
    await getPool().query("UPDATE auth.local_accounts SET role='admin' WHERE username='local'");
    const local = await cotejo.inject({method:"POST",url:"/api/auth/login",payload:{username:"local",password:PASSWORD}});
    expect(local.json().user.actor).toBe("crv:local");
    const logged = await cotejo.inject({method:"POST",url:"/api/auth/login",payload:{username:"brian",password:PASSWORD}});
    expect(logged.statusCode).toBe(200);
    const headers = {cookie:cookie(logged)};
    await cotejo.close();
    cotejo = Fastify();
    registerCotejoAuth(cotejo);
    expect((await cotejo.inject({url:"/api/auth/me",headers})).statusCode).toBe(200);
    expect((await app.inject({url:"/auth/me",headers})).statusCode).toBe(401);
    await getPool().query("UPDATE auth.admins SET session_version=session_version+1 WHERE id=1");
    expect((await cotejo.inject({url:"/api/auth/me",headers})).statusCode).toBe(401);
  });
});
