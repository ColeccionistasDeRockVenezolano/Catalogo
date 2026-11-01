import { describe, expect, it } from "vitest";
import { roleCanAccess } from "./roles.js";

describe("roleCanAccess", () => {
  it("admin entra a todo", () => {
    expect(roleCanAccess("admin", "/community/admin/collaborators")).toBe(true);
    expect(roleCanAccess("admin", "/catalog-editor/artists")).toBe(true);
  });

  it("community solo entra a comunidad", () => {
    expect(roleCanAccess("community", "/community/admin/applications")).toBe(true);
    expect(roleCanAccess("community", "/community/admin")).toBe(true);
    expect(roleCanAccess("community", "/catalog-editor/artists")).toBe(false);
    expect(roleCanAccess("community", "/chat/admin/messages")).toBe(false);
  });

  it("curator entra al catálogo pero no a comunidad ni al chat de moderación", () => {
    expect(roleCanAccess("curator", "/catalog-editor/artists")).toBe(true);
    expect(roleCanAccess("curator", "/site-appearance")).toBe(true);
    expect(roleCanAccess("curator", "/community/admin/collaborators")).toBe(false);
    expect(roleCanAccess("curator", "/chat/admin/messages")).toBe(false);
  });

  it("reader no entra a ninguna ruta interna", () => {
    expect(roleCanAccess("reader", "/community/admin/collaborators")).toBe(false);
    expect(roleCanAccess("reader", "/catalog-editor/artists")).toBe(false);
  });

  it("cualquier rol administra su propio perfil en /account", () => {
    for (const role of ["admin", "curator", "community", "reader"] as const) {
      expect(roleCanAccess(role, "/account/profile")).toBe(true);
      expect(roleCanAccess(role, "/account/password")).toBe(true);
    }
    // La excepción es solo de /account: no abre /accounts ni otras secciones.
    expect(roleCanAccess("reader", "/accounts")).toBe(false);
    expect(roleCanAccess("reader", "/community/applications")).toBe(false);
  });
});
