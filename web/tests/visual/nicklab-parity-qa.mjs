// Compara el renderer real con el HTML de referencia, sin modificar el catálogo.
// CRV_QA_CDP=http://127.0.0.1:38055 CRV_QA_OUT=<staging SSD> node web/tests/visual/nicklab-parity-qa.mjs
/* global PRESETS, normalize, nickname */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const output = process.env.CRV_QA_OUT;
assert(output && process.env.CRV_QA_CDP, "Fija CRV_QA_CDP y CRV_QA_OUT (staging SSD)");
const source = await readFile(process.env.CRV_NICKLAB_HTML ?? "/home/brian/Desktop/nicklab_editor_v2.html", "utf8");
const browser = await chromium.connectOverCDP(process.env.CRV_QA_CDP);
const checks = [];
try {
 for (const width of [1440, 390]) {
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  try {
   const reference = await context.newPage(), system = await context.newPage();
   const errors = [];
   for (const page of [reference, system]) page.on("pageerror", error => errors.push(error.message));
   await reference.route("**/nicklab-reference", route => route.fulfill({ contentType: "text/html", body: source }));
   await system.route("**/nicklab-system", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#f5f5f5;padding:30px"><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/visual/nicklab-parity.fixture.tsx"></script></body></html>` }));
   await reference.goto("http://127.0.0.1:5173/nicklab-reference");
   await system.goto("http://127.0.0.1:5173/nicklab-system");
   await system.waitForFunction(() => typeof window.renderNick === "function");
   // Cada preset del HTML, incluidos estáticos, más las variantes sin sombra.
   const presets = await reference.evaluate(() => PRESETS.map(p => normalize(p)));
   const variants = [37, 123, 271].flatMap(motionAngle => ["wave", "flow"].map(animation => ({ ...presets[0], id: `${animation}-${motionAngle}`, animation, motionAngle, gradientAngle: motionAngle, direction: "alternate-reverse" })));
   for (const p of [...presets, ...variants, ...presets.filter(p => ["pulse", "sparkle"].includes(p.animation)).map(p => ({ ...p, id: p.id + "-no-shadow", disableShadows: true }))]) {
    await reference.evaluate(p => {
     document.body.replaceChildren();
     const target = nickname({ ...p, badge: "none" }); target.id = "reference";
     document.body.append(target); document.body.style.background = "#f5f5f5"; document.body.style.padding = "30px";
    }, p);
    await system.evaluate(p => window.renderNick(p.nick, window.nickReferences[p.id] ?? {
     family: p.font, size: p.size, weight: p.weight, italic: p.italic === "italic", tracking: p.tracking,
     colors: [p.c1, p.c2, p.c3], gradient: p.gradient, gradientAngle: p.gradientAngle,
     outlineColor: p.outline, outlineWidth: p.outlineWidth, shadow: !p.disableShadows,
     shadowColor: p.shadow, shadowBlur: p.glow, animation: p.animation,
     duration: p.speed, direction: p.direction, motionAngle: p.motionAngle,
     stagger: p.stagger, prefix: p.prefix, suffix: p.suffix,
    }), p);
    await system.waitForFunction(name => document.querySelector(".crv-styled-name")?.getAttribute("aria-label") === name, p.prefix + p.nick + p.suffix);
    if (p.animation !== "none") await system.waitForFunction(() => document.querySelector(".crv-styled-name.is-live"));
    for (const fraction of [0, .5, .77, 1]) {
     const time = p.speed * 1000 * fraction;
     const snapshot = async (page, original) => page.evaluate(({ original, time }) => {
      const root = document.querySelector(original ? "#reference" : ".ns-text");
      root.getAnimations({ subtree: true }).forEach(a => { a.pause(); a.currentTime = time; });
      const read = element => {
       const s = getComputedStyle(element), r = element.getBoundingClientRect(), parent = root.getBoundingClientRect();
       return { text: element.textContent, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, fontStyle: s.fontStyle,
        letterSpacing: s.letterSpacing, lineHeight: s.lineHeight, color: s.color, fill: s.webkitTextFillColor,
        stroke: s.webkitTextStroke, background: s.backgroundImage, backgroundSize: s.backgroundSize,
        backgroundPosition: s.backgroundPosition, filter: s.filter, textShadow: s.textShadow, opacity: s.opacity,
        width: r.width, height: r.height, x: r.x - parent.x, y: r.y - parent.y };
      };
      return { groupFilter: getComputedStyle(root.querySelector(original ? ".glyphs" : ".ns-glyphs")).filter,
       glyphs: [...root.querySelectorAll(original ? ".glyph" : ".ns-glyph")].map(read),
       symbols: [...root.querySelectorAll(original ? ".nick-symbol" : ".ns-symbol")].map(read) };
     }, { original, time });
     const expected = await snapshot(reference, true), actual = await snapshot(system, false);
     assert.deepEqual(actual, expected, `${width}px ${p.id} ciclo=${fraction}`);
     checks.push({ width, preset: p.id, fraction, matched: true });
    }
   }
   await reference.bringToFront();
   await reference.locator("#reference").screenshot({ path: `${output}/reference-${width}.png`, animations: "disabled" });
   await system.bringToFront();
   await system.screenshot({ animations: "disabled", path: `${output}/system-${width}.png` });
   assert.deepEqual(errors, []);
  } finally { await context.close(); }
 }
 await writeFile(`${output}/parity.json`, JSON.stringify(checks, null, 2));
 console.log(`NickLab: ${checks.length} comparaciones exactas de CSS calculado, geometría y animación OK`);
} finally { await browser.close(); }
