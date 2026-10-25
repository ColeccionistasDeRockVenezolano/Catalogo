/* Fondo de la extensión: pide trabajos al puente, navega una pestaña, lee el DOM y lo entrega.
   MV2 con background persistente: el bucle vive aquí y NO depende de la pestaña «panel»
   (antes el bucle estaba en un content_script del panel y, si esa pestaña no cargaba el
   script, el puente contestaba 504 a todo — fallo observado 2026-10-19). */
const BASE = "http://127.0.0.1:8899";
const LECTURA = "JSON.stringify({t: document.title, u: location.href, h: document.documentElement.outerHTML})";
const RETO = /un momento|just a moment|attention required|security check|verific|checking your browser/i;
let ocupado = false;
let vueltas = 0;         // ciclos del bucle (para diagnósticos periódicos)
let tabPuente = null;   // pestaña que abrió la cola: su lectura va por /resultado, no por /captura
let usarClic = false;   // si tabs.create falla (muro), se pasa a abrir con un clic en el panel

function dormir(ms) { return new Promise((ok) => setTimeout(ok, ms)); }

async function esperarListo(tabId, host, timeout = 120000) {
  // No basta con tabs.onUpdated «complete»: en algunos arranques ese evento llega con la
  // pestaña aún en about:blank y executeScript falla con «Missing host permission for the tab»
  // (visto 2026-10-19). Aquí se exige URL del sitio y status complete.
  const fin = Date.now() + timeout;
  return new Promise((res, rej) => {
    (async () => {
      while (Date.now() < fin) {
        let t = null;
        try { t = await browser.tabs.get(tabId); } catch (e) { return rej(new Error("pestaña cerrada")); }
        if (t && t.status === "complete" && (t.url || "").startsWith(host)) return res(t);
        await dormir(800);
      }
      rej(new Error("timeout de carga"));
    })();
  });
}

async function esperarUrl(tabId, trozo, timeout = 90000) {
  // Espera a que la pestaña esté en una URL que contenga `trozo` (la navegación en dos pasos
  // tarda en commitear y `complete` sigue apuntando a la página anterior).
  const fin = Date.now() + timeout;
  while (Date.now() < fin) {
    let t = null;
    try { t = await browser.tabs.get(tabId); } catch (e) { return null; }
    if (t && t.status === "complete" && (t.url || "").includes(trozo)) return t;
    await dormir(600);
  }
  return null;
}

async function leer(tabId) {
  const r = await browser.tabs.executeScript(tabId, { code: LECTURA });
  return JSON.parse(r[0]);
}

async function leerConEspera(tabId, timeout = 45000) {
  // Firefox informa tab.url con la URL *pendiente* y status «complete» del about:blank inicial:
  // executeScript entonces falla con «Missing host permission for the tab» aunque el permiso
  // exista. Se reintenta hasta que el documento real esté montado (visto 2026-10-19).
  const fin = Date.now() + timeout;
  let ultimo = null;
  while (Date.now() < fin) {
    try { return await leer(tabId); } catch (e) { ultimo = e; await dormir(900); }
  }
  throw ultimo || new Error("sin lectura");
}

