// Compara los 33 renderers reales con NOX y verifica Bloodfall mejorado.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
const output = process.env.CRV_QA_OUT;
assert(output && process.env.CRV_QA_CDP, "Fija CRV_QA_CDP y CRV_QA_OUT (staging SSD)");
const source = await readFile(process.env.CRV_NOX_HTML ?? "/home/brian/Downloads/NOX_chat_demo.html", "utf8");
await writeFile(`${output}/NOX_chat_demo.html`, source);
const browser = await chromium.connectOverCDP(process.env.CRV_QA_CDP), checks = [];
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#090a10;color:#eef0f8;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif}#root{padding:25px}</style></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/visual/nox-effects.fixture.tsx"></script></body></html>`;
try {
 for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  try {
   const reference = await context.newPage(), system = await context.newPage(), errors = [];
   for (const page of [reference, system]) page.on("pageerror", error => errors.push(error.message));
   await reference.route("**/nox-reference", route => route.fulfill({ contentType: "text/html", body: source.replace("renderShop();\n})();", "renderShop();window.__nox={EFFECTS,makeNick,makeAvatar,makeBubble};\n})();") }));
   await system.route("**/nox-system", route => route.fulfill({ contentType: "text/html", body: html }));
   await reference.goto("http://127.0.0.1:5173/nox-reference");
   await system.goto("http://127.0.0.1:5173/nox-system");
   await system.waitForFunction(() => typeof window.renderNox === "function");
   const effects = await reference.evaluate(() => window.__nox.EFFECTS);
   for (const effect of effects) for (const kind of ["name", "frame", "bubble"]) {
    await reference.evaluate(({ effect, kind }) => {
     const api = window.__nox;
     const target = kind === "name" ? api.makeNick("TuNickname", effect.id) : kind === "frame" ? api.makeAvatar("T", effect.id) : api.makeBubble("Este es mi nuevo estilo ✧", effect.id);
     target.id = "reference"; document.body.replaceChildren(target); document.body.style.padding = "25px";
    }, { effect, kind });
    await system.evaluate(input => window.renderNox(input), { kind, preset: effect.id, enhanced: false });
    const selector = kind === "name" ? ".nox-name" : kind === "frame" ? ".nox-frame" : ".nox-bubble";
    await system.waitForFunction(selector => document.querySelector(selector) && !document.querySelector(selector).classList.contains("nox-still"), selector);
    for (const time of [0, 1200, 2700]) {
     const sample = (page, selector) => page.evaluate(({ selector, time }) => {
      const root = document.querySelector(selector);
      root.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = time; });
      const properties = ["color", "backgroundImage", "backgroundColor", "backgroundSize", "backgroundPosition", "borderColor", "borderWidth", "borderRadius", "boxShadow", "textShadow", "filter", "webkitTextFillColor", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "opacity", "transform", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight"];
      const read = (node, pseudo) => {
       const s = getComputedStyle(node, pseudo);
       return Object.fromEntries(properties.map(key => [key, s[key]]));
      };
      return { root: read(root), after: read(root, "::after"), children: [...root.children].map(child => ({ style: read(child), after: read(child, "::after") })) };
     }, { selector, time });
     assert.deepEqual(await sample(system, selector), await sample(reference, "#reference"), `${width}px ${effect.id}/${kind} @${time}`);
     checks.push({ width, preset: effect.id, kind, time, matched: true });
    }
   }
   // Letras, espacios, Unicode, nombre corto y límites del chat.
   for (const name of ["Bloodfall", "A", "A   A", "Ángel Ñandú", "ℓσв𝓎 🎸", "W".repeat(48)]) {
    await system.evaluate(name => window.renderNox({ kind: "name", preset: "blood", enhanced: true, name }), name);
    await system.waitForFunction(() => document.querySelectorAll(".nox-drop-anchor").length > 0);
    const bounds = await system.locator(".nox-bloodfall").evaluate(root => {
     const box = root.getBoundingClientRect(), ink = root.querySelector(".nox-blood-ink").getBoundingClientRect();
     return { width: box.width, viewport: innerWidth, bottom: box.bottom, inkBottom: ink.bottom, anchors: [...root.querySelectorAll(".nox-drop-anchor")].map(a => {
      const r = a.getBoundingClientRect(); return { x: r.x - ink.x, y: r.y - ink.y, height: r.height, inkWidth: ink.width, inkHeight: ink.height };
     }), animationNames: root.getAnimations({ subtree: true }).map(a => a.animationName) };
    });
    assert(bounds.width <= width - 50, `Bloodfall sin desbordamiento: ${name}`);
    assert(bounds.bottom > bounds.inkBottom + 10, "El goteo tiene espacio propio");
    for (const a of bounds.anchors) { assert(a.x >= 0 && a.x <= a.inkWidth); assert(a.y >= 0 && a.y < a.inkHeight); }
    assert(bounds.animationNames.includes("nox-bead-fall"), "Hay desprendimiento de gotas");
    checks.push({ width, enhanced: name, bounds });
   }
   for (const quality of ["low", "reduced"]) {
    await system.evaluate(quality => window.renderNox({ kind: "name", preset: "blood", enhanced: true, quality }), quality);
    assert.equal(await system.locator(".nox-bloodfall").evaluate(root => root.getAnimations({ subtree: true }).length), 0);
    checks.push({ width, staticQuality: quality });
   }
   await system.evaluate(() => window.renderNox({ kind: "name", preset: "blood", enhanced: true }));
   await system.waitForFunction(() => document.querySelector(".nox-bloodfall").getAnimations({ subtree: true }).length > 0);
   const cdp = await context.newCDPSession(system);
   await cdp.send("Performance.enable");
   const before = await cdp.send("Performance.getMetrics");
   const frames = await system.evaluate(() => new Promise(resolve => {
    const samples = []; let previous = 0;
    const sample = now => { if (previous) samples.push(now - previous); previous = now; if (samples.length === 90) resolve(samples); else requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
   }));
   const after = await cdp.send("Performance.getMetrics");
   const metric = (sample, name) => sample.metrics.find(m => m.name === name).value;
   const layouts = metric(after, "LayoutCount") - metric(before, "LayoutCount");
   assert(layouts <= 1, `Bloodfall no recalcula el layout por fotograma: ${layouts}`);
   checks.push({ width, performance: { layouts, medianFrameMs: [...frames].sort((a,b) => a-b)[45], p95FrameMs: [...frames].sort((a,b) => a-b)[85] } });
   await system.emulateMedia({ reducedMotion: "reduce" });
   await system.waitForFunction(() => document.querySelector(".nox-bloodfall").getAnimations({ subtree: true }).length === 0);
   checks.push({ width, reducedMotion: true });
   await system.emulateMedia({ reducedMotion: "no-preference" });
   await system.evaluate(() => window.showNoxGallery());
   await system.bringToFront();
   await system.screenshot({ path: `${output}/collection-${width}.png`, fullPage: true, animations: "disabled" });
   assert.deepEqual(errors, []);
  } finally { await context.close(); }
 }
 await writeFile(`${output}/results.json`, JSON.stringify({ sourceSha256: createHash("sha256").update(source).digest("hex"), checks }, null, 2));
 console.log(`NOX: ${checks.filter(c => c.matched).length} comparaciones fieles y ${checks.filter(c => !c.matched).length} verificaciones Bloodfall/accesibilidad OK`);
} finally { await browser.close(); }
