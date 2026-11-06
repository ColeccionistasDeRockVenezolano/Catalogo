import { z } from "zod";

/** El proveedor produce el JSON de entrada, antes de normalizarlo con transforms.
 * Usar la API pública de Zod evita depender de su representación interna. */
export function responseContract(schema: z.ZodType): Record<string, unknown> {
  const contract = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  delete contract.$schema;
  return contract;
}