async function leerConTracks(tabId, timeout = 22000) {
  // RYM rellena la lista de pistas por JS dentro de <ul id="tracks_mobile">. Leer en cuanto la
  // página está «complete» devuelve el <ul> VACÍO y la ficha se guarda con 0 pistas (medido el
  // 2026-10-19: 21,6 % de las fichas del día, y subiendo). Aquí se espera a que haya filas.
  const fin = Date.now() + timeout;
  let ultimo = null;
  while (true) {
    const leido = await leer(tabId);          // puede lanzar si está navegando
    ultimo = leido;
    const filas = (leido.h || "").split('class="track"').length - 1;
    const reviewsPage = /\/reviews\/\d+\//.test(leido.u || "");
    const reviewsReady = reviewsPage && /id=["']review_shell_std_\d+/.test(leido.h || "");
    if (reviewsReady || RETO.test(leido.t || "") || filas > 0 || Date.now() >= fin) return leido;
    await dormir(1500);
  }
}

// ── Cabeceras de navegación ───────────────────────────────────────────────────────────
// Medido el 2026-10-19: una ficha abierta PULSANDO un enlace carga; abierta con tabs.create
// (equivalente a escribir la URL) RYM corta la conexión. La diferencia visible en la red es
// Sec-Fetch-Site: cross-site + Referer del panel. Se replican en toda navegación a una ficha.
try {
  browser.webRequest.onBeforeSendHeaders.addListener(
    (detalles) => {
      const h = detalles.requestHeaders || [];
      const poner = (nombre, valor) => {
        const i = h.findIndex((x) => x.name.toLowerCase() === nombre.toLowerCase());
        if (i >= 0) h[i].value = valor;
        else h.push({ name: nombre, value: valor });
      };
      if (!/\/release\//.test(detalles.url || "")) return {};
      poner("Referer", BASE + "/panel");
      poner("Sec-Fetch-Site", "cross-site");
      return { requestHeaders: h };
    },
    { urls: ["https://rateyourmusic.com/*"], types: ["main_frame"] },
    ["blocking", "requestHeaders"]
  );
} catch (e) { /* si el navegador no deja, se sigue con lo que haya */ }

let tabPanelId = null;   // pestaña del panel reutilizada (no crear una por ficha)
let tabReto = null;      // pestaña con un reto de Cloudflare SIN resolver: no se cierra nunca
let retoHumano = false;  // el reto pedía imágenes: necesita al dueño, no se insiste
// El aviso de reto del puente es un latch: solo lo limpia quien lo puso. Se revalida contra la
// pestaña real en cada vuelta del bucle (dos lecturas seguidas), porque si queda pegado la cola
// espera para siempre.
let retoLecturas = 0;
let fichaEnCurso = null; // ruta de la ficha que la cola está capturando (para no duplicar lecturas)
// Pestañas que abrió el PUENTE (cola, panel, retos). El listener de captura manual las ignora:
// antes se tomaban como «abiertas a mano» y cada ficha se leía dos veces.
const misPestanas = new Set();
browser.tabs.onRemoved.addListener((id) => {
  misPestanas.delete(id);
  if (id === tabReto) {
    tabReto = null;
    marcarReto(false, { motivo: "pestaña del reto cerrada a mano" });
  }
});
// El clic del panel crea la pestaña antes de que podamos marcarla: onCreated llega primero.
browser.tabs.onCreated.addListener((t) => {
  if (ocupado && t && t.openerTabId === tabPanelId) misPestanas.add(t.id);
});

// Puntos a probar dentro del ancla de reCAPTCHA (304x78), en orden de probabilidad. El centro de
// la casilla está a ~(28, 39) de la esquina, pero el origen del contenido en pantalla se desvía
// hasta 26-52 px según el marco de la ventana (medido: dbg.mx/sy vs posición X real). La zona
// segura es la casilla + el texto «No soy un robot» (x 10-215, y 18-58): todos los puntos caen
// ahí, ninguno en el globo «reCAPTCHA» (que navegaría a la documentación de Google).
const OFFSETS = [[0, -26], [0, -13], [0, -39], [0, 0], [-13, -26], [-26, -26],
                 [0, -52], [-13, -13], [-26, 0], [-13, -39], [-26, -39], [-13, -52]];

// Geometría del reto: posición en pantalla del iframe de Turnstile. El iframe es de otro origen
// (no se puede tocar su DOM), pero el elemento sí está en el documento: se mide su rectángulo y
// el puente pulsa ahí con XTEST (clic real del sistema, el que Cloudflare acepta).
const GEO = `JSON.stringify((() => {
  const out = { t: document.title, u: location.href, token: 0, ifr: null, sub: null, alto: 0 };
  // Origen del área de contenido en la PANTALLA. mozInnerScreenX/Y es lo único que da la X real
  // del contenido (medido 2026-10-19: acertó el clic en x; en y se desvía ~26 px y el abanico de
  // OFFSETS lo cubre). screenX + (outer - inner) sumaba 26 px de marco y caía fuera de la casilla.
  out.vx = Math.round(window.mozInnerScreenX || (window.screenX + (window.outerWidth - window.innerWidth)));
  out.vy = Math.round(window.mozInnerScreenY || (window.screenY + (window.outerHeight - window.innerHeight)));
  out.w = innerWidth; out.h = innerHeight;
  out.dbg = { sx: window.screenX, sy: window.screenY, ow: window.outerWidth, oh: window.outerHeight,
              iw: innerWidth, ih: innerHeight, mx: Math.round(window.mozInnerScreenX || 0),
              my: Math.round(window.mozInnerScreenY || 0), dpr: devicePixelRatio };
  const ta = document.querySelector('textarea[name="g-recaptcha-response"], #g-recaptcha-response');
  out.token = ta && ta.value ? ta.value.length : 0;
  const marcos = [...document.querySelectorAll('iframe')].map((f) => {
    const r = f.getBoundingClientRect();
    return { src: (f.src || '').slice(0, 160), w: Math.round(r.width), h: Math.round(r.height),
             rl: Math.round(r.left), rt: Math.round(r.top),
             sx: out.vx + Math.round(r.left), sy: out.vy + Math.round(r.top) };
  }).filter((m) => m.w > 12 && m.h > 12);
  out.marcos = marcos;
  // La CASILLA es el ancla de reCAPTCHA v2 (size normal). El globo «protegido por reCAPTCHA»
  // también es un iframe y su clic lleva a la documentación de Google: hay que excluirlo.
  const ancla = marcos.find((m) => (m.src.indexOf('api2/anchor') >= 0 || m.src.indexOf('challenges.cloudflare.com') >= 0 || m.src.indexOf('challenge-platform') >= 0) && m.src.indexOf('invisible') < 0 && m.src.indexOf('badge=') < 0 && m.w >= 250 && m.h >= 55);
  if (ancla) { out.ifr = { w: ancla.w, h: ancla.h, sx: ancla.sx, sy: ancla.sy, src: ancla.src, rl: ancla.rl, rt: ancla.rt }; out.alto = ancla.h; }
  else {
    const globo = marcos.find((m) => /anchor|badge/i.test(m.src));
    out.alto = globo ? globo.h : 0;
  }
  // El mosaico de imágenes se abre en el marco «bframe» (grande), no en el ancla.
  out.bframe = marcos.some((m) => (m.src.indexOf('bframe') >= 0 || m.src.indexOf('hcaptcha') >= 0) && m.h > 150);
  const botones = [...document.querySelectorAll('input[type=submit], button, input[type=button]')];
  const sub = botones.find((b) => /submit|enviar|continuar|i'?m not a robot/i.test(b.value || b.textContent || ''));
  if (sub) {
    const r = sub.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) {
      out.sub = { sx: out.vx + Math.round(r.left + r.width / 2), sy: out.vy + Math.round(r.top + r.height / 2) };
    }
  }
  out.texto = (document.body ? document.body.innerText : '').slice(0, 200).replace(/\\s+/g, ' ');
  return out;
})())`;

async function geometria(tabId) {
  try {
    const r = await browser.tabs.executeScript(tabId, { code: GEO });
    return JSON.parse(r[0]);
  } catch (e) { return { t: "", u: "", error: String(e).slice(0, 120), marcos: [], token: 0 }; }
}

// Avisa al puente de que hay (o ya no hay) un reto EN PANTALLA. La cola lo consulta para no
// seguir abriendo fichas mientras el reto está sin resolver: antes reintentaba a ciegas y seguía
// abriendo pestañas con el captcha delante.
async function marcarReto(pendiente, extra) {
  try {
    await fetch(BASE + "/reto", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ estado: pendiente ? "pendiente" : "libre",
                                          ts: Date.now() }, extra || {}))
    });
  } catch (e) { /* puente caído */ }
}

