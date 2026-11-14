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
    // El ensayo no depende de la rama ni del trabajo pendiente del checkout.
    await writeFile(join(dir, "git"), "#!/bin/sh\ncase \"$*\" in *'branch --show-current'*) printf master;; esac\n", { mode: 0o755 });
    await promisify(execFile)("bash", [resolve("scripts/deploy.sh")], {
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}`, CRV_DEPLOY_BRANCH: "master", CRV_DEPLOY_TRACE: trace },
    });
    const calls = await readFile(trace, "utf8");
    expect(calls).toContain("run build:public");
    expect(calls).toContain("restart crv-web");
    expect(calls).toContain("run --silent cache:clear");
    expect(calls).not.toContain("restart crv-api");
    expect(calls.indexOf("cache:clear")).toBeGreaterThan(calls.indexOf("restart crv-web"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("no compila ni reinicia cuando crv-web sirve otro release", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crv-deploy-pinned-"));
  const trace = join(dir, "trace");
  try {
    await writeFile(join(dir, "git"), "#!/bin/sh\ncase \"$*\" in *'branch --show-current'*) printf master;; esac\n", { mode: 0o755 });
    await writeFile(join(dir, "systemctl"), "#!/bin/sh\nprintf '%s\\n' '/releases/catalog/web'\n", { mode: 0o755 });
    await writeFile(join(dir, "npm"), "#!/bin/sh\nprintf called >> \"$CRV_DEPLOY_TRACE\"\n", { mode: 0o755 });
    await expect(promisify(execFile)("bash", [resolve("scripts/deploy.sh")], {
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}`, CRV_DEPLOY_BRANCH: "master", CRV_DEPLOY_TRACE: trace },
    })).rejects.toThrow("crv-web está fijada");
    await expect(readFile(trace, "utf8")).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
