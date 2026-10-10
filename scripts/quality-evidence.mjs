import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exec = promisify(execFile);
const sha = value => createHash("sha256").update(value).digest("hex");
const out = path.resolve(root, process.argv[2] ?? `reports/plan-20-de-20/quality-${new Date().toISOString().replace(/[:.]/gu, "-")}`);
await mkdir(out, { recursive: true });
async function fingerprint() {
  const { stdout } = await exec("git", ["ls-files", "-c", "-o", "--exclude-standard", "-z"], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const paths = [...new Set(stdout.split("\0").filter(p =>
    /^(src\/|test\/|migrations\/|scripts\/|web\/(src|scripts|tests)\/|\.github\/|data\/genres\/)/u.test(p) ||
    /^(?:web\/)?(package(-lock)?\.json|tsconfig\.json|vitest\.config\.ts|vite\.config\.ts|eslint\.config\.js|crv_simple_v1\.sql)$/u.test(p)))].sort();
  const files = {};
  for (const name of paths) files[name] = sha(await readFile(path.join(root, name)));
  return { hash: sha(JSON.stringify(files)), files };
}
const baseline = await fingerprint();
const { stdout: commit } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
const report = { commit: commit.trim(), node: process.version, startedAt: new Date().toISOString(), source: baseline, checks: [], unchanged: true, passed: false };
const steps = [
  ["typecheck", ["run", "typecheck"]], ["lint", ["run", "lint"]],
  ["unit", ["run", "test:unit"]], ["web-unit", ["run", "test:web"]],
  ["contract", ["run", "test:contract"]], ["backend-build", ["run", "build"]],
  ["web-build", ["--prefix", "web", "run", "build"]], ["browser", ["run", "test:browser"]],
];
for (const [name, args] of steps) {
  const startedAt = new Date().toISOString();
  console.log(`Verificando ${name}; evidencia en ${path.join(out, `${name}.log`)}`);
  const log = createWriteStream(path.join(out, `${name}.log`));
  const code = await new Promise((resolve, reject) => {
    const child = spawn("npm", args, { cwd: root, env: { ...process.env, VITE_API_BASE_URL: "/api" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.once("error", reject);
    child.once("close", code => log.end(() => resolve(code ?? 1)));
  });
  const current = await fingerprint();
  report.unchanged &&= current.hash === baseline.hash;
  report.checks.push({ name, args, code, startedAt, finishedAt: new Date().toISOString(), sourceHash: current.hash });
  await writeFile(path.join(out, "quality.json"), JSON.stringify(report, null, 2) + "\n");
  if (code !== 0 || !report.unchanged) break;
}
report.passed = report.unchanged && report.checks.length === steps.length && report.checks.every(check => check.code === 0);
report.finishedAt = new Date().toISOString();
await writeFile(path.join(out, "quality.json"), JSON.stringify(report, null, 2) + "\n");
console.log(report.passed ? "Calidad aprobada sobre el mismo código." : "Calidad pendiente: consulta quality.json y los logs; ningún fallo se omite.");
process.exitCode = report.passed ? 0 : 1;
