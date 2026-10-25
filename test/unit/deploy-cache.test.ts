import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { expect, it } from "vitest";

it("npm run deploy invalida la caché sin reiniciar la API", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crv-deploy-cache-"));
  const trace = join(dir, "trace");
  try {
    for (const command of ["npm", "systemctl"]) {
      await writeFile(join(dir, command), `#!/bin/sh\nprintf '%s|%s|%s\\n' '${command}' "$PWD" "$*" >> "$CRV_DEPLOY_TRACE"\n`, { mode: 0o755 });
    }
    await writeFile(join(dir, "curl"), "#!/bin/sh\nprintf 200\n", { mode: 0o755 });
    await promisify(execFile)("bash", [resolve("scripts/deploy.sh")], {
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}`, CRV_DEPLOY_TRACE: trace },
    });
    const calls = await readFile(trace, "utf8");
    expect(calls).toContain("run build:public");
    expect(calls).toContain("restart crv-web");
    expect(calls).toContain("run --silent cache:clear");
    expect(calls).not.toContain("restart crv-api");
    expect(calls.indexOf("cache:clear")).toBeGreaterThan(calls.indexOf("restart crv-web"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
