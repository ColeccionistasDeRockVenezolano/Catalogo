import {randomUUID} from "node:crypto";
import {z} from "zod";
import {getPool} from "../db/client.js";

export const budgetPricesSchema=z.object({sourceUrl:z.string().url(),capturedAt:z.string().datetime(),sourceHash:z.string().regex(/^[a-f0-9]{64}$/u),requestTokenOverhead:z.number().int().positive(),models:z.record(z.object({inputUsdPerMillion:z.number().nonnegative(),outputUsdPerMillion:z.number().nonnegative()}))});
export type BudgetPrices=z.infer<typeof budgetPricesSchema>;
export class DeepSeekBudgetExceeded extends Error{}
interface Reservation{id:string;prices:BudgetPrices;model:string;reservedMicroUsd:number;reservedTokens:number;}

export async function createExecutionBudget(input:{id:string;maxUsd:number;maxCalls:number;maxTokens:number;maxConcurrency?:number;prices:BudgetPrices;authorizedBy:string}):Promise<void>{
 const prices=budgetPricesSchema.parse(input.prices);
 if(!Number.isFinite(input.maxUsd)||input.maxUsd<=0)throw new Error("El máximo financiero debe ser positivo.");
 await getPool().query("INSERT INTO ingest.ai_execution_budgets(id,max_micro_usd,max_calls,max_tokens,max_concurrency,prices,authorized_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",[input.id,Math.floor(input.maxUsd*1_000_000),input.maxCalls,input.maxTokens,input.maxConcurrency??1,JSON.stringify(prices),input.authorizedBy]);
}
/** Reserve a conservative UTF-8/token upper bound under one budget row lock.
 * An interrupted request retains its full reservation until usage is known.
 */
export async function reserveExecutionBudget(budgetId:string,input:{model:string;taskKind:string;promptHash:string;system:string;user:string;maxTokens:number;timeoutMs:number}):Promise<Reservation>{
 const db=await getPool().connect();
 try{
  await db.query("BEGIN");
  const budget=(await db.query<{max_micro_usd:string;max_calls:number;max_tokens:string;max_concurrency:number;prices:BudgetPrices}>("SELECT * FROM ingest.ai_execution_budgets WHERE id=$1 FOR UPDATE",[budgetId])).rows[0];
  if(!budget)throw new DeepSeekBudgetExceeded("No existe el presupuesto financiero configurado; no se inicia una llamada pagada.");
  const prices=budgetPricesSchema.parse(budget.prices),rate=prices.models[input.model];
  if(!rate)throw new DeepSeekBudgetExceeded(`Falta un precio registrado para ${input.model}; no se inicia una llamada pagada.`);
  await db.query("UPDATE ingest.ai_budget_reservations SET state='uncertain',settled_at=now() WHERE budget_id=$1 AND state='reserved' AND expires_at<now()",[budgetId]);
  const usage=(await db.query<{calls:number;tokens:string;micro_usd:string;active:number}>("SELECT count(*)::int AS calls,coalesce(sum(charged_tokens),0)::text AS tokens,coalesce(sum(charged_micro_usd),0)::text AS micro_usd,count(*) FILTER(WHERE state='reserved')::int AS active FROM ingest.ai_budget_reservations WHERE budget_id=$1",[budgetId])).rows[0]!;
  const inputTokens=Buffer.byteLength(input.system,"utf8")+Buffer.byteLength(input.user,"utf8")+prices.requestTokenOverhead;
  const reservedTokens=inputTokens+input.maxTokens,reservedMicroUsd=Math.ceil(inputTokens*rate.inputUsdPerMillion+input.maxTokens*rate.outputUsdPerMillion);
  if(usage.calls>=budget.max_calls||Number(usage.tokens)+reservedTokens>Number(budget.max_tokens)||Number(usage.micro_usd)+reservedMicroUsd>Number(budget.max_micro_usd))throw new DeepSeekBudgetExceeded("Presupuesto global de llamadas, tokens o gasto alcanzado; se conservan los resultados para continuar.");
  if(usage.active>=budget.max_concurrency)throw new DeepSeekBudgetExceeded("El presupuesto global ya tiene una llamada en curso; se conserva la tarea para reintentar.");
  const id=randomUUID();
  await db.query("INSERT INTO ingest.ai_budget_reservations(id,budget_id,model,task_kind,prompt_hash,reserved_micro_usd,charged_micro_usd,reserved_tokens,charged_tokens,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$7,'reserved',now()+($8::int*interval '1 millisecond'))",[id,budgetId,input.model,input.taskKind,input.promptHash,reservedMicroUsd,reservedTokens,input.timeoutMs+30000]);
  await db.query("COMMIT");return {id,prices,model:input.model,reservedMicroUsd,reservedTokens};
 }catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}
}
export async function settleExecutionBudget(reservation:Reservation,usage?:{tokensIn:number;tokensOut:number}):Promise<void>{
 const rate=reservation.prices.models[reservation.model]!;
 const known=usage&&Number.isSafeInteger(usage.tokensIn)&&usage.tokensIn>=0&&Number.isSafeInteger(usage.tokensOut)&&usage.tokensOut>=0;
 await getPool().query("UPDATE ingest.ai_budget_reservations SET state=$2,charged_micro_usd=$3,charged_tokens=$4,tokens_in=$5,tokens_out=$6,settled_at=now() WHERE id=$1 AND state IN ('reserved','uncertain')",[reservation.id,known?"settled":"uncertain",known?Math.ceil(usage.tokensIn*rate.inputUsdPerMillion+usage.tokensOut*rate.outputUsdPerMillion):reservation.reservedMicroUsd,known?usage.tokensIn+usage.tokensOut:reservation.reservedTokens,known?usage.tokensIn:null,known?usage.tokensOut:null]);
}
export async function executionBudgetUsage(id:string):Promise<{maxUsd:number;chargedUsd:number;calls:number;tokens:number;unknownCalls:number}>{
 const row=(await getPool().query<{max_micro_usd:string;charged:string;calls:number;tokens:string;unknown:number}>("SELECT b.max_micro_usd,coalesce(sum(r.charged_micro_usd),0)::text AS charged,count(r.id)::int AS calls,coalesce(sum(r.charged_tokens),0)::text AS tokens,count(r.id) FILTER(WHERE r.state<>'settled')::int AS unknown FROM ingest.ai_execution_budgets b LEFT JOIN ingest.ai_budget_reservations r ON r.budget_id=b.id WHERE b.id=$1 GROUP BY b.id",[id])).rows[0];
 if(!row)throw new Error("Presupuesto inexistente");
 return {maxUsd:Number(row.max_micro_usd)/1_000_000,chargedUsd:Number(row.charged)/1_000_000,calls:row.calls,tokens:Number(row.tokens),unknownCalls:row.unknown};
}
