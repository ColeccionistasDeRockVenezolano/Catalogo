import {describe,it,expect} from 'vitest';
import {corroboratesPlaybackAlbum,corroboratesPlaybackRepertoire,corroboratedPlaybackMembers} from '../../src/verification/artist-player-recovery.js';
describe('identidad de publicaciones para recuperar reproductores',()=>{
  const album={id:1,title:'Victoria Ancestral',year:2013,tracks:['Río','Vida','Tierra']};
  it('exige artista y publicación exactos aunque coincida el año',()=>{
    expect(corroboratesPlaybackAlbum({title:album.title,year:2013,tracks:[],artist:'Otro'},album,['Nabarao'])).toBe(false);
    expect(corroboratesPlaybackAlbum({title:'Victoria Ancestral Remixes',year:2013,tracks:album.tracks,artist:'Nabarao'},album,['Nabarao'])).toBe(false);
  });
  it('acepta dos pistas documentadas cuando cambia el año de edición',()=>{
    expect(corroboratesPlaybackAlbum({title:album.title,year:2014,tracks:['Rio','Tierra'],artist:'Nabarao'},album,['Nabarao'])).toBe(true);
  });
  it('no cuenta repeticiones como dos pistas',()=>{
    expect(corroboratesPlaybackAlbum({title:album.title,year:2014,tracks:['Vida','Vida'],artist:'Nabarao'},album,['Nabarao'])).toBe(false);
  });
  it('no resuelve un título genérico con solo nombre y año',()=>{
    const ep={...album,title:'EP'};
    expect(corroboratesPlaybackAlbum({title:'EP',year:2013,tracks:[],artist:'Nabarao'},ep,['Nabarao'])).toBe(false);
    expect(corroboratesPlaybackAlbum({title:'EP',year:2013,tracks:['Intro','Outro'],artist:'Nabarao'},{...ep,tracks:['Intro','Outro']},['Nabarao'])).toBe(false);
  });
  it('exige nombres completos y personas distintas para corroborar integrantes',()=>{
    expect(corroboratedPlaybackMembers('Fabio K, João Holzer', [{id:1,name:'Fabio K'},{id:2,name:'João Holzer'},{id:2,name:'João Holzer'}])).toEqual([2]);
    expect(corroboratedPlaybackMembers('Edwin Oropeza y Jhonny Briceño', [{id:1,name:'Edwin Oropeza'},{id:2,name:'Jhonny Briceño'}])).toEqual([1,2]);
  });
  it('acredita repertorio de una reedición sin convertirla en la edición del catálogo',()=>{
    expect(corroboratesPlaybackRepertoire({artist:'Nabarao',title:'Otra edición',year:2020,tracks:['Río','Tierra']},[album],['Nabarao'])).toBe(true);
    expect(corroboratesPlaybackRepertoire({artist:'Nabarao',title:'Otra edición',year:2020,tracks:['Intro','Outro']},[{...album,tracks:['Intro','Outro']}],['Nabarao'])).toBe(false);
  });
});
