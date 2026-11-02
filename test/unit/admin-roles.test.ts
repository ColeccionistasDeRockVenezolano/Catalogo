import { describe, expect, it } from "vitest";
import { roleConstraintAllows } from "../../src/api/community/store.js";

describe("roles de administración según la migración 0124", () => {
  it("reconoce el CHECK viejo (solo superadmin/admin)", () => {
    expect(roleConstraintAllows("CHECK ((role = ANY (ARRAY['superadmin'::text, 'admin'::text])))")).toBe(false);
  });

  it("reconoce el CHECK de la 0124 con curator y community", () => {
    expect(roleConstraintAllows("CHECK ((role = ANY (ARRAY['superadmin'::text, 'admin'::text, 'curator'::text, 'community'::text])))")).toBe(true);
  });

  it("no se fía de una definición incompleta", () => {
    expect(roleConstraintAllows("CHECK ((role = ANY (ARRAY['admin'::text, 'curator'::text])))")).toBe(false);
    expect(roleConstraintAllows("")).toBe(false);
  });
});
