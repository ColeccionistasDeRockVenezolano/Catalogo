import { YouTubeDataApi, type YouTubeVideoPayload } from './api.js';
import { CRV_CHANNEL_ID } from './home-channel.js';

/** Unknown, restricted, processing, or non-embeddable videos fail closed. */
export function isPlayableCrvVideo(video: YouTubeVideoPayload): boolean {
  const status = video.status;
  const details = video.contentDetails;
  return video.snippet?.['channelId'] === CRV_CHANNEL_ID
    && video.snippet?.['liveBroadcastContent'] !== 'upcoming'
    && ['public', 'unlisted'].includes(String(status?.['privacyStatus']))
    && status?.['uploadStatus'] === 'processed'
    && status?.['embeddable'] === true
    && !status?.['rejectionReason'] && !status?.['failureReason']
    && !details?.['regionRestriction']
    && (details?.['contentRating'] as Record<string, unknown> | undefined)?.['ytRating'] !== 'ytAgeRestricted';
}

/** No stale positive cache: a failed API check never exposes an old CRV candidate. */
export async function playableCrvVideoIds(ids: readonly string[], api?: YouTubeDataApi): Promise<Set<string>> {
  const unique = [...new Set(ids)].filter(id => /^[\w-]{11}$/.test(id));
  const allowed = new Set<string>();
  if (!unique.length) return allowed;
  const signal = AbortSignal.timeout(6000);
  const client = api ?? new YouTubeDataApi(undefined, (input, init) => fetch(input, { ...init, signal }));
  try {
    for (let start = 0; start < unique.length; start += 50) {
      const batch = unique.slice(start, start + 50);
      for (const video of (await client.listVideos(batch)).items ?? []) {
        if (batch.includes(video.id) && isPlayableCrvVideo(video)) allowed.add(video.id);
      }
    }
    return allowed;
  } catch { return new Set(); }
}
