import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Play } from "@phosphor-icons/react";
import type { YoutubePlayback } from "../lib/youtube";
import { useVideoPlayer, VideoSlot, type CatalogVideoTrack } from "./VideoPlayer";

export interface AlbumYoutubePlayerHandle {
  /** Con `video`, cambia al de ese disco (Lado B, CD 2) y suena desde `seconds`. */
  playFrom: (seconds: number, video?: { videoId: string; title: string }) => void;
}
interface AlbumYoutubePlayerProps {
  videoId: string;
  title: string;
  albumId: number;
  tracks: readonly CatalogVideoTrack[];
  onPlaybackChange: (playback: YoutubePlayback | null) => void;
}

export const AlbumYoutubePlayer = forwardRef<AlbumYoutubePlayerHandle, AlbumYoutubePlayerProps>(
  function AlbumYoutubePlayer({ videoId, title, albumId, tracks, onPlaybackChange }, ref) {
    const { session, play, playback } = useVideoPlayer();
    const owner = `album-${albumId}`;
    const container = useRef<HTMLDivElement>(null);
    const initialized = useRef(false);
    const video = { videoId, title, album: { id: albumId, title } };
    const selected = session?.video.videoId === videoId;
    useEffect(() => {
      if (initialized.current) return;
      initialized.current = true;
      if (!session) play({ videoId, title, album: { id: albumId, title } }, owner, undefined, false, tracks);
    }, [session, play, videoId, title, albumId, owner, tracks]);
    useEffect(() => { onPlaybackChange(selected ? playback : null); }, [selected, playback, onPlaybackChange]);
    useEffect(() => () => onPlaybackChange(null), [onPlaybackChange]);
    useImperativeHandle(ref, () => ({
      playFrom(seconds, other) {
        if (!Number.isFinite(seconds) || seconds < 0) return;
        const target = other ?? { videoId, title };
        play({ videoId: target.videoId, title: target.title, album: { id: albumId, title: target.title } }, owner, seconds, true, tracks);
        onPlaybackChange({ seconds, state: 3 });
      },
    }), [play, videoId, title, albumId, owner, tracks, onPlaybackChange]);
    return <div ref={container}>
      {!selected ? <button type="button" className="album-video-start" onClick={() => play(video, owner, undefined, true, tracks)}>
        <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" loading="lazy" />
        <span><Play size={28} weight="fill" /> Reproducir {title}</span>
      </button> : null}
      <VideoSlot owner={owner} />
    </div>;
  },
);
