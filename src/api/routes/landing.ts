import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { renderLanding } from "../../landing/render.js";
import { getPool } from "../../db/client.js";
import { projectId } from "../community/store.js";

export async function registerLandingRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get("/landing/:page", {
    schema: {
      tags: ["Roadmap"],
      params: z.object({ page: z.enum(["roadmap", "colaborar", "login", "registro", "activar"]) }),
      querystring: z.object({ lang: z.enum(["es", "en"]).optional(), token: z.string().max(200).optional() }),
    },
  }, async (request, reply) => {
    const session = request.viewer ? { ...request.viewer, userId: request.account?.kind === "user" ? request.account.id : null, csrf: request.csrfToken } : null;
    const html = await renderLanding(request.params.page, request.query.lang ?? "es", request.query.token ?? "", session);
    return reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(html);
  });
  api.get("/landing-media/:kind", {
    schema: { tags: ["Roadmap"], params: z.object({ kind: z.enum(["favicon", "share"]) }) },
  }, async (request, reply) => {
    const project = await projectId();
    const kind = request.params.kind === "share" ? "share_image" : "favicon";
    const result = await getPool().query<{ bytes: Buffer; mime_type: string; checksum: string }>(
      "SELECT bytes, mime_type, checksum FROM auth.project_assets WHERE project_id = $1 AND kind = $2", [project, kind],
    );
    const asset = result.rows[0];
    if (!asset) return reply.code(404).send();
    return reply.header("Cache-Control", "public, max-age=300").header("ETag", `"${asset.checksum}"`)
      .header("Cross-Origin-Resource-Policy", "cross-origin").type(asset.mime_type).send(asset.bytes);
  });
}
