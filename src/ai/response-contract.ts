import { z } from "zod";

/** Describe the actual response validator to JSON-only providers, including required keys and enums. */
export function responseContract(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodEffects) return responseContract(schema.innerType());
  if (schema instanceof z.ZodOptional) return responseContract(schema.unwrap());
  if (schema instanceof z.ZodDefault) return responseContract(schema.removeDefault());
  if (schema instanceof z.ZodNullable) return { anyOf: [responseContract(schema.unwrap()), { type: "null" }] };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as z.ZodRawShape;
    return { type: "object", properties: Object.fromEntries(Object.entries(shape).map(([name, field]) => [name, responseContract(field)])),
      required: Object.entries(shape).filter(([, field]) => !field.isOptional()).map(([name]) => name), additionalProperties: schema._def.unknownKeys === "passthrough" };
  }
  if (schema instanceof z.ZodDiscriminatedUnion) return { oneOf: schema.options.map((option: z.ZodTypeAny) => responseContract(option)) };
  if (schema instanceof z.ZodUnion) return { anyOf: schema.options.map((option: z.ZodTypeAny) => responseContract(option)) };
  if (schema instanceof z.ZodArray) return { type: "array", items: responseContract(schema.element),
    ...(schema._def.minLength ? { minItems: schema._def.minLength.value } : {}), ...(schema._def.maxLength ? { maxItems: schema._def.maxLength.value } : {}) };
  if (schema instanceof z.ZodRecord) return { type: "object", additionalProperties: responseContract(schema._def.valueType) };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { const: schema.value };
  if (schema instanceof z.ZodString) {
    const regex = schema._def.checks.find(check => check.kind === "regex");
    return { type: "string", ...(schema.minLength !== null ? { minLength: schema.minLength } : {}), ...(schema.maxLength !== null ? { maxLength: schema.maxLength } : {}), ...(regex?.kind === "regex" ? { pattern: regex.regex.source } : {}) };
  }
  if (schema instanceof z.ZodNumber) {
    const min = schema._def.checks.find(check => check.kind === "min" && check.value === schema.minValue);
    const max = schema._def.checks.find(check => check.kind === "max" && check.value === schema.maxValue);
    return { type: schema.isInt ? "integer" : "number",
      ...(schema.minValue !== null ? { [min?.kind === "min" && !min.inclusive ? "exclusiveMinimum" : "minimum"]: schema.minValue } : {}),
      ...(schema.maxValue !== null ? { [max?.kind === "max" && !max.inclusive ? "exclusiveMaximum" : "maximum"]: schema.maxValue } : {}) };
  }
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodNull) return { type: "null" };
  return {};
}
