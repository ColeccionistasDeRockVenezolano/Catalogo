import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../src/config/project-root.js";
import { readReviewedVocabulary } from "../src/search/semantic-review.js";
const root=projectRoot(import.meta.url),directory=path.join(root,"reports/unified-search-stage2");
const vocabulary=await readReviewedVocabulary(root);
await mkdir(directory,{recursive:true});
await writeFile(path.join(directory,"vocabulary.json"),`${JSON.stringify(vocabulary,null,2)}\n`);
console.log(JSON.stringify(vocabulary.coverage));
