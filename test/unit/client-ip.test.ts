// CRV · IP real detrás del túnel (Fase 2A.3).
//
// `clientIp` decide los límites por IP (candidaturas, visitas, sesiones del
// chat). Detrás de Cloudflare, el XFF puede terminar siempre en la IP del
// túnel; `CF-Connecting-IP` es la única fuente real, pero aceptarla sin más
// permitiría que cualquiera eligiera su IP. Estas pruebas fijan las tres
// condiciones: interruptor encendido, peer local y valor con forma de IP.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { clientIp } from "../../src/api/auth.js";
import { resetEnvCache } from "../../src/config/env.js";

function fake(peer: string, headers: Record<string, string>, ip = peer): FastifyRequest {
  return {
    headers,
    ip,
    raw: { socket: { remoteAddress: peer } },
  } as unknown as FastifyRequest;
}

function withTrust(enabled: boolean): void {
  process.env["CRV_TRUST_CF_HEADERS"] = enabled ? "true" : "false";
  resetEnvCache();
}

afterEach(() => {
  delete process.env["CRV_TRUST_CF_HEADERS"];
  resetEnvCache();
});

describe("clientIp detrás del túnel", () => {
  it("con el interruptor encendido y peer local, usa CF-Connecting-IP", () => {
    withTrust(true);
    expect(clientIp(fake("127.0.0.1", { "cf-connecting-ip": "190.45.12.7", "x-forwarded-for": "10.9.9.9" }))).toBe("190.45.12.7");
    expect(clientIp(fake("::ffff:127.0.0.1", { "cf-connecting-ip": "190.45.12.7" }))).toBe("190.45.12.7");
    expect(clientIp(fake("::1", { "cf-connecting-ip": "2a00:1450:4001:800::200e" }))).toBe("2a00:1450:4001:800::200e");
  });

  it("ignora CF-Connecting-IP y XFF si el peer NO es local (cliente directo)", () => {
    withTrust(true);
    expect(clientIp(fake("190.45.12.7", { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "8.8.8.8" }))).toBe("190.45.12.7");
  });

  it("con el interruptor apagado usa el último X-Forwarded-For", () => {
    withTrust(false);
    expect(clientIp(fake("127.0.0.1", { "cf-connecting-ip": "190.45.12.7", "x-forwarded-for": "1.1.1.1, 10.9.9.9" }))).toBe("10.9.9.9");
  });

  it("descarta cabeceras sin forma de IP y cae al XFF", () => {
    withTrust(true);
    expect(clientIp(fake("127.0.0.1", { "cf-connecting-ip": "no-es-una-ip", "x-forwarded-for": "10.9.9.9" }))).toBe("10.9.9.9");
    expect(clientIp(fake("127.0.0.1", { "cf-connecting-ip": "999.1.1.1", "x-forwarded-for": "10.9.9.9" }))).toBe("10.9.9.9");
    expect(clientIp(fake("127.0.0.1", { "cf-connecting-ip": "" }))).toBe("127.0.0.1");
  });

  it("sin proxy delante devuelve la IP del socket", () => {
    withTrust(true);
    expect(clientIp(fake("192.0.2.44", {}))).toBe("192.0.2.44");
  });
});
