import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Play } from "@phosphor-icons/react";
import type { YoutubePlayback } from "../lib/youtube";
import { useVideoPlayer, VideoSlot } from "./VideoPlayer";

export interface AlbumYoutubePlayerHandle { playFrom: (seconds: number) => void; }
interface AlbumYoutubePlayerProps {
  videoId: string;
  title: string;
  albumId: number;
  onPlaybackChange: (playback: YoutubePlayback | null) => void;
}

export const AlbumYoutubePlayer = forwardRef<AlbumYoutubePlayerHandle, AlbumYoutubePlayerProps>(
  function AlbumYoutubePlayer({ videoId, title, albumId, onPlaybackChange }, ref) {
    const { session, play, playback } = useVideoPlayer();
    const owner = `album-${albumId}`;
    const initialized = useRef(false);
    const container = useRef<HTMLDivElement>(null);
    const video = { videoId, title, album: { id: albumId, title } };
    const selected = session?.video.videoId === videoId;
    useEffect(() => {
      if (initialized.current) return;
      initialized.current = true;
      // Un video que ya suena sigue flotando hasta que se elija otro.
      if (!session || session.video.videoId === videoId) play({ videoId, title, album: { id: albumId, title } }, owner, undefined, false);
    }, [session, play, videoId, title, albumId, owner]);
    useEffect(() => { onPlaybackChange(selected ? playback : null); }, [selected, playback, onPlaybackChange]);
    useEffect(() => () => onPlaybackChange(null), [onPlaybackChange]);
    useImperativeHandle(ref, () => ({
      playFrom(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return;
        play({ videoId, title, album: { id: albumId, title } }, owner, seconds);
        onPlaybackChange({ seconds, state: 3 });
        container.current?.scrollIntoView({ block: "center", behavior: "instant" });
      },
    }), [play, videoId, title, albumId, owner, onPlaybackChange]);
    return <div ref={container}>
      {!selected ? <button type="button" className="album-video-start" onClick={() => play(video, owner)}>
        <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" loading="lazy" />
        <span><Play size={28} weight="fill" /> Reproducir {title}</span>
      </button> : null}
      <VideoSlot owner={owner} />
    </div>;
  },
);
