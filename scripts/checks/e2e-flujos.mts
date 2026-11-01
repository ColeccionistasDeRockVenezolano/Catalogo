// CRV · Flujos de punta a punta y matriz de roles (aceptación de Fases 1 y 2).
//
// Contra la API de STAGING (:3130 → :8082) y la base crv_staging. Recorre los
// cinco flujos con datos propios y los deja limpios al terminar:
//
//   A. candidatura → aceptación → activación → login
//   B. invitación → registro → aprobación → login
//   C. colaborador cambia el estado de su tarea y se ve en la portada pública
//   D. revocación: la cuenta pierde el acceso y su login falla
//   E. matriz de roles admin/community/curator/colaborador por API
//
// Uso (con la API de staging levantada):
//   CRV_ENV_FILE=$HOME/apps/crv-staging/staging.env \
//     ./scripts/with-node22.sh ./node_modules/.bin/tsx scripts/checks/e2e-flujos.mts
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getPool, closeDb } from "../../src/db/client.js";
import { prepararFixtures, limpiarFixtures } from "./lib/fixtures.mjs";
import { ipDePrueba } from "./lib/sesion.mjs";

const BASE = "http://127.0.0.1:3130";
const OUT = path.join(os.homedir(), "crv-staging/reports/independencia/e2e-flujos");
const sufijo = Date.now().toString(36).slice(-5);
const IP_PRUEBA = ipDePrueba("e2e-flujos");

const report = { cuando: new Date().toISOString(), ok: [] as string[], fallos: [] as string[], datos: {} as Record<string, unknown> };
const ok = (nombre: string, extra?: unknown) => report.ok.push(extra === undefined ? nombre : `${nombre} (${String(extra)})`);
const fallo = (nombre: string, detalle: unknown) => report.fallos.push(`${nombre}: ${String(detalle)}`);

interface Cliente { cookie: string; csrf: string }

