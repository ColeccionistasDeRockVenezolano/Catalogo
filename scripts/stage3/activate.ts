/** Registra una activación o desactivación de Laya (etapa 3) como operador; mismas reglas que la API. */
import { recordLayaActivation } from "../../src/search/laya-models.js";
import { closeDb } from "../../src/db/client.js";

const [task, modelId, action, actor, ...reason] = process.argv.slice(2);
try {
  const r = await recordLayaActivation({ task, modelId, action, reason: reason.join(" ") } as Parameters<typeof recordLayaActivation>[0], actor!);
  console.log(JSON.stringify(r));
} finally {
  await closeDb();
}
