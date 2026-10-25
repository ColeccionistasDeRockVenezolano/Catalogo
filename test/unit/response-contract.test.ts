import { describe,it,expect } from "vitest";
import { z } from "zod";
import { responseContract } from "../../src/ai/response-contract.js";
describe("contrato JSON para proveedores",()=>{
  it("describe campos requeridos, categorías, nulos y límites de citas",()=>{
    const schema=z.object({kind:z.enum(["founder","membership"]),quote:z.string().min(8).max(500),uncertainty:z.string().nullable(),evidenceIds:z.array(z.string()).max(8),optional:z.string().optional()}).strict();
    const contract=responseContract(schema);
    expect(contract["required"]).toEqual(["kind","quote","uncertainty","evidenceIds"]);
    expect(contract["additionalProperties"]).toBe(false);
    expect((contract["properties"] as Record<string,unknown>)["kind"]).toEqual({type:"string",enum:["founder","membership"]});
    expect((contract["properties"] as Record<string,unknown>)["evidenceIds"]).toMatchObject({maxItems:8});
  });
  it("describe las referencias positivas y claves cortas del contrato real",()=>{
    expect(responseContract(z.number().int().positive())).toEqual({type:"integer",exclusiveMinimum:0});
    expect(responseContract(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/u))).toEqual({type:"string",pattern:"^[a-zA-Z][a-zA-Z0-9_-]{0,39}$"});
  });
});
