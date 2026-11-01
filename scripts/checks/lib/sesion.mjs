// CRV · sesión determinista para los guiones de navegador de `scripts/checks`.
//
// Por qué existe: los guiones esperaban un tiempo fijo (1,5 s) después de pulsar
// «Entrar». Eso falló una vez en `b9-ventanas-browser.mjs`: el limitador de
// `/auth/login` cuenta **todos** los intentos contra la IP (aciertos incluidos,
// `LOGIN_IP_MAX_FAILURES = 20` por 15 min) y solo perdona el cupo de la cuenta al
// acertar (`LOGIN_MAX_FAILURES = 5`). Varias tandas de guiones desde 127.0.0.1
// agotaban el cupo de la IP y un 429 dejaba el guion sin sesión.
//
// Aquí se espera la respuesta real de `POST /auth/login` y se confirma la
// sesión contra `/auth/me`; nunca se avanza por reloj. Un 429 se reporta como
// tal, en vez de confundirse con un fallo de la interfaz. La sesión se guarda en
// `~/crv-staging/sesiones` y se reutiliza mientras siga viva, para no gastar el
// cupo de la IP en cada corrida. Cada guion usa además una IP de prueba propia
// (`ipDePrueba`) para no compartir el contador con los demás.
//
// Uso:
//   import { entrar, estadoSesion, reutilizar, ipDePrueba } from "./lib/sesion.mjs";
//   const usuario = await entrar(page, { usuario: "fase1-admin", clave: "…" });
//   const movil = await browser.newContext({ ..., storageState: await context.storageState() });

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const BASE = "http://127.0.0.1:3130";
export const API = "/crv/api";

const SESIONES = path.join(os.homedir(), "crv-staging/sesiones");

/** IP de prueba distinta por corrida: aísla el cupo del limitador entre guiones. */
export function ipDePrueba(etiqueta = "check") {
  const semilla = `${etiqueta}-${Date.now()}-${Math.random()}`;
  let hash = 0;
  for (const letra of semilla) hash = (hash * 31 + letra.charCodeAt(0)) >>> 0;
  return `10.77.${(hash >>> 8) % 250}.${(hash % 250) + 1}`;
}

function rutaSesion(base, usuario) {
  const host = new URL(base).host.replace(/[^a-z0-9.:-]/giu, "_");
  return path.join(SESIONES, `${host}-${usuario}.json`);
}

async function cargarSesion(pagina, base, usuario) {
  try {
    const estado = JSON.parse(await readFile(rutaSesion(base, usuario), "utf8"));
    if (Array.isArray(estado.cookies) && estado.cookies.length) await pagina.context().addCookies(estado.cookies);
  } catch {
    // Sin sesión guardada: se inicia sesión normal.
  }
}

async function guardarSesion(pagina, base, usuario) {
  try {
    const estado = await pagina.context().storageState();
    await mkdir(SESIONES, { recursive: true });
    await writeFile(rutaSesion(base, usuario), JSON.stringify(estado));
  } catch {
    // La caché es una comodidad: si falla, el guion sigue.
  }
}

/** Estado de la sesión según la API (la cookie es httpOnly: no se puede leer desde JS). */
export async function estadoSesion(pagina, apiBase = API) {
  return pagina.evaluate(async (base) => {
    const respuesta = await fetch(`${base}/auth/me`, { credentials: "include" });
    if (!respuesta.ok) return { status: respuesta.status, user: null, csrf: "" };
    const cuerpo = await respuesta.json();
    return { status: respuesta.status, user: cuerpo.user ?? null, csrf: cuerpo.csrf ?? "" };
  }, apiBase);
}

/**
 * Inicia sesión y la confirma. Devuelve el usuario de `/auth/me`.
 * Si ya hay sesión abierta (la página no muestra el formulario), solo la confirma.
 */
export async function entrar(pagina, opciones = {}) {
  const {
    base = BASE,
    apiBase = API,
    ruta = "/crv/cuenta",
    usuario,
    clave,
    usuarioSelector = "#op-username",
    claveSelector = "#op-password",
    botonSelector = "form button",
    esperarUrl,
    timeoutMs = 25_000,
    usarCache = true,
  } = opciones;

  if (usarCache && usuario) await cargarSesion(pagina, base, usuario);
  await pagina.goto(`${base}${ruta}`, { waitUntil: "domcontentloaded" });

  // La app monta el formulario después del documento: se espera a que aparezca
  // el campo o a que /auth/me confirme una sesión ya abierta. Sin esta espera,
  // un `count()` inmediato devolvía 0 y el guion seguía sin haber entrado.
  let hayFormulario = false;
  const arranque = Date.now();
  while (Date.now() - arranque < 10_000) {
    if (await pagina.locator(usuarioSelector).count()) { hayFormulario = true; break; }
    const yaAbierta = await estadoSesion(pagina, apiBase).catch(() => ({ status: 0, user: null }));
    if (yaAbierta.status === 200 && yaAbierta.user) return yaAbierta.user;
    await pagina.waitForTimeout(150);
  }

  if (hayFormulario) {
    if (!usuario || !clave) throw new Error("login: faltan usuario o clave y no hay sesión abierta");
    const pendiente = pagina.waitForResponse(
      (respuesta) => respuesta.url().includes("/api/auth/login") && respuesta.request().method() === "POST",
      { timeout: timeoutMs },
    );
    await pagina.fill(usuarioSelector, usuario);
    await pagina.fill(claveSelector, clave);
    await pagina.click(botonSelector);
    const respuesta = await pendiente.catch(() => null);
    if (!respuesta) throw new Error(`login: no hubo respuesta de /auth/login (${usuario})`);
    const estado = respuesta.status();
    if (estado === 429) {
      throw new Error(`login: 429 too_many_attempts (${usuario}). El limitador cuenta los intentos contra la IP; `
        + "cada guion usa una IP de prueba propia y reutiliza la sesión guardada, así que esto no debería ocurrir.");
    }
    if (!respuesta.ok()) throw new Error(`login: ${estado} (${usuario})`);
    if (usarCache) await guardarSesion(pagina, base, usuario);
  }
  if (esperarUrl) await pagina.waitForURL(esperarUrl, { timeout: timeoutMs }).catch(() => null);

  const inicio = Date.now();
  while (Date.now() - inicio < 15_000) {
    const estado = await estadoSesion(pagina, apiBase);
    if (estado.status === 200 && estado.user) return estado.user;
    await pagina.waitForTimeout(150);
  }
  throw new Error(`sesión no confirmada contra /auth/me (${usuario ?? "sin usuario"})`);
}

/** Contexto nuevo que hereda las cookies de otro (evita un login por ventana). */
export async function reutilizar(browser, contexto, opciones = {}) {
  return browser.newContext({ ...opciones, storageState: await contexto.storageState() });
}
