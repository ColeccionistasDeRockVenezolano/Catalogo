// CRV · sesión determinista para los guiones de navegador de `scripts/checks`.
//
// Por qué existe: los guiones esperaban un tiempo fijo (1,5 s) después de pulsar
// «Entrar». Eso falló una vez en `b9-ventanas-browser.mjs`: el limitador de
// intentos de `/auth/login` cuenta **todos** los intentos (aciertos incluidos,
// 5 por cuenta y 15 min, `LOGIN_MAX_FAILURES`), así que un 429 dejaba el guion
// sin sesión y las comprobaciones siguientes fallaban en cascada.
//
// Aquí se espera la respuesta real de `POST /auth/login` y se confirma la
// sesión contra `/auth/me`; nunca se avanza por reloj. Un 429 se reporta como
// tal, en vez de confundirse con un fallo de la interfaz.
//
// Uso:
//   import { entrar, estadoSesion, reutilizar } from "./lib/sesion.mjs";
//   const usuario = await entrar(page, { usuario: "fase1-admin", clave: "…" });
//   const movil = await browser.newContext({ ..., storageState: await context.storageState() });

export const BASE = "http://127.0.0.1:3130";
export const API = "/crv/api";

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
  } = opciones;

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
      throw new Error(`login: 429 too_many_attempts (${usuario}). El limitador cuenta los aciertos: `
        + "espera 15 min, usa otra cuenta de prueba o reinicia crv-api-staging.");
    }
    if (!respuesta.ok()) throw new Error(`login: ${estado} (${usuario})`);
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
