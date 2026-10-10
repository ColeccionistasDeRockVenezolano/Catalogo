// Investigación individual explícita; solo persiste el informe derivado.
import { loadVerificationSnapshot } from "../src/verification/snapshot.js";
import { researchStored } from "../src/verification/research-state.js";
import { saveIndividualVerification } from "../src/verification/store.js";
import { closeDb } from "../src/db/client.js";
import type { VerificationKind } from "../src/verification/types.js";
const [kind,idArg]=process.argv.slice(2);
if(!["artist","person","album"].includes(kind??"")||!Number.isSafeInteger(Number(idArg))||Number(idArg)<1)throw new Error("Uso: tsx scripts/verify-entity.ts artist|person|album ID");
try{
  const snapshot=await loadVerificationSnapshot(kind as VerificationKind,Number(idArg));
  console.log(JSON.stringify({entity:snapshot.name,units:snapshot.units.length,albums:snapshot.albums.length,state:"researching"}));
  const report=await researchStored(snapshot);
  const reportId=await saveIndividualVerification(report,"Verificación individual CLI");
  console.log(JSON.stringify({reportId,entity:report.name,score:report.score,sources:report.sources.length,areas:report.areas,limitations:report.limitations}));
}finally{await closeDb();}
