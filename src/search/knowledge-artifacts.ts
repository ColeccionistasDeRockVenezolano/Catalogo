import assert from "node:assert/strict";
import { knowledgeModelState, modelInterpretationSchema, type InterpretationMetadata } from "./knowledge-interpretation.js";
import { hashText } from "./review-protocol.js";
import type { z } from "zod";
export interface ArtifactTask {unitKey:string;inputHash:string;state:ReturnType<typeof knowledgeModelState>;metadata:InterpretationMetadata}
type Prediction=z.infer<typeof modelInterpretationSchema>;
const sameMetadata=(p:Prediction,m:InterpretationMetadata)=>Object.entries(m).every(([k,v])=>p[k as keyof Prediction]===v)&&p.routing["model"]===m.model;
/** Model predictions may be reused for identical model input; this creates no
 * new source witness or human decision. Study identity remains explicit and
 * model/question/input changes always require another prediction. */
export async function interpretStudyArtifacts(tasks:ArtifactTask[],previous:unknown[],predict:(batch:ArtifactTask[])=>Promise<unknown[]>){
  assert.equal(new Set(tasks.map(t=>t.unitKey)).size,tasks.length,"Tarea de interpretación duplicada");
  for(const task of tasks)assert.equal(task.inputHash,hashText(JSON.stringify(task.state)),"Huella de entrada de tarea incorrecta");
  const old=previous.map(p=>modelInterpretationSchema.parse(p)),predictions=new Map<string,Prediction>(),pending:ArtifactTask[]=[];
  const reused:Array<{unitKey:string;fromUnitKey:string;inputHash:string}>=[];
  for(const task of tasks){
    const prior=old.find(p=>p.inputHash===task.inputHash&&sameMetadata(p,task.metadata));
    if(prior){predictions.set(task.unitKey,{...prior,unitKey:task.unitKey});reused.push({unitKey:task.unitKey,fromUnitKey:prior.unitKey,inputHash:task.inputHash});}
    else pending.push(task);
  }
  let batches=0;
  for(let offset=0;offset<pending.length;offset+=20){
    const batch=pending.slice(offset,offset+20),rows=(await predict(batch)).map(p=>modelInterpretationSchema.parse(p));
    assert.equal(rows.length,batch.length,"Modelo devolvió otra cantidad de unidades");
    assert.equal(new Set(rows.map(p=>p.unitKey)).size,rows.length,"Predicción duplicada");
    for(const row of rows){
      const task=batch.find(t=>t.unitKey===row.unitKey);assert(task,"Predicción sin tarea");
      assert.equal(row.inputHash,task.inputHash,"Predicción de otro texto");
      assert(sameMetadata(row,task.metadata),"Modelo/preguntas cambiaron");predictions.set(row.unitKey,row);
    }
    batches++;
  }
  return {interpretations:tasks.map(t=>predictions.get(t.unitKey)!),execution:{inferred:pending.length,reused:reused.length,batches,reusePolicy:"exact_model_question_metadata_and_input_hash",reusedFrom:reused}};
}
