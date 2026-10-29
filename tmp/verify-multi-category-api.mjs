import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const base='http://127.0.0.1:3120/crv/api';
const get=async path=>{const started=performance.now();const response=await fetch(base+path);assert.equal(response.status,200,path);return {body:await response.json(),ms:Math.round(performance.now()-started)}};
const records=(await get('/albums?albumType=remix&limit=200')).body.data;
const singleRemix=records.filter(a=>a.albumType==='single');
const triple=singleRemix.filter(a=>a.classifications.some(c=>c.classification==='Instrumental'));
const cases=[];
for(const [query,expected] of [
 ['albumType=single,remix',singleRemix],
 ['albumType=single&albumType=remix',singleRemix],
 ['albumType=single,remix,single',singleRemix],
 ['albumType=single,remix,instrumental',triple],
 ['albumType=single,ep',[]],
 ['albumType=single,unknown',[]]
]) {
 const {body,ms}=await get(`/albums?${query}&limit=200`);
 assert.equal(body.pagination.total,expected.length);assert.deepEqual(body.data.map(a=>a.id).sort((a,b)=>a-b),expected.map(a=>a.id).sort((a,b)=>a-b));
 cases.push({query,total:body.pagination.total,ms});
}
for(const [query,total] of [['albumType=b_sides,single',2],['albumType=b_sides,live',1],['albumType=b_sides,demo',1],['albumType=b_sides,compilation',2]]){
 const {body,ms}=await get(`/albums?${query}&limit=200`);assert.equal(body.pagination.total,total);cases.push({query,total,ms});
}
const {body:paged}=await get('/albums?albumType=single,remix&limit=1&offset=1');
assert.equal(paged.pagination.total,singleRemix.length);assert.equal(paged.data.length,1);
const {body:all}=await get('/albums?albumType=single,remix&limit=200');assert.equal(paged.data[0].id,all.data[1].id);
const acoustic=(await get('/albums?albumType=acoustic,live&limit=200')).body;
assert(acoustic.data.some(a=>a.id===534));
const result={checkedAt:new Date().toISOString(),cases,paginationVerified:true,unpluggedLiveIncludes534:true,acousticLiveTotal:acoustic.pagination.total};
writeFileSync('reports/seleccion-multiple-discos/api.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
