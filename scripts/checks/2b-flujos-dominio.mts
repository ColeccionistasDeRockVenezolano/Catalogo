// CRV · Ensayo 2B · flujos del dominio con la forma de producción (base crv_staging).
//
// Simula lo que llega por Cloudflare: Host, Origin, CF-Connecting-IP y CF-IPCountry
// del dominio contra la portada de ensayo, y administra por el panel del propio dominio (/admin).
// Comprueba además lo que el navegador no ve: fila de auditoría `public`, IP real,
// visita con país y métricas. Lo que crea lo retira al terminar y restaura los
// contadores del día. NUNCA envía POST a /api/radio/*: es la emisión real de Herra.
//
//   CRV_ENV_FILE=$HOME/apps/crv-staging/staging.env ./scripts/with-node22.sh \
//     ./node_modules/.bin/tsx scripts/checks/2b-flujos-dominio.mts \
//     --portada http://127.0.0.1:3150 --metricas
import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeDb, getPool } from "../../src/db/client.js";
import { limpiarFixtures, prepararFixtures } from "./lib/fixtures.mjs";

const args = process.argv.slice(2);
const opcion = (nombre: string, defecto: string): string => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : defecto;
};
const PORTADA = opcion("portada", "http://127.0.0.1:3150");
const PANEL = opcion("panel", PORTADA);
const API_PANEL = "/api/community/admin/panel";
const METRICAS = args.includes("--metricas");
const DOMINIO = "coleccionistasderockvenezolano.com";
const HERRA = "http://127.0.0.1:3020/api/radio/now";
const OUT = path.join(os.homedir(), "crv-staging/reports/2b-rehearsal-2026-11");
const sufijo = Date.now().toString(36).slice(-5);
const IP = "203.0.113.7";

const informe = { cuando: new Date().toISOString(), portada: PORTADA, panel: PANEL, ok: [] as string[], fallos: [] as string[] };
const ok = (n: string, x?: unknown) => { informe.ok.push(x === undefined ? n : `${n} (${String(x)})`); };
const fallo = (n: string, x: unknown) => { informe.fallos.push(`${n}: ${String(x)}`); };
const comprobar = (c: boolean, n: string, x?: unknown) => { if (c) ok(n, x); else fallo(n, x); };

const delDominio = (ip = IP): Record<string, string> => ({
  host: DOMINIO, origin: `https://${DOMINIO}`, "cf-connecting-ip": ip, "cf-ipcountry": "VE",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml", "accept-language": "es-VE,es;q=0.9",
  "sec-fetch-mode": "navigate", "sec-fetch-site": "none",
});

// `fetch` no deja fijar Host; se usa http.request para enviar el del dominio.
function pedir(base: string, ruta: string, opciones: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; texto: string; json: any; setCookie: string[] }> {
  const url = new URL(ruta, base);
  const cuerpo = opciones.body === undefined ? undefined : JSON.stringify(opciones.body);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: opciones.method ?? "GET",
      headers: { ...(opciones.headers ?? {}), ...(cuerpo ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(cuerpo)) } : {}) },
    }, (res) => {
      const trozos: Buffer[] = [];
      res.on("data", (t: Buffer) => trozos.push(t));
      res.on("end", () => {
        const texto = Buffer.concat(trozos).toString();
        let json: any = null;
        try { json = JSON.parse(texto); } catch { /* HTML */ }
        resolve({ status: res.statusCode ?? 0, texto, json, setCookie: res.headers["set-cookie"] ?? [] });
      });
    });
    req.on("error", reject);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