// El aviso de reto es un latch y la cola no navega mientras diga «pendiente». Si la pestaña del
// reto deja de pedir reto (el dueño lo resolvió, caducó, o navegó a otra página) sin pasar por
// /release/ ni cerrarse, nadie republica «libre» y la cola se queda esperando para siempre
// (2026-10-20: 29 min parada con la pestaña ya en la portada). Cada vuelta del bucle se contrasta
// el aviso con la pestaña REAL; dos lecturas seguidas para no limpiar en un instante de carga.
async function vigilarReto() {
  // Se pregunta al PUENTE (fuente de verdad del latch), no a un flag local: tras reiniciar la
  // extensión el aviso puede seguir pegado en el puente y hay que soltarlo igual.
  let aviso = null;
  try { aviso = await (await fetch(BASE + "/reto", { cache: "no-store" })).json(); }
  catch (e) { return; }                        // puente caído: no hay nada que revalidar
  if (!aviso || aviso.estado !== "pendiente") { retoLecturas = 0; return; }
  let t = null;
  if (tabReto !== null) {
    try { t = await browser.tabs.get(tabReto); } catch (e) { t = null; }
  }
  if (!t) {
    // Sin pestaña de reto no hay reto en pantalla: el aviso quedó huérfano.
    tabReto = null;
    retoLecturas = 0;
    await marcarReto(false, { motivo: "revalidado: no hay pestaña de reto" });
    return;
  }
  const titulo = t.title || "";
  const url = t.url || "";
  const yaNoEsReto = titulo && !RETO.test(titulo) && url && !/^about:/.test(url);
  if (yaNoEsReto) {
    if (++retoLecturas >= 2) {
      retoLecturas = 0;
      console.log("reto: la pestaña ya no pide reto (" + titulo.slice(0, 40) + "): se publica libre");
      await marcarReto(false, { url, motivo: "revalidado: la pestaña ya no pide reto" });
    }
    return;
  }
  retoLecturas = 0;
}


