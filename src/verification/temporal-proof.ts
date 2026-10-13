/** Foundation and a release date are different claims, even in one paragraph. */
export function formationYears(quote:string):number[]{
 const text=quote.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
 const cues=/(?:\bfundad[oa]s?\b|\bfundo\b|\bformad[oa]s?\b|\bse form(?:o|aron)\b|\bfounded\b|\bformed\b|\bfoundingdate\b|\bfecha de fundacion\b|\bfecha de formacion\b|\bformacion\b(?=\s*(?::|=|\||\n|[12][0-9]{3}))|\b(?:activo|activa|actividad) desde\b)/gu;
 const years:number[]=[];
 for(const match of text.matchAll(cues)){
  const after=text.slice((match.index??0)+match[0].length,(match.index??0)+match[0].length+70).replace(/^[\s:|=]+/u,"").split(/[.!?\n]/u)[0]??"";
  const year=/(?<![0-9])(?:[12][0-9]{3})(?![0-9])/u.exec(after);if(year)years.push(Number(year[0]));
 }
 return [...new Set(years)];
}
