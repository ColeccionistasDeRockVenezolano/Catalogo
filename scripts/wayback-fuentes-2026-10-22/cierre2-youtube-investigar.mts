import {writeFileSync} from 'node:fs';
import {YouTubeDataApi} from '../../src/youtube/api.js';
import {closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');
try{const ids=['JR5hYywCM4k','ivgmIeZfcnw','B6E8QpLPY4s','weAxcNxVVVU','A_PcEnFqLCY','07GOOGf-7Zg','xb9UeDp1xPw','BDGj2GM3ezA','x6Dy7Z_gLIY','948U2LSWMQs'];
 const api=await new YouTubeDataApi().listVideos(ids);writeFileSync(out+'/youtube-investigacion.json',JSON.stringify({at:new Date().toISOString(),requested:ids,api},null,2));console.log(JSON.stringify(api.items?.map(v=>({id:v.id,title:v.snippet?.['title'],channel:v.snippet?.['channelTitle'],description:v.snippet?.['description'],status:v.status})),null,2));
}finally{await closeDb();}
