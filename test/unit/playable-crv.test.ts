import { describe, expect, it, vi } from 'vitest';
import { isPlayableCrvVideo, playableCrvVideoIds } from '../../src/youtube/playable-crv.js';
import { CRV_CHANNEL_ID } from '../../src/youtube/home-channel.js';
import { YouTubeDataApi, type YouTubeVideoPayload } from '../../src/youtube/api.js';

const valid = (): YouTubeVideoPayload => ({ id: 'abcdefghijk', snippet: { channelId: CRV_CHANNEL_ID },
  status: { privacyStatus: 'public', uploadStatus: 'processed', embeddable: true }, contentDetails: {} });

describe('disponibilidad confirmada de YouTube CRV', () => {
  it('acepta publicaciones públicas y no listadas reproducibles', () => {
    expect(isPlayableCrvVideo(valid())).toBe(true);
    expect(isPlayableCrvVideo({ ...valid(), status: { ...valid().status, privacyStatus: 'unlisted' } })).toBe(true);
  });
  it.each([
    { status: {} },
    { status: { ...valid().status, privacyStatus: 'private' } },
    { status: { ...valid().status, embeddable: false } },
    { status: { ...valid().status, uploadStatus: 'deleted' } },
    { status: { ...valid().status, uploadStatus: 'failed' } },
    { status: { ...valid().status, rejectionReason: 'copyright' } },
    { contentDetails: { regionRestriction: { blocked: ['VE'] } } },
    { contentDetails: { regionRestriction: { allowed: ['US'] } } },
    { contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } } },
    { snippet: { channelId: 'otro-canal' } },
    { snippet: { channelId: CRV_CHANNEL_ID, liveBroadcastContent: 'upcoming' } },
  ])('omite videos inaccesibles o sin confirmación: %j', patch => {
    expect(isPlayableCrvVideo({ ...valid(), ...patch })).toBe(false);
  });
  it('no recupera un resultado anterior si la API falla o ya no devuelve el video', async () => {
    const api = new YouTubeDataApi('test');
    const request = vi.spyOn(api, 'listVideos').mockResolvedValueOnce({ items: [valid()] })
      .mockResolvedValueOnce({ items: [] }).mockRejectedValueOnce(new Error('API no disponible'));
    expect(await playableCrvVideoIds(['abcdefghijk'], api)).toEqual(new Set(['abcdefghijk']));
    expect(await playableCrvVideoIds(['abcdefghijk'], api)).toEqual(new Set());
    expect(await playableCrvVideoIds(['abcdefghijk'], api)).toEqual(new Set());
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('no consulta la API para un catálogo vacío y limita los lotes a 50 IDs', async () => {
    const api = new YouTubeDataApi('test');
    const request = vi.spyOn(api, 'listVideos').mockResolvedValue({ items: [] });
    expect(await playableCrvVideoIds([], api)).toEqual(new Set());
    expect(request).not.toHaveBeenCalled();
    await playableCrvVideoIds(Array.from({ length: 51 }, (_, i) => String(i).padStart(11, 'v')), api);
    expect(request.mock.calls.map(([ids]) => ids.length)).toEqual([50, 1]);
  });
});
