import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import sharp, { type OutputInfo } from "sharp";
import { IMAGE_UPLOAD_MAX_BYTES, IMAGE_UPLOAD_MAX_PIXELS, IMAGE_UPLOAD_TYPES } from "../../shared/image-upload.js";
import { OPERATOR_SECURITY } from "../auth.js";
import { ApiError } from "../http-errors.js";
import { createWindowLimiter } from "../rate-limit.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Una subida de galería es una campaña corta: SSD, publicación verificada, HDD. */
async function publishGalleryImage(data: Buffer, hash: string): Promise<string> {
  await execFileAsync("python3", ["scripts/shared-storage.py", "status"]);
  const campaign = `gallery-upload-${randomUUID()}`;
  const { stdout } = await execFileAsync("python3", ["scripts/staging.py", "new", "web/public/media", campaign]);
  const directory = stdout.trim().split("\n")[0]!;
  await writeFile(path.join(directory, `${hash}.webp`), data, { flag: "wx", mode: 0o644 });
  // Si falla se conserva el staging para poder recuperar/publicar la captura.
  await execFileAsync("python3", ["scripts/staging.py", "publish", "web/public/media", campaign, "--hash"]);
  return `/crv/media/${campaign}/${hash}.webp`;
}

/** Se conservan fuera del build de Vite; el gateway y Vite sirven public/media. */
export async function registerImageUploadRoutes(app: FastifyInstance, mediaRoot = path.resolve("web/public/media"), gallery = false): Promise<void> {
  // Parser encapsulado: no amplía el límite ni los tipos de las demás rutas.
  await app.register(async (uploads) => {
    const budget = createWindowLimiter({ max: gallery ? 120 : 12, windowMs: 60_000, maxKeys: 1000 });
    let processing = 0;
    uploads.addContentTypeParser([...IMAGE_UPLOAD_TYPES], { parseAs: "buffer", bodyLimit: IMAGE_UPLOAD_MAX_BYTES }, (_request, body, done) => done(null, body));
    uploads.post<{ Body: Buffer }>(gallery ? "/media/gallery-uploads" : "/media/uploads", {
      bodyLimit: IMAGE_UPLOAD_MAX_BYTES,
      schema: { tags: ["media"], security: OPERATOR_SECURITY, description: "Sube una imagen del catálogo (solo administración). Cuerpo binario image/jpeg, png, webp, gif o avif; máximo 12 MiB. Devuelve una URL local que se guarda mediante los editores auditados." },
      onRequest: async (request, reply) => {
        reply.header("cache-control", "no-store");
        // El hook global ya comprobó rol, origen, sesión y CSRF antes de leer el cuerpo.
        if (!request.operator) throw new ApiError(401, "unauthorized", "Inicia sesión con una cuenta administradora.");
        if (!budget.take(request.operator)) {
          reply.header("retry-after", "60");
          throw new ApiError(429, "upload_rate_limited", "Demasiadas imágenes seguidas. Espera un minuto y vuelve a intentarlo.");
        }
      },
    }, async (request, reply) => {
      if (processing >= 2) throw new ApiError(429, "uploads_busy", "Hay otras imágenes procesándose. Vuelve a intentarlo en unos segundos.");
      const body = request.body;
      if (!Buffer.isBuffer(body) || !body.length) throw new ApiError(400, "invalid_image", "Selecciona una imagen que no esté vacía.");
      processing += 1;
      try {
        let output: { data: Buffer; info: OutputInfo };
        try {
          const image = sharp(body, { limitInputPixels: IMAGE_UPLOAD_MAX_PIXELS, failOn: "warning" });
          const metadata = await image.metadata();
          // Se rechaza SVG/TIFF/HTML aunque vengan declarados como PNG. No se
          // conserva ningún byte original ni metadato EXIF, XMP o nombre del cliente.
          const formats: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heif: "image/avif" };
          const actualType = formats[metadata.format ?? ""];
          const declared = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
          if (!actualType || actualType !== declared || (metadata.format === "heif" && metadata.compression !== "av1")) throw new Error("Formato no permitido");
          output = await image.rotate().resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 92, alphaQuality: 100, effort: 4 }).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
        } catch {
          throw new ApiError(422, "invalid_image", "La imagen no es válida o supera 40 megapíxeles. Usa un JPG, PNG, WebP, GIF o AVIF válido de hasta 12 MiB.");
        }
        const hash = createHash("sha256").update(output.data).digest("hex");
        if (gallery) {
          const url = await publishGalleryImage(output.data, hash);
          request.log.info({ operator: request.operator, url, bytes: output.info.size }, "gallery_image_uploaded");
          return reply.code(201).send({ url, width: output.info.width, height: output.info.height, bytes: output.info.size });
        }
        const directory = path.join(mediaRoot, "uploads");
        await mkdir(directory, { recursive: true });
        const temporary = path.join(directory, `.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, output.data, { flag: "wx", mode: 0o644 });
          await rename(temporary, path.join(directory, `${hash}.webp`));
        } finally {
          await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
        }
        const url = `/crv/media/uploads/${hash}.webp`;
        request.log.info({ operator: request.operator, url, bytes: output.info.size, width: output.info.width, height: output.info.height }, "catalog_image_uploaded");
        return reply.code(201).send({ url, width: output.info.width, height: output.info.height, bytes: output.info.size });
      } finally {
        processing -= 1;
      }
    });
  });
}
