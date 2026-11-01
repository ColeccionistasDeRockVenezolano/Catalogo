export const BASE: string;
export const API: string;
export function ipDePrueba(etiqueta?: string): string;
export function estadoSesion(pagina: unknown, apiBase?: string): Promise<{ status: number; user: any; csrf: string }>;
export function entrar(pagina: unknown, opciones?: Record<string, unknown>): Promise<any>;
export function reutilizar(browser: unknown, contexto: unknown, opciones?: Record<string, unknown>): Promise<any>;
