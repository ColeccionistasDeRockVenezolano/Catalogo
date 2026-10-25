import {describe,expect,it} from 'vitest';
import {planRymPerson,rymPersonDate,rymProfilePersonMatches} from '../../src/verification/rym-person-resolution.js';
import type {PersonCandidate} from '../../src/verification/person-source-plan.js';
const person=(id:number,name:string,projects:number[]=[],aliases:string[]=[]):PersonCandidate=>({id,name,projects,aliases});
describe('RYM person identity',()=>{
 it('does not give the birth name of Gus to Gustavo Corma through their shared nickname',()=>{
  expect(rymProfilePersonMatches('Gus',['Gustavo Enrique Ortega Urdaneta'],6788,person(1123,'Gustavo Corma',[6788],['Gus']),null)).toBe(false);
 });
 it('does not identify Nacho as the bassist Ignacio Pérez',()=>{
  expect(rymProfilePersonMatches('Nacho',['Miguel Ignacio Mendoza Donatti'],6630,person(3343,'Ignacio Pérez',[6630],['Nacho']),null)).toBe(false);
 });
 it('accepts the fuller birth name of the documented member of Chino & Nacho',()=>{
  expect(rymProfilePersonMatches('Nacho',['Miguel Ignacio Mendoza Donatti'],6630,person(35444,'Miguel Ignacio Mendoza',[6630],['Nacho']),null)).toBe(true);
 });
 it('keeps a genuine stage identity when its birth name was not previously recorded',()=>{
  expect(rymProfilePersonMatches('Caterinetta Lescano',['Katharina Matje Leschan'],6878,person(40125,'Caterinetta Lescano',[6878]),null)).toBe(true);
 });
 it('checks an existing real name even when the stage names agree',()=>{
  expect(rymProfilePersonMatches('Gus',['Gustavo Enrique Ortega Urdaneta'],6788,person(1123,'Gus',[6788]),'Gustavo Corma')).toBe(false);
 });
 it('preserves date precision, historic years and rejects impossible days',()=>{
  expect(rymPersonDate('1567, Cremona, Italy')).toBe('1567');
  expect(rymPersonDate('February 1980, Caracas')).toBe('1980-02');
  expect(rymPersonDate('29 February 1980, Caracas')).toBe('1980-02-29');
  expect(rymPersonDate('31 June 1980')).toBeNull();
 });
 it('recognizes a documented longer full name in the same project',()=>{
  expect(planRymPerson('Juan Ignacio Morasso Tucker',1,[person(3,'Ignacio Morasso',[1])]).personId).toBe(3);
 });
 it('does not identify an unlinked person by containment',()=>{
  expect(planRymPerson('Juan Ignacio Morasso Tucker',1,[person(3,'Ignacio Morasso',[2])])).toMatchObject({personId:null,canCreateDifferent:false});
 });
 it('does not choose between two collaborators sharing a shorter name',()=>{
  expect(planRymPerson('Juan Pérez',1,[person(3,'Juan Carlos Pérez',[1]),person(4,'Juan Antonio Pérez',[1])])).toMatchObject({personId:null,canCreateDifferent:false});
 });
 it('recognizes an explicit quoted nickname without creating another person',()=>{
  expect(planRymPerson('José "Gollo" Hernández',1,[person(3,'José Hernández',[1])])).toMatchObject({personId:3,nickname:'Gollo'});
 });
 it('retains possible misspellings and shared name fragments',()=>{
  expect(planRymPerson('Adrián Hernández',1,[person(3,'Adrián Fernández')]).canCreateDifferent).toBe(false);
  expect(planRymPerson('María Gabriela Martín',1,[person(3,'María Gabriela')]).canCreateDifferent).toBe(false);
 });
 it('allows a distinct documented full name after all aliases were checked',()=>{
  expect(planRymPerson('Wolfgang Osorio',1,[person(3,'Carlos Romero',[1])]).canCreateDifferent).toBe(true);
  expect(planRymPerson('Wolfgang Osorio',1,[person(3,'Carlos Romero',[1],['Wolfgang Osorio'])]).personId).toBe(3);
 });
});
