import {describe,expect,it} from 'vitest';
import {distinctRymPublication as distinct,type RymExistingPublication} from '../../src/verification/rym-distinct-publication.js';
const existing:RymExistingPublication={title:'Primera obra',aliases:['Debut'],album_type:'studio_album',titles:['Mar abierto','La tormenta','El regreso']};
const source={title:'Segunda vida',year:2002,albumType:'studio_album',titles:['Despertar','Noche larga','Horizonte']};
describe('documented distinct RYM publication',()=>{
 it('recognizes a dated work with a different literal title and repertoire',()=>expect(distinct(source,[existing])).toBe(true));
 it('retains aliases, compact spelling variants and expanded titles',()=>{
  for(const title of ['Debut','Primeraobra','Primera obra en vivo'])expect(distinct({...source,title},[existing])).toBe(false);
 });
 it('does not create another work for the same reordered repertoire',()=>expect(distinct({...source,titles:[...existing.titles].reverse()},[existing])).toBe(false));
 it('does not promote an edition or an undated record to a distinct work',()=>{
  expect(distinct({...source,title:'Segunda vida (Deluxe Edition)'},[existing])).toBe(false);
  expect(distinct({...source,year:null},[existing])).toBe(false);
 });
 it('allows a documented single contained in a longer album but retains a retitled duplicate single',()=>{
  const single={title:'Mar abierto',year:2001,albumType:'single',titles:['Mar abierto']};
  expect(distinct(single,[existing])).toBe(true);
  expect(distinct(single,[{title:'Otra vida',aliases:[],titles:['Mar abierto'],album_type:'single'}])).toBe(false);
 });
 it('requires a primary repertoire independently of an explicit publication type',()=>expect(distinct({...source,titles:[]},[existing])).toBe(false));
});
