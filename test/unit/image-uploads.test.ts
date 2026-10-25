import { scryptSync } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerOperatorAuth, resetAuthStateForTests } from "../../src/api/auth.js";
import { registerImageUploadRoutes } from "../../src/api/routes/image-uploads.js";
import { toApiError } from "../../src/api/http-errors.js";
import { resetEnvCache } from "../../src/config/env.js";
import { IMAGE_UPLOAD_MAX_BYTES } from "../../src/shared/image-upload.js";

const password = "password-image-upload-test";
const salt = Buffer.alloc(16, 3);
const passwordHash = `scrypt$16384$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;
const image = () => sharp({ create: { width: 24, height: 16, channels: 4, background: { r: 180, g: 12, b: 16, alpha: 0.5 } } });

describe("subida de imágenes exclusiva de administración", () => {
  let app: FastifyInstance;
  let directory: string;
  const previousEnv = { ...process.env };
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "crv-uploads-"));
    process.env["CRV_COLLABORATORS_JSON"] = JSON.stringify([
      { username: "upload.admin", name: "Admin imágenes", passwordHash, role: "admin" },
      { username: "upload.reader", name: "Lector imágenes", passwordHash, role: "reader" },
    ]);
    delete process.env["CRV_OPERATOR_TOKEN"];
    delete process.env["CRV_HERRA_DB_PATH"];
    resetEnvCache(); resetAuthStateForTests();
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error, _request, reply) => {
      const expected = toApiError(error);
      if (expected) return reply.status(expected.statusCode).send({ error: { code: expected.code } });
      return reply.send(error);
    });
    await registerOperatorAuth(app);
    await registerImageUploadRoutes(app, directory);
  });
  afterEach(async () => {
    await app.close(); await rm(directory, { recursive: true, force: true });
    for (const key of ["CRV_COLLABORATORS_JSON", "CRV_OPERATOR_TOKEN", "CRV_HERRA_DB_PATH"]) {
      if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    }
    resetEnvCache(); resetAuthStateForTests();
  });
  async function login(username = "upload.admin") {
    const result = await app.inject({ method: "POST", url: "/auth/login", payload: { username, password } });
    expect(result.statusCode, result.body).toBe(200);
    return { cookie: String(result.headers["set-cookie"]).split(";", 1)[0]!, "x-crv-csrf": result.json().csrf as string };
  }
  const upload = (payload: Buffer, headers: Record<string, string> = {}, type = "image/png") => app.inject({
    method: "POST", url: "/media/uploads", headers: { "content-type": type, ...headers }, payload,
  });

  it("bloquea visitantes, lectores, sesiones sin CSRF y orígenes ajenos antes de almacenar", async () => {
    const png = await image().png().toBuffer();
    expect((await upload(png)).statusCode).toBe(401);
    expect((await upload(png, await login("upload.reader"))).statusCode).toBe(403);
    const admin = await login();
    expect((await upload(png, { cookie: admin.cookie })).statusCode).toBe(403);
    expect((await upload(png, { ...admin, origin: "https://otro-sitio.invalid" })).statusCode).toBe(403);
    expect(await readdir(directory)).toEqual([]);
  });
  it.each(["jpeg", "png", "webp", "gif", "avif"] as const)("decodifica %s, preserva proporción y guarda solo WebP seguro", async format => {
    const payload = await image().toFormat(format).toBuffer();
    const response = await upload(payload, await login(), `image/${format}`);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const result = response.json();
    expect(result).toMatchObject({ url: expect.stringMatching(/^\/crv\/media\/uploads\/[a-f0-9]{64}\.webp$/), width: 24, height: 16, bytes: expect.any(Number) });
    const stored = await readFile(path.join(directory, "uploads", path.basename(result.url)));
    const metadata = await sharp(stored).metadata();
    expect(metadata.format).toBe("webp");
    if (format === "png") expect(metadata.hasAlpha).toBe(true);
    expect(metadata.exif).toBeUndefined(); expect(metadata.xmp).toBeUndefined();
    expect((await readdir(path.join(directory, "uploads")))).toEqual([path.basename(result.url)]);
  });
  it("elimina metadatos y contenido agregado, deduplica y no acepta nombres de ruta del cliente", async () => {
    const admin = await login();
    const original = await image().withExif({ IFD0: { Artist: "dato privado" } }).jpeg().toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const payload = Buffer.concat([original, Buffer.from("<script>contenido que no se conserva</script>")]);
    const first = await upload(payload, { ...admin, "x-filename": "../../escape.html" }, "image/jpeg");
    expect(first.statusCode, first.body).toBe(201);
    const second = await upload(payload, admin, "image/jpeg");
    expect(second.json().url).toBe(first.json().url);
    const stored = await readFile(path.join(directory, "uploads", path.basename(first.json().url)));
    expect(stored.includes(Buffer.from("<script>"))).toBe(false);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(await readdir(directory)).toEqual(["uploads"]);
    expect(await readdir(path.join(directory, "uploads"))).toHaveLength(1);
  });
  it("rechaza HTML, SVG encubierto, imágenes truncadas, MIME falso, vacíos y exceso de bytes", async () => {
    const admin = await login();
    const png = await image().png().toBuffer();
    for (const payload of [Buffer.from("<html>imagen falsa</html>"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>'), png.subarray(0, 30)]) {
      expect((await upload(payload, admin)).statusCode).toBe(422);
    }
    expect((await upload(png, admin, "image/jpeg")).statusCode).toBe(422);
    expect((await upload(Buffer.alloc(0), admin)).statusCode).toBe(400);
    expect((await upload(Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES + 1), admin)).statusCode).toBe(413);
    expect(await readdir(directory)).toEqual([]);
  });
  it("limita megapíxeles y reduce imágenes grandes sin deformar", async () => {
    const admin = await login();
    const large = await sharp({ create: { width: 6500, height: 6500, channels: 3, background: "black" } }).png().toBuffer();
    expect((await upload(large, admin)).statusCode).toBe(422);
    const wide = await sharp({ create: { width: 5000, height: 100, channels: 3, background: "red" } }).png().toBuffer();
    const result = await upload(wide, admin);
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json()).toMatchObject({ width: 4096, height: 82 });
  });
  it("limita subidas por administrador sin afectar los otros parsers", async () => {
    const admin = await login();
    const png = await image().png().toBuffer();
    for (let i = 0; i < 12; i++) expect((await upload(png, admin)).statusCode).toBe(201);
    const limited = await upload(png, admin);
    expect(limited.statusCode).toBe(429); expect(limited.headers["retry-after"]).toBe("60");
    expect(limited.json()).toMatchObject({ error: { code: "upload_rate_limited" } });
    expect((await app.inject({ method: "POST", url: "/auth/login", payload: { username: "upload.admin", password } })).statusCode).toBe(200);
  });
});
