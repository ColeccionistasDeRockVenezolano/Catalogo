// CRV · Un video nuevo del canal dispara su alta (Brian, 2026-10-31).
//
// La portada consulta el canal cada 5 minutos (home-channel). Cuando esa
// consulta trae un video que el catálogo todavía no tiene, se lanza en el acto
// la cadena que antes esperaba a los timers horarios:
//
//   vigilante (enlace/renombre/alta) → alta con IA → exportación de la radio
//
// El trabajo NO corre dentro de la API: se lanza una unidad transitoria de
// systemd (`systemd-run --user`) con ops/youtube-canal/nuevo.sh, así que un
// fallo o una IA lenta no tocan el sitio público. La unidad tiene nombre fijo:
// si ya está corriendo, systemd rechaza la segunda y el video entra en la
// siguiente pasada. Los timers horarios siguen como respaldo.
import { execFile } from "node:child_process";
import path from "node:path";
import { getEnv } from "../config/env.js";
import { getPool } from "../db/client.js";
import { moduleLogger } from "../logger/index.js";

const log = moduleLogger("youtube:new-video");

export const NEW_VIDEO_UNIT = "crv-youtube-nuevo";
/** Entre dos lanzamientos: los videos que lleguen en medio esperan a la siguiente consulta. */
const MIN_INTERVAL_MS = 10 * 60 * 1000;

/** Videos ya lanzados en esta vida de la API: un video que el vigilante descarta no se relanza cada 5 minutos. */
const launched = new Set<string>();
let lastLaunch = 0;

export type Launcher = (videoIds: string[]) => Promise<void>;

export async function unknownVideoIds(videoIds: string[]): Promise<string[]> {
  if (!videoIds.length) return [];
  const known = await getPool().query<{ video_id: string }>(
    "SELECT video_id FROM media.youtube_videos WHERE video_id = ANY($1::text[]) AND title IS NOT NULL", [videoIds]);
  const knownIds = new Set(known.rows.map((row) => row.video_id));
  return videoIds.filter((id) => !knownIds.has(id));
}

const systemdLauncher: Launcher = (videoIds) => new Promise((resolve, reject) => {
  const root = process.cwd();
  execFile("systemd-run", [
    "--user", `--unit=${NEW_VIDEO_UNIT}`, "--collect", "--no-block",
    `--description=CRV video nuevo del canal → catálogo, IA y radio (${videoIds.join(", ")})`,
    `--working-directory=${root}`,
    "/bin/bash", path.join(root, "ops/youtube-canal/nuevo.sh"), ...videoIds,
  ], { timeout: 15_000 }, (error, _stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message)) : resolve());
});

/**
 * Recibe los videos públicos que la portada acaba de leer del canal y lanza la
 * cadena para los que el catálogo no conoce. Devuelve los ids lanzados.
 */
export async function triggerNewChannelVideos(videoIds: string[], options: {
  launcher?: Launcher; enabled?: boolean; now?: number;
} = {}): Promise<string[]> {
  if (!(options.enabled ?? getEnv().CRV_YT_NEW_TRIGGER)) return [];
  const now = options.now ?? Date.now();
  if (now - lastLaunch < MIN_INTERVAL_MS) return [];
  const fresh = (await unknownVideoIds(videoIds)).filter((id) => !launched.has(id));
  if (!fresh.length) return [];
  lastLaunch = now;
  for (const id of fresh) launched.add(id);
  try {
    await (options.launcher ?? systemdLauncher)(fresh);
    log.info({ videoIds: fresh }, "Video nuevo del canal: se lanzó su alta en el catálogo y la radio.");
  } catch (error) {
    // Ya corre una pasada (unidad ocupada) o systemd no responde: se reintenta
    // tras el intervalo y, si no, el timer horario lo recoge.
    for (const id of fresh) launched.delete(id);
    log.warn({ videoIds: fresh, error: error instanceof Error ? error.message : String(error) },
      "No se pudo lanzar el alta del video nuevo; queda para el vigilante horario.");
  }
  return fresh;
}

/** Solo para pruebas. */
export function resetNewVideoTrigger(): void {
  launched.clear();
  lastLaunch = 0;
}
