export class GenreCurationError extends Error {
  constructor(public readonly code: "invalid" | "not_found" | "conflict", message: string) { super(message); }
}
