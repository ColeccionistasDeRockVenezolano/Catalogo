// CRV · Código de referencia de un error («CRV-7F3A9K»). Lo ve quien visita;
// el detalle queda en el log con el mismo código. Sin 0/O ni 1/I: se dicta.
import { randomInt } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const INCIDENT_CODE = /^CRV-[2-9A-HJ-NP-Z]{6}$/u;

export function newIncidentCode(): string {
  let code = "CRV-";
  for (let index = 0; index < 6; index += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
