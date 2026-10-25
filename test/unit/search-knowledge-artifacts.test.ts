import { expect, it } from "vitest";
import { interpretStudyArtifacts, type ArtifactTask } from "../../src/search/knowledge-artifacts.js";
import { knowledgeModelState } from "../../src/search/knowledge-interpretation.js";
import { hashText } from "../../src/search/review-protocol.js";
import { knowledgeFixture } from "../support/knowledge-fixture.js";
function task(i:number):ArtifactTask{
 const a=knowledgeFixture();a.observation.quote=`Descripción ${i}`;const state=knowledgeModelState(a);
 return {unitKey:hashText(`unit:${i}`),inputHash:hashText(JSON.stringify(state)),state,metadata:{model:"multilingual",modelRevision:"a".repeat(40),sdkVersion:"test",questionVersion:"test-v1",questionHash:"b".repeat(64)}};
}
const prediction=(t:ArtifactTask)=>({unitKey:t.unitKey,inputHash:t.inputHash,...t.metadata,decisions:{state:{choice:"affirmed",probabilities:{affirmed:1}}},routing:{model:t.metadata.model}});
it("procesa más de veinte tareas en lotes acotados y enlaza respuestas por clave",async()=>{
 const tasks=Array.from({length:25},(_,i)=>task(i)),sizes:number[]=[];
 const result=await interpretStudyArtifacts(tasks,[],async batch=>{sizes.push(batch.length);return batch.map(prediction).reverse();});
 expect(sizes).toEqual([20,5]);expect(result.execution).toMatchObject({inferred:25,reused:0,batches:2});expect(result.interpretations.map(p=>p.unitKey)).toEqual(tasks.map(t=>t.unitKey));
});
it("reutiliza solo entrada/modelo/preguntas idénticos y documenta la clave anterior",async()=>{
 const t=task(1),prior=prediction({...t,unitKey:hashText("old-study-key")});
 let calls=0;const run=()=>interpretStudyArtifacts([t],[prior],async batch=>{calls++;return batch.map(prediction);});
 const result=await run();expect(calls).toBe(0);expect(result.execution.reusedFrom).toEqual([{unitKey:t.unitKey,fromUnitKey:prior.unitKey,inputHash:t.inputHash}]);
 t.metadata.questionHash="c".repeat(64);expect((await run()).execution.inferred).toBe(1);expect(calls).toBe(1);
});
it("una entrada cambiada no reutiliza una predicción y una huella falsa se rechaza",async()=>{
 const t=task(1),prior=prediction(t);t.state.quote="Otro texto";t.inputHash=hashText(JSON.stringify(t.state));
 const result=await interpretStudyArtifacts([t],[prior],async batch=>batch.map(prediction));expect(result.execution.inferred).toBe(1);
 t.inputHash=prior.inputHash;await expect(interpretStudyArtifacts([t],[prior],async()=>[])).rejects.toThrow(/Huella/);
});
it("rechaza tareas/respuestas duplicadas, ajenas, incompletas o de otra versión",async()=>{
 const tasks=[task(1),task(2)];await expect(interpretStudyArtifacts([tasks[0]!,tasks[0]!],[],async()=>[])).rejects.toThrow(/duplicada/);
 const bads=[[],[prediction(tasks[0]!)],[prediction(tasks[0]!),prediction(tasks[0]!)],[prediction(tasks[0]!),prediction(task(3))],[prediction(tasks[0]!),{...prediction(tasks[1]!),inputHash:"d".repeat(64)}],[prediction(tasks[0]!),{...prediction(tasks[1]!),modelRevision:"e".repeat(40)}]];
 for(const bad of bads)await expect(interpretStudyArtifacts(tasks,[],async()=>bad)).rejects.toThrow();
});
