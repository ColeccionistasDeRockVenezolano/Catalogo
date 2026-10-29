import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const base='http://127.0.0.1:3120/crv/api';
const get=async path=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.json()};
const a=await get('/albums?albumType=remix&limit=100');
const b=await get('/albums?albumType=remix&limit=100&offset=100');
const all=[...a.data,...b.data];
assert.equal(new Set(all.map(a=>a.id)).size,all.length);assert.equal(all.length,a.pagination.total);
assert.equal(all.filter(a=>a.albumType==='single').length,78);
assert.equal(all.filter(a=>a.albumType==='ep').length,5);
const examples=[];
for(const [id,type,labels] of [[155,'single',['Remix']],[13929,'ep',['Remix']],[14426,'single',['Remix','Instrumental']],[487,'remix',['Compilation Album','Remix']]]) {
 const album=await get(`/albums/${id}`);assert.equal(album.albumType,type);
 for(const label of labels)assert(album.classifications.some(c=>c.classification===label));
 examples.push({id,title:album.title,type:album.albumType,classifications:album.classifications});
}
const acoustic=await get('/albums?albumType=acoustic&limit=100');
assert(!acoustic.data.some(a=>a.id===534));
const unplugged=await get('/albums/534');assert(unplugged.classifications.some(c=>c.classification==='Unplugged'));
const result={checkedAt:new Date().toISOString(),remixFilter:{total:all.length,singles:78,eps:5,duplicates:0},examples,unpluggedMissingFromAcoustic:{id:534,title:unplugged.title,classifications:unplugged.classifications,acousticFilterTotal:acoustic.pagination.total},uiCapability:'El selector actual permite una categoría por vez; no combina intersecciones de categorías.'};
writeFileSync('reports/tipos-mixtos-discos/api.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
