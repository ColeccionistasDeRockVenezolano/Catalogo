// Comprobación de la guarda del último administrador total (F1-3).
// Uso: CRV_ENV_FILE=... tsx scripts/checks/f1-last-admin.ts <projectId> <adminId>
import { setAdminRole } from "../../src/api/community/store.js";
import { ApiError } from "../../src/api/http-errors.js";

const project = Number(process.argv[2]);
const adminId = Number(process.argv[3]);
if (!project || !adminId) {
  console.error("faltan projectId o adminId");
  process.exit(2);
}
try {
  await setAdminRole(project, adminId, "curator");
  console.log("FAIL: permitió degradar al último admin");
  process.exit(1);
} catch (error) {
  if (error instanceof ApiError && error.statusCode === 409 && error.code === "last_admin") {
    console.log("OK: last_admin");
    process.exit(0);
  }
  console.error("FAIL: error inesperado", error);
  process.exit(1);
}