async function peticion(cliente: Partial<Cliente>, method: string, ruta: string, body?: unknown): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { accept: "application/json", "x-forwarded-for": IP_PRUEBA };
  if (cliente.cookie) headers["cookie"] = cliente.cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && cliente.csrf) headers["x-crv-csrf"] = cliente.csrf;
  const respuesta = await fetch(`${BASE}/crv/api${ruta}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const texto = await respuesta.text();
  const json: any = (() => {
    try { return texto ? JSON.parse(texto) : null; }
    catch { return { crudo: texto.slice(0, 200) }; }
  })();
  return { status: respuesta.status, json };
}

async function entrar(usuario: string, clave: string): Promise<Cliente & { rol?: string; user?: any }> {
  const respuesta = await fetch(`${BASE}/crv/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": IP_PRUEBA },
    body: JSON.stringify({ username: usuario, password: clave }),
  });
  const cookie = (respuesta.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const me = await fetch(`${BASE}/crv/api/auth/me`, { headers: { cookie, "x-forwarded-for": IP_PRUEBA } });
  const cuerpo = me.ok ? await me.json() as any : null;
  return { cookie, csrf: cuerpo?.csrf ?? "", rol: cuerpo?.user?.role, user: cuerpo?.user };
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const pool = getPool();
  const { rows: db } = await pool.query<{ datname: string }>("SELECT current_database() AS datname");
  if (!(db[0]?.datname ?? "").includes("staging")) throw new Error(`No es staging: ${db[0]?.datname}`);
  // Las cuentas de rol se crean aquí y se retiran al final: el guion no depende
  // de que alguien las haya dejado preparadas ni de reiniciar la API.
  prepararFixtures();
  const { rows: proyectos } = await pool.query<{ id: number }>("SELECT id FROM auth.projects ORDER BY id LIMIT 1");
  const proyecto = proyectos[0]!.id;

  const admin = await entrar("fase1-admin", "Fase1Admin2026");
  if (admin.rol !== "admin") throw new Error("sin sesión de administración");

  // ---------------------------------------------------------------- A. candidatura
  const correo = `e2e-${sufijo}@example.com`;
  const alta = await peticion({}, "POST", "/community/applications", {
    firstName: "E2E", lastName: `Candidatura ${sufijo}`, email: correo,
    city: "Caracas", country: "Venezuela", experience: "Prueba automática de punta a punta.",
    contactPreference: "email", availability: "Fines de semana",
  });
  if (alta.status === 200 || alta.status === 201) ok("candidatura enviada", alta.status);
  else fallo("candidatura", `${alta.status} ${JSON.stringify(alta.json).slice(0, 160)}`);

  const bandeja = await peticion(admin, "GET", "/community/admin/applications?status=new");
  const solicitud = (bandeja.json?.data ?? []).find((fila: any) => fila.email === correo);
  if (solicitud) ok("la candidatura aparece en la bandeja", solicitud.id);
  else fallo("bandeja", JSON.stringify(bandeja.json).slice(0, 200));

  let userId: number | null = null;
  if (solicitud) {
    const aceptada = await peticion(admin, "POST", `/community/admin/applications/${solicitud.id}/accept`, {});
    const token = aceptada.json?.activationToken ?? "";
    userId = aceptada.json?.userId ?? null;
    const nombreCuenta = `e2e-${sufijo}`;
    if ((aceptada.status === 200 || aceptada.status === 201) && token) ok("candidatura aceptada con enlace de activación", `user ${userId}`);
    else fallo("aceptación", `${aceptada.status} ${JSON.stringify(aceptada.json).slice(0, 160)}`);

    const info = await peticion({}, "GET", `/community/activate/${encodeURIComponent(token)}`);
    if (info.status === 200 && info.json?.valid) ok("el enlace de activación es válido", info.json?.name);
    else fallo("enlace de activación", `${info.status}`);

    const activada = await peticion({}, "POST", "/community/activate", {
      token, name: nombreCuenta, accessCode: "ClaveE2E2026x",
    });
    if (activada.status === 200) ok("cuenta activada"); else fallo("activación", `${activada.status} ${JSON.stringify(activada.json).slice(0, 140)}`);

    const sesion = await entrar(nombreCuenta, "ClaveE2E2026x");
    if (sesion.rol && sesion.cookie) ok("login del colaborador activado", sesion.rol);
    else fallo("login del colaborador", JSON.stringify(sesion).slice(0, 140));

    // ------------------------------------------------- C. estado de su propia tarea
    const { rows: etapas } = await pool.query<{ id: number }>("SELECT id FROM auth.categories ORDER BY sort_order LIMIT 1");
    const creada = await peticion(admin, "POST", "/community/admin/roadmap/tasks", {
      categoryId: etapas[0]!.id, title: `E2E tarea ${sufijo}`, status: "pending", assignedUserIds: [userId],
    });
    const tarea = (creada.json?.roadmap?.categories ?? [])
      .flatMap((categoria: any) => categoria.tasks).find((fila: any) => fila.title === `E2E tarea ${sufijo}`);
    if (tarea) ok("tarea asignada al colaborador", tarea.id); else fallo("tarea asignada", JSON.stringify(creada.json).slice(0, 160));

    if (tarea) {
      const cambio = await peticion(sesion, "PATCH", `/roadmap/tasks/${tarea.id}/status`, { status: "completed" });
      if (cambio.status === 200) ok("el colaborador cambia el estado de su tarea"); else fallo("cambio de estado", `${cambio.status} ${JSON.stringify(cambio.json).slice(0, 140)}`);
      const publico = await fetch(`${BASE}/crv/api/roadmap`);
      const html = await publico.text();
      if (html.includes(`E2E tarea ${sufijo}`)) ok("la actividad completada se ve en la portada pública");
      else fallo("portada pública", "la actividad no aparece");

      // ---------------------------------------------- D. revocación del acceso
      const revocada = await peticion(admin, "POST", `/community/admin/collaborators/${userId}/revoke`);
      if (revocada.status === 204) ok("revocación aceptada"); else fallo("revocación", revocada.status);
      const trasRevocar = await entrar(nombreCuenta, "ClaveE2E2026x");
      if (!trasRevocar.cookie || trasRevocar.rol === undefined) ok("tras revocar, el login falla");
      else fallo("login tras revocar", `sigue entrando como ${trasRevocar.rol}`);
      const sesionViva = await fetch(`${BASE}/crv/api/auth/me`, { headers: { cookie: sesion.cookie } });
      if (sesionViva.status === 401) ok("la sesión anterior queda invalidada"); else fallo("sesión tras revocar", sesionViva.status);

      const borrarTarea = await peticion(admin, "DELETE", `/community/admin/roadmap/tasks/${tarea.id}`);
      if (borrarTarea.status === 204) ok("tarea de prueba retirada"); else fallo("limpieza de tarea", borrarTarea.status);
    }
  }

  // ---------------------------------------------------------------- B. invitación
  const invitacion = await peticion(admin, "POST", "/community/admin/invites");
  const tokenInvitacion = invitacion.json?.token ?? "";
  if ((invitacion.status === 200 || invitacion.status === 201) && tokenInvitacion) ok("enlace de registro generado"); else fallo("invitación", invitacion.status);

  const nombreInv = `e2e-inv-${sufijo}`;
  const registro = await peticion({}, "POST", "/community/register", {
    token: tokenInvitacion, name: nombreInv, firstName: "E2E", lastName: `Invitación ${sufijo}`, accessCode: "ClaveInv2026xx",
  });
  if (registro.status === 200) ok("registro por invitación"); else fallo("registro", `${registro.status} ${JSON.stringify(registro.json).slice(0, 140)}`);

  const pendientes = await peticion(admin, "GET", "/community/admin/collaborators?status=pending");
  const pendiente = (pendientes.json?.data ?? []).find((fila: any) => fila.name === nombreInv);
  if (pendiente) ok("la cuenta queda pendiente de aprobación", pendiente.id); else fallo("pendiente", JSON.stringify(pendientes.json).slice(0, 160));

  const usuarioInvitado: number | null = pendiente?.id ?? null;
  let sesionInvitado: (Cliente & { rol?: string }) | null = null;
  if (pendiente) {
    const aprobada = await peticion(admin, "PATCH", `/community/admin/collaborators/${pendiente.id}`, { status: "approved" });
    if (aprobada.status === 200) ok("aprobación de la cuenta"); else fallo("aprobación", aprobada.status);
    const sesionInv = await entrar(nombreInv, "ClaveInv2026xx");
    sesionInvitado = sesionInv;
    if (sesionInv.cookie) ok("login tras la aprobación", sesionInv.rol ?? "reader"); else fallo("login invitado", "sin sesión");
    if (sesionInv.cookie) {
      const propio = await peticion(sesionInv, "GET", "/account/profile");
      if (propio.status === 200) ok("el colaborador lee su propio perfil"); else fallo("perfil propio", propio.status);
    }
  }

  // ------------------------------------------------------------ E. matriz de roles
  const community = await entrar("fase1-community", "Fase1Community2026");
  const curator = await entrar("fase1-curator", "Fase1Curator2026");
  const rutas: Array<{ ruta: string; esperado: Record<string, number> }> = [
    { ruta: "/community/admin/roadmap", esperado: { admin: 200, community: 200, curator: 403, colaborador: 403 } },
    { ruta: "/community/admin/metrics?days=7", esperado: { admin: 200, community: 200, curator: 403, colaborador: 403 } },
    { ruta: "/community/admin/collaborators", esperado: { admin: 200, community: 200, curator: 403, colaborador: 403 } },
    { ruta: "/curation/emotions/tags", esperado: { admin: 200, community: 403, curator: 200, colaborador: 403 } },
    { ruta: "/account/profile", esperado: { admin: 200, community: 200, curator: 200, colaborador: 200 } },
  ];
  // El colaborador es la cuenta aprobada del flujo B, con su propia sesión.
  const sesiones: Record<string, Partial<Cliente>> = {
    admin, community, curator,
    colaborador: sesionInvitado ?? {},
  };
  report.datos["matriz"] = {};
  for (const caso of rutas) {
    const fila: Record<string, number> = {};
    for (const rol of ["admin", "community", "curator", "colaborador"] as const) {
      const sesion = sesiones[rol]!;
      const respuesta = await peticion(sesion, "GET", caso.ruta);
      fila[rol] = respuesta.status;
      if (respuesta.status === caso.esperado[rol]) ok(`matriz ${caso.ruta} · ${rol}`, respuesta.status);
      else fallo(`matriz ${caso.ruta} · ${rol}`, `esperaba ${caso.esperado[rol]}, dio ${respuesta.status}`);
    }
    (report.datos["matriz"] as Record<string, unknown>)[caso.ruta] = fila;
  }

  // Sin sesión: las rutas privadas no se sirven.
  for (const ruta of ["/community/admin/roadmap", "/community/admin/metrics", "/account/profile", "/curation/emotions/tags"]) {
    const respuesta = await peticion({}, "GET", ruta);
    if (respuesta.status === 401 || respuesta.status === 403) ok(`sin sesión ${ruta}`, respuesta.status);
    else fallo(`sin sesión ${ruta}`, respuesta.status);
  }

  // ---------------------------------------------------------------- limpieza
  if (usuarioInvitado) {
    const quitar = await peticion(admin, "DELETE", `/community/admin/collaborators/${usuarioInvitado}`);
    if (quitar.status === 204) ok("cuenta invitada retirada"); else fallo("limpieza invitado", quitar.status);
  }
  if (userId) {
    const quitar = await peticion(admin, "DELETE", `/community/admin/collaborators/${userId}`);
    if (quitar.status === 204) ok("cuenta de la candidatura retirada"); else fallo("limpieza candidatura", quitar.status);
  }
  // Personas y candidaturas huérfanas de esta corrida (y de corridas cortadas):
  // el nombre completo se compara junto porque la aceptación guarda
  // «E2E Candidatura <sufijo>» en `first_name`, sin apellido.
  await pool.query("DELETE FROM auth.applications WHERE email LIKE 'e2e-%@example.com'");
  await pool.query(
    `DELETE FROM auth.people p
      WHERE (p.first_name || ' ' || coalesce(p.last_name, '')) LIKE 'E2E %'
        AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.person_id = p.id)`);
  await pool.query("DELETE FROM auth.sessions WHERE lower(payload->>'username') LIKE 'e2e-%'");
  await pool.query("DELETE FROM auth.users WHERE lower(name::text) LIKE 'e2e-%'");
  limpiarFixtures();

  const { rows: resto } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM auth.users WHERE lower(name::text) LIKE $1", [`e2e-%${sufijo}%`]);
  if ((resto[0]?.n ?? 0) <= 1) ok("sin cuentas de prueba (la revocada se conserva)", resto[0]?.n);
  else fallo("limpieza", `${resto[0]?.n} cuentas e2e`);
  report.datos["proyecto"] = proyecto;
}

main()
  .then(async () => {
    report.datos["resumen"] = { comprobaciones: report.ok.length + report.fallos.length, ok: report.ok.length, fallos: report.fallos.length };
    await writeFile(path.join(OUT, "informe.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.datos["resumen"]));
    for (const linea of report.fallos) console.log("FALLO:", linea);
    for (const linea of report.ok) console.log("OK:", linea);
    await closeDb();
    process.exitCode = report.fallos.length === 0 ? 0 : 1;
  })
  .catch(async (error) => {
    console.error(error);
    await writeFile(path.join(OUT, "informe.json"), JSON.stringify({ ...report, error: String(error) }, null, 2));
    await closeDb();
    process.exitCode = 1;
  });
