// Datos que viven en el almacén externo (docs/SHARED_STORAGE.md: `reports/`, `data/research`) y no en Git.
// Las pruebas que verifican ese corpus real se saltan cuando falta y siguen ejecutándose donde existe;
// nunca se saltan de forma incondicional.
import { existsSync } from "node:fs";
import path from "node:path";

export const externalDataAvailable = (...files: string[]): boolean => files.every((file) => existsSync(path.resolve(file)));
