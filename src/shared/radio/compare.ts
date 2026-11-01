// CRV · Comparación de instantáneas de radio (Fase 3).
//
// La usan la sombra (script) y el panel de estado. Ignora `serverTime` y
// `listeners`, que no describen la emisión; compara pieza, tramo, cola y
// catálogo. `offsetSeconds` admite un segundo de diferencia por redondeo.
import type { RadioSnapshot } from "./engine.js";

export interface SnapshotDivergence { field: string; live: unknown; local: unknown }

export function compareRadioSnapshots(live: RadioSnapshot, local: RadioSnapshot): SnapshotDivergence[] {
  const diffs: SnapshotDivergence[] = [];
  const check = (field: string, left: unknown, right: unknown): void => {
    if (left !== right) diffs.push({ field, live: left, local: right });
  };
  check("catalogVersion", live.catalogVersion, local.catalogVersion);
  check("queueId", live.queueId, local.queueId);
  check("phase", live.phase, local.phase);
  check("cycle", live.cycle, local.cycle);
  check("position", live.position, local.position);
  check("total", live.total, local.total);
  check("startsAt", live.startsAt, local.startsAt);
  check("endsAt", live.endsAt, local.endsAt);
  check("sweeperSlot", live.sweeperSlot, local.sweeperSlot);
  check("sweeperNext", live.sweeperNext, local.sweeperNext);
  check("current.videoId", live.current.videoId, local.current.videoId);
  check("current.startSeconds", live.current.startSeconds, local.current.startSeconds);
  check("current.durationSeconds", live.current.durationSeconds, local.current.durationSeconds);
  check("next.videoId", live.next.videoId, local.next.videoId);
  check("next.startSeconds", live.next.startSeconds, local.next.startSeconds);
  check("upcoming", live.upcoming.map((item) => item.videoId).join(","), local.upcoming.map((item) => item.videoId).join(","));
  if (Math.abs(live.offsetSeconds - local.offsetSeconds) > 1) {
    diffs.push({ field: "offsetSeconds", live: live.offsetSeconds, local: local.offsetSeconds });
  }
  return diffs;
}
