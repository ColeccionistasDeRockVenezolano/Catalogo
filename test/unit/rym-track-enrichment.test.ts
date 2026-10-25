import { describe,expect,it } from 'vitest';
import { planRymTrackEnrichment } from '../../src/verification/rym-track-enrichment.js';
const source=[{n:'1',titulo:'Camino al mar',seg:120,dur:'2:00'},{n:'2',titulo:'Otra orilla',seg:180,dur:'3:00'}];
describe('integral RYM track enrichment',()=>{
  it('accepts an existing exact alias only at its documented position',()=>{
    const current=[{id:1,title:'Título canónico',aliases:['Camino al mar'],disc_number:1,track_number:1,duration_seconds:null}];
    const plan=planRymTrackEnrichment(current,[source]);
    expect(plan.durations).toEqual([{id:1,seconds:120}]);expect(plan.added.map(t=>t.title)).toEqual(['Otra orilla']);
    expect(planRymTrackEnrichment([{...current[0]!,track_number:2}],[source]).withheld).toContain('existing_tracklist_differs');
  });
  it('fills a compatible partial list without recreating the existing recording',()=>{
    const result=planRymTrackEnrichment([{id:1,title:'Camino al mar',disc_number:1,track_number:1,duration_seconds:null}],[source]);
    expect(result.added.map(t=>t.title)).toEqual(['Otra orilla']);expect(result.durations).toEqual([{id:1,seconds:120}]);
  });
  it('refuses a different edition or recording at an occupied position',()=>{
    expect(planRymTrackEnrichment([{id:1,title:'Otra toma',disc_number:1,track_number:1,duration_seconds:null}],[source]).added).toEqual([]);
    expect(planRymTrackEnrichment([],[source,source.slice(0,1)]).withheld).toContain('source_editions_disagree');
  });
  it('never overwrites a duration and abstains from conflicting durations',()=>{
    const current=[{id:1,title:'Camino al mar',disc_number:1,track_number:1,duration_seconds:140}];
    expect(planRymTrackEnrichment(current,[source]).durations).toEqual([]);
    const second=source.map(t=>({...t,seg:t.seg+10}));
    expect(planRymTrackEnrichment([],[source,second]).added.every(t=>t.duration_seconds===undefined)).toBe(true);
  });
  it('preserves repeated song titles at distinct documented positions',()=>{
    const repeated=[source[0]!,{...source[0]!,n:'2'}];
    expect(planRymTrackEnrichment([],[repeated]).added).toHaveLength(2);
  });
  it('rejects ambiguous source numbering and duplicated catalog positions',()=>{
    expect(planRymTrackEnrichment([],[source.map(t=>({...t,n:'1'}))]).added).toEqual([]);
    const track={id:1,title:'Camino al mar',disc_number:1,track_number:1,duration_seconds:null};
    expect(planRymTrackEnrichment([track,{...track,id:2}],[source]).added).toEqual([]);
  });
});