async function entrar(base: string, prefijo: string, usuario: string, clave: string, headers: Record<string, string>) {
  const r = await pedir(base, `${prefijo}/api/auth/login`, { method: "POST", headers, body: { username: usuario, password: clave } });
  const raw = r.setCookie.find((c) => c.startsWith("crv_session=")) ?? "";
  const cookie = raw.split(";")[0] ?? "";
  const me = await pedir(base, `${prefijo}/api/auth/me`, { headers: { ...headers, cookie } });
  return { status: r.status, raw, cookie, csrf: String(me.json?.csrf ?? ""), rol: me.json?.user?.role as string | undefined };
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const pool = getPool();
  const db = (await pool.query<{ d: string }>("SELECT current_database() d")).rows[0]!.d;
  if (!db.includes("staging")) throw new Error(`No es staging: ${db}`);
  prepararFixtures();
  const hoy = (await pool.query<{ d: string }>("SELECT to_char(timezone('America/Caracas', now()), 'YYYY-MM-DD') d")).rows[0]!.d;
  const maxVisita = (await pool.query<{ m: number }>("SELECT coalesce(max(id),0)::int m FROM auth.project_visits")).rows[0]!.m;
  const maxAudit = (await pool.query<{ m: number }>("SELECT coalesce(max(id),0)::int m FROM auth.audit_log")).rows[0]!.m;
  const traficoAntes = (await pool.query("SELECT * FROM auth.traffic_daily WHERE day = $1", [hoy])).rows;
  const visitantesAntes = (await pool.query("SELECT * FROM auth.traffic_visitors WHERE day = $1", [hoy])).rows;

  let userId: number | null = null;
  let tareaId: number | null = null;
  let solicitudId: number | null = null;
  const local = delDominio();
  try {
    // --------------------------------------------------------- radio en la portada
    for (const lang of ["es", "en"]) {
      let html = ""; let vivo: any = null;
      // La copia anónima dura 30 s y el cliente corrige con /api/radio/now: tras un cambio de pista puede ir atrás.
      for (let intento = 0; intento < 9; intento += 1) {
        vivo = await (await fetch(HERRA)).json();
        html = (await pedir(PORTADA, `/?lang=${lang}`, { headers: delDominio() })).texto;
        if (html.includes(vivo.current.videoId)) break;
        await new Promise((r) => setTimeout(r, 5_000));
      }
      comprobar(html.includes('id="radio"') && html.includes('href="#radio"'), `portada ${lang}: tarjeta y enlace de radio sin sesión`);
      comprobar(html.includes(vivo.current.videoId), `portada ${lang}: pinta lo que emite Herra`, vivo.current.videoId);
    }
    const ahora = await pedir(PORTADA, "/api/radio/now", { headers: delDominio() });
    comprobar(ahora.status === 200 && ahora.json?.queueId, "GET /api/radio/now por el gateway", ahora.json?.queueId);
    const cuna = await pedir(PORTADA, "/landing/radio/sweeper-v2.wav", { headers: { ...delDominio(), range: "bytes=0-100" } });
    comprobar(cuna.status === 206 || cuna.status === 200, "la cuña se sirve en el dominio", cuna.status);

    // --------------------------------------------------------- candidatura y auditoría
    const correo = `2b-${sufijo}@example.com`;
    const alta = await pedir(PORTADA, "/api/community/applications", { method: "POST", headers: delDominio(), body: {
      firstName: "2B", lastName: `Ensayo ${sufijo}`, email: correo, city: "Caracas", country: "Venezuela",
      experience: "Prueba automática del ensayo 2B.", contactPreference: "email", availability: "Fines de semana",
    } });
    comprobar(alta.status === 200 || alta.status === 201, "candidatura con Host/Origin/CF del dominio", alta.status);
    const fila = (await pool.query<{ id: number; source_addr: string | null }>("SELECT id, source_addr FROM auth.applications WHERE email = $1", [correo])).rows[0];
    solicitudId = fila?.id ?? null;
    comprobar(fila?.source_addr === IP, "la candidatura guarda la IP real", fila?.source_addr);
    await new Promise((r) => setTimeout(r, 300));
    const auditCand = (await pool.query("SELECT 1 FROM auth.audit_log WHERE id > $1 AND actor_type = 'public' AND path LIKE '%applications%'", [maxAudit])).rowCount ?? 0;
    comprobar(auditCand === 1, "la candidatura deja fila public en auth.audit_log", auditCand);

    // --------------------------------------------------------- login en la raíz
    const adminRaiz = await entrar(PORTADA, "", "fase1-admin", "Fase1Admin2026", delDominio());
    comprobar(adminRaiz.status === 200 && /Path=\/;/iu.test(`${adminRaiz.raw};`) && /Secure/iu.test(adminRaiz.raw) && /HttpOnly/iu.test(adminRaiz.raw), "login con cookie Secure en /", adminRaiz.raw.replace(/=[^;]+/u, "=…"));

    // --------------------------------------------------------- panel del dominio
    const admin = await entrar(PANEL, "", "fase1-admin", "Fase1Admin2026", local);
    comprobar(admin.rol === "admin", "login en el panel del dominio", admin.rol);
    const conAdmin = { ...local, cookie: admin.cookie, "x-crv-csrf": admin.csrf };
    const aceptada = await pedir(PANEL, `${API_PANEL}/applications/${solicitudId}/accept`, { method: "POST", headers: conAdmin, body: {} });
    const token = new URL(String(aceptada.json?.activationUrl ?? "http://x/")).searchParams.get("token") ?? "";
    userId = aceptada.json?.userId ?? null;
    comprobar(Boolean(token), "el panel acepta la candidatura", aceptada.status);

    // --------------------------------------------------------- activación y tarea
    const nombre = `e2b-${sufijo}`; const clave = "ClaveEnsayo2B2026x";
    const activa = await pedir(PORTADA, "/api/community/activate", { method: "POST", headers: delDominio(), body: { token, name: nombre, accessCode: clave } });
    comprobar(activa.status === 200, "activación desde el dominio", activa.status);
    await new Promise((r) => setTimeout(r, 300));
    const auditAct = (await pool.query("SELECT 1 FROM auth.audit_log WHERE id > $1 AND actor_type = 'public' AND path LIKE '%activate%'", [maxAudit])).rowCount ?? 0;
    comprobar(auditAct === 1, "la activación deja fila public en auth.audit_log", auditAct);
    const colaborador = await entrar(PORTADA, "", nombre, clave, delDominio());
    comprobar(Boolean(colaborador.rol), "login del colaborador en el dominio", colaborador.rol);
    const etapa = (await pool.query<{ id: number }>("SELECT id FROM auth.categories ORDER BY sort_order LIMIT 1")).rows[0]!.id;
    await pedir(PANEL, `${API_PANEL}/tasks`, { method: "POST", headers: conAdmin, body: { categoryId: etapa, title: `2B tarea ${sufijo}`, status: "pending", assignedUserIds: [userId] } });
    tareaId = (await pool.query<{ id: number }>("SELECT id FROM auth.tasks WHERE title = $1", [`2B tarea ${sufijo}`])).rows[0]?.id ?? null;
    const cambio = await pedir(PORTADA, `/api/roadmap/tasks/${tareaId}/status`, { method: "PATCH", headers: { ...delDominio(), cookie: colaborador.cookie, "x-crv-csrf": colaborador.csrf }, body: { status: "in_progress" } });
    comprobar(cambio.status === 200, "el colaborador cambia su tarea desde el dominio", cambio.status);

    // --------------------------------------------------------- visita y país
    for (const ip of ["203.0.113.31", "203.0.113.32", "203.0.113.31"]) {
      await pedir(PORTADA, "/api/roadmap/visit", { method: "POST", headers: delDominio(ip), body: {} });
    }
    const visitas = (await pool.query<{ country: string; n: number }>("SELECT country, count(*)::int n FROM auth.project_visits WHERE id > $1 GROUP BY country", [maxVisita])).rows;
    comprobar(visitas.length === 1 && visitas[0]?.country === "ve" && visitas[0]?.n === 2, "dos IP suman dos visitas con país ve", JSON.stringify(visitas));

    // --------------------------------------------------------- métricas (opción a de §8)
    if (METRICAS) {
      // Las portadas de arriba siguen en la cola de tráfico: se espera su volcado para medir solo esta visita.
      await new Promise((r) => setTimeout(r, 11_000));
      const antes = (await pool.query<{ n: number }>("SELECT coalesce(sum(requests),0)::int n FROM auth.traffic_daily WHERE day = $1 AND page = 'roadmap'", [hoy])).rows[0]!.n;
      await pedir(PORTADA, "/", { headers: delDominio("203.0.113.41") });
      let despues = antes;
      for (let i = 0; i < 24 && despues === antes; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        despues = (await pool.query<{ n: number }>("SELECT coalesce(sum(requests),0)::int n FROM auth.traffic_daily WHERE day = $1 AND page = 'roadmap'", [hoy])).rows[0]!.n;
      }
      comprobar(despues === antes + 1, "la visita de página llega a traffic_daily con los trabajos apagados", `${antes}→${despues}`);
      const pais = (await pool.query<{ country: string; category: string }>("SELECT country, category FROM auth.traffic_daily WHERE day = $1 AND page = 'roadmap' ORDER BY last_at DESC LIMIT 1", [hoy])).rows[0];
      comprobar(pais?.country === "ve", "traffic_daily guarda país", JSON.stringify(pais));
    }
  } finally {
    // ------------------------------------------------------------------ limpieza
    if (tareaId) await pool.query("DELETE FROM auth.tasks WHERE id = $1", [tareaId]).catch((e) => { fallo("limpieza tarea", e); });
    await pool.query("DELETE FROM auth.applications WHERE id = $1", [solicitudId]).catch((e) => { fallo("limpieza candidatura", e); });
    await pool.query("DELETE FROM auth.sessions WHERE lower(payload->>'username') LIKE 'e2b-%'");
    if (userId) {
      const persona = (await pool.query<{ person_id: number | null }>("SELECT person_id FROM auth.users WHERE id = $1", [userId])).rows[0]?.person_id;
      await pool.query("DELETE FROM auth.users WHERE id = $1", [userId]).catch((e) => { fallo("limpieza usuario", e); });
      if (persona) await pool.query("DELETE FROM auth.people WHERE id = $1", [persona]).catch((e) => { fallo("limpieza persona", e); });
    }
    await pool.query("DELETE FROM auth.project_visits WHERE id > $1", [maxVisita]);
    await pool.query("DELETE FROM auth.audit_log WHERE id > $1", [maxAudit]);
    await pool.query("DELETE FROM auth.traffic_daily WHERE day = $1", [hoy]);
    await pool.query("DELETE FROM auth.traffic_visitors WHERE day = $1", [hoy]);
    for (const [tabla, filas] of [["auth.traffic_daily", traficoAntes], ["auth.traffic_visitors", visitantesAntes]] as const) {
      for (const fila of filas) {
        const c = Object.keys(fila);
        const ident = tabla === "auth.traffic_daily" ? " OVERRIDING SYSTEM VALUE" : "";
        await pool.query(`INSERT INTO ${tabla} (${c.join(",")})${ident} VALUES (${c.map((_, i) => `$${i + 1}`).join(",")})`, c.map((k) => fila[k]));
      }
    }
    limpiarFixtures();
    await writeFile(path.join(OUT, "flujos-dominio.json"), `${JSON.stringify(informe, null, 2)}\n`);
    console.log(JSON.stringify(informe, null, 2));
    process.exitCode = informe.fallos.length ? 1 : 0;
    await closeDb();
  }
}
await main();
