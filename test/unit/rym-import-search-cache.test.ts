import {beforeEach,describe,expect,it,vi} from 'vitest';

const database=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../../src/db/client.js',()=>({getPool:()=>database}));

beforeEach(()=>{vi.resetModules();database.query.mockReset();database.query.mockResolvedValue({rows:[]});});

describe('search cache during catalog imports',()=>{
 it('does not load unused indexes when an import invalidates them',async()=>{
  const search=await import('../../src/api/search-index.js');
  search.invalidateSearchIndex();
  await Promise.resolve();
  expect(database.query).not.toHaveBeenCalled();
  expect(search.searchIndexSize()).toBe(0);
 });
 it('still loads current data on the first search after a cold invalidation',async()=>{
  const search=await import('../../src/api/search-index.js');
  search.invalidateSearchIndex('artist');
  database.query.mockImplementation(async(sql:string)=>({rows:sql.includes('FROM ingest.artist_aliases')?[]:[{id:'17',name:'Bacos',weight:'0'}]}));
  expect(await search.searchIds('artist','bacos')).toEqual([17]);
  expect(search.searchIndexSize()).toBe(1);
 });
 it('refreshes an index already used by the API without loading other kinds',async()=>{
  const search=await import('../../src/api/search-index.js');
  expect(await search.searchIds('artist','bacos')).toEqual([]);
  database.query.mockImplementation(async(sql:string)=>({rows:sql.includes('FROM ingest.artist_aliases')?[]:[{id:'17',name:'Bacos',weight:'0'}]}));
  search.invalidateSearchIndex();
  await search.refreshSearchIndex('artist');
  expect(await search.searchIds('artist','bacos')).toEqual([17]);
  expect(search.searchIndexSize()).toBe(1);
  expect(database.query.mock.calls.every(([sql])=>!String(sql).includes('FROM public.persons'))).toBe(true);
 });
});
