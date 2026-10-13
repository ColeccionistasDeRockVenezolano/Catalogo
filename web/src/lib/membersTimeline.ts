// CRV · Cuándo sale la línea de tiempo de integrantes. Vive aparte del
// componente para que el archivo de componentes solo exporte componentes.
import type { ArtistMember } from "./types.js";

/** Un integrante entra en la línea si tiene algún año, o si sigue y se conoce el inicio de la banda. */
export function plotted(member: ArtistMember, startKnown: boolean): boolean {
  return member.fromYear !== null || member.toYear !== null || (member.isCurrent && startKnown);
}

/**
 * Línea de tiempo también con datos parciales (Brian, 2026-10-13): basta con
 * que dos personas tengan algún año. Lo que no se sabe (entrada o salida) se
 * dibuja difuminado; quien no tiene ningún dato se nombra debajo.
 */
export function timelineReady(members: ArtistMember[], formedYear: number | null = null): boolean {
  const startKnown = formedYear !== null || members.some((member) => member.fromYear !== null);
  return new Set(members.filter((member) => plotted(member, startKnown)).map((member) => member.personId)).size >= 2;
}
