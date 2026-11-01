// CRV · C5 · Revisión de Claude: permisos de lectura de la ventana 3.4,
// edición parcial del perfil, cambio de usuario y borrado de cuenta.
//
// Levanta un PostgreSQL desechable, aplica el esquema de cuentas (0112 + la
// migración pendiente 0124, que habilita los roles curator/community) y usa la
// app real de comunidad con el guardián de auth.ts. Sin datos de staging.
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPgContainer, type PgContainer } from "../support/pg-container.js";
import { closeDb, getPool } from "../../src/db/client.js";
import { getEnv, resetEnvCache } from "../../src/config/env.js";
import { registerOperatorAuth } from "../../src/api/auth.js";
import { registerCommunityRoutes } from "../../src/api/routes/community.js";
import { toApiError } from "../../src/api/http-errors.js";
import { hashAccessCode } from "../../src/api/community/validation.js";

const PASSWORD = "ClavePruebaC5";
const passwordHash = hashAccessCode(PASSWORD);

describe("comunidad · ficha de persona, usuario y borrado de cuenta (C5)", () => {
  let container: PgContainer;
  let app: FastifyInstance;
  let project = 0;
  let adminCookie = "";
  let adminCsrf = "";
  let communityCookie = "";
  let communityCsrf = "";
  let uAdmin = 0;
  let uLink = 0;
  let uCollab = 0;
  let pCollab = 0;
  let pLink = 0;

  const pool = () => getPool();

  async function person(firstName: string, lastName: string): Promise<number> {
    const { rows } = await pool().query<{ id: number }>(
      "INSERT INTO auth.people (first_name, last_name) VALUES ($1, $2) RETURNING id", [firstName, lastName]);
    return rows[0]!.id;
  }

  async function user(name: string, personId: number): Promise<number> {
    const { rows } = await pool().query<{ id: number }>(
      `INSERT INTO auth.users (person_id, project_id, name, first_name, last_name, access_code_hash, status)
       VALUES ($1, $2, $3, 'Persona', 'C5', $4, 'approved') RETURNING id`, [personId, project, name, passwordHash]);
    return rows[0]!.id;
  }

  async function admin(username: string, role: "admin" | "community", userId: number | null): Promise<number> {
    const { rows } = await pool().query<{ id: number }>(
      `INSERT INTO auth.admins (username, password_hash, role, project_id, user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`, [username, passwordHash, role, project, userId]);
    return rows[0]!.id;
  }

  async function login(username: string): Promise<{ cookie: string; csrf: string }> {
    const response = await app.inject({
      method: "POST", url: "/auth/login", payload: { username, password: PASSWORD },
    });
    expect(response.statusCode, `login ${username}`).toBe(200);
    return {
      cookie: String(response.headers["set-cookie"]).split(";", 1)[0]!,
      csrf: (response.json() as { csrf: string }).csrf,
    };
  }

  const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
  const write = (method: "PATCH" | "DELETE" | "POST", url: string, session: { cookie: string; csrf: string }, payload?: unknown) =>
    app.inject({
      method, url, headers: { cookie: session.cookie, "x-crv-csrf": session.csrf },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  beforeAll(async () => {
    container = await startPgContainer();
    process.env["DATABASE_URL"] = container.databaseUrl;
    process.env["CRV_AUTH_BACKEND"] = "postgres";
    process.env["CRV_HERRA_PROJECT_SLUG"] = "crv-c5-persona-test";
    delete process.env["CRV_COLLABORATORS_JSON"];
    delete process.env["CRV_OPERATOR_TOKEN"];
    resetEnvCache();
    await pool().query(readFileSync("migrations/0112_unified_auth.up.sql", "utf8"));
    await pool().query(readFileSync("migrations/pending/0124_community_roles.up.sql", "utf8"));
    const created = await pool().query<{ id: number }>(
      "INSERT INTO auth.projects (slug, name) VALUES ($1, 'CRV C5') RETURNING id", [getEnv().CRV_HERRA_PROJECT_SLUG]);
    project = created.rows[0]!.id;

    pCollab = await person("Colabora", "C5");
    await pool().query(
      `UPDATE auth.people SET birth_date = '1990-05-04', whatsapp_phone = '+584141234567',
              email = 'colab@ejemplo.test', city = 'Maracaibo', country = 'Venezuela',
              bio = 'Biografía que el editor no toca', experience = 'Diez años de radio',
              availability = 'Tardes'
        WHERE id = $1`, [pCollab]);
    pLink = await person("Cuenta", "Vinculada");
    uAdmin = await user("jefa-c5", await person("Jefa", "Admin"));
    uLink = await user("vinc-admin", pLink);
    uCollab = await user("colab-c5", pCollab);
    await admin("jefa-c5", "admin", uAdmin);
    await admin("comu-c5", "community", null);
    await admin("admin-vinculado", "admin", uLink);

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const api = toApiError(error);
      if (api) void reply.code(api.statusCode).send({ error: { code: api.code, message: api.message } });
      else void reply.send(error);
    });
    await registerOperatorAuth(app);
    await registerCommunityRoutes(app);

    const adminSession = await login("jefa-c5");
    adminCookie = adminSession.cookie;
    adminCsrf = adminSession.csrf;
    const communitySession = await login("comu-c5");
    communityCookie = communitySession.cookie;
    communityCsrf = communitySession.csrf;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await closeDb();
    delete process.env["CRV_HERRA_PROJECT_SLUG"];
    resetEnvCache();
    await container?.stop();
  }, 60_000);

  it("a) la ficha de una cuenta vinculada a un administrador no la lee community", async () => {
    // La cuenta vinculada expone datos personales: community recibe 403 y el
    // admin sí la lee. Lo mismo en el detalle y en la lista.
    const persona = await get(`/community/admin/collaborators/${uLink}/person`, communityCookie);
    expect(persona.statusCode).toBe(403);
    expect(persona.json()).toMatchObject({ error: { code: "linked_admin" } });

    expect((await get(`/community/admin/collaborators/${uLink}`, communityCookie)).statusCode).toBe(403);

    const detalleAdmin = await get(`/community/admin/collaborators/${uLink}/person`, adminCookie);
    expect(detalleAdmin.statusCode).toBe(200);
    expect(detalleAdmin.json()).toMatchObject({ user_id: uLink, first_name: "Cuenta" });

    // La lista de community no incluye la cuenta que no puede gestionar.
    const listaCommunity = await get("/community/admin/collaborators", communityCookie);
    expect(listaCommunity.statusCode).toBe(200);
    const idsCommunity = (listaCommunity.json() as { data: Array<{ id: number }> }).data.map((row) => row.id);
    expect(idsCommunity).not.toContain(uLink);
    expect(idsCommunity).toContain(uCollab);

    const listaAdmin = await get("/community/admin/collaborators", adminCookie);
    const filaVinculada = (listaAdmin.json() as { data: Array<{ id: number; linked_admin: boolean }> }).data
      .find((row) => row.id === uLink);
    expect(filaVinculada?.linked_admin).toBe(true);

    // Generar un enlace de activación es una escritura privilegiada: también
    // se bloquea para las cuentas ligadas a un administrador.
    expect((await write("POST", `/community/admin/collaborators/${uLink}/activation`, {
      cookie: communityCookie, csrf: communityCsrf,
    })).statusCode).toBe(403);

    // Una cuenta normal sigue abierta para community (no se rompió la ventana).
    expect((await get(`/community/admin/collaborators/${uCollab}/person`, communityCookie)).statusCode).toBe(200);
  });

  it("b) el perfil conserva lo omitido y limpia con \"\" o null", async () => {
    // Omitido: solo cambia el nombre; el resto de la ficha intacta.
    const parcial = await write("PATCH", `/community/admin/collaborators/${uCollab}/person`, {
      cookie: adminCookie, csrf: adminCsrf,
    }, { firstName: "Colaboradora" });
    expect(parcial.statusCode).toBe(200);
    expect(parcial.json()).toMatchObject({
      first_name: "Colaboradora", last_name: "C5", city: "Maracaibo", country: "Venezuela",
      email: "colab@ejemplo.test", experience: "Diez años de radio", availability: "Tardes",
      birth_date: "1990-05-04", whatsapp_phone: "+584141234567",
    });

    // El nombre y apellido también se reflejan en la cuenta del proyecto.
    const cuenta = await get(`/community/admin/collaborators/${uCollab}`, adminCookie);
    expect(cuenta.json()).toMatchObject({ first_name: "Colaboradora" });

    // Cuerpo vacío: no borra nada.
    const vacio = await write("PATCH", `/community/admin/collaborators/${uCollab}/person`, {
      cookie: adminCookie, csrf: adminCsrf,
    }, {});
    expect(vacio.statusCode).toBe(200);
    expect(vacio.json()).toMatchObject({ city: "Maracaibo", email: "colab@ejemplo.test" });

    // "" limpia y null limpia; el resto se conserva.
    const limpiado = await write("PATCH", `/community/admin/collaborators/${uCollab}/person`, {
      cookie: adminCookie, csrf: adminCsrf,
    }, { city: "", email: null, availability: "   " });
    expect(limpiado.statusCode).toBe(200);
    expect(limpiado.json()).toMatchObject({
      city: null, email: null, availability: null,
      country: "Venezuela", experience: "Diez años de radio", birth_date: "1990-05-04",
    });

    // La ventana manda siempre el formulario completo: al vaciar un campo
    // envía "" y la API lo limpia (antes lo omitía y el dato seguía guardado).
    const formulario = await write("PATCH", `/community/admin/collaborators/${uCollab}/person`, {
      cookie: adminCookie, csrf: adminCsrf,
    }, {
      firstName: "Colaboradora", lastName: "C5", birthDate: "1990-05-04",
      whatsappPhone: "+584141234567", email: "", city: "Caracas", country: "Venezuela",
      experience: "", availability: "",
    });
    expect(formulario.statusCode).toBe(200);
    expect(formulario.json()).toMatchObject({
      city: "Caracas", email: null, experience: null, availability: null, last_name: "C5",
    });

    // `bio` no está en el editor: nunca se toca.
    const { rows } = await pool().query<{ bio: string }>("SELECT bio FROM auth.people WHERE id = $1", [pCollab]);
    expect(rows[0]?.bio).toBe("Biografía que el editor no toca");
  });

  it("b) rechaza los datos inválidos sin tocar el perfil", async () => {
    const casos: Array<[Record<string, unknown>, string]> = [
      [{ birthDate: "1990-02-31" }, "invalid_birth_date"],
      [{ email: "sin-arroba" }, "invalid_email"],
      [{ whatsappPhone: "abc" }, "invalid_phone"],
      [{ firstName: "   " }, "invalid_first_name"],
    ];
    for (const [body, code] of casos) {
      const response = await write("PATCH", `/community/admin/collaborators/${uCollab}/person`, {
        cookie: adminCookie, csrf: adminCsrf,
      }, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ error: { code } });
    }
    const actual = await get(`/community/admin/collaborators/${uCollab}/person`, adminCookie);
    expect(actual.json()).toMatchObject({ first_name: "Colaboradora", city: "Caracas", birth_date: "1990-05-04" });
  });

  it("c) cambiar el usuario: duplicado, de admin, inválido y sesiones fuera", async () => {
    // Dos sesiones abiertas de la misma cuenta.
    const primera = await login("colab-c5");
    const segunda = await login("colab-c5");
    expect((await get("/auth/me", primera.cookie)).statusCode).toBe(200);

    // Una sesión persistida en la base (la que usa el chat) también se borra.
    await pool().query(
      `INSERT INTO auth.sessions (audience, token_hash, payload, expires_at)
       VALUES ('crv', 'c5-sesion-colab',
               jsonb_build_object('herra', jsonb_build_object('kind', 'user', 'id', $1::int)), now() + interval '1 day')`,
      [uCollab]);

    const duplicado = await write("PATCH", `/community/admin/collaborators/${uCollab}/username`, {
      cookie: adminCookie, csrf: adminCsrf,
    }, { username: "vinc-admin" });
    expect(duplicado.statusCode).toBe(409);
    expect(duplicado.json()).toMatchObject({ error: { code: "username_taken" } });

    const deAdmin = await write("PATCH", `/community/admin/collaborators/${uCollab}/username`, {
      cookie: adminCookie, csrf: adminCsrf,
    }, { username: "jefa-c5" });
    expect(deAdmin.statusCode).toBe(409);
    expect(deAdmin.json()).toMatchObject({ error: { code: "username_taken" } });

    const invalido = await write("PATCH", `/community/admin/collaborators/${uCollab}/username`, {
      cookie: adminCookie, csrf: adminCsrf,
    }, { username: "no vale" });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json()).toMatchObject({ error: { code: "invalid_name" } });

    const antes = await pool().query<{ session_version: number }>(
      "SELECT session_version FROM auth.users WHERE id = $1", [uCollab]);

    const cambiado = await write("PATCH", `/community/admin/collaborators/${uCollab}/username`, {
      cookie: adminCookie, csrf: adminCsrf,
    }, { username: "colab-c5-nuevo" });
    expect(cambiado.statusCode).toBe(200);
    expect(cambiado.json()).toMatchObject({ name: "colab-c5-nuevo", id: uCollab });

    const despues = await pool().query<{ session_version: number }>(
      "SELECT session_version FROM auth.users WHERE id = $1", [uCollab]);
    expect(despues.rows[0]!.session_version).toBe(antes.rows[0]!.session_version + 1);

    // Las dos sesiones en memoria quedan revocadas en la siguiente petición.
    expect((await get("/auth/me", primera.cookie)).statusCode).toBe(401);
    expect((await get("/auth/me", segunda.cookie)).statusCode).toBe(401);
    const persistidas = await pool().query("SELECT 1 FROM auth.sessions WHERE token_hash = 'c5-sesion-colab'");
    expect(persistidas.rows).toHaveLength(0);
  });

  it("c) borrar: la cuenta vinculada a un admin responde 403 incluso al admin", async () => {
    const comoCommunity = await write("DELETE", `/community/admin/collaborators/${uLink}`, {
      cookie: communityCookie, csrf: communityCsrf,
    });
    expect(comoCommunity.statusCode).toBe(403);
    expect(comoCommunity.json()).toMatchObject({ error: { code: "linked_admin" } });

    const comoAdmin = await write("DELETE", `/community/admin/collaborators/${uLink}`, {
      cookie: adminCookie, csrf: adminCsrf,
    });
    expect(comoAdmin.statusCode).toBe(403);
    expect(comoAdmin.json()).toMatchObject({ error: { code: "linked_admin" } });

    const sigue = await get(`/community/admin/collaborators/${uLink}`, adminCookie);
    expect(sigue.statusCode).toBe(200);
    const vinculo = await pool().query("SELECT 1 FROM auth.admins WHERE user_id = $1", [uLink]);
    expect(vinculo.rows).toHaveLength(1);
    expect(pLink).toBeGreaterThan(0);
  });

  it("c) borrar: sale de las tareas y la candidatura queda sin cuenta", async () => {
    const etapa = await pool().query<{ id: number }>(
      `INSERT INTO auth.categories (project_id, slug, title, sort_order, color_key)
       VALUES ($1, 'c5-etapa', 'C5 etapa', 1, 'rock') RETURNING id`, [project]);
    const categoryId = etapa.rows[0]!.id;
    const asignada = await pool().query<{ id: number }>(
      `INSERT INTO auth.tasks (project_id, category_id, title, status, sort_order, assigned_user_id)
       VALUES ($1, $2, 'Actividad con responsable', 'pending', 1, $3) RETURNING id`, [project, categoryId, uCollab]);
    const compartida = await pool().query<{ id: number }>(
      `INSERT INTO auth.tasks (project_id, category_id, title, status, sort_order)
       VALUES ($1, $2, 'Actividad compartida', 'pending', 2) RETURNING id`, [project, categoryId]);
    await pool().query("INSERT INTO auth.task_assignees (task_id, user_id) VALUES ($1, $2)",
      [compartida.rows[0]!.id, uCollab]);
    const candidatura = await pool().query<{ id: number }>(
      `INSERT INTO auth.applications (project_id, user_id, first_name, status)
       VALUES ($1, $2, 'Postulante', 'accepted') RETURNING id`, [project, uCollab]);

    // Lo que el diálogo de «Quitar» avisa: cuántas tareas pierde.
    const fila = await get(`/community/admin/collaborators/${uCollab}`, adminCookie);
    expect(fila.json()).toMatchObject({ tasks: 2, linked_admin: false });

    const borrado = await write("DELETE", `/community/admin/collaborators/${uCollab}`, {
      cookie: adminCookie, csrf: adminCsrf,
    });
    expect(borrado.statusCode).toBe(204);

    expect((await get(`/community/admin/collaborators/${uCollab}`, adminCookie)).statusCode).toBe(404);
    const tareas = await pool().query<{ assigned_user_id: number | null }>(
      "SELECT assigned_user_id FROM auth.tasks WHERE id = $1", [asignada.rows[0]!.id]);
    expect(tareas.rows[0]!.assigned_user_id).toBeNull();
    const asignados = await pool().query("SELECT 1 FROM auth.task_assignees WHERE user_id = $1", [uCollab]);
    expect(asignados.rows).toHaveLength(0);
    const aplicacion = await pool().query<{ user_id: number | null }>(
      "SELECT user_id FROM auth.applications WHERE id = $1", [candidatura.rows[0]!.id]);
    expect(aplicacion.rows[0]!.user_id).toBeNull();
    // La persona global se conserva.
    const persona = await pool().query("SELECT 1 FROM auth.people WHERE id = $1", [pCollab]);
    expect(persona.rows).toHaveLength(1);
  });
});
