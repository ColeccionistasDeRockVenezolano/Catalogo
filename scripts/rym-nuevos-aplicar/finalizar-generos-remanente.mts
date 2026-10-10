import {writeFileSync} from 'node:fs';
import {applyTaxonomyOperations} from '../../src/genres/admin.js';
import {closeDb} from '../../src/db/client.js';
const confirm=process.argv.includes('--confirm');
const result=await applyTaxonomyOperations([{op:'set_alias',alias:'Schlager',target:'pop',notes:'Término RYM conservado como alias al padre Pop, siguiendo el criterio de la campaña. Clasificación: https://musicbrainz.org/genre/7edde935-8094-409e-ba33-34779b4668f8; contraste: https://www.gema.de/de/w/zehn-jahre-radiokulturpreis'}],{actor:'Codex (autorizado por Brian)',reason:'Resolver cuatro géneros Schlager pendientes en los sencillos de Carlos Otero, remanente RYM 2026-10-09.'},{confirm});
writeFileSync(`reports/rym-resolucion-2026-10-09/taxonomia-${confirm?'aplicado':'ensayo'}.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({mode:result.mode,runId:result.runId}));await closeDb();
