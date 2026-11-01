// Clasificador de tráfico y aritmética de prefijos (ventana 3.7).
//
// Portado de `herra-separacion/src/traffic/classify.test.ts` (1.1.10) y
// contrastado con `herra-1.1.36/dist/traffic/classify.test.js`: mismas reglas,
// sin la prueba de robots.txt (CRV no tiene política de robots propia todavía).
// Son funciones puras: no arrancan servidor ni tocan la red.
import { describe, expect, it } from "vitest";
import { classifySignals, type RequestSignals } from "../../src/traffic/classify.js";
import { extractPrefixes, ipInPrefixes, parsePrefix } from "../../src/traffic/verify.js";

const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAFARI_OLD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15";

function navigation(overrides: Partial<RequestSignals> = {}): RequestSignals {
  return {
    kind: "navigation", userAgent: CHROME,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    acceptLanguage: "es-VE,es;q=0.9", secFetchMode: "navigate", secFetchSite: "none",
    signatureAgent: "", webdriver: false, ...overrides,
  };
}

function beacon(overrides: Partial<RequestSignals> = {}): RequestSignals {
  return navigation({ kind: "beacon", accept: "*/*", secFetchMode: "cors", secFetchSite: "same-origin", ...overrides });
}

describe("clasificación de tráfico", () => {
  it("un navegador coherente es una persona probable", () => {
    expect(classifySignals(navigation()).category).toBe("human");
    expect(classifySignals(beacon()).category).toBe("human");
  });

  it("reconoce a los rastreadores de IA aunque se presenten como Mozilla", () => {
    const gpt = classifySignals(navigation({ userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot" }));
    expect([gpt.category, gpt.agent]).toEqual(["ai", "gptbot"]);
    const claude = classifySignals(navigation({ userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" }));
    expect([claude.category, claude.agent]).toEqual(["ai", "claudebot"]);
    expect(classifySignals(navigation({ userAgent: "Mozilla/5.0 (compatible; Google-CloudVertexBot)" })).agent).toBe("google-cloudvertexbot");
  });

  it("da su propia categoría a buscadores y vistas previas", () => {
    const google = classifySignals(navigation({ userAgent: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }));
    expect([google.category, google.agent]).toEqual(["search", "googlebot"]);
    const whatsapp = classifySignals(navigation({ userAgent: "WhatsApp/2.23.20.0" }));
    expect([whatsapp.category, whatsapp.agent]).toEqual(["bot", "whatsapp"]);
  });

  it("no deja pasar como personas a Lighthouse ni a los navegadores sin interfaz", () => {
    const lighthouse = classifySignals(beacon({ userAgent: `${CHROME} Chrome-Lighthouse` }));
    expect([lighthouse.category, lighthouse.agent]).toEqual(["bot", "lighthouse"]);
    expect(classifySignals(beacon({ userAgent: CHROME.replace("Chrome/", "HeadlessChrome/") })).category).toBe("bot");
  });

  it("manda a bots las herramientas y los agentes sin User-Agent", () => {
    const empty = classifySignals(navigation({ userAgent: "" }));
    expect([empty.category, empty.agent]).toEqual(["bot", "no-user-agent"]);
    expect(classifySignals(navigation({ userAgent: "curl/8.5.0" })).agent).toBe("curl");
    expect(classifySignals(navigation({ userAgent: "python-requests/2.32" })).agent).toBe("python");
    expect(classifySignals(navigation({ userAgent: "node" })).agent).toBe("node-http");
    expect(classifySignals(navigation({ userAgent: "SomeCrawler/1.0 (+https://example.com/bot)" })).agent).toBe("other-bot");
  });

  it("marca como sospechosas las imitaciones torpes de navegador", () => {
    expect(classifySignals(navigation({ acceptLanguage: "" })).category).toBe("suspicious");
    expect(classifySignals(beacon({ acceptLanguage: "*" })).category).toBe("suspicious");
    expect(classifySignals(navigation({ secFetchMode: "" })).category).toBe("suspicious");
    expect(classifySignals(navigation({ accept: "*/*" })).category).toBe("suspicious");
    expect(classifySignals(beacon({ webdriver: true })).category).toBe("suspicious");
    expect(classifySignals(beacon({ secFetchSite: "cross-site" })).category).toBe("suspicious");
    // Un Safari anterior a 16.4 no manda Sec-Fetch: no se le puede exigir.
    expect(classifySignals(navigation({ userAgent: SAFARI_OLD, secFetchMode: "", secFetchSite: "" })).category).toBe("human");
  });

  it("declara como IA a los agentes con firma HTTP", () => {
    const agent = classifySignals(navigation({ signatureAgent: '"https://chatgpt.com"' }));
    expect([agent.category, agent.agent]).toEqual(["ai", "chatgpt-agent"]);
  });
});

describe("prefijos de IP", () => {
  it("entiende IPv4, IPv6 e IPv4 mapeada", () => {
    expect(ipInPrefixes("192.0.2.77", ["192.0.2.0/24"])).toBe(true);
    expect(ipInPrefixes("192.0.3.1", ["192.0.2.0/24"])).toBe(false);
    expect(ipInPrefixes("::ffff:192.0.2.9", ["192.0.2.0/28"])).toBe(true);
    expect(ipInPrefixes("2001:4860:4801:10::abcd", ["2001:4860:4801:10::/64"])).toBe(true);
    expect(ipInPrefixes("2001:4860:4801:11::1", ["2001:4860:4801:10::/64"])).toBe(false);
    expect(ipInPrefixes("10.0.0.1", ["2001:db8::/32"])).toBe(false);
    expect(parsePrefix("not-an-ip/24")).toBeNull();
    expect(parsePrefix("192.0.2.0/33")).toBeNull();
    expect(extractPrefixes({ prefixes: [{ ipv4Prefix: "192.0.2.0/24" }, { ipv6Prefix: "2001:db8::/32" }, { other: 1 }] }))
      .toEqual(["192.0.2.0/24", "2001:db8::/32"]);
    expect(extractPrefixes({ nope: [] })).toBeNull();
  });
});
