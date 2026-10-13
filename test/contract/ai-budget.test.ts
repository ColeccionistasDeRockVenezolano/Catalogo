import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {z} from "zod";
import {startPgContainer,type PgContainer} from "../support/pg-container.js";
import {applyCore} from "../support/apply-core.js";
import {migrateUp} from "../../src/db/migrate.js";
import {getPool,closeDb} from "../../src/db/client.js";
import {resetEnvCache} from "../../src/config/env.js";
import {createExecutionBudget,reserveExecutionBudget,settleExecutionBudget,executionBudgetUsage} from "../../src/ai/budget.js";
import {DeepSeekGateway,MemoryDeepSeekRunStore,MockDeepSeekTransport} from "../../src/ai/gateway.js";
const prices={sourceUrl:"https://prices.example/test",sourceHash:"a".repeat(64),capturedAt:"2026-10-13T00:00:00Z",requestTokenOverhead:10,models:{fixture:{inputUsdPerMillion:1,outputUsdPerMillion:2}}};
const request={model:"fixture",taskKind:"curation_plan",promptHash:"fixture",system:"Test",user:"Test",maxTokens:100,timeoutMs:1000};
describe("presupuesto financiero global de IA",()=>{
 let container:PgContainer;
 beforeAll(async()=>{container=await startPgContainer();process.env["DATABASE_URL"]=container.databaseUrl;resetEnvCache();await applyCore(container.name);await migrateUp();},120000);
 afterAll(async()=>{await closeDb();resetEnvCache();await container?.stop();},60000);
 it("coordina dos procesos, rechaza reservas que excedan el techo y contabiliza consumo confirmado",async()=>{
  await createExecutionBudget({id:"concurrent",maxUsd:.0005,maxCalls:10,maxTokens:5000,prices,authorizedBy:"QA"});
  const results=await Promise.allSettled([reserveExecutionBudget("concurrent",request),reserveExecutionBudget("concurrent",request)]);
  expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
  const reservation=results.find(result=>result.status==="fulfilled")!;if(reservation.status!=="fulfilled")throw Error("Sin reserva");
  await settleExecutionBudget(reservation.value,{tokensIn:20,tokensOut:30});
  expect(await executionBudgetUsage("concurrent")).toMatchObject({calls:1,chargedUsd:.00008,tokens:50,unknownCalls:0});
  const second=await reserveExecutionBudget("concurrent",request);await settleExecutionBudget(second);
  expect(await executionBudgetUsage("concurrent")).toMatchObject({calls:2,unknownCalls:1});
  await expect(reserveExecutionBudget("concurrent",request)).rejects.toThrow(/Presupuesto global/);
 });
 it("mantiene reservas tras un corte, permite continuar dentro del techo y no inventa uso cero",async()=>{
  await createExecutionBudget({id:"interrupted",maxUsd:1,maxCalls:3,maxTokens:5000,prices,authorizedBy:"QA"});
  const first=await reserveExecutionBudget("interrupted",request);
  await getPool().query("UPDATE ingest.ai_budget_reservations SET expires_at=now()-interval '1 second' WHERE id=$1",[first.id]);
  const second=await reserveExecutionBudget("interrupted",request);await settleExecutionBudget(second,{tokensIn:1,tokensOut:1});
  const usage=await executionBudgetUsage("interrupted");expect(usage.unknownCalls).toBe(1);expect(usage.chargedUsd).toBeGreaterThan(.0002);
 });
 it("el gateway no cobra ni reserva llamadas cacheadas y bloquea la red al alcanzar el presupuesto",async()=>{
  await createExecutionBudget({id:"gateway",maxUsd:1,maxCalls:1,maxTokens:100000,prices,authorizedBy:"QA"});
  const transport=new MockDeepSeekTransport({ok:true},{ok:true});
  const gateway=new DeepSeekGateway({budgetId:"gateway",baseUrl:"https://model.example",models:{fast:"fixture",reasoning:"fixture",vision:"fixture"},maxTokens:100,timeoutMs:1000},transport,new MemoryDeepSeekRunStore());
  const input={taskKind:"cheap_classification" as const,schemaVersion:"qa",instructions:"Test",input:{value:1},responseSchema:z.object({ok:z.boolean()})};
  await gateway.propose(input);expect((await gateway.propose(input)).cached).toBe(true);
  await expect(gateway.propose({...input,input:{value:2}})).rejects.toThrow(/Presupuesto global/);
  expect(transport.requests).toHaveLength(1);expect(await executionBudgetUsage("gateway")).toMatchObject({calls:1,unknownCalls:0});
 });
});
