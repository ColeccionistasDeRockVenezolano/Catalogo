import {describe,it,expect} from 'vitest';
import {matchReviewedRymRelease,disputedRymField,compatibleRymDate,reviewedRymOwnerMatches,type ReviewedReleaseCandidate} from '../../src/verification/rym-reviewed-application.js';
const source={titulo:'Obra',anio:2000,catalog_no:null,formato:null,tipo:'Album',pistas:[{titulo:'Uno'},{titulo:'Dos'}]};
const album:ReviewedReleaseCandidate={id:7,title:'Obra',aliases:[],release_year:2000,catalog_id:null,media_format:null,album_type:'studio_album',classifications:['Studio Album'],titles:['Uno','Dos']};
describe('reviewed RYM application',()=>{
 it('does not enrich an edition with a conflicting year',()=>expect(matchReviewedRymRelease({...source,anio:2010},[album])).toMatchObject({status:'hold',reason:'edition_year_differs'}));
 it('retains ambiguous duplicate publications without choosing one',()=>expect(matchReviewedRymRelease(source,[album,{...album,id:8}])).toMatchObject({status:'hold',ids:[7,8]}));
 it('does not create a second album for the same repertoire with another title',()=>expect(matchReviewedRymRelease({...source,titulo:'Otro título'},[album])).toMatchObject({status:'hold',reason:'same_complete_repertoire'}));
 it('does not use a catalog number as permission to create a duplicate',()=>expect(matchReviewedRymRelease({...source,titulo:'Otra',catalog_no:'AB-123'},[{...album,catalog_id:'AB123'}])).toMatchObject({status:'hold',reason:'existing_catalog_number_different_title'}));
 it('accepts an existing title alias only for compatible editions',()=>expect(matchReviewedRymRelease({...source,titulo:'Alternativo'},[{...album,aliases:['Alternativo']}])).toMatchObject({status:'match',album:{id:7}}));
 it('keeps an album separate from a single with the same title',()=>expect(matchReviewedRymRelease(source,[album,{...album,id:8,album_type:'single',classifications:['Single']}])).toMatchObject({status:'match',album:{id:7}}));
 it('recognizes an explicit birthplace discrepancy expressed as nacer',()=>expect(disputedRymField('birth_city',['Cusica la llama caraqueña, mientras RYM la hace nacer en Maracaibo'])).toBe(true));
 it('does not turn a documented absence into a birth contradiction',()=>expect(disputedRymField('birth_date',['Es una carencia de nacimiento, no una contradicción de identidad'])).toBe(false));
 it('withholds disputed birth facts while preserving unrelated fields',()=>{expect(disputedRymField('birth_date',['Discrepancia de nacimiento: 1943 frente a 1944'])).toBe(true);expect(disputedRymField('current_city',['Discrepancia de nacimiento'])).toBe(false);});
 it('preserves date precision and detects conflicting partial dates',()=>{expect(compatibleRymDate('1981','1981-04-03')).toBe(true);expect(compatibleRymDate('1980','1981-04-03')).toBe(false);});
 it('does not transfer another project of the same musician',()=>expect(reviewedRymOwnerMatches('Winds of May',['Dhargorak'])).toBe(false));
 it('accepts a documented primary artist on a collaborative publication',()=>expect(reviewedRymOwnerMatches("Julio D’Escriván / Thomas Bellingham",["Julio D'Escrivan"])).toBe(true));
 it('does not match a short name inside an unrelated word',()=>expect(reviewedRymOwnerMatches('FGX',['FG'])).toBe(false));
 it('retains a retitled reissue when only one title differs in a long list',()=>{
  const titles=['Uno','Dos','Tres','Cuatro','Cinco','Seis','Siete','Ocho','Nueve','Diez'];
  expect(matchReviewedRymRelease({...source,titulo:'Demo 1986',pistas:[...titles.slice(0,9).map(titulo=>({titulo})),{titulo:'Diez con variante'}]},[{...album,titles}])).toMatchObject({status:'hold',reason:'nearly_complete_existing_repertoire'});
 });
});
