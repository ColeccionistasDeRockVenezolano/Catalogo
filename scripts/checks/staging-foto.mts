// CRV · Foto de staging (SOLO LECTURA).
//
// Saca los recuentos de paridad del cierre (61 actividades, 27 completadas,
// 5 etapas, 3 admins, 5 usuarios aprobados, 8 personas, 0 sesiones), la
// identidad del proyecto (hash de `auth.projects` sin `updated_at`) y el
// favicon (bytes + checksum), y los compara con una foto anterior.
//
// Las restauraciones de staging salen SIEMPRE de esta foto, nunca de producción.
//
//   CRV_ENV_FILE=$HOME/apps/crv-staging/staging.env \
//     ./scripts/with-node22.sh tsx scripts/checks/staging-foto.mts            # compara
//   ... --guardar                                                            # nueva base
//   ... --json                                                               # salida legible por máquina
//
// Código de salida: 0 = igual a la foto; 1 = diferencias (o base no staging).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getPool, closeDb } from "../../src/db/client.js";
import { getEnv } from "../../src/config/env.js";

interface Foto {
  cuando: string;
  base: string;
  recuentos: Record<string, number>;
  paridad: Record<string, boolean>;
  identidad: string;
  proyecto: Record<string, unknown>;
  favicon: { bytes: number | null; checksum: string | null; mime: string | null };
}

const RUTA = path.join(os.homedir(), "crv-staging/fotos/staging-foto.json");
const ESPERADO: Record<string, number> = {
  actividades: 61, completadas: 27, etapas: 5, admins: 3, usuarios: 5, personas: 8, sesiones_prueba: 0,
};

const guardar = process.argv.includes("--guardar");
const json = process.argv.includes("--json");

async function main(): Promise<number> {
  const pool = getPool();
  const { rows: db } = await pool.query<{ datname: string }>("SELECT current_database() AS datname");
  const base = db[0]?.datname ?? "";
  if (!base.includes("staging")) {
    console.error(`ABORTA: esta foto es de staging y la base es «${base}».`);
    return 2;
  }
  const slug = getEnv().CRV_HERRA_PROJECT_SLUG;

  const { rows: recuentos } = await pool.query<Record<string, number>>(`
    SELECT
      (SELECT count(*)::int FROM auth.tasks) AS actividades,
      (SELECT count(*)::int FROM auth.tasks WHERE status = 'completed') AS completadas,
      (SELECT count(*)::int FROM auth.categories) AS etapas,
      (SELECT count(*)::int FROM auth.admins) AS admins,
      (SELECT count(*)::int FROM auth.users WHERE status = 'approved') AS usuarios,
      (SELECT count(*)::int FROM auth.people) AS personas,
      (SELECT count(*)::int FROM auth.sessions) AS sesiones,
      (SELECT count(*)::int FROM auth.sessions
        WHERE lower(coalesce(payload->>'username', '')) LIKE 'fase1-%'
           OR lower(coalesce(payload->>'username', '')) LIKE 'c5-%') AS sesiones_prueba`);

  // Identidad: todas las columnas de auth.projects menos `updated_at` (que
  // cambia con cualquier guardado y no dice nada de la identidad).
  const { rows: identidad } = await pool.query<{ hash: string | null }>(`
    SELECT md5(coalesce(string_agg(fila::text, '|' ORDER BY fila->>'id'), '')) AS hash
      FROM (SELECT (row_to_json(p)::jsonb - 'updated_at') AS fila
              FROM auth.projects p
             WHERE lower(p.slug::text) = lower($1)) t`, [slug]);

  const { rows: proyecto } = await pool.query<Record<string, unknown>>(`
    SELECT id, slug, name, visibility_mode, default_lang, accepts_applications,
           show_login, visitor_counter,
           length(branding_json) AS branding_len, length(theme_json) AS theme_len,
           length(i18n_json) AS i18n_len, length(collaborate_json) AS collaborate_len
      FROM auth.projects WHERE lower(slug::text) = lower($1)`, [slug]);

  const { rows: assets } = await pool.query<{ byte_size: number; checksum: string; mime_type: string }>(`
    SELECT a.byte_size, a.checksum, a.mime_type
      FROM auth.project_assets a JOIN auth.projects p ON p.id = a.project_id
     WHERE lower(p.slug::text) = lower($1) AND a.kind = 'favicon'
     ORDER BY a.id DESC LIMIT 1`, [slug]);
  const favicon = assets[0]
    ? { bytes: assets[0].byte_size, checksum: assets[0].checksum.slice(0, 8), mime: assets[0].mime_type }
    : { bytes: null, checksum: null, mime: null };

  const paridad = Object.fromEntries(
    Object.entries(ESPERADO).map(([clave, valor]) => [clave, (recuentos[0]?.[clave] ?? -1) === valor]),
  );
  const foto: Foto = {
    cuando: new Date().toISOString(),
    base,
    recuentos: recuentos[0] ?? {},
    paridad,
    identidad: identidad[0]?.hash ?? "",
    proyecto: proyecto[0] ?? {},
    favicon,
  };

  let previa: Foto | null = null;
  try {
    previa = JSON.parse(await readFile(RUTA, "utf8")) as Foto;
  } catch {
    // Primera ejecución: no hay foto previa.
  }

  if (guardar) {
    await mkdir(path.dirname(RUTA), { recursive: true });
    await writeFile(RUTA, `${JSON.stringify(foto, null, 2)}\n`);
    console.log(json ? JSON.stringify(foto, null, 2) : `Foto guardada en ${RUTA}`);
    if (!Object.values(paridad).every(Boolean)) {
      console.error(`AVISO: la foto guardada no cumple la paridad: ${JSON.stringify(foto.recuentos)}`);
      return 1;
    }
    return 0;
  }

  const diferencias: string[] = [];
  if (!previa) {
    diferencias.push(`no hay foto previa en ${RUTA}; corre con --guardar la primera vez`);
  } else {
    if (previa.identidad !== foto.identidad) diferencias.push("identidad de auth.projects distinta");
    if (JSON.stringify(previa.favicon) !== JSON.stringify(foto.favicon)) {
      diferencias.push(`favicon: ${JSON.stringify(previa.favicon)} → ${JSON.stringify(foto.favicon)}`);
    }
    for (const clave of Object.keys(ESPERADO)) {
      if (previa.recuentos[clave] !== foto.recuentos[clave]) {
        diferencias.push(`${clave}: ${previa.recuentos[clave]} → ${foto.recuentos[clave]}`);
      }
    }
  }
  const fueraDeParidad = Object.entries(paridad).filter(([, ok]) => !ok).map(([clave]) => clave);
  if (fueraDeParidad.length) diferencias.push(`fuera de paridad: ${fueraDeParidad.join(", ")}`);

  if (json) console.log(JSON.stringify({ foto, previa, diferencias }, null, 2));
  else {
    console.log(`base ${foto.base} · ${foto.cuando}`);
    console.log(`recuentos ${JSON.stringify(foto.recuentos)}`);
    console.log(`identidad ${foto.identidad.slice(0, 12)}… · favicon ${foto.favicon.bytes} B ${foto.favicon.checksum}…`);
    console.log(diferencias.length ? `DIFERENCIAS:\n- ${diferencias.join("\n- ")}` : "igual a la foto previa y en paridad");
  }
  return diferencias.length ? 1 : 0;
}

main()
  .then(async (codigo) => {
    await closeDb();
    process.exitCode = codigo;
  })
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exitCode = 1;
  });
