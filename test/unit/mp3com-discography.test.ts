import { describe, expect, it } from 'vitest';
import { discographyCounts, discographyTitle, renderDiscography } from '../../scripts/lib/mp3com-discography.js';

describe('Discografía declarada en MP3.com', () => {
  it('conserva canciones sin edición y no las cuenta como discos', () => {
    const d = { name: 'Artista', url: 'https://example.org/artist', albums: [
      {album:'Mi disco',media:'CD',label:null,tracks:[{song_id:'1',title:'Uno',credits:null}]},
      {album:null,media:null,label:null,tracks:[{song_id:'2',title:'Dos',credits:null}]},
    ] };
    expect(discographyCounts(d)).toMatchObject({albums:1,albumGroups:2,untitledGroups:1,tracks:2,unassignedTracks:1});
    expect(discographyTitle(d)).toContain('1 entrada con título de disco');
    const text=renderDiscography(d,[{song_id:'2',credits:'Ana',genre:'Rock'}]);
    expect(text).toContain('Pistas sin disco identificado');
    expect(text).toContain('Dos (Ana — género: Rock)');
    expect(text).toContain('Mi disco');
  });
  it('distingue entradas, títulos repetidos y grupos vacíos', () => {
    const d={name:'Artista',url:'https://example.org',albums:[
      {album:'Disco',media:'CD',label:null,tracks:[]},
      {album:' DISCO ',media:'Digital',label:null,tracks:[]},
      {album:' ',media:null,label:null,tracks:[]},
    ]};
    expect(discographyCounts(d)).toMatchObject({albums:2,distinctAlbumTitles:1,untitledGroups:1,tracks:0});
  });
});
