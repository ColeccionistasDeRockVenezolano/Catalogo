import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {z} from "zod";
import {createExecutionBudget,executionBudgetUsage,budgetPricesSchema} from "../src/ai/budget.js";
import {closeDb} from "../src/db/client.js";

export async function main(args:string[]):Promise<void>{
 const [action,id,...rest]=args;if(!id)throw Error("Uso: ai-budget create <id> <config.json> | usage <id>");
 if(action==="create"){
  const file=rest[0];if(!file)throw Error("Falta el archivo de presupuesto autorizado.");
  const config=z.object({maxUsd:z.number().positive(),maxCalls:z.number().int().positive(),maxTokens:z.number().int().positive(),maxConcurrency:z.number().int().positive().default(1),prices:budgetPricesSchema,authorizedBy:z.string().min(1)}).strict().parse(JSON.parse(await readFile(file,"utf8")));
  await createExecutionBudget({id,...config});
 }else if(action!=="usage")throw Error("Acción desconocida");
 process.stdout.write(`${JSON.stringify({id,...await executionBudgetUsage(id)},null,2)}\n`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;}).finally(closeDb);
}
