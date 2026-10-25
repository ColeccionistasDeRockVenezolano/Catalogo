import {normalizeRymIdentity as norm} from './rym-identity.js';
import {completePersonName,exactSourcePeople,resolveSourcePerson,type PersonCandidate} from './person-source-plan.js';

const ignored=new Set(['de','del','la','el','los','las','da','do','dos','y']);
const parts=(value:string)=>norm(value).split(' ').filter(v=>v&&!ignored.has(v));
const candidateNames=new WeakMap<PersonCandidate,{name:string;aliases:string[];values:Array<{key:string;parts:string[]}>}>();
function namesOf(person:PersonCandidate){
 let cached=candidateNames.get(person);
 if(!cached||cached.name!==person.name||cached.aliases!==person.aliases){
  cached={name:person.name,aliases:person.aliases,values:[person.name,...person.aliases].map(alias=>({key:norm(alias),parts:parts(alias)}))};
  candidateNames.set(person,cached);
 }
 return cached.values;
}
export function rymPersonDate(raw:string|undefined):string|null{
 const text=(raw??'').split(',')[0]!.trim();
 if(/^[1-9]\d{3}$/u.test(text))return text;
 const match=/^(?:(\d{1,2})\s+)?([A-Za-z]+)\s+([1-9]\d{3})$/u.exec(text);
 if(!match)return null;
 const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
 const month=months.indexOf(match[2]!.toLowerCase())+1;if(!month)return null;
 if(match[1]){const date=new Date(Date.UTC(Number(match[3]),month-1,Number(match[1])));if(date.getUTCMonth()!==month-1||date.getUTCDate()!==Number(match[1]))return null;}
 return `${match[3]}-${String(month).padStart(2,'0')}${match[1]?`-${match[1].padStart(2,'0')}`:''}`;
}
function near(a:string,b:string):boolean{
 if(Math.abs(a.length-b.length)>2)return false;
 let row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const next=[i];
  for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]!+1,row[j]!+1,row[j-1]!+(a[i-1]===b[j-1]?0:1));
  if(Math.min(...next)>2)return false;
  row=next;
 }
 return row[b.length]!<=2;
}

/** A source may supply a longer full name or an explicit quoted nickname.
 * Only a unique existing collaborator of the same project can be recognized
 * by containment. New people require a full name with no plausible spelling,
 * abbreviation, alias or collaborator candidate anywhere in the catalog. */
export function planRymPerson(name:string,artistId:number,people:PersonCandidate[],checkCreation=true):{
 personId:number|null;canCreateDifferent:boolean;canonicalName:string;nickname:string|null;
}{
 const nickname=/["“]([^"”]+)["”]/u.exec(name)?.[1]?.trim()??null;
 const canonicalName=name.replace(/["“][^"”]+["”]/gu,' ').replace(/\s+/gu,' ').trim();
 const exact=resolveSourcePerson(name,artistId,people)??(canonicalName!==name?resolveSourcePerson(canonicalName,artistId,people):null);
 const result={personId:exact,canCreateDifferent:false,canonicalName,nickname};
 if(exact)return result;
 const incoming=parts(canonicalName);
 if(incoming.length<2||!completePersonName(canonicalName))return result;
 const linked=people.filter(p=>p.projects.includes(artistId));
 const extensions=linked.filter(p=>namesOf(p).some(alias=>{
  const existing=alias.parts;
  return existing.length>=2&&(existing.every(v=>incoming.includes(v))||incoming.every(v=>existing.includes(v)));
 }));
 if(extensions.length===1)return {...result,personId:extensions[0]!.id};
 if(!checkCreation)return result;
 if(extensions.length||exactSourcePeople(canonicalName,people).length)return result;
 if(linked.some(p=>namesOf(p).some(alias=>alias.parts.some(v=>incoming.includes(v)))))return result;
 const key=norm(canonicalName);
 for(const person of people)for(const alias of namesOf(person)){
  const existing=alias.parts,shared=incoming.filter(v=>existing.includes(v));
  if(existing.length===1&&shared.length>0&&existing[0]!.length>=4||shared.length>=2||alias.key.replace(/ /gu,'')===key.replace(/ /gu,'')||near(alias.key,key))return result;
 }
 return {...result,canCreateDifferent:true};
}

/** A stage name does not contradict a newly documented birth name. A
 * different known full name behind a shared nickname does require proof. */
export function rymProfilePersonMatches(sourceName:string,birthNames:readonly string[],artistId:number,person:PersonCandidate,realName:string|null):boolean{
 if(!birthNames.length)return true;
 if(norm(sourceName)===norm(person.name)&&!realName)return true;
 const candidate={...person,aliases:[...person.aliases,...(realName?[realName]:[])]};
 return birthNames.some(name=>planRymPerson(name,artistId,[candidate],false).personId===person.id);
}
