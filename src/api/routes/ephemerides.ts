import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { dailyCycleSchema, dailyDateSchema } from "../daily-cycle.js";
import { getEphemerides } from "../repositories/ephemerides.js";
import { saveEphemeris,editorialEphemerides } from "../../catalog/ephemerides.js";
import { withOperatorRun } from "../../merge/operator.js";
import { OPERATOR_SECURITY } from "../auth.js";

const eventSchema = z.object({
  id:z.number().int(),title:z.string(),description:z.string(),date:dailyDateSchema,
  year:z.number().int(),place:z.string(),subject:z.string(),
  sources:z.array(z.object({title:z.string(),url:z.string().url()})),
});
export async function registerEphemeridesRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get("/ephemerides", {
    schema:{ tags:["search"],summary:"Hechos históricos documentados de la escena venezolana",
      querystring:z.object({date:dailyDateSchema.optional()}),
      response:{200:z.object({dailyCycle:dailyCycleSchema,today:z.array(eventSchema),events:z.array(eventSchema)})},
    },
  },async (request,reply) => {
    reply.header("Cache-Control","no-store");
    return getEphemerides(request.query.date);
  });
  const server=app.withTypeProvider<ZodTypeProvider>();
  server.get("/curation/ephemerides",{schema:{tags:["curation"],security:OPERATOR_SECURITY,response:{200:z.array(z.unknown())}}},async()=>editorialEphemerides());
  const input=z.object({
    key:z.string().regex(/^[a-z0-9][a-z0-9-]{0,159}$/u),title:z.string().trim().min(1).max(300),
    description:z.string().trim().min(1).max(20_000),date:dailyDateSchema.nullable(),year:z.number().int().min(1).max(9999),
    dateNote:z.string().max(4000).nullable(),place:z.string().trim().min(1).max(500),subject:z.string().trim().min(1).max(300),
    originalArtistId:z.number().int().positive().nullable(),status:z.enum(["verified","pending","contradicted"]),
    sources:z.array(z.object({title:z.string().trim().min(1).max(500),url:z.string().url().regex(/^https?:\/\//u)}).strict()).min(1).max(30),
    note:z.string().trim().min(8).max(4000),
  }).strict().refine(value=>value.status!=="verified"||value.date!==null,"Una efeméride verificada requiere fecha exacta")
    .refine(value=>!value.date||Number(value.date.slice(0,4))===value.year,"La fecha debe coincidir con el año");
  server.post("/curation/ephemerides",{schema:{tags:["curation"],security:OPERATOR_SECURITY,body:input,
    response:{200:z.object({id:z.number().int(),runId:z.number().int()})}}},async request=>{
    const {note,...value}=request.body;
    const result=await withOperatorRun({name:"editorial:save-ephemeris",operator:request.operator,note},ctx=>saveEphemeris(ctx,value));
    return {...result.result,runId:result.runId};
  });
}
