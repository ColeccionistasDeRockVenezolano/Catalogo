import {writeFileSync} from 'node:fs';import {getPool,closeDb} from '../src/db/client.js';import {previewAlbumMerge} from '../src/merge/album-merge.js';
const out=process.argv[2];if(!out)throw new Error('Indica staging');const c=await getPool().connect();
try{await c.query('BEGIN READ ONLY');const results=[];for(const [keep,drop] of [[39998,3641],[39998,4623],[656,3305]]){
 const p=await previewAlbumMerge(c,keep!,drop!,{mode:'match'});results.push(p);console.log({keep,drop,matched:p.matchedTracks.length,unmatched:p.unmatchedDropTracks.length,conflicts:p.fieldConflicts.map(c=>({field:c.field,keep:c.keepValue,drop:c.dropValue})),warnings:p.warnings});}
 writeFileSync(`${out}/merge-previews.json`,JSON.stringify(results,null,2));await c.query('ROLLBACK');}finally{c.release();await closeDb();}