async function alFrente(tabId) {
  // Los retos de Cloudflare NO progresan en pestañas de fondo: los temporizadores van a 1/min y
  // requestAnimationFrame no corre. Hay que activar la pestaña y enfocar su ventana.
  try {
    const t = await browser.tabs.get(tabId);
    try { await browser.windows.update(t.windowId, { focused: true, drawAttention: true }); } catch (e) {}
    try { await browser.tabs.update(tabId, { active: true }); } catch (e) {}
    return true;
  } catch (e) { return false; }
}

async function resolverReto(tabId, leido0) {
  // Resuelve la página antirrobot de RYM («Security check required»: reCAPTCHA + Submit) o el
  // desafío de Cloudflare, sin intervención: clic REAL del sistema en la casilla, espera del
  // token, clic en Submit y espera de la ficha. La pestaña NUNCA se cierra.
  const t0 = Date.now(), LIMITE = 150000;   // 2,5 min (la cola espera 230 s: margen de sobra)
  let leido = leido0, clics = 0, submits = 0, recargas = 0, ultimo = 0, imagen = false, iter = 0;
  await alFrente(tabId);
  await marcarReto(true, { url: (leido0 && leido0.u) || "" });
  const avisar = async (que, g) => {
    try {
      await fetch(BASE + "/reto", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ que, url: (g && g.u) || "", ifr: (g && g.ifr) || null,
                               marcos: (g && g.marcos) || [], token: (g && g.token) || 0,
                               bframe: !!(g && g.bframe), error: (g && g.error) || "",
                               dbg: (g && g.dbg) || null }) });
    } catch (e) {}
  };
  { const g0 = await geometria(tabId); await avisar("inicio", g0); }
  while (Date.now() - t0 < LIMITE) {
    await dormir(2000);
    let g = null;
    try { g = await geometria(tabId); } catch (e) { g = null; }
    if (g.t && !RETO.test(g.t)) {                 // ya entró: se lee la ficha
      try { const listo = await leer(tabId); await marcarReto(false, { url: listo.u }); return listo; }
      catch (e) { /* sigue cargando: se reintenta en la vuelta */ }
    }
    const t = Date.now() - t0;
    if (iter++ % 5 === 0) await avisar("iter", g);
    if (!g.marcos && !g.t) { await avisar("sin lectura", g); await dormir(2000); continue; }
    // Si un clic se fue a un enlace del widget (documentación de Google), se vuelve atrás.
    if (g.u && !/rateyourmusic\.com/.test(g.u)) {
      console.log("reto: la pestaña salió del sitio (" + g.u.slice(0, 50) + "), volviendo");
      try { await browser.tabs.goBack(tabId); } catch (e) {}
      await dormir(2500);
      ultimo = Date.now();
      continue;
    }
    if (g.token > 20) {
      // Casilla pasada: hay token. Falta pulsar Submit (una vez cada 6 s como mucho).
      if (Date.now() - ultimo > 6000 && submits < 4) {
        // Submit es un botón de la propia página (no del iframe): se pulsa por DOM, que no
        // depende de la geometría de la pantalla; si no aparece, se pulsa con el ratón real.
        let pulsado = false;
        try {
          const r = await browser.tabs.executeScript(tabId, { code:
            `(() => { const b = [...document.querySelectorAll('input[type=submit], button[type=submit], button')]
                        .find((x) => /submit|enviar|continuar/i.test(x.value || x.textContent || ''));
                      if (!b) return 'no'; b.click(); return 'ok'; })()` });
          pulsado = (r && r[0]) === "ok";
        } catch (e) { pulsado = false; }
        if (!pulsado && g.sub) {
          await alFrente(tabId);
          try { await fetch(BASE + "/raton", { method: "POST", headers: { "Content-Type": "application/json" },
                                               body: JSON.stringify({ x: g.sub.sx, y: g.sub.sy, tipo: "click" }) }); } catch (e) {}
          pulsado = true;
        }
        console.log("reto: token listo, Submit " + (pulsado ? "pulsado" : "no encontrado"));
        submits++;
        ultimo = Date.now();
      }
    } else if (g.bframe) {
      // reCAPTCHA abrió el mosaico de imágenes: eso necesita ojos. Se deja la ventana al frente
      // y se suelta el turno (insistir a ciegas solo empeora la reputación de la sesión).
      if (!imagen) {
        imagen = true;
        console.log("reto: mosaico de imágenes — se deja al frente para el dueño");
      }
      await dormir(3000);
      retoHumano = true;
      return null;
    } else if (g.ifr) {
      // Casilla «No soy un robot»: clic real del escritorio. El origen del contenido en pantalla
      // puede desviarse ~26 px según el marco de la ventana, así que se prueba un abanico de
      // puntos DENTRO del widget (304x78) hasta que aparezca el token o el mosaico.
      if (Date.now() - ultimo > 4500 && clics < OFFSETS.length) {
        const d = OFFSETS[clics];
        const px = g.ifr.sx + 28 + d[0], py = g.ifr.sy + Math.round(g.ifr.h / 2) + d[1];
        await alFrente(tabId);   // el clic va a la ventana de ENCIMA: que sea la del reto
        try { await fetch(BASE + "/raton", { method: "POST", headers: { "Content-Type": "application/json" },
                                             body: JSON.stringify({ x: px, y: py, tipo: "click" }) }); } catch (e) {}
        console.log("reto: clic casilla " + px + "," + py + " (intento " + (clics + 1) + ")");
        clics++;
        ultimo = Date.now();
      }
    } else if (Date.now() - ultimo > 8000) {
      // Ni casilla ni botón: entrada real en la página y esperar a que pase solo.
      try {
        await fetch(BASE + "/raton", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: g.vx + 80 + Math.floor(Math.random() * Math.max(40, g.w - 160)),
                                 y: g.vy + 140 + Math.floor(Math.random() * Math.max(40, g.h - 280)),
                                 tipo: "mover" }) });
      } catch (e) {}
      console.log("reto: sin casilla; movimiento real y espera — " + (g.texto || "").slice(0, 70));
      ultimo = Date.now();
    }
    // Recargar funcionó a mano el 2026-10-19 (reto a las 16:15:28 → ficha a las 16:15:53).
    if (!imagen && ((t > 45000 && recargas === 0) || (t > 110000 && recargas === 1))) {
      recargas++;
      console.log("reto: recarga " + recargas);
      try { await browser.tabs.reload(tabId); } catch (e) {}
    }
  }
  console.log("reto NO resuelto" + (imagen ? " (pide imágenes: hace falta el dueño)" : ""));
  return null;
}

