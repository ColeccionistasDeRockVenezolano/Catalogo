import { describe, expect, it } from "vitest";
import { assertDeploymentGuards } from "../../src/config/deployment.js";

const SECRET = "x".repeat(32);
const API = {
  deployment: "production", role: "api", port: 8083, visitsSecret: SECRET, dbName: "crv",
  backgroundJobs: false, radioEnabled: true,
  radioDataDir: "/datos", radioLiveUrl: "http://127.0.0.1:3020/api/radio/now",
} as const;

describe("guarda de despliegue de la Fase 2B", () => {
  it("admite la API de producción con base crv, :8083 y secreto", () => {
    expect(() => assertDeploymentGuards({
      ...API, port: 8083, dbName: "crv",
    })).not.toThrow();
  });

  it("aborta si la API de producción apunta a una base con «staging»", () => {
    expect(() => assertDeploymentGuards({
      ...API, port: 8083, dbName: "crv_staging",
    })).toThrow(/staging/u);
  });

  it("aborta si la API de producción usa :8080 o :8082 o no tiene secreto", () => {
    expect(() => assertDeploymentGuards({
      ...API, port: 8080, dbName: "crv",
    })).toThrow(/:8080/u);
    expect(() => assertDeploymentGuards({
      ...API, port: 8082, dbName: "crv",
    })).toThrow(/:8082/u);
    expect(() => assertDeploymentGuards({
      deployment: "production", role: "api", port: 8083, dbName: "crv", backgroundJobs: false,
    })).toThrow(/CRV_VISITS_SECRET/u);
    expect(() => assertDeploymentGuards({
      ...API, visitsSecret: "corta",
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

  it("aborta si la API del dominio dejaría trabajos de fondo encendidos", () => {
    expect(() => assertDeploymentGuards({ ...API, backgroundJobs: true })).toThrow(/CRV_BACKGROUND_JOBS/u);
    const { backgroundJobs: _omitido, ...sinDefinir } = API;
    expect(() => assertDeploymentGuards(sinDefinir)).toThrow(/CRV_BACKGROUND_JOBS/u);
  });

  it("aborta si la portada del dominio perdería la radio", () => {
    expect(() => assertDeploymentGuards({ ...API, radioEnabled: false })).toThrow(/radio/u);
    const { radioLiveUrl: _a, ...sinLive } = API;
    expect(() => assertDeploymentGuards(sinLive)).toThrow(/radio/u);
    const { radioDataDir: _b, ...sinDatos } = API;
    expect(() => assertDeploymentGuards(sinDatos)).toThrow(/radio/u);
    expect(() => assertDeploymentGuards({ ...sinLive, radioOwner: false })).toThrow(/radio/u);
  });

  it("tras el corte, la API dueña de la radio no necesita a Herra", () => {
    const { radioLiveUrl: _a, ...sinLive } = API;
    expect(() => assertDeploymentGuards({ ...sinLive, radioOwner: true })).not.toThrow();
    const { radioDataDir: _b, ...sinDatos } = sinLive;
    expect(() => assertDeploymentGuards({ ...sinDatos, radioOwner: true })).toThrow(/radio/u);
  });
});
