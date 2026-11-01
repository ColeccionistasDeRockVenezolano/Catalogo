// CRV · Pruebas de «Mi perfil» (/cuenta) sin base de datos.
//
// Cubren lo que puede romper el formulario antes de tocar PostgreSQL: la
// validación de los campos, los enlaces (incluido el que no es http), la
// lista de huecos y el descarte de filas vacías.
import { describe, expect, it } from "vitest";
import { cleanLinks, profileGaps, validateProfileFields } from "./store.js";

const base = { firstName: "Brian", lastName: "Pérez" };

describe("validateProfileFields", () => {
  it("exige nombre y apellido", () => {
    expect(() => validateProfileFields({ firstName: "", lastName: "Pérez" })).toThrow(/Nombre y apellido/);
    expect(() => validateProfileFields({ firstName: "Brian", lastName: "  " })).toThrow(/Nombre y apellido/);
  });

  it("normaliza espacios y deja vacíos en null", () => {
    const clean = validateProfileFields({
      firstName: "  Brian   Antonio ", lastName: " Pérez ",
      birthDate: "", whatsappPhone: "", email: "", city: "", country: "",
      bio: "", experience: "", availability: "",
    });
    expect(clean.firstName).toBe("Brian Antonio");
    expect(clean.lastName).toBe("Pérez");
    expect(clean.person.birthDate).toBeNull();
    expect(clean.person.email).toBeNull();
    expect(clean.person.contactPreference).toBe("whatsapp");
    expect(clean.person.profileVisibility).toBe("private");
  });

  it("rechaza fecha, correo y WhatsApp inválidos", () => {
    expect(() => validateProfileFields({ ...base, birthDate: "1990-02-31" })).toThrow(/fecha de nacimiento/);
    expect(() => validateProfileFields({ ...base, email: "sin-arroba" })).toThrow(/correo/);
    expect(() => validateProfileFields({ ...base, whatsappPhone: "abc" })).toThrow(/WhatsApp/);
  });

  it("acepta una fecha real y un teléfono con código de país", () => {
    const clean = validateProfileFields({
      ...base, birthDate: "1990-02-28", whatsappPhone: "+58 412-1234567", email: "brian@example.com",
      contactPreference: "email", profileVisibility: "public",
    });
    expect(clean.person.birthDate).toBe("1990-02-28");
    expect(clean.person.contactPreference).toBe("email");
    expect(clean.person.profileVisibility).toBe("public");
  });

  it("no repite categorías y descarta ids inválidos", () => {
    const clean = validateProfileFields({ ...base, termIds: [3, 3, -1, 0, 7.5, 4] });
    expect(clean.termIds).toEqual([3, 4]);
  });

  it("rechaza preferencia y visibilidad desconocidas", () => {
    expect(() => validateProfileFields({ ...base, contactPreference: "telefono" })).toThrow(/preferencia/);
    expect(() => validateProfileFields({ ...base, profileVisibility: "friends" })).toThrow(/visibilidad/);
  });
});

describe("cleanLinks", () => {
  it("descarta filas sin URL y conserva el resto en orden", () => {
    const links = cleanLinks([
      { type: "instagram", label: "Instagram", url: "https://instagram.com/crv", isPublic: true },
      { type: "web", label: "", url: "   " },
      { type: "web", label: "Archivo", url: "https://example.com" },
    ]);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ type: "instagram", isPublic: true });
    expect(links[1]?.label).toBe("Archivo");
    expect(links[1]?.isPublic).toBe(false);
  });

  it("rechaza lo que no es http(s)", () => {
    expect(() => cleanLinks([{ url: "javascript:alert(1)" }])).toThrow(/enlaces/);
    expect(() => cleanLinks([{ url: "example.com" }])).toThrow(/enlaces/);
    expect(() => cleanLinks([{ url: "ftp://example.com" }])).toThrow(/enlaces/);
  });

  it("corta en el máximo de enlaces", () => {
    const many = Array.from({ length: 11 }, (_, index) => ({ url: `https://example.com/${index}` }));
    expect(() => cleanLinks(many)).toThrow(/10 enlaces/);
  });
});

describe("profileGaps", () => {
  it("enumera lo que falta, en el orden de Herra", () => {
    expect(profileGaps(null, [], [])).toEqual(["age", "whatsapp", "experience", "categories", "links"]);
    expect(profileGaps({ birth_date: "1990-01-01", whatsapp_phone: "+58412", experience: "X" }, [2], [{ url: "https://x.dev" }]))
      .toEqual([]);
    expect(profileGaps({ birth_date: null, whatsapp_phone: "+58412", experience: "X" }, [2], []))
      .toEqual(["age", "links"]);
  });
});