async function tabPanel() {
  // Reutiliza SIEMPRE la misma pestaña del panel: si se crea una por ficha, se acumulan.
  if (tabPanelId !== null) {
    try { return await browser.tabs.get(tabPanelId); } catch (e) { tabPanelId = null; }
  }
  let ts = [];
  try { ts = await browser.tabs.query({}); } catch (e) { ts = []; }
  const paneles = ts.filter((t) => (t.url || "").indexOf(BASE + "/panel") === 0);
  if (paneles.length) {
    tabPanelId = paneles[0].id;
    // Cierra duplicados que hayan quedado de antes.
    for (const extra of paneles.slice(1)) { try { await browser.tabs.remove(extra.id); } catch (e) {} }
    return paneles[0];
  }
  const t = await browser.tabs.create({ url: BASE + "/panel", active: false });
  tabPanelId = t.id;
  misPestanas.add(t.id);
  await dormir(1500);
  return t;
}

async function clicEnPanel(url) {
  // Abrir la ficha PULSANDO un enlace en el panel, no con tabs.create: medido el 2026-10-19,
  // tabs.create viaja con Sec-Fetch-Site: none (como la barra de direcciones) y RYM corta la
  // conexión; el clic viaja como cross-site y la ficha carga. Es el mismo camino que usa el dueño.
  const panel = await tabPanel();
  const r = await browser.tabs.executeScript(panel.id, {
    code: `(() => {
      const a = document.createElement('a');
      a.href = ${JSON.stringify(url)};
      a.target = '_blank';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return 'clic';
    })()`
  });
  return (r && r[0]) === "clic";
}

