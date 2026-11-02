// CRV · Una persona, una clave. Solo contra staging: crea cuentas de prueba en
// `crv_staging`, comprueba cada camino que escribe una clave y las borra al final.
//
//   node scripts/checks/clave-unica.mjs            # contra :3141
//
// Caminos: «Mi perfil» desde las dos puertas, restablecer desde el panel,
// activación, y la guarda que impide a `community` tocar a un administrador.
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";

// Directo a la API de staging: `/account/password` no está en la lista blanca de la portada.
const BASE = "http://127.0.0.1:8082";
const PREFIJO = `pruebaclave${Date.now().toString(36)}`;
const fallos = [];
let aciertos = 0;
const comprobar = (nombre, condicion, detalle = "") => {
  if (condicion) { aciertos += 1; console.log(`ok    ${nombre}`); }
  else { fallos.push(nombre); console.log(`FALLO ${nombre} ${detalle}`); }
};

const sql = (consulta) => execFileSync("docker", ["exec", "-i", "crv-postgres-staging", "psql", "-U", "crv", "-d", "crv_staging", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: consulta, encoding: "utf8" }).trim();
const hash = (clave) => {
  const sal = randomBytes(16);
  return `scrypt$16384$8$1$${sal.toString("hex")}$${scryptSync(clave, sal, 64, { N: 16384, r: 8, p: 1 }).toString("hex")}`;
};
const texto = (valor) => `'${String(valor).replaceAll("'", "''")}'`;

class Sesion {
  cookie = ""; csrf = "";
  async pedir(metodo, ruta, cuerpo) {
    const respuesta = await fetch(`${BASE}${ruta.replace(/^\/api/u, "")}`, {
      method: metodo, redirect: "manual",
      headers: { accept: "application/json", origin: BASE, ...(cuerpo ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.csrf ? { "x-crv-csrf": this.csrf } : {}) },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    });
    const galleta = respuesta.headers.get("set-cookie");
    if (galleta) this.cookie = galleta.split(";")[0];
    const contenido = await respuesta.text();
    let json = null;
    try { json = JSON.parse(contenido); } catch { /* sin cuerpo */ }
    return { status: respuesta.status, json };
  }
  async entrar(usuario, clave) {
    this.cookie = ""; this.csrf = "";
    const r = await this.pedir("POST", "/api/auth/login", { username: usuario, password: clave });
    if (r.json?.csrf) this.csrf = r.json.csrf;
    return r;
  }
}
const entra = async (usuario, clave) => (await new Sesion().entrar(usuario, clave)).status;

const proyecto = sql("SELECT id FROM auth.projects ORDER BY id LIMIT 1;");
const auditoriaInicial = sql("SELECT coalesce(max(id),0) FROM auth.audit_log;");
const creadas = [];
function persona(sufijo, claveUsuario, claveAdmin, rol = "admin") {
  const nombre = `${PREFIJO}${sufijo}`;
  const u = sql(`WITH p AS (INSERT INTO auth.people (first_name,last_name) VALUES ('Clave',${texto(sufijo)}) RETURNING id)
    INSERT INTO auth.users (person_id,project_id,name,first_name,last_name,access_code_hash,status,signup_source)
    SELECT id,${proyecto},${texto(nombre)},'Clave',${texto(sufijo)},${texto(hash(claveUsuario))},'approved','admin' FROM p RETURNING id;`).split("\n")[0];
  const a = claveAdmin ? sql(`INSERT INTO auth.admins (username,password_hash,role,project_id,user_id,session_version)
    VALUES (${texto(nombre)},${texto(hash(claveAdmin))},${texto(rol)},${proyecto},${u},1) RETURNING id;`).split("\n")[0] : null;
  creadas.push({ nombre, u });
  return { nombre, u, a };
}
const hashes = (p) => sql(`SELECT u.access_code_hash, a.password_hash FROM auth.users u JOIN auth.admins a ON a.user_id=u.id WHERE u.id=${p.u};`).split("|");
const unica = (p) => { const [x, y] = hashes(p); return Boolean(x) && x === y; };

