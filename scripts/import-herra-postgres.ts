import { z } from "zod";
import { getEnv } from "../src/config/env.js";
import { closeDb, getPool } from "../src/db/client.js";
import { importHerra } from "../src/db/import-herra.js";

const source = process.argv[2];
if (!source) throw new Error("Uso: tsx scripts/import-herra-postgres.ts <respaldo-sqlite-verificado>");
const accounts = z.array(z.object({
  username: z.string().min(1), name: z.string().min(1), passwordHash: z.string().min(1),
  role: z.enum(["admin","reader"]).optional(),
}).strict()).parse(JSON.parse(getEnv().CRV_COLLABORATORS_JSON || "[]"));
try {
  console.log(JSON.stringify(await importHerra(getPool(),source,accounts),null,2));
} finally {
  await closeDb();
}
