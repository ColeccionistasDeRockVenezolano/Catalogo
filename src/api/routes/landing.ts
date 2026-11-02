import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { renderLanding } from "../../landing/render.js";
import { getPool } from "../../db/client.js";
import { projectId } from "../community/store.js";
import { clientCountry } from "../auth.js";

export async function registerLandingRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get("/landing/:page", {
    schema: {
      tags: ["Roadmap"],
      params: z.object({ page: z.enum(["roadmap", "colaborar", "login", "registro", "activar", "admin", "account", "radio-embed"]) }),
      querystring: z.object({ lang: z.enum(["es", "en"]).optional(), token: z.string().max(200).optional(), mode: z.enum(["landing"]).optional(), saved: z.enum(["profile", "password", "both"]).optional() }),
    },
  }, async (request, reply) => {
    const session = request.viewer ? { ...request.viewer, userId: request.account?.kind === "user" ? request.account.id : null, adminId: request.account?.kind === "admin" ? request.account.id : null, csrf: request.csrfToken } : null;
    // El panel solo existe con sesión de administración o comunidad; el gateway
    // manda a /login a quien reciba este 403.
    if (request.params.page === "admin" && request.viewer?.role !== "admin" && request.viewer?.role !== "community") {
      return reply.code(403).header("Cache-Control", "no-store").send({ error: "forbidden" });
    }
    // TEMPORAL-PORTADA: como en Herra, /account pide sesión y /login no se le ofrece a quien ya entró.
    if (request.params.page === "account" && !session) {
      return reply.code(401).header("Cache-Control", "no-store").send({ error: "unauthorized" });
    }
    if (request.params.page === "login" && session) {
      return reply.code(204).header("Cache-Control", "no-store").header("x-crv-landing-redirect", "roadmap").send();
    }
    const html = await renderLanding(request.params.page, request.query.lang ?? "es", request.query.token ?? "", session, request.query.mode === "landing", request.query.saved ?? null, clientCountry(request));
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
