// CRV · Límites de la API sobre el pool compartido (src/db/client.ts). Una lectura web
// que pase de 2 minutos se cancela en PostgreSQL; las rutas que necesitan menos
// fijan su propio SET LOCAL. Se pueden ajustar por entorno.
// env.js carga antes el .env: sus valores mandan sobre estos predeterminados.
import "../config/env.js";

const API_DB_DEFAULTS: Record<string, string> = {
  CRV_DB_POOL_MAX: "12",
  CRV_DB_CONNECTION_TIMEOUT_MS: "15000",
  CRV_DB_STATEMENT_TIMEOUT_MS: "120000",
  CRV_DB_IDLE_TX_TIMEOUT_MS: "60000",
  CRV_DB_APPLICATION_NAME: "crv-api",
};
for (const [key, value] of Object.entries(API_DB_DEFAULTS)) process.env[key] ??= value;
