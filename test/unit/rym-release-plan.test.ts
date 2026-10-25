import { describe, expect, it } from 'vitest';
import { rymPublicationType, rymReleaseClassifications, rymReleaseDateText, rymTrackPositions } from '../../src/verification/rym-release-plan.js';
describe('RYM documented musical publications', () => {
  it('keeps a physical additional release without guessing an album, EP or single type',()=>{
    expect(rymReleaseClassifications({tipo:'Additional release',titulo:'Demo 1995',formato:'Cassette'})).toMatchObject({albumType:'other',classifications:['Demos']});
    expect(rymReleaseClassifications({tipo:'Additional release',titulo:'Obra sin soporte'})).toMatchObject({reviewReason:'additional_release_audio_edition_not_documented'});
    expect(rymReleaseClassifications({tipo:'Additional release',titulo:'Concierto',formato:'DVD'})).toBeNull();
  });
  it('retains documented mixtape and DJ mix categories without inventing an album/EP/single base',()=>{
    expect(rymPublicationType('Mixtape, Collaboration')).toEqual({albumType:'other',classifications:['Mixtape','Collaboration Album']});
    expect(rymReleaseClassifications({tipo:'DJ Mix',titulo:'Set publicado',formato:'Digital File'})).toMatchObject({reviewReason:'dj_mix_audio_edition_not_documented'});
    expect(rymReleaseClassifications({tipo:'DJ Mix',titulo:'Set publicado',formato:'CD'})).toMatchObject({albumType:'other',classifications:['DJ Mix']});
    expect(rymReleaseClassifications({tipo:'DJ Mix',titulo:'Set publicado',musicalEditionVerified:true})).toMatchObject({albumType:'other',classifications:['DJ Mix']});
    expect(rymReleaseClassifications({tipo:'DJ Mix, Video',titulo:'Sesión en video',musicalEditionVerified:true})).toBeNull();
  });
  it('combines publication and recording characteristics from publication evidence', () => {
    expect(rymReleaseClassifications({tipo:'Single',titulo:'Agustito [Remix]'})?.classifications).toEqual(['Single','Remix']);
    expect(rymReleaseClassifications({tipo:'EP',titulo:'Live 2013 EP'})?.classifications).toEqual(['EP','En vivo']);
    expect(rymReleaseClassifications({tipo:'Compilation',titulo:'Evil Demos 1986/87'})?.classifications).toEqual(['Compilation Album','Demos']);
    const live=rymReleaseClassifications({tipo:'Album',titulo:'Ruido blanco',publication_attributes:[{classification:'En vivo',basis:'ranked_release_type',evidence:'#1,585 for live'}]});
    expect(live?.albumType).toBe('live_album');
    expect(live?.classifications).toEqual(['En vivo','Live Album']);
  });
  it('keeps dates separate from label and catalog prose', () => {
    expect(rymReleaseDateText('18 October 1994 on Hannibal (catalog no')).toBe('18 de octubre de 1994');
    expect(rymReleaseDateText('in 1979 on Top Hits (catalog no')).toBe('1979');
    expect(rymReleaseDateText('in October 1985 on WEA (catalog no')).toBe('octubre de 1985');
    expect(rymReleaseDateText('unknown date')).toBeNull();
  });
  it('preserves combined publication types without inferring a base from a feature', () => {
    expect(rymPublicationType(null)).toBeNull();
    expect(rymPublicationType('Single, Collaboration')).toEqual({ albumType: 'single', classifications: ['Single', 'Collaboration Album'] });
    expect(rymPublicationType('Instrumental')).toBeNull();
    expect(rymPublicationType('Album, Video')).toBeNull();
    expect(rymPublicationType('Bootleg / Unauthorized')).toBeNull();
    expect(rymPublicationType('Single, Instrumental, Remix')).toEqual({albumType:'single',classifications:['Single','Instrumental','Remix']});
    expect(rymReleaseClassifications({tipo:'Demo, Live',titulo:'Test'})).toMatchObject({albumType:'demo',classifications:['Demos','En vivo']});
  });
  it('keeps CD and side provenance and rejects ambiguous numbering', () => {
    const track = (n: string) => ({ n, titulo: 'Song', seg: 0 });
    expect(rymTrackPositions([track('1.1'), track('2.1')])?.map(t => [t.disc_number,t.track_number])).toEqual([[1,1],[2,1]]);
    expect(rymTrackPositions([track('A1'),track('B1'),track('C1')])?.map(t => [t.disc_number,t.track_number])).toEqual([[1,1],[1,2],[2,1]]);
    expect(rymTrackPositions([track('1'),track('1')])).toBeNull();
    expect(rymTrackPositions([track('')])).toBeNull();
    expect(rymTrackPositions([track('1'),track('A1')])).toBeNull();
  });
  it('uses the same Unicode normalization as the stored catalog on repeat runs', () => {
    expect(rymTrackPositions([{n:'1',titulo:'Oton\u0303al',seg:0}])?.[0]?.title).toBe('Otoñal');
  });
});
