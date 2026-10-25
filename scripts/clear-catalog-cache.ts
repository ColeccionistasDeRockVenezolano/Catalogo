import { publishCatalogRevision } from "../src/storage/catalog-cache-revision.js";

const revision = await publishCatalogRevision();
console.log(`Caché del catálogo invalidada: ${revision}`);
