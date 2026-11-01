// CRV · Validación y credenciales de la comunidad (Fase 1).
//
// Los códigos de acceso usan el MISMO formato scrypt que Herra
// (`scrypt$N$r$p$saltHex$hashHex`) para que `herraPasswordMatches` siga
// verificando las cuentas existentes y las nuevas sin migrar hashes.
import { createHash, randomBytes, scryptSync } from "node:crypto";

export const MIN_USER_NAME = 2;
export const MAX_USER_NAME = 80;
export const MAX_PERSON_NAME = 80;
export const MIN_ACCESS_CODE = 12;
export const MAX_ACCESS_CODE = 200;
export const MAX_FIELD = 200;
export const MAX_TEXT = 4_000;
export const MAX_LINKS = 10;
export const ACTIVATION_TTL_DAYS = 7;
export const INVITE_TTL_MINUTES = 24 * 60;
export const MAX_REGISTRATIONS_PER_DAY = 20;

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 5;
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 };

// Lista corta de claves que no aportan nada; el mínimo real es longitud +
// letra + número, igual que en Herra.
const COMMON_ACCESS_CODES = new Set([
  "contrasena123", "password1234", "123456789012", "qwerty123456",
  "colaborador1", "coleccionistas1", "rockvenezolano1",
]);

export function hashAccessCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(code, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Token de 256 bits para invitaciones y activaciones. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Solo se guarda el hash: la base no permite reutilizar un enlace robado. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function passwordRequirementsText(): string {
  return `Entre ${MIN_ACCESS_CODE} y ${MAX_ACCESS_CODE} caracteres, con al menos una letra y un número, y que no sea una clave demasiado común.`;
}

export function isStrongAccessCode(accessCode: string, username?: string): boolean {
  if (accessCode.length < MIN_ACCESS_CODE || accessCode.length > MAX_ACCESS_CODE) return false;
  if (!/[a-zA-Z]/.test(accessCode) || !/[0-9]/.test(accessCode)) return false;
  if (COMMON_ACCESS_CODES.has(accessCode.toLowerCase())) return false;
  if (username && accessCode.toLowerCase() === username.trim().toLowerCase()) return false;
  return true;
}

/** Nombre visible: NFC, espacios colapsados y sin caracteres de control. */
export function normalizePersonName(value: string): string {
  const text = Array.from(value.normalize("NFC"))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  return text
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_PERSON_NAME);
}

export function validUsername(name: string): boolean {
  const value = name.trim();
  return value.length >= MIN_USER_NAME && value.length <= MAX_USER_NAME;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value);
}

export function isValidPhone(value: string): boolean {
  return /^[+()\d][\d\s().-]{6,24}$/u.test(value);
}

export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const year = date.getUTCFullYear();
  return year >= 1900 && date.getTime() <= Date.now();
}

/** Nombre de usuario provisional para una colaboración creada al aceptar. */
export function slugify(value: string, fallback = "colaborador"): string {
  const normalized = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 60);
  if (slug.length >= MIN_USER_NAME) return slug;
  return `${fallback}-${Math.random().toString(36).slice(2, 8)}`.slice(0, MAX_USER_NAME);
}
