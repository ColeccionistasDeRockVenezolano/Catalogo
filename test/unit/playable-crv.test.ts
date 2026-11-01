import { describe, expect, it } from 'vitest';
import { isPlayableCrvVideo, isPlayableYoutubeVideo, playableCrvVideoIds, playableVideoIds, playableVideoSql, shownCrvVideoIds, shownVideoIds, shownVideoSql, unplayableReason } from '../../src/youtube/playable-crv.js';
import { CRV_CHANNEL_ID } from '../../src/youtube/home-channel.js';
import type { YouTubeVideoPayload } from '../../src/youtube/api.js';

const valid = (): YouTubeVideoPayload => ({ id: 'abcdefghijk', snippet: { channelId: CRV_CHANNEL_ID },
  status: { privacyStatus: 'public', uploadStatus: 'processed', embeddable: true }, contentDetails: {} });

describe('reproducibilidad según el registro de la base', () => {
  it('acepta lo público, procesado e incrustable', () => {
    expect(isPlayableCrvVideo(valid())).toBe(true);
    expect(isPlayableYoutubeVideo({ ...valid(), snippet: { channelId: 'otro-canal' } })).toBe(true);
  });
  it('muestra un veto regional parcial; solo esconde si no se permite en ningún país', () => {
    expect(isPlayableCrvVideo({ ...valid(), contentDetails: { regionRestriction: { blocked: ['DE'] } } })).toBe(true);
    expect(isPlayableCrvVideo({ ...valid(), contentDetails: { regionRestriction: { allowed: ['US'] } } })).toBe(true);
    expect(unplayableReason({ ...valid(), contentDetails: { regionRestriction: { allowed: [] } } })).toBe('bloqueado_en_todo_pais');
  });
  it.each([
    [{ status: {} }, 'borrado_o_privado'],
    [{ status: { ...valid().status, privacyStatus: 'private' } }, 'borrado_o_privado'],
    [{ status: { ...valid().status, privacyStatus: 'unlisted' } }, 'no_listado'],
    [{ status: { ...valid().status, embeddable: false } }, 'no_incrustable'],
    [{ status: { ...valid().status, uploadStatus: 'deleted' } }, 'no_procesado'],
    [{ status: { ...valid().status, rejectionReason: 'copyright' } }, 'rechazado'],
    [{ contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } } }, 'restriccion_edad'],
    [{ snippet: { channelId: CRV_CHANNEL_ID, liveBroadcastContent: 'upcoming' } }, 'estreno'],
  ] as const)('esconde %j', (patch, reason) => {
    expect(unplayableReason({ ...valid(), ...patch } as YouTubeVideoPayload)).toBe(reason);
    expect(isPlayableCrvVideo({ ...valid(), ...patch } as YouTubeVideoPayload)).toBe(false);
  });
  it('el estado guardado en la base manda antes que la respuesta', () => {
    expect(unplayableReason(valid(), 'unpublished')).toBe('borrado_o_privado');
    expect(unplayableReason(valid(), 'copyright_blocked')).toBe('copyright');
    expect(unplayableReason(valid(), 'unlisted')).toBe('no_listado');
    expect(unplayableReason(valid(), 'unknown')).toBe('estado_desconocido');
    expect(unplayableReason(null)).toBe('sin_registro');
  });
  it('un canal ajeno no es video de CRV', () => {
    expect(isPlayableCrvVideo({ ...valid(), snippet: { channelId: 'otro-canal' } })).toBe(false);
  });
  it('la regla SQL cubre los mismos campos', () => {
    const sql = playableVideoSql('v');
    for (const field of ["publication_status = 'published'", 'privacyStatus', 'uploadStatus', 'embeddable', 'rejectionReason',
      'failureReason', 'liveBroadcastContent', 'ytAgeRestricted', 'regionRestriction,allowed']) expect(sql).toContain(field);
  });
  it('allowUnlisted acepta el no listado y mantiene el resto de la regla', () => {
    const sql = playableVideoSql('v', { allowUnlisted: true });
    expect(sql).toContain("IN ('public','unlisted')");
    expect(sql).toContain('embeddable');
    expect(playableVideoSql('v')).not.toContain('unlisted');
  });
  it('las páginas muestran todo lo registrado, sin filtrar por estado', () => {
    expect(shownVideoSql('v')).toBe('(v.video_id IS NOT NULL)');
  });
  it('no consulta la base sin IDs válidos', async () => {
    expect(await shownVideoIds([])).toEqual(new Set());
    expect(await shownCrvVideoIds(['corto'])).toEqual(new Set());
    expect(await playableVideoIds([])).toEqual(new Set());
    expect(await playableCrvVideoIds(['corto', 'demasiado-largo'])).toEqual(new Set());
  });
});
