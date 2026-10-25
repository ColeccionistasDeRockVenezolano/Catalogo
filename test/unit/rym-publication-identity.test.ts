import {describe,expect,it} from 'vitest';
import {rymPublicationConflict,rymVideoOnlyMedium,rymCatalogKey,rymFormatKey} from '../../src/verification/rym-publication-identity.js';
describe('identidad de publicación RYM',()=>{
  it('compares identifiers and synonymous media without creating another edition',()=>{
    expect(rymCatalogKey('L.P.M. - 1537')).toBe(rymCatalogKey('LPM1537'));
    expect(rymCatalogKey('no number')).toBe('');expect(rymCatalogKey('N/A')).toBe('');
    expect(rymFormatKey('Vinyl LP')).toBe(rymFormatKey('LP'));
    expect(rymFormatKey('Compact Disc')).toBe(rymFormatKey('CD'));
    expect(rymFormatKey('CD')).not.toBe(rymFormatKey('DVD'));
  });
  it('requires an audio edition for DJ mixes and keeps special publications separate from singles',()=>{
    expect(rymPublicationConflict('DJ Mix','other')).toBe(true);
    expect(rymPublicationConflict('DJ Mix','other',[],true)).toBe(false);
    expect(rymPublicationConflict('Mixtape','single')).toBe(true);
    expect(rymPublicationConflict('Mixtape','other')).toBe(false);
  });
  it('retiene álbum frente a sencillo y EP frente a sencillo salvo categorías combinadas acreditadas',()=>{
    expect(rymPublicationConflict('Album','single')).toBe(true);
    expect(rymPublicationConflict('Single, Collaboration','ep')).toBe(true);
    expect(rymPublicationConflict('EP','single',['EP'])).toBe(false);
  });
  it('no deduce el tipo de publicación desde remix o banda sonora',()=>{
    expect(rymPublicationConflict('EP','remix')).toBe(false);
    expect(rymPublicationConflict('Single','soundtrack')).toBe(false);
    expect(rymPublicationConflict('Album','live_album')).toBe(false);
  });
  it('excluye compuestos audiovisuales y distingue DVD de una edición de audio documentada',()=>{
    expect(rymPublicationConflict('Album, Video','studio_album')).toBe(true);
    expect(rymVideoOnlyMedium('DVD')).toBe(true);
    expect(rymVideoOnlyMedium('DVD-Audio')).toBe(false);
    expect(rymVideoOnlyMedium('CD + DVD')).toBe(false);
  });
});
