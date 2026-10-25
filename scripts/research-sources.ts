import { inventorySummary, loadSourceInventory } from "../src/verification/source-inventory.js";

const args = process.argv.slice(2);
if (args.length > 1 || args[0] !== undefined && args[0] !== "--summary") {
  throw new Error("Uso: npm run research:sources -- [--summary]");
}
const inventory = loadSourceInventory();
process.stdout.write(`${JSON.stringify(args[0] === "--summary" ? inventorySummary(inventory) : inventory, null, 2)}\n`);