async function procesar(id, url, previo, reintento = 0) {
  let tab = null;
  tabPuente = null;
  fichaEnCurso = (() => { try { return new URL(url).pathname.replace(/\/+$/, ""); } catch (e) { return null; } })();
  const datos = { id, status: 500, html: "", url };
  try {
    // Si quedó una pestaña con un reto de ESTA misma ficha, se reutiliza SIN recargarla: puede
    // tener el reto a medio resolver por el dueño, y recargar tiraría su trabajo. Primero se lee:
    // si ya entró la ficha, se entrega; si sigue el reto, se intenta resolver y, si pide imágenes,
    // se deja tal cual para que el dueño la termine.
    if (tabReto !== null) {
      try {
        const t = await browser.tabs.get(tabReto);
        const camino = new URL(url).pathname.replace(/\/+$/, "");
        if ((t.url || "").includes(camino)) {
          tab = t;
          tabPuente = t.id;
          await esperarListo(t.id, "https://rateyourmusic.com/", 30000);
        } else {
          tabReto = null;
        }
      } catch (e) { tabReto = null; }
    }
    if (!tab && previo) {
      tab = await browser.tabs.create({ url: previo, active: true });
      tabPuente = tab.id;
      misPestanas.add(tab.id);
      await esperarListo(tab.id, "https://rateyourmusic.com/");
    } else if (!tab && usarClic) {
      const antes = new Set((await browser.tabs.query({})).map((t) => t.id));
      await clicEnPanel(url);
      const camino = new URL(url).pathname;
      for (let i = 0; i < 40 && !tab; i++) {
        await dormir(500);
        const ts = await browser.tabs.query({});
        tab = ts.find((t) => !antes.has(t.id) && (t.url || "").includes(camino)) || null;
      }
      if (!tab) {
        // Si el clic no dio una pestaña con la URL esperada (redirección al portada), se cierran
        // las pestañas nuevas que hayan quedado: no se acumulan.
        try {
          for (const t of await browser.tabs.query({})) {
            if (!antes.has(t.id) && t.id !== tabPanelId && t.id !== tabReto) {
              try { await browser.tabs.remove(t.id); } catch (_) {}
            }
          }
        } catch (_) {}
        throw new Error("el clic no abrió pestaña");
      }
      tabPuente = tab.id;
      misPestanas.add(tab.id);
      await esperarListo(tab.id, "https://rateyourmusic.com/");
    } else if (!tab) {
      tab = await browser.tabs.create({ url, active: false });
      tabPuente = tab.id;
      misPestanas.add(tab.id);
      await esperarListo(tab.id, "https://rateyourmusic.com/");
    }
    if (previo) {
      // Navegación en dos pasos: primero una página del sitio (p. ej. la ficha del artista) y
      // desde ella se PULSA el enlace del disco (no location.href): así la petición lleva
      // Referer exacto y gesto de usuario. Sospecha 2026-10-19: RYM frena enlaces profundos.
      await dormir(6000);
      const camino = (() => { try { return new URL(url).pathname; } catch (_) { return url; } })();
      try {
        const r = await browser.tabs.executeScript(tab.id, {
          code: `(() => {
            const a = [...document.querySelectorAll('a')].find(x => (x.getAttribute('href')||'').startsWith(${JSON.stringify(camino)}));
            if (!a) return 'sin-enlace';
            a.scrollIntoView({block:'center'});
            a.click();
            return 'clic';
          })()`
        });
        datos.clic = (r && r[0]) || "?";
      } catch (e) { datos.clic = "err:" + String(e).slice(0, 40); }
      await esperarUrl(tab.id, camino);
    }
    let leido;
    try { leido = await leerConTracks(tab.id); }
    catch (e) { leido = await leerConEspera(tab.id); }
    // RETO DE CLOUDFLARE: no se cierra la pestaña ni se abandona. Se intenta resolver solo
    // (esperar a que el desafío gestionado pase, pulsar la casilla con clic real, recargar).
    if (RETO.test(leido.t || "")) {
      const resuelto = await resolverReto(tab.id, leido);
      if (resuelto) {
        leido = resuelto;
        datos.reto_resuelto = true;   // la cola baja el ritmo un rato tras resolver
      } else if (retoHumano) {
        datos.reto_humano = true;     // pide imágenes: la ventana queda al frente para el dueño
        retoHumano = false;
      }
    }
    datos.status = RETO.test(leido.t || "") ? 403 : 200;
    if (datos.status === 403) {
      // Se queda abierta: en el siguiente intento de esta misma ficha se reutiliza y se recarga.
      datos.reto = true;
      tabReto = tab.id;
      datos.titulo = leido.t || "";
    }
    datos.html = leido.h || "";
    datos.url = leido.u || url;
    if (!datos.titulo) datos.titulo = leido.t || "";
    // REDIRECCIÓN SILENCIOSA: cuando RYM bloquea una ficha de disco responde 200 con la PORTADA.
    // Sin esta comprobación el capturador guardaría la portada como si fuera la ficha (basura).
    // Visto 2026-10-19: /release/album/chaos_avatar/las_brujas → https://rateyourmusic.com/
    try {
      const objetivo = new URL(url).pathname.replace(/\/+$/, "");
      const final = new URL(datos.url, "https://rateyourmusic.com").pathname.replace(/\/+$/, "");
      if (!final.startsWith(objetivo)) {
        datos.redirigido = true;
        datos.status = 409;
      }
    } catch (e) { /* si no se puede comparar, se deja pasar */ }
  } catch (e) {
    // Si tabs.create acaba en about:neterror (RYM corta la conexión), se pasa a abrir con un
    // clic real en el panel — el camino que sí funciona — y se reintenta.
    if (!previo && !usarClic && /Missing host permission|timeout de carga|no abrió pestaña/i.test(String(e))) {
      usarClic = true;
      if (tab) { try { await browser.tabs.remove(tab.id); } catch (_) {} }
      await dormir(1200);
      return procesar(id, url, previo, reintento + 1);
    }
    // Pestaña cerrada por el usuario o por la propia página: se reintenta una vez con una nueva.
    if (reintento < 1 && /Invalid tab ID|pestaña cerrada/i.test(String(e))) {
      if (tab) { try { await browser.tabs.remove(tab.id); } catch (_) {} }
      await dormir(1500);
      return procesar(id, url, previo, reintento + 1);
    }
    datos.error = String(e);
    // Diagnóstico: si la pestaña acabó en about:neterror / otro origen, aquí se ve.
    try { const t = await browser.tabs.get(tab.id); datos.url = t.url || url; datos.tabStatus = t.status; } catch (_) {}
    if (tab && tab.id !== tabReto) { try { await browser.tabs.remove(tab.id); } catch (_) {} }
  }
  try {
    await fetch(BASE + "/resultado", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos)
    });
  } catch (e) { /* el puente lo dará por perdido y el capturador reintentará */ }
  // La pestaña del reto SIN resolver NO se cierra: queda ahí para el siguiente intento.
  if (tab && tab.id !== tabReto) { try { await browser.tabs.remove(tab.id); } catch (e) {} }
  if (tabReto !== null && tab && tab.id === tabReto && datos.status === 200) tabReto = null;
  tabPuente = null;
  fichaEnCurso = null;
}

