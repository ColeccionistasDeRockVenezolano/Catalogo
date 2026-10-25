import {describe,expect,it} from 'vitest';
import {rymCreditScope} from '../../src/verification/rym-credit-scope.js';
const source=['A1','A2','B1','B2'].map((n,i)=>({n,titulo:`Tema ${i+1}`,seg:0}));
describe('literal RYM credit scopes',()=>{
 it('resolves documented vinyl ranges against the edition list',()=>expect(rymCreditScope('A2-B1, B2',source)?.map(t=>t.track_number)).toEqual([2,3,4]));
 it('keeps the same printed track number on different CDs separate',()=>{
  const cds=['1.1','1.2','2.1','2.2'].map(n=>({n,titulo:n,seg:0}));
  expect(rymCreditScope('2.1-2.2',cds)?.map(t=>t.disc_number)).toEqual([2,2]);
  expect(rymCreditScope('1',cds)).toBeNull();
 });
 it('rejects absent endpoints, reversed ranges and ambiguous source labels',()=>{
  expect(rymCreditScope('A1-B5',source)).toBeNull();
  expect(rymCreditScope('B2-A1',source)).toBeNull();
  expect(rymCreditScope('A1',[...source,source[0]!])).toBeNull();
 });
});
