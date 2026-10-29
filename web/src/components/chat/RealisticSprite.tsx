import { useId } from "react";
import atlas from "../../assets/chat/rock-material-atlas.webp";
import compactAtlas from "../../assets/chat/rock-material-atlas-small.webp";
import { detectQuality } from "../../lib/chatEffects";

// UV rectangles in the generated 1254px atlas. Unequal rectangles preserve
// the full guitar neck and the bat's broad wings. One decoded shared image.
const REGIONS: Record<string, [number, number, number, number]> = {
  "vinyl-face": [9, 8, 299, 291], "cassette-face": [327, 68, 287, 214],
  "amp-face": [641, 4, 291, 296], "skull-rocker": [957, 0, 294, 307],
  "flame-face": [34, 303, 249, 329], "guitar": [314, 292, 316, 340],
  "hand-rock": [692, 306, 178, 334], "bat": [878, 357, 375, 238],
  "mic": [68, 626, 156, 307], "drum": [314, 673, 315, 233],
  "heart-horns": [648, 632, 248, 292], "ufo-vinyl": [927, 687, 326, 177],
  "drumsticks": [7, 941, 290, 306], "rockerito": [320, 924, 283, 329],
  "clap": [617, 929, 297, 322], "curtain": [927, 914, 326, 337],
};

export function RealisticSprite({ preset, className = "" }: { preset: string; className?: string }) {
  const id = useId().replace(/:/gu, "");
  const rect = REGIONS[preset];
  if (!rect) return null;
  const [x, y, width, height] = rect;
  const picture = <image href={detectQuality() === "high" ? atlas : compactAtlas} width="1254" height="1254" />;
  const bat = preset === "bat";
  const ufo = preset === "ufo-vinyl";
  return <svg viewBox={`${x} ${y} ${width} ${height * (ufo ? 1.6 : 1)}`} className={`crv-real-art crv-real-${preset} ${className}`} aria-hidden="true">
    {ufo ? <>
      <defs>
        <clipPath id={`${id}-ship`}><rect x={x} y={y} width={width} height={height} /></clipPath>
        <linearGradient id={`${id}-beam`} x2="0" y2="1"><stop stopColor="#78e7ff" stopOpacity=".6" /><stop offset="1" stopColor="#45ade5" stopOpacity="0" /></linearGradient>
      </defs>
      <path className="crv-ufo-beam" fill={`url(#${id}-beam)`} d={`M${x + width * .4} ${y + height * .72} L${x + width * .6} ${y + height * .72} L${x + width * .85} ${y + height * 1.6} L${x + width * .15} ${y + height * 1.6} Z`} />
      <g clipPath={`url(#${id}-ship)`}>{picture}</g>
    </> : bat ? <>
      <defs>
        <clipPath id={`${id}-left`}><rect x={x} y={y} width={width * 0.46} height={height} /></clipPath>
        <clipPath id={`${id}-right`}><rect x={x + width * 0.57} y={y} width={width * 0.43} height={height} /></clipPath>
        <clipPath id={`${id}-body`}><rect x={x + width * 0.46} y={y} width={width * 0.11} height={height} /></clipPath>
      </defs>
      <g className="crv-real-wing crv-real-wing-left" style={{ transformOrigin: `${x + width * 0.49}px ${y + height * 0.6}px` }}><g clipPath={`url(#${id}-left)`}>{picture}</g></g>
      <g className="crv-real-wing crv-real-wing-right" style={{ transformOrigin: `${x + width * 0.54}px ${y + height * 0.6}px` }}><g clipPath={`url(#${id}-right)`}>{picture}</g></g>
      <g clipPath={`url(#${id}-body)`}>{picture}</g>
    </> : <>
      {/* Sin recorte, una caja con otra proporción enseña los objetos vecinos del atlas. */}
      <defs><clipPath id={`${id}-cell`}><rect x={x} y={y} width={width} height={height} /></clipPath></defs>
      <g clipPath={`url(#${id}-cell)`}>{picture}</g>
    </>}
  </svg>;
}
