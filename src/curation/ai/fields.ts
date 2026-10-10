import { z } from "zod";
import type { CatalogField } from "./types.js";
export function describeFields(shape: z.ZodRawShape): CatalogField[] {
  return Object.entries(shape).map(([key, schema]) => {
    let inner = schema;
    const nullable = inner.isNullable();
    while (
      inner instanceof z.ZodNullable ||
      inner instanceof z.ZodOptional ||
      inner instanceof z.ZodDefault ||
      inner instanceof z.ZodEffects
    ) {
      inner =
        inner instanceof z.ZodEffects
          ? inner.innerType()
          : inner instanceof z.ZodDefault
            ? inner.removeDefault()
            : inner.unwrap();
    }
    return {
      key,
      nullable,
      type:
        inner instanceof z.ZodNumber
          ? "number"
          : inner instanceof z.ZodBoolean
            ? "boolean"
            : "string",
      ...(inner instanceof z.ZodEnum
        ? { options: inner.options as string[] }
        : {}),
    };
  });
}
