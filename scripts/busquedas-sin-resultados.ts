// CRV · Búsquedas públicas sin resultados (migración 0072).
//
// Lista lo que la gente busca y no encuentra: siglas, apodos o grafías que
// faltan como alias. Una sigla que aparezca aquí se documenta (fuente con la
// sigla junto al nombre) y se agrega a reports/iniciales-2026-10-13/
// siglas-documentadas.json; nunca se calcula.
//
//   uso: tsx scripts/busquedas-sin-resultados.ts [días=30] [límite=100]
import { closeDb } from "../src/db/client.js";
import { listSearchMisses } from "../src/api/search-misses.js";

const days = Number(process.argv[2] ?? 30);
const limit = Number(process.argv[3] ?? 100);
const misses = await listSearchMisses(limit, days);
console.log(`${misses.length} búsquedas sin resultados en los últimos ${days} días`);
for (const miss of misses) console.log(`${String(miss.misses).padStart(5)}  ${miss.sample.padEnd(40)}  última ${miss.lastSeen.slice(0, 10)}`);
await closeDb();