const A = "ClaveUsuario1234", B = "ClaveAdmin5678", C = "ClaveNueva9012", D = "ClaveOtra3456", E = "ClaveFinal7890";
try {
  // 1. Dos claves distintas, cambio desde la puerta de colaborador, usando la otra como actual.
  const p1 = persona("a", A, B);
  comprobar("partida: dos claves distintas", !unica(p1));
  comprobar("partida: entra con la de colaborador", await entra(p1.nombre, A) === 200);
  comprobar("partida: entra con la de administración", await entra(p1.nombre, B) === 200);
  const colaborador = new Sesion(); await colaborador.entrar(p1.nombre, A);
  const otra = new Sesion(); await otra.entrar(p1.nombre, B);
  const mala = await colaborador.pedir("POST", "/api/account/password", { currentAccessCode: "NoEsLaClave000", newAccessCode: C, newAccessCodeConfirm: C });
  comprobar("clave actual incorrecta: 400", mala.status === 400);
  comprobar("clave actual incorrecta: no unifica nada", !unica(p1));
  const cambio = await colaborador.pedir("POST", "/api/account/password", { currentAccessCode: B, newAccessCode: C, newAccessCodeConfirm: C });
  comprobar("cambio con la otra clave como actual: 200", cambio.status === 200, JSON.stringify(cambio.json));
  comprobar("queda una sola clave", unica(p1));
  comprobar("la sesión que cambió sigue activa", (await colaborador.pedir("GET", "/api/auth/me")).status === 200);
  comprobar("la otra sesión queda fuera", (await otra.pedir("GET", "/api/auth/me")).status === 401);
  comprobar("clave vieja de colaborador rechazada", await entra(p1.nombre, A) === 401);
  comprobar("clave vieja de administración rechazada", await entra(p1.nombre, B) === 401);
  comprobar("la nueva entra", await entra(p1.nombre, C) === 200);
  comprobar("la nueva conserva el rol admin", (await new Sesion().entrar(p1.nombre, C)).json?.user?.role === "admin");

  // 2. Desde la puerta de administración, por «Mi perfil» y por la ventana del panel.
  const p2 = persona("b", B, A);
  const adminSesion = new Sesion();
  // La cuenta admin va primero en el login: con esta clave la sesión es de administración.
  await adminSesion.entrar(p2.nombre, A);
  const perfil = await adminSesion.pedir("POST", "/api/account/save", { firstName: "Clave", lastName: "b", currentAccessCode: A, newAccessCode: C, newAccessCodeConfirm: C });
  comprobar("/account/save desde administración", perfil.status === 200, JSON.stringify(perfil.json));
  comprobar("/account/save deja una sola clave", unica(p2));
  comprobar("la sesión de administración sigue activa", (await adminSesion.pedir("GET", "/api/auth/me")).status === 200);
  const ventana = await adminSesion.pedir("POST", "/api/community/admin/panel/account/password", { currentPassword: C, newPassword: D });
  comprobar("ventana «Mi clave» del panel", ventana.status === 200, JSON.stringify(ventana.json));
  comprobar("la ventana deja una sola clave", unica(p2));
  comprobar("entra con la de la ventana", await entra(p2.nombre, D) === 200);

  // 3. Restablecer desde el panel una cuenta con administración vinculada.
  const p3 = persona("c", A, B);
  const reset = await adminSesion.pedir("PATCH", `/api/community/admin/panel/users/${p3.u}`, { accessCode: C });
  comprobar("restablecer desde el panel", reset.status === 200, JSON.stringify(reset.json));
  comprobar("restablecer deja una sola clave", unica(p3));
  comprobar("restablecer: la clave de administración vieja no entra", await entra(p3.nombre, B) === 401);

  // 4. Activación de una cuenta con administración vinculada.
  const p4 = persona("d", A, B);
  const token = randomBytes(32).toString("base64url");
  sql(`INSERT INTO auth.activation_tokens (project_id,user_id,token_hash,created_by,expires_at) VALUES (${proyecto},${p4.u},'${createHash("sha256").update(token).digest("hex")}','prueba',to_char(timezone('UTC',now())+interval '1 day','YYYY-MM-DD HH24:MI:SS'));`);
  sql(`UPDATE auth.admins SET username=${texto(`${p4.nombre}adm`)} WHERE user_id=${p4.u};`);
  const activar = await new Sesion().pedir("POST", "/api/community/activate", { token, name: `${p4.nombre}x`, accessCode: E });
  comprobar("activación", activar.status === 200, JSON.stringify(activar.json));
  comprobar("activación deja una sola clave", unica(p4));

  // 5. `community` no puede tocar a un administrador; sí a un colaborador normal.
  const p5 = persona("e", A, B, "community");
  const victima = persona("f", A, B);
  const normal = persona("g", A, null);
  const comunidad = new Sesion(); await comunidad.entrar(p5.nombre, B);
  const antes = hashes(victima).join();
  for (const [metodo, ruta, cuerpo] of [
    ["PATCH", `/api/community/admin/panel/users/${victima.u}`, { accessCode: C }],
    ["POST", `/api/community/admin/panel/users/${victima.u}/activation`, {}],
    ["PATCH", `/api/community/admin/panel/users/${victima.u}/reject`, {}],
    ["DELETE", `/api/community/admin/panel/users/${victima.u}`, undefined],
  ]) {
    const r = await comunidad.pedir(metodo, ruta, cuerpo);
    comprobar(`community contra administrador ${metodo} ${ruta.replace(String(victima.u), ":id")}: 403`, r.status === 403 && /vinculada a un administrador/u.test(r.json?.error ?? ""), JSON.stringify(r.json));
  }
  comprobar("la cuenta del administrador sigue igual", hashes(victima).join() === antes);
  const permitido = await comunidad.pedir("PATCH", `/api/community/admin/panel/users/${normal.u}`, { accessCode: C });
  comprobar("community sí restablece a un colaborador normal", permitido.status === 200, JSON.stringify(permitido.json));
} finally {
  // La auditoría se escribe al terminar cada respuesta: se espera a la última.
  await new Promise((resolver) => { setTimeout(resolver, 1000); });
  const ids = creadas.map((p) => p.u).join(",");
  if (ids) sql(`DELETE FROM auth.sessions WHERE payload->>'username' LIKE '${PREFIJO}%';
    DELETE FROM auth.audit_log WHERE id > ${auditoriaInicial};
    DELETE FROM auth.activation_tokens WHERE user_id IN (${ids});
    DELETE FROM auth.admins WHERE user_id IN (${ids});
    WITH borradas AS (DELETE FROM auth.users WHERE id IN (${ids}) RETURNING person_id)
    DELETE FROM auth.people WHERE id IN (SELECT person_id FROM borradas);`);
  const quedan = sql(`SELECT count(*) FROM auth.users WHERE name::text LIKE '${PREFIJO}%';`);
  comprobar("staging limpio", quedan === "0", quedan);
}
console.log(`\n${aciertos} bien, ${fallos.length} mal`);
process.exit(fallos.length ? 1 : 0);
