// Validates planning consistency, never marks software acceptance as passed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const main=new URL('PLAN_CINCO_ETAPAS_20_DE_20_2026-10-10.md',root);
const contract=new URL('PLAN_CINCO_ETAPAS_20_DE_20_EJECUCION_2026-10-10.md',root);
const [mainText,contractText,backlogText,acceptanceText]=await Promise.all([
 readFile(main,'utf8'),readFile(contract,'utf8'),
 readFile(new URL('backlog.json',import.meta.url),'utf8'),
 readFile(new URL('acceptance.json',import.meta.url),'utf8'),
]);
const backlog=JSON.parse(backlogText),acceptance=JSON.parse(acceptanceText);
assert.deepEqual([...mainText.matchAll(/^## Etapa ([1-5])\./gm)].map(m=>m[1]),['1','2','3','4','5']);
assert.equal(backlog.tasks.length,25);
const tasks=new Map(backlog.tasks.map(task=>[task.id,task]));
assert.equal(tasks.size,25);
const visiting=new Set(),visited=new Set();
function visit(id){
 assert(!visiting.has(id),`Dependency cycle at ${id}`);
 if(visited.has(id))return;
 const task=tasks.get(id);assert(task,`Unknown task ${id}`);visiting.add(id);
 for(const dep of task.dependencies){assert(tasks.has(dep),`Unknown dependency ${dep}`);assert(tasks.get(dep).stage<=task.stage);visit(dep)}
 visiting.delete(id);visited.add(id);
}
const covered=new Set();
for(const task of tasks.values()){
 visit(task.id);assert(task.stage>=1&&task.stage<=5);assert.match(task.id,new RegExp(`^E${task.stage}-0[1-5]$`));
 assert(task.ownerRole&&task.reviewerRole&&task.deliverable&&task.verification&&task.codeAreas.length);
 assert(task.effortPersonDays.min>0&&task.effortPersonDays.max>=task.effortPersonDays.min);
 if(task.acceptance==='G01-G29'){for(let n=1;n<=29;n++)covered.add(`G${String(n).padStart(2,'0')}`)}else{for(const gate of task.acceptance.split(','))covered.add(gate)}
}
const gateIds=Array.from({length:29},(_,i)=>`G${String(i+1).padStart(2,'0')}`);
assert.deepEqual(acceptance.gates.map(g=>g.id),gateIds);
assert.deepEqual([...covered].sort(),gateIds);
assert.deepEqual(acceptance.metrics.map(m=>m.id),Array.from({length:13},(_,i)=>`M${String(i+1).padStart(2,'0')}`));
const metricIds=new Set(acceptance.metrics.map(m=>m.id));
for(const gate of acceptance.gates){
 assert(gate.requiredEvidence&&gate.packageAndReviewer);
 for(const task of gate.packageAndReviewer.matchAll(/E[1-5]-\d{2}/g))assert(tasks.has(task[0]));
 for(const metric of gate.metrics)assert(metricIds.has(metric));
 const row=contractText.split('\n').find(line=>line.startsWith(`| ${gate.id} |`));assert(row);
 const columns=row.slice(1,-1).split('|').map(v=>v.trim());
 assert.equal(columns[1],gate.dimension);assert.equal(columns[2],gate.requiredEvidence);assert.equal(columns[3],gate.packageAndReviewer);
}
for(const metric of acceptance.metrics){
 const row=contractText.split('\n').find(line=>line.startsWith(`| ${metric.id} |`));assert(row);
 const columns=row.slice(1,-1).split('|').map(v=>v.trim());assert.equal(columns[1],metric.name);assert.equal(columns[2],metric.definitionAndThreshold);
}
const estimate=[...tasks.values()].reduce((s,t)=>[s[0]+t.effortPersonDays.min,s[1]+t.effortPersonDays.max],[0,0]);
assert.deepEqual(estimate,[64,112]);
assert.equal([...contractText.matchAll(/^\|\d+ \|/gm)].length,20);
for(const [url,body]of [[main,mainText],[contract,contractText]]){
 for(const link of body.matchAll(/\]\(([^)]+)\)/g)){
  if(link[1].startsWith('http'))continue;
  await readFile(new URL(link[1].split('#')[0],url));
 }
}
console.log(JSON.stringify({planStages:5,workPackages:25,dependencyCycles:0,acceptanceDimensions:29,metrics:13,planningCriteria:20,effortPersonDays:estimate,consistency:'passed',softwareStatus:'not evaluated by this validator'},null,2));
