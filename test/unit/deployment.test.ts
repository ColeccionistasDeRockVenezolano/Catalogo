import { describe, expect, it } from "vitest";
import { assertDeploymentGuards } from "../../src/config/deployment.js";

const SECRET = "x".repeat(32);

describe("guarda de despliegue de la Fase 2B", () => {
  it("admite la API de producción con base crv, :8083 y secreto", () => {
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "api", port: 8083, visitsSecret: SECRET, dbName: "crv",
    })).not.toThrow();
  });

  it("aborta si la API de producción apunta a una base con «staging»", () => {
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "api", port: 8083, visitsSecret: SECRET, dbName: "crv_staging",
    })).toThrow(/staging/u);
  });

  it("aborta si la API de producción usa :8080 o :8082 o no tiene secreto", () => {
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "api", port: 8080, visitsSecret: SECRET, dbName: "crv",
    })).toThrow(/:8080/u);
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "api", port: 8082, visitsSecret: SECRET, dbName: "crv",
    })).toThrow(/:8082/u);
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "api", port: 8083, dbName: "crv",
    })).toThrow(/CRV_VISITS_SECRET/u);
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "api", port: 8083, visitsSecret: "corta", dbName: "crv",
    })).toThrow(/32/u);
  });

  it("admite la portada y el panel con su forma correcta", () => {
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "gateway", port: 3140, apiPort: 8083,
      publicPath: "", webMode: "landing", webDist: "dist",
    })).not.toThrow();
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "gateway", port: 3131, apiPort: 8083,
      publicPath: "crv", webMode: "catalog", webDist: "dist-public",
    })).not.toThrow();
  });

  it("aborta el gateway de producción si apunta a ensayo o sirve staging", () => {
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "gateway", port: 3140, apiPort: 8080,
      publicPath: "", webMode: "landing", webDist: "dist",
    })).toThrow(/:8080/u);
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "gateway", port: 3140, apiPort: 8082,
      publicPath: "", webMode: "landing", webDist: "dist-staging",
    })).toThrow(/:8082/u);
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "gateway", port: 3140, apiPort: 8083,
      publicPath: "crv", webMode: "landing", webDist: "dist",
    })).toThrow(/raíz/u);
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "gateway", port: 3131, apiPort: 8083,
      publicPath: "crv", webMode: "catalog", webDist: "dist-staging",
    })).toThrow(/staging/u);
  });

  it("el ensayo explícito admite staging y los puertos de ensayo", () => {
    expect(() => assertDeploymentGuards({
      deployment: "rehearsal", role: "api", port: 8082, dbName: "crv_staging",
    })).not.toThrow();
    expect(() => assertDeploymentGuards({
      deployment: "rehearsal", role: "gateway", port: 3150, apiPort: 8082,
      publicPath: "", webMode: "landing", webDist: "dist-staging",
    })).not.toThrow();
  });

  it("sin CRV_DEPLOYMENT no cambia el comportamiento histórico", () => {
    expect(() => assertDeploymentGuards({
      deployment: "legacy", role: "api", port: 8080, dbName: "crv_staging",
    })).not.toThrow();
  });
});
