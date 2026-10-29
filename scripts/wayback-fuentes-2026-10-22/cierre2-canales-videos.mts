import {readFileSync,writeFileSync} from 'node:fs';
import {YouTubeDataApi} from '../../src/youtube/api.js';
import {closeDb} from '../../src/db/client.js';
const out=process.env['WAYBACK_OUT']!;if(!out)throw Error('WAYBACK_OUT obligatorio');
try{const cached=JSON.parse(readFileSync(out+'/youtube-investigacion.json','utf8'));const video=cached.api.items.find((v:any)=>v.id==='xb9UeDp1xPw');
 const channelId=video.snippet.channelId;const api=new YouTubeDataApi();const channel=await api.getChannel(channelId);const playlist=channel.items?.[0]?.contentDetails?.['relatedPlaylists'] as {uploads?:string}|undefined;
 const rows:any[]=[];if(playlist?.uploads){let page:string|undefined;for(let n=0;n<3;n++){const response=await api.listPlaylistItems(playlist.uploads,page);rows.push(...(response.items??[]));page=response.nextPageToken;if(!page)break;}}
 writeFileSync(out+'/youtube-canal-archivo.json',JSON.stringify({at:new Date().toISOString(),channel,items:rows},null,2));console.log(JSON.stringify(rows.map(r=>({id:r.contentDetails?.videoId,title:r.snippet?.title,description:r.snippet?.description})),null,2));
}finally{await closeDb();}
