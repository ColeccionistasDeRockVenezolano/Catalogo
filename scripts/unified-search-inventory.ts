import { readFile, writeFile, stat, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { getPool, closeDb } from "../src/db/client.js";
import { getEnv } from "../src/config/env.js";
const registryPath = new URL("../docs/unified-search/resources.json", import.meta.url);
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const measuredAt = new Date().toISOString();
for (const resource of registry.resources) {
  for (const location of resource.locations) {
    try { const info = await stat(location.location); location.exists = true;
      location.kind = info.isDirectory() ? "directory" : "file";
      location.entries = info.isDirectory() ? (await readdir(location.location)).length : null;
      location.bytes = info.isFile() ? info.size : null;
    } catch { location.exists = false; location.kind = "missing"; location.entries = null; location.bytes = null; }
  }
  resource.availability = resource.locations.some((l: {exists:boolean}) => l.exists) ? "available" : "unavailable";
}
registry.checkedAt = measuredAt;
await writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
const tables = ["ingest.artist_search_suggestions", "ingest.artist_discovery_labels", "ingest.discovery_metric_events", "ingest.discovery_metric_daily", "ingest.discovery_metric_jobs", "ingest.track_context_proposals", "ingest.track_context_assignments", "ingest.track_context_evaluations", "ingest.recommendation_requests", "ingest.recommendation_feedback", "ingest.search_misses", "ingest.emotion_tag_decisions", "ingest.lastfm_artist_verifications", "public.entity_user_tags", "public.entity_metrics", "public.entity_emotions", "public.entity_shouts"];
const counts: Record<string, unknown> = {};
try {
  for (const table of tables) {
    const exists = (await getPool().query("SELECT to_regclass($1) AS t", [table])).rows[0]?.t;
    counts[table] = exists ? Number((await getPool().query(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n) : "absent";
  }
  const migrations = (await getPool().query("SELECT version,applied_at FROM ingest.schema_migrations ORDER BY version")).rows;
  const systemd = (args: string[]) => { try { return execFileSync("systemctl", ["--user", ...args], { encoding: "utf8" }); } catch { return "unavailable"; } };
  const inventory = { version: "crv-search-inventory-v1", measuredAt,
    flags: Object.fromEntries(Object.entries(getEnv()).filter(([key]) => /DISCOVERY|RECOMMEND/.test(key) && !/SECRET|TOKEN|KEY/.test(key))),
    migrations, counts, services: systemd(["list-units", "--type=service", "--all", "--no-pager"] ).split("\n").filter(s => /crv-/u.test(s)),
    timers: systemd(["list-timers", "--all", "--no-pager"]).split("\n").filter(s => /crv-/u.test(s)),
    deployment: systemd(["show", "crv-api", "crv-web", "-p", "ExecStart", "-p", "WorkingDirectory", "-p", "FragmentPath"]),
    safeguards: { shouts: "API restricts basis=tags and verified identities; capture/import/classify scripts raise SystemExit", musicalValidation: "not inferred from rows or passing software tests" },
  };
  await writeFile(new URL("../reports/unified-search-stage1/inventory.json", import.meta.url), JSON.stringify(inventory, null, 2) + "\n");
  console.log(JSON.stringify({ measuredAt, resources: registry.resources.length, counts }));
} finally { await closeDb(); }
