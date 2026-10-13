import {parseDateValue} from "../catalog/date-value.js";

const MONTHS=["enero january","febrero february","marzo march","abril april","mayo may","junio june","julio july","agosto august","septiembre setiembre september","octubre october","noviembre november","diciembre december"];
/** The month and day must occur as one calendar date, not unrelated numbers. */
export function dateBacked(text:string,value:string):boolean{
 let point;try{point=parseDateValue(value);}catch{return false;}
 if(point.kind!=="point"||point.approximate)return false;
 const normalized=text.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
 const year=String(point.year),month=point.month,day=point.day;
 if(month===null)return new RegExp(`(?<![0-9])${year}(?![0-9])`,"u").test(normalized);
 const aliases=MONTHS[month-1]!.split(" ").join("|");
 const numericMonth=`0?${month}`,numericDay=day===null?"(?:0?[1-9]|[12][0-9]|3[01])":`0?${day}`;
 const iso=`${year}[-/]${numericMonth}${day===null?"":`[-/]${numericDay}`}`;
 const local=`${numericDay}[-/]${numericMonth}[-/]${year}`;
 const named=day===null?`(?:${aliases})(?:\\s+de)?[ ,]+(?:${numericDay}(?:st|nd|rd|th)?[ ,]+)?${year}`:`(?:${numericDay}(?:\\s+de)?\\s+(?:${aliases})(?:\\s+de)?[ ,]+${year}|(?:${aliases})\\s+${numericDay}(?:st|nd|rd|th)?[ ,]+${year})`;
 return new RegExp(`(?<![\\p{L}0-9])(?:${iso}|${local}|${named})(?![0-9])`,"u").test(normalized);
}
export function calendarAtoms(value:string):string[]|null{
 if(value.includes("~")||value.includes("/"))return [value];
 const date=/\b\d{4}(?:-\d{2}(?:-\d{2})?)?\b/u.exec(value)?.[0];if(!date)return null;
 try{const parsed=parseDateValue(date);if(parsed.kind!=="point")return null;}catch{return null;}
 const parts=date.split("-");return parts.map((_part,index)=>parts.slice(0,index+1).join("-"));
}
