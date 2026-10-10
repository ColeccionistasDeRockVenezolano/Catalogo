import { readFile } from "node:fs/promises";
import { closeDb } from "../src/db/client.js";
import { recommend, recordRecommendationFeedback, importRecommendationVersions, recommendationFeedbackReport } from "../src/discovery/recommendations.js";
import { evaluateRecommendations, evaluateInterpretations } from "../src/discovery/recommendation-evaluation.js";
import { interpretRecommendation, intentQuestions } from "../src/discovery/recommendation-interpreter.js";
const [command,arg,actor]=process.argv.slice(2);
try {
  let result:unknown;
  if (command==="questions") result=intentQuestions();
  else if (command==="interpret" && arg) result=await interpretRecommendation(arg);
  else if (command==="recommend" && arg && actor) result=await recommend(JSON.parse(await readFile(arg,"utf8")),actor,process.argv.includes("--apply"));
  else if (command==="feedback" && arg && actor) result=await recordRecommendationFeedback(JSON.parse(await readFile(arg,"utf8")),actor);
  else if (command==="versions" && arg) result=await importRecommendationVersions(JSON.parse(await readFile(arg,"utf8")),process.argv.includes("--apply"));
  else if (command==="evaluate" && arg) result=await evaluateRecommendations(JSON.parse(await readFile(arg,"utf8")));
  else if (command==="evaluate-interpretation" && arg) result=await evaluateInterpretations(JSON.parse(await readFile(arg,"utf8")));
  else if (command==="feedback-report") result=await recommendationFeedbackReport();
  else throw new Error('Uso: discovery:recommendations -- questions | interpret "solicitud" | recommend solicitud.json actor [--apply] | feedback feedback.json actor | versions lote.json [--apply] | evaluate casos.json | evaluate-interpretation casos.json | feedback-report');
  console.log(JSON.stringify(result,null,2));
} catch(error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; }
finally { await closeDb(); }