// CAPTURA MANUAL: cualquier ficha de disco que abras en esta ventana se lee y se manda al puente
// (POST /captura → cola de recibidas → se guarda y se marca como hecha en el panel).
browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  const u = (tab && tab.url) || info.url || "";
  if (!/^https:\/\/rateyourmusic\.com\/release\//.test(u)) return;
  // La pestaña de la cola se ignora (su lectura va por /resultado)… salvo que sea la del RETO:
  // cuando el dueño lo resuelve a mano, esa pestaña entra a la ficha y aquí se captura sola.
  if (tabId === tabPuente && tabId !== tabReto) return;
  // Pestaña del propio puente (cola/panel): no es una captura manual.
  if (misPestanas.has(tabId) && tabId !== tabReto) return;
  // La ficha que la cola está capturando se entrega por /resultado: aquí se ignoraría para no
  // leerla dos veces (se hacía: cada ficha costaba dos lecturas y dos esperas de 5 s).
  if (fichaEnCurso && u.includes(fichaEnCurso)) return;
  (async () => {
    try {
      // Espera a que la lista de pistas esté hidratada (si no, la ficha entra con 0 pistas).
      const leido = await leerConTracks(tabId, 15000);
      const reto = RETO.test(leido.t || "");
      const eraReto = (tabId === tabReto);   // esta pestaña la abrió el puente para el reto
      await fetch(BASE + "/captura", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: leido.u || u, status: reto ? 403 : 200,
                               html: leido.h || "", titulo: leido.t || "",
                               origen: eraReto ? "reto" : "manual" })
      });
      if (!reto && eraReto) {
        // Reto resuelto y ficha capturada: la pestaña ya cumplió, se cierra (no se acumulan).
        tabReto = null;
        misPestanas.delete(tabId);
        try { await browser.tabs.remove(tabId); } catch (e) {}
        await marcarReto(false, { url: leido.u || u });
        try {
          await fetch(BASE + "/reto", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ que: "pestaña del reto cerrada tras capturar", url: leido.u || u }) });
        } catch (e) {}
      }
    } catch (e) { /* pestaña cerrada o en about: */ }
  })();
});

async function bucle() {
  if (!ocupado) {
    // El aviso de reto debe reflejar la pestaña real ANTES de pedir más trabajo: si quedó pegado,
    // la cola está esperando y este es el único punto que puede soltarlo.
    try { await vigilarReto(); } catch (e) { /* se reintenta en la vuelta */ }
    try {
      // Cada ~2 min se informa cuántas pestañas hay abiertas: si crecen, algo se está dejando.
      if (++vueltas % 150 === 0) {
        try {
          const n = (await browser.tabs.query({})).length;
          await fetch(BASE + "/latido?n=" + n, { cache: "no-store" });
        } catch (e) {}
      }
      const r = await fetch(BASE + "/trabajo", { cache: "no-store" });
      if (r.status === 200) {
        const j = await r.json();
        if (j && j.url) {
          ocupado = true;
          await procesar(j.id, j.url, j.previo || null);
          ocupado = false;
        }
      }
    } catch (e) { /* puente caído: se reintenta en el siguiente ciclo */ }
  }
  setTimeout(bucle, 700);
}

bucle();
