import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Play } from "@phosphor-icons/react";
import type { YoutubePlayback } from "../lib/youtube";
import { useVideoPlayer, VideoSlot } from "./VideoPlayer";

export interface AlbumYoutubePlayerHandle {
  /** Con `video`, cambia al de ese disco (Lado B, CD 2) y suena desde `seconds`. */
  playFrom: (seconds: number, video?: { videoId: string; title: string }) => void;
}
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
      // Un video que ya suena sigue flotando hasta que se elija otro. Si ya es de este disco
      // (una pista pulsada desde otra plataforma), no se toca: lleva su segundo de inicio.
      if (session?.owner === owner) return;
      if (!session || session.video.videoId === videoId) play({ videoId, title, album: { id: albumId, title } }, owner, undefined, false);
    }, [session, play, videoId, title, albumId, owner]);
    useEffect(() => { onPlaybackChange(selected ? playback : null); }, [selected, playback, onPlaybackChange]);
    useEffect(() => () => onPlaybackChange(null), [onPlaybackChange]);
    useImperativeHandle(ref, () => ({
      playFrom(seconds, other) {
        if (!Number.isFinite(seconds) || seconds < 0) return;
        const target = other ?? { videoId, title };
        play({ videoId: target.videoId, title: target.title, album: { id: albumId, title: target.title } }, owner, seconds);
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
