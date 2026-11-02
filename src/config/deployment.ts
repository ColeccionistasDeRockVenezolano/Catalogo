// CRV · Guarda de despliegue de las instancias de la Fase 2B.
//
// La API del dominio comparte la base `crv` con el catálogo y el proceso de la
// portada comparte el árbol de release con el panel privado. Un error de
// configuración (arrancar contra `crv_staging`, apuntar a `:8080` o `:8082`,
// servir `dist-staging`) publicaría datos de ensayo o duplicaría trabajos de
// fondo. Esta guarda aborta el arranque antes de escuchar.
//
// `CRV_DEPLOYMENT=production` activa las comprobaciones; `rehearsal` las admite
// de forma explícita para los ensayos sobre `crv_staging`; sin la variable se
// conserva el comportamiento histórico (catálogo y staging no cambian).
import { getPool } from "../db/client.js";

export type Deployment = "legacy" | "production" | "rehearsal";

export interface DeploymentGuardInput {
  deployment: Deployment;
  role: "api" | "gateway";
  /** Puerto propio del proceso (API) o del gateway. */
  port: number;
  /** Solo gateway: puerto de la API a la que reenvía. */
  apiPort?: number;
  /** Solo gateway: prefijo público (`""` para la raíz, `crv` para el catálogo). */
  publicPath?: string;
  /** Solo gateway: `landing` o `catalog`. */
  webMode?: string;
  /** Solo gateway: directorio del build (`dist`, `dist-public`). */
  webDist?: string;
  /** Solo API: secreto de la huella diaria. */
  visitsSecret?: string;
  /** Solo API: nombre real de la base (`current_database()`). */
  dbName?: string;
  /** Solo API: `CRV_BACKGROUND_JOBS`; en el dominio debe estar apagado. */
  backgroundJobs?: boolean;
  /** Solo API: la portada del dominio pinta la tarjeta de radio. */
  radioEnabled?: boolean;
  radioDataDir?: string;
  radioLiveUrl?: string;
  /** Solo API: tras el corte de la Fase 3 la emisión es de CRV y no hay Herra a quien preguntar. */
  radioOwner?: boolean;
}

const PRODUCTION_PORTS = new Set([8080, 8082]);

function fail(message: string): never {
  throw new Error(`CRV deployment guard: ${message}`);
}

/** Comprobaciones puras (sin base de datos); se pueden probar con vitest. */
export function assertDeploymentGuards(input: DeploymentGuardInput): void {
  if (input.deployment === "legacy") return;
  if (input.deployment === "rehearsal") return;

  if (input.role === "api") {
    if (PRODUCTION_PORTS.has(input.port)) {
      fail(`la API de producción no puede escuchar en :${input.port} (usa :8083)`);
    }
    if (!input.visitsSecret || input.visitsSecret.length < 32) {
      fail("falta CRV_VISITS_SECRET (mínimo 32 caracteres) en producción");
    }
    if (input.backgroundJobs !== false) {
      fail("CRV_BACKGROUND_JOBS debe ser false: esta API comparte la base con la del catálogo");
    }
    if (!input.radioEnabled || !input.radioDataDir || (!input.radioLiveUrl && !input.radioOwner)) {
      fail("la portada perdería la radio: faltan CRV_RADIO_ENABLED=true, CRV_RADIO_DATA_DIR, o CRV_RADIO_LIVE_URL (emite Herra) o CRV_RADIO_OWNER=true (emite CRV)");
    }
    if (!input.dbName) fail("no se pudo comprobar current_database() en producción");
    if (/staging/iu.test(input.dbName)) {
      fail(`la API de producción apunta a la base «${input.dbName}»; se espera «crv»`);
    }
    return;
  }

  if (input.apiPort === undefined || PRODUCTION_PORTS.has(input.apiPort)) {
    fail(`el gateway de producción no puede apuntar a :${input.apiPort ?? "?"} (usa :8083)`);
  }
  const mode = input.webMode ?? "catalog";
  const publicPath = input.publicPath ?? "";
  if (mode === "landing" && publicPath !== "") {
    fail(`la portada de producción debe servirse en la raíz, no en /${publicPath}`);
  }
  if (mode === "catalog" && publicPath !== "crv") {
    fail(`el panel privado debe servirse en /crv, no en «/${publicPath}»`);
  }
  if (mode !== "landing" && mode !== "catalog") fail(`CRV_WEB_MODE inválido: ${mode}`);
  if (/staging/iu.test(input.webDist ?? "")) {
    fail(`el gateway de producción no puede servir «${input.webDist}» (build de staging)`);
  }
}

/** Comprueba la base real antes de escuchar; solo en producción. */
export async function assertProductionDatabase(deployment: Deployment): Promise<string | undefined> {
  if (deployment !== "production") return undefined;
  const { rows } = await getPool().query<{ db: string }>("SELECT current_database() AS db");
  return rows[0]?.db ?? "";
}
