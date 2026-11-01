// Sincronizacion con la hoja de seguimiento externa del canal (fuera de
// Herra). Esta hoja es un registro manual que ya existia antes que la radio.
// Este modulo:
//   - AGREGA (nunca borra) una fila por video nuevo que puede clasificar con
//     confianza a partir del titulo. La unica llamada que crea filas es
//     values:append, que agrega al final sin tocar las existentes.
//   - En cada corrida, RECALCULA tres columnas derivadas para TODAS las filas
//     (nuevas y viejas): "Upload Order", "Status" y la fecha en que
//     dejo de estar Listed. Nunca toca Artista/Album/Label/Año/Tipo/URL,
//     que son datos cargados a mano.
//   - Mantiene una validacion de lista (Listed/Unlisted/Blocked/Removed) y un
//     formato condicional (un color de fila por cada estado no publico).
// Nada de esto borra filas, columnas ni la hoja misma.
import fs from 'node:fs';
import crypto from 'node:crypto';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Restricciones y nombre del canal pertenecen a la configuracion del proyecto.
export interface TrackingSheetOptions {
  channelName?: string;
  readOnlySheetIds?: readonly string[];
}

// El mismo rojo pastel con el que ya estaban pintadas a mano algunas filas
// "Unlisted" en la hoja (verificado leyendo su userEnteredFormat.backgroundColor).
const UNLISTED_ROW_COLOR = { red: 0.91764706, green: 0.6, blue: 0.6 };
// Naranja pastel (bloqueado por derechos) y gris claro (ya no existe), para
// distinguirlos a simple vista del rojo de Unlisted.
const BLOCKED_ROW_COLOR = { red: 0.98, green: 0.8, blue: 0.6 };
const REMOVED_ROW_COLOR = { red: 0.8, green: 0.8, blue: 0.8 };
// Margen de filas futuras que ya quedan cubiertas por la validacion y el
// formato condicional, para no tener que ampliar el rango cada vez.
const FORMAT_RANGE_ROWS = 5000;

type TrackingField = 'uploadOrder' | 'artist' | 'album' | 'year' | 'type' | 'url' | 'status' | 'unlistedSince';
interface TrackingColumns extends Record<TrackingField, number> {
  width: number;
  counters: Record<TrackingStatus, number> | null;
}

export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('Indice de columna invalido.');
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + (n - 1) % 26) + result;
  }
  return result;
}

function sheetRange(title: string, range: string): string {
  return `'${title.replace(/'/g, "''")}'!${range}`;
}

// Ninguna posicion de la hoja se presupone. Los contadores son encabezados
// historicos dinamicos (p.ej. "Unlisted: 10"); ese encabezado tambien identifica
// la columna de fecha en las hojas que aun no usan "Unlisted Since".
export function resolveTrackingColumns(headers: string[]): TrackingColumns {
  const names = headers.map(normalizeKey);
  const seen = new Set<string>();
  for (const name of names.filter(Boolean)) {
    if (seen.has(name)) throw new Error(`Encabezado duplicado en la hoja: ${name}. No se escribe.`);
    seen.add(name);
  }
  const unique = (label: string, matches: (name: string) => boolean, optional = false): number => {
    const indices = names.flatMap((name, index) => matches(name) ? [index] : []);
    if (optional && indices.length === 0) return -1;
    if (indices.length !== 1) {
      throw new Error(`Se requiere un encabezado unico para ${label}; encontrados ${indices.length}. No se escribe.`);
    }
    return indices[0]!;
  };
  const field = (label: string, aliases = [label]): number => unique(label, name => aliases.map(normalizeKey).includes(name));
  const hasLegacyCounters = names.some(name => TRACKING_STATUSES.some(status => name.startsWith(`${status.toLowerCase()}:`)));
  const counters = hasLegacyCounters ? Object.fromEntries(TRACKING_STATUSES.map(status => [
    status, unique(`contador ${status}`, name => name.startsWith(`${status.toLowerCase()}:`)),
  ])) as Record<TrackingStatus, number> : null;
  const date = unique('Unlisted Since', name => name === 'unlisted since', true);
  if (date < 0 && !counters) throw new Error('Se requiere un encabezado unico para Unlisted Since. No se escribe.');
  return {
    uploadOrder: field('Upload Order', ['Upload Order', 'u3f']),
    artist: field('Artist Name'), album: field('Album Name'), year: field('Album Year'),
    type: field('Type of Album'), url: field('URL'), status: field('Status'),
    unlistedSince: date < 0 ? counters!.Unlisted : date,
    counters, width: headers.length,
  };
}

interface ServiceAccount { client_email: string; private_key: string }

function base64url(input: string | Buffer): string {
  return (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function readServiceAccount(filePath: string): ServiceAccount {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  const clientEmail = raw["client_email"];
  const privateKey = raw["private_key"];
  if (typeof clientEmail !== 'string' || typeof privateKey !== 'string') {
    throw new Error(`${filePath} no parece una clave de cuenta de servicio (faltan client_email/private_key).`);
  }
  return { client_email: clientEmail, private_key: privateKey };
}

// Cuentas de servicio no tienen sesion de usuario: se autentican firmando un
// JWT propio (RS256) y canjeandolo por un access token de corta duracion.
async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = base64url(signer.sign(serviceAccount.private_key));
  const jwt = `${unsigned}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!response.ok) throw new Error(`No se pudo autenticar con Google (HTTP ${response.status}): ${await response.text()}`);
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Google no devolvio un access_token.');
  return data.access_token;
}

async function sheetsGet(spreadsheetId: string, accessToken: string, suffix: string): Promise<unknown> {
  const response = await fetch(`${SHEETS_API}/${spreadsheetId}${suffix}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Sheets API HTTP ${response.status} (${suffix}): ${await response.text()}`);
  return response.json();
}

interface TrackingTable { tableId: string; range: { startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number } }
interface SheetMeta { sheetId: number; title: string; columnCount: number; conditionalFormats: unknown[]; tables: TrackingTable[]; countersTitle?: string }

async function firstSheetMeta(spreadsheetId: string, accessToken: string): Promise<SheetMeta> {
  const fields = encodeURIComponent('sheets(properties,conditionalFormats,tables(tableId,range))');
  const data = await sheetsGet(spreadsheetId, accessToken, `?fields=${fields}`) as {
    sheets?: Array<{ properties?: { title?: string; sheetId?: number; gridProperties?: { columnCount?: number } }; conditionalFormats?: unknown[]; tables?: TrackingTable[] }>;
  };
  const sheet = data.sheets?.[0];
  const title = sheet?.properties?.title;
  const sheetId = sheet?.properties?.sheetId;
  if (!title || sheetId === undefined) throw new Error('No se pudo leer la primera hoja del documento.');
  const columnCount = sheet?.properties?.gridProperties?.columnCount;
  if (!columnCount) throw new Error('No se pudo leer el ancho de la hoja.');
  const countersTitle = data.sheets?.find(s => s.properties?.title === 'Contadores')?.properties?.title;
  return {
    sheetId, title, columnCount,
    conditionalFormats: sheet?.conditionalFormats ?? [],
    tables: sheet?.tables ?? [],
    ...(countersTitle ? { countersTitle } : {}),
  };
}

async function readTrackingColumns(spreadsheetId: string, accessToken: string, meta: SheetMeta): Promise<TrackingColumns> {
  const range = encodeURIComponent(sheetRange(meta.title, `A1:${columnLetter(meta.columnCount - 1)}1`));
  const data = await sheetsGet(spreadsheetId, accessToken, `/values/${range}`) as { values?: string[][] };
  return resolveTrackingColumns(data.values?.[0] ?? []);
}

async function readExistingRows(spreadsheetId: string, accessToken: string, sheetTitle: string, columns: TrackingColumns): Promise<Array<Array<string | number>>> {
  const range = encodeURIComponent(sheetRange(sheetTitle, `A2:${columnLetter(columns.width - 1)}`));
  const data = await sheetsGet(spreadsheetId, accessToken, `/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`) as { values?: Array<Array<string | number>> };
  return data.values ?? [];
}

// Unica operacion que crea filas: agrega al final de la tabla. No hay en este
// modulo ninguna funcion que borre filas, columnas o la hoja. Se agregan solo
// los campos identificados por encabezado; Label y Status se dejan vacios. La fecha, si
// aplica, la pone el barrido de mas abajo junto con la de todas las demas filas.
async function appendRows(
  spreadsheetId: string, accessToken: string, sheetTitle: string, rows: Array<Array<string | number>>, columns: TrackingColumns,
): Promise<void> {
  if (rows.length === 0) return;
  const range = encodeURIComponent(sheetRange(sheetTitle, `A:${columnLetter(columns.width - 1)}`));
  const response = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    },
  );
  if (!response.ok) throw new Error(`Sheets API append HTTP ${response.status}: ${await response.text()}`);
}

// Recalcula, en una sola llamada, columnas derivadas de filas YA existentes
// (Upload Order y Status) y sus contadores por encabezado. No crea ni borra filas.
async function valuesBatchUpdate(
  spreadsheetId: string, accessToken: string, data: Array<{ range: string; values: Array<Array<string | number>> }>,
  valueInputOption: 'RAW' | 'USER_ENTERED' = 'USER_ENTERED',
): Promise<void> {
  if (data.length === 0) return;
  const response = await fetch(`${SHEETS_API}/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption, data }),
  });
  if (!response.ok) throw new Error(`Sheets API values:batchUpdate HTTP ${response.status}: ${await response.text()}`);
}

// Solo para validacion de lista y formato condicional (no toca valores de celdas).
async function spreadsheetBatchUpdate(spreadsheetId: string, accessToken: string, requests: unknown[]): Promise<void> {
  if (requests.length === 0) return;
  const response = await fetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!response.ok) throw new Error(`Sheets API batchUpdate HTTP ${response.status}: ${await response.text()}`);
}

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/);
  return m ? m[1]! : null;
}

// Para comparar "¿ya esta esto en la hoja?" mas alla del URL: acentos,
// mayusculas y espacios no deberian crear una fila duplicada.
function normalizeKey(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizedTypeParts(value: unknown): string[] {
  return (typeof value === 'string' ? value : '')
    .split(',')
    .map(part => normalizeKey(part))
    .filter(Boolean);
}

// Decision editorial: Shorts e Interview se registran en la hoja, pero no
// pertenecen a la secuencia historica de Upload Order. Other(s) se reconoce
// solo para limpiar datos heredados; el clasificador ya no lo emite.
export function uploadTypeIsUnnumbered(value: unknown): boolean {
  return normalizedTypeParts(value).some(part => ['short', 'shorts', 'interview', 'other', 'others'].includes(part));
}

// Google values.get representa una celda vacia como "". Number("") es 0 en
// JavaScript, que fue la causa del corrimiento: esas filas se ordenaban antes
// del Upload Order 1. Solo aceptamos enteros positivos escritos de verdad.
function parseUploadOrder(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function assertWritableTrackingSheet(spreadsheetId: string, readOnlySheetIds: readonly string[]): void {
  if (readOnlySheetIds.includes(spreadsheetId)) {
    throw new Error(`La hoja ${spreadsheetId} es el respaldo manual canonico y es de solo lectura.`);
  }
}

interface SheetRowDraft { artist: string; album: string; year: number | null; type: string }

// Solo clasifica lo que el titulo alcanza a explicar sin adivinar: "Full
// Album" (con o sin [EP]/[Single]/B-Sides), "Full Documentary" y videoclips
// "(Official ... Video)". Conciertos y unplugged quedan afuera a proposito: el
// canal los titula de forma menos uniforme y adivinar mal es peor que tratarlos
// como Shorts hasta una correccion manual.
function parseAlbumYear(raw: string): { album: string; year: number | null } {
  const trimmed = raw.trim();
  const withTag = trimmed.match(/^(.*?)\s*\[[^\]]*\]\s*\((\d{4}(?:-\d{4})?)\)\s*$/);
  const withoutTag = trimmed.match(/^(.*?)\s*\((\d{4}(?:-\d{4})?)\)\s*$/);
  const m = withTag ?? withoutTag;
  if (!m) return { album: trimmed, year: null };
  const [, albumPart, yearPart] = m;
  if (/^\d{4}$/.test(yearPart!)) return { album: albumPart!.trim(), year: Number(yearPart) };
  return { album: trimmed, year: null };
}

function classifyFullAlbumType(rest: string, album: string): string {
  const tag = rest.match(/\[([^\]]+)\]/)?.[1]?.trim().toLowerCase();
  if (tag === 'ep') return 'EP';
  if (tag === 'single') return 'Single';
  if (/^b-sides?\b/i.test(album)) return 'B-Sides';
  return '';
}

// Entrevistas, documentales y Shorts no son discos, pero conviene registrarlos
// igual para no tener que darles Status a mano en cada corrida. A diferencia
// de "Full Album" y "Official Video", el titulo de una reseña/Short es
// prosa libre: solo se distingue Artista/Album cuando la frase lo deja claro
// sin adivinar (comillas, "disco debut X", "algo, disponible..."). El resto
// se agrega como Shorts, pero sin artista ni album inventados. Other/Others no
// es una categoria valida de salida.
function classifyReview(trimmed: string, channelName: string): SheetRowDraft | null {
  if (/entrevista/i.test(trimmed)) return { artist: channelName, album: '', year: null, type: 'Interview' };

  const debut = trimmed.match(/^(.+?)\s+con su disco debut\s+(.+?)\s+por\s+@/i);
  if (debut) return { artist: debut[1]!.trim(), album: debut[2]!.trim(), year: null, type: 'Shorts' };

  const debutSinNombre = trimmed.match(/^(.+?)\s+y su álbum debut\s+por\s+@/i);
  if (debutSinNombre) return { artist: debutSinNombre[1]!.trim(), album: '', year: null, type: 'Shorts' };

  const albumEntreComillas = trimmed.match(/:.*álbum\s+"([^"]+)"\s+por\s+@/i);
  if (albumEntreComillas) {
    const artist = trimmed.slice(0, trimmed.indexOf(':')).trim();
    return { artist, album: albumEntreComillas[1]!.trim(), year: null, type: 'Shorts' };
  }

  const compiladoEntreComillas = trimmed.match(/reseñ\w*\s+sobre\s+"([^"]+)"/i);
  if (compiladoEntreComillas) return { artist: 'Various Artists', album: compiladoEntreComillas[1]!.trim(), year: null, type: 'Shorts' };

  const disponible = trimmed.match(/^(.+?),\s+disponible.*reseñ\w*\s+por\s+@/i);
  if (disponible) return { artist: disponible[1]!.trim(), album: '', year: null, type: 'Shorts' };

  return null;
}

// Nunca devuelve null: lo que no calza con ningun patron conocido se agrega
// igual con tipo "Shorts", sin inventar artista ni album (el titulo completo
// queda en Album Name como referencia para revisarlo a mano si hace falta).
// Asi ningun video nuevo se queda fuera de la hoja por falta de clasificacion.
export function classifyForTrackingSheet(title: string, channelName = ''): SheetRowDraft {
  const trimmed = title.trim();

  const albumMatch = trimmed.match(/^(.+?)\s+-\s+(.+?)\s*\|\|\s*full album\s*\|\|\s*$/i);
  if (albumMatch) {
    const [, artist, rest] = albumMatch;
    const { album, year } = parseAlbumYear(rest!);
    return { artist: artist!.trim(), album, year, type: classifyFullAlbumType(rest!, album) };
  }

  const videoMatch = trimmed.match(/^(.+?)\s+-\s+(.+?)\s*\(official[^)]*video\)\s*$/i);
  if (videoMatch) return { artist: videoMatch[1]!.trim(), album: videoMatch[2]!.trim(), year: null, type: 'Music Video' };

  if (/\|\|\s*full documentary\s*\|\|/i.test(trimmed)) {
    return { artist: '', album: trimmed.slice(0, 240), year: null, type: 'Documentary' };
  }

  return classifyReview(trimmed, channelName) ?? { artist: '', album: trimmed.slice(0, 240), year: null, type: 'Shorts' };
}

// Estados del campo Status. Fuera de la lista publica de "subidos" hay tres
// casos que la hoja distingue:
//   - Unlisted: el video existe pero solo se ve con el link (oculto) o es
//     privado.
//   - Blocked:  el video es publico pero YouTube no lo reproduce: bloqueo por
//     derechos. Verificado con la Data API en sep-2026: los 95 casos estaban
//     bloqueados en 249 paises, es decir, a nivel internacional.
//   - Removed:  el video ya no existe (borrado, o retirado con todo y creditos).
export type TrackingStatus = 'Listed' | 'Unlisted' | 'Blocked' | 'Removed';
const TRACKING_STATUSES: readonly TrackingStatus[] = ['Unlisted', 'Listed', 'Blocked', 'Removed'];

// Traduce el playabilityStatus.status del reproductor de YouTube (visto por
// un visitante anonimo) al estado de la hoja, para un video que NO aparece en
// la lista de subidos. null = respuesta que no se sabe leer; quien llama
// conserva el estado anterior en vez de adivinar.
//   ERROR          -> "Video unavailable" sin mas: el video no existe.
//   UNPLAYABLE     -> existe y es publico, pero no se reproduce: bloqueado.
//   LOGIN_REQUIRED -> privado (o con restriccion de edad): no es publico.
//   OK             -> se reproduce con el link pero no esta listado: oculto.
export function statusFromPlayability(playability: string | undefined): Exclude<TrackingStatus, 'Listed'> | null {
  switch (playability) {
    case 'ERROR': return 'Removed';
    case 'UNPLAYABLE': return 'Blocked';
    case 'LOGIN_REQUIRED':
    case 'OK':
      return 'Unlisted';
    default: return null;
  }
}

// Consulta, para los videos fuera de la lista publica, en que estado estan.
// La implementa el exportador (que ya sabe leer las paginas de YouTube); un
// videoId ausente del resultado es uno que no se pudo averiguar.
export type UnlistedVideoProbe = (videoIds: string[]) => Promise<Map<string, Exclude<TrackingStatus, 'Listed'>>>;

// Una fila sin artista, album, año, tipo ni URL es un hueco (p.ej. una fila
// cuyo contenido se borro a mano sin eliminarla). No recibe Upload Order ni
// Status, no cuenta en los contadores y no fija el siguiente numero.
export function isBlankTrackingRow(row: Array<string | number>, columns: TrackingColumns): boolean {
  return [columns.artist, columns.album, columns.year, columns.type, columns.url]
    .every(column => String(row[column] ?? '').trim() === '');
}

function rowVideoId(row: Array<string | number>, columns: TrackingColumns): string | null {
  const url = row[columns.url];
  return typeof url === 'string' ? extractVideoId(url) : null;
}

// Si el videoId de la URL de la fila aparece en la lista de "subidos" que ya
// se escaneo esta misma corrida, esta "Listed" sin pedir nada mas. Si no, manda
// lo que averiguo la sonda. Sin URL todavia (disco cargado a mano antes de
// subir el video) queda "Unlisted", igual que antes. Si la sonda no pudo
// averiguar nada, se conserva el estado no publico que ya tenia la fila, y
// solo si venia de Listed se marca "Unlisted".
function computeStatus(
  row: Array<string | number>, knownVideoIds: Set<string>, probed: Map<string, Exclude<TrackingStatus, 'Listed'>>, columns: TrackingColumns,
): TrackingStatus {
  const videoId = rowVideoId(row, columns);
  if (!videoId) return 'Unlisted';
  if (knownVideoIds.has(videoId)) return 'Listed';
  const found = probed.get(videoId);
  if (found) return found;
  const previousValue = row[columns.status];
  const previous = typeof previousValue === 'string' ? previousValue.trim() : '';
  return previous === 'Blocked' || previous === 'Removed' ? previous : 'Unlisted';
}

// Corrige colisiones de Upload Order sin forzar una secuencia compacta: un
// hueco antiguo (p.ej. una fila borrada hace tiempo) se deja tal cual. Ante un
// empate, gana la fila que esta mas arriba en la hoja -asi, si insertas una
// fila nueva justo encima de la que ya tenia el numero 500 y le pones tambien
// 500, la nueva se queda con 500 y la vieja (y todo lo que sigue) se recorre
// +1 en cascada.
export function resequenceUploadOrder(
  currentOrders: Array<number | null>, rowTypes: unknown[],
): Array<number | null> {
  if (currentOrders.length !== rowTypes.length) throw new Error('Upload Order y Type of Album tienen longitudes distintas.');
  const indexed = currentOrders.map((order, index) => ({ index, order, unnumbered: uploadTypeIsUnnumbered(rowTypes[index]) }));
  const numbered = indexed.filter(r => !r.unnumbered);
  const withOrder = numbered.filter((r): r is { index: number; order: number; unnumbered: false } => r.order !== null);
  const withoutOrder = numbered.filter(r => r.order === null);
  withOrder.sort((a, b) => (a.order - b.order) || (a.index - b.index));

  const result = new Array<number | null>(currentOrders.length).fill(null);
  let previous = 0;
  for (const r of withOrder) {
    const next = r.order > previous ? r.order : previous + 1;
    result[r.index] = next;
    previous = next;
  }
  for (const r of withoutOrder) {
    previous += 1;
    result[r.index] = previous;
  }
  return result;
}

// Mantiene la validacion de lista de Status con los cuatro estados y
// agrega (si falta) una regla de formato condicional por estado no publico:
// Unlisted en el mismo rojo pastel que ya usaban a mano algunas filas, Blocked
// en naranja y Removed en gris. Idempotente: una regla de color que ya existe
// (de una corrida anterior) no se duplica. Tambien retira exclusivamente las
// reglas de Status que quedaron ancladas a otra columna tras un cambio de esquema.
async function ensureStatusValidationAndFormatting(
  spreadsheetId: string, accessToken: string, sheetMeta: SheetMeta, columns: TrackingColumns,
): Promise<void> {
  const requests: unknown[] = [
    {
      setDataValidation: {
        range: {
          sheetId: sheetMeta.sheetId, startRowIndex: 1, endRowIndex: FORMAT_RANGE_ROWS,
          startColumnIndex: columns.status, endColumnIndex: columns.status + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: TRACKING_STATUSES.map(status => ({ userEnteredValue: status })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
  ];

  const conditionOf = (format: unknown): string => {
    const condition = (format as { booleanRule?: { condition?: { values?: Array<{ userEnteredValue?: string }> } } })
      .booleanRule?.condition;
    return condition?.values?.[0]?.userEnteredValue ?? '';
  };
  const staleRules = sheetMeta.conditionalFormats
    .map((format, index) => ({ index, formula: conditionOf(format) }))
    .filter(({ formula }) => /^=\$[A-Z]+2="(?:Unlisted|Blocked|Removed)"$/.test(formula) && !formula.startsWith(`=$${columnLetter(columns.status)}2=`))
    .map(({ index }) => index)
    .sort((a, b) => b - a);
  for (const index of staleRules) {
    requests.push({ deleteConditionalFormatRule: { sheetId: sheetMeta.sheetId, index } });
  }

  const colorRules: Array<[TrackingStatus, typeof UNLISTED_ROW_COLOR]> = [
    ['Unlisted', UNLISTED_ROW_COLOR], ['Blocked', BLOCKED_ROW_COLOR], ['Removed', REMOVED_ROW_COLOR],
  ];
  for (const [status, color] of colorRules) {
    const hasColorRule = sheetMeta.conditionalFormats.some(fmt => conditionOf(fmt) === `=$${columnLetter(columns.status)}2="${status}"`);
    if (hasColorRule) continue;
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId: sheetMeta.sheetId, startRowIndex: 1, endRowIndex: FORMAT_RANGE_ROWS,
            startColumnIndex: 0, endColumnIndex: Math.max(columns.uploadOrder, columns.artist, columns.album, columns.year, columns.type, columns.url, columns.status) + 1,
          }],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$${columnLetter(columns.status)}2="${status}"` }] },
            format: { backgroundColor: color },
          },
        },
        index: 0,
      },
    });
  }

  await spreadsheetBatchUpdate(spreadsheetId, accessToken, requests);
}

// Tipos del campo Type of Album que no son musica encadenable y quedan fuera de la
// radio aunque el titulo del video diga "Full Album". La hoja es la fuente de
// estos tipos; el titulo de YouTube no los distingue con fiabilidad.
export const RADIO_EXCLUDED_ALBUM_TYPES: ReadonlySet<string> = new Set([
  'Documentary', 'Live Concert', 'Music Video', 'Interview', 'Shorts',
  // Compatibilidad defensiva con hojas antiguas; el clasificador ya no emite
  // ninguna de estas categorias.
  'Review', 'Other', 'Others',
]);

// videoId -> tipos del campo Type of Album. Una celda puede traer varios separados
// por coma ("Live Concert, Documentary"); si un mismo video aparece en mas de
// una fila, se unen los tipos de todas. Solo lectura.
export async function readAlbumTypesByVideo(
  spreadsheetId: string, serviceAccountPath: string,
): Promise<Map<string, string[]>> {
  const accessToken = await getAccessToken(readServiceAccount(serviceAccountPath));
  const sheetMeta = await firstSheetMeta(spreadsheetId, accessToken);
  const columns = await readTrackingColumns(spreadsheetId, accessToken, sheetMeta);
  const rows = await readExistingRows(spreadsheetId, accessToken, sheetMeta.title, columns);
  const types = new Map<string, string[]>();
  for (const row of rows) {
    const url = row[columns.url];
    const videoId = typeof url === 'string' ? extractVideoId(url) : null;
    if (!videoId) continue;
    const type = row[columns.type];
    const cell = typeof type === 'string' ? type : '';
    const merged = new Set([...(types.get(videoId) ?? []), ...cell.split(',').map(t => t.trim()).filter(Boolean)]);
    types.set(videoId, [...merged]);
  }
  return types;
}

export interface TrackingSheetVideoRef { videoId: string; title: string }

export interface TrackingSheetSyncResult {
  added: number;
  rows: Array<Array<string | number>>;
  possibleDuplicates: Array<TrackingSheetVideoRef & { existingRow: string }>;
  // Filas cuyo Upload Order, Status o fecha de Unlisted cambio en esta
  // corrida (0 en un dry-run sin colisiones ni videos que hayan cambiado).
  orderChanges: number;
  statusChanges: number;
  unlistedDateChanges: number;
  // Cuantas filas quedan en cada estado tras el barrido (null si la hoja no
  // tiene filas).
  statusCounts: Record<TrackingStatus, number> | null;
}

// Las fechas son dias de Sheets, nunca texto interpretado segun el locale.
// El texto heredado se lee expresamente como dia/mes/año.
export function trackingDateSerial(value: unknown): number | '' {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== 'string') throw new Error('Fecha de seguimiento invalida. No se escribe.');
  const text = value.trim();
  if (!text) return '';
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error(`Fecha de seguimiento invalida: ${text}. No se escribe.`);
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    throw new Error(`Fecha de seguimiento invalida: ${text}. No se escribe.`);
  }
  return Math.round(date.getTime() / 86400000) + 25569;
}

function todayTrackingSerial(): number {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return trackingDateSerial(`${part('day')}/${part('month')}/${part('year')}`) as number;
}

// Unlisted Since (o el contador Unlisted historico): la fecha en que la fila dejo de estar Listed (paso a Unlisted,
// Blocked o Removed). No hay historial de corridas anteriores, asi que la
// unica forma de saber "cuando" es comparar contra la fecha que ya hay: si la
// fila sigue fuera de Listed y ya tenia fecha, esa fecha NO se toca aunque
// cambie entre Unlisted/Blocked/Removed (es la primera vez que se detecto, no
// hoy); si es la primera corrida fuera de Listed, se pone la fecha de hoy. Si
// la fila vuelve a estar Listed, la fecha ya no aplica y se borra.
function computeUnlistedSince(row: Array<string | number>, newStatus: TrackingStatus, today: number, columns: TrackingColumns): string | number {
  if (newStatus === 'Listed') return '';
  const existing = trackingDateSerial(row[columns.unlistedSince]);
  return existing || today;
}

// videos: TODOS los del canal (no solo los "Full Album" de la radio), en el
// mismo orden que entrega la lista de subidos de YouTube (mas nuevo primero).
// Se usa tanto para clasificar videos nuevos como, ya con canal completo en
// mano, para saber que fila sigue publicamente listada.
export async function syncTrackingSheet(
  spreadsheetId: string, serviceAccountPath: string, videos: TrackingSheetVideoRef[], dryRun: boolean,
  probeUnlisted: UnlistedVideoProbe,
  options: TrackingSheetOptions = {},
): Promise<TrackingSheetSyncResult> {
  assertWritableTrackingSheet(spreadsheetId, options.readOnlySheetIds ?? []);
  const serviceAccount = readServiceAccount(serviceAccountPath);
  const accessToken = await getAccessToken(serviceAccount);
  const sheetMeta = await firstSheetMeta(spreadsheetId, accessToken);
  const sheetTitle = sheetMeta.title;
  const columns = await readTrackingColumns(spreadsheetId, accessToken, sheetMeta);
  const existingRows = await readExistingRows(spreadsheetId, accessToken, sheetTitle, columns);
  if (!columns.counters && !sheetMeta.countersTitle) throw new Error('Falta la pestaña Contadores. No se escribe.');
  // La validacion de fechas precede incluso al append de videos nuevos.
  for (const row of existingRows) trackingDateSerial(row[columns.unlistedSince]);

  const knownVideoIds = new Set(videos.map(v => v.videoId));

  const knownVideoIdsInSheet = new Set<string>();
  // "Artista|Album" ya presente en la hoja, tenga o no URL todavia (p.ej. un
  // disco cargado a mano como "Unlisted" antes de subir el video real). Evita
  // una fila duplicada cuando ese video pasa a estar publico.
  const knownArtistAlbum = new Map<string, string>();
  let maxUploadOrder = 0;
  for (const row of existingRows) {
    const uploadOrder = isBlankTrackingRow(row, columns) || uploadTypeIsUnnumbered(row[columns.type])
      ? null : parseUploadOrder(row[columns.uploadOrder]);
    if (uploadOrder !== null) maxUploadOrder = Math.max(maxUploadOrder, uploadOrder);
    const url = row[columns.url];
    if (typeof url === 'string') {
      const videoId = extractVideoId(url);
      if (videoId) knownVideoIdsInSheet.add(videoId);
    }
    const artist = row[columns.artist];
    const album = row[columns.album];
    if (typeof artist === 'string' && typeof album === 'string' && artist && album) {
      knownArtistAlbum.set(`${normalizeKey(artist)}|${normalizeKey(album)}`, row.join(' | '));
    }
  }

  // La lista del canal viene del mas nuevo al mas viejo; se invierte para que
  // los que van quedando "nuevos" reciban un Upload Order creciente en el
  // mismo sentido cronologico que ya usa la hoja.
  const missing = videos.filter(v => !knownVideoIdsInSheet.has(v.videoId)).reverse();

  const rows: Array<Array<string | number>> = [];
  const possibleDuplicates: Array<TrackingSheetVideoRef & { existingRow: string }> = [];
  let nextOrder = maxUploadOrder + 1;
  for (const video of missing) {
    const classified = classifyForTrackingSheet(video.title, options.channelName);
    const existingRow = knownArtistAlbum.get(`${normalizeKey(classified.artist)}|${normalizeKey(classified.album)}`);
    if (existingRow) { possibleDuplicates.push({ ...video, existingRow }); continue; }
    const uploadOrder = uploadTypeIsUnnumbered(classified.type) ? '' : nextOrder;
    const row: Array<string | number> = new Array(columns.width).fill('');
    row[columns.uploadOrder] = uploadOrder;
    row[columns.artist] = classified.artist;
    row[columns.album] = classified.album;
    row[columns.year] = classified.year ?? '';
    row[columns.type] = classified.type;
    row[columns.url] = `https://www.youtube.com/watch?v=${video.videoId}`;
    rows.push(row);
    if (uploadOrder !== '') nextOrder += 1;
  }

  // Solo se sondean las filas con URL que no estan en la lista publica: son
  // las unicas cuyo estado no se deduce gratis de la lista de subidos.
  async function sweep(rowsForSweep: Array<Array<string | number>>) {
    const outsideList = [...new Set(rowsForSweep.map(row => rowVideoId(row, columns)).filter((id): id is string => Boolean(id) && !knownVideoIds.has(id!)))];
    const probed = outsideList.length > 0 ? await probeUnlisted(outsideList) : new Map<string, Exclude<TrackingStatus, 'Listed'>>();
    const blank = rowsForSweep.map(r => isBlankTrackingRow(r, columns));
    const currentOrders = rowsForSweep.map(r => parseUploadOrder(r[columns.uploadOrder]));
    // Un hueco se trata como fila sin numerar: pierde su Upload Order.
    const newOrders = resequenceUploadOrder(currentOrders, rowsForSweep.map((r, i) => (blank[i] ? 'Shorts' : r[columns.type])));
    const orderChanges = currentOrders.filter((o, i) => o !== newOrders[i]).length;
    const newStatuses: Array<TrackingStatus | ''> = rowsForSweep.map((r, i) => (blank[i] ? '' : computeStatus(r, knownVideoIds, probed, columns)));
    const statusChanges = rowsForSweep.filter((r, i) => (typeof r[columns.status] === 'string' ? r[columns.status] : '') !== newStatuses[i]).length;
    const today = todayTrackingSerial();
    const newUnlistedDates = rowsForSweep.map((r, i) => {
      const status = newStatuses[i] ?? '';
      return status === '' ? '' : computeUnlistedSince(r, status, today, columns);
    });
    const unlistedDateChanges = rowsForSweep.filter((r, i) => trackingDateSerial(r[columns.unlistedSince]) !== newUnlistedDates[i]).length;
    const statusCounts = Object.fromEntries(TRACKING_STATUSES.map(s => [s, newStatuses.filter(n => n === s).length])) as Record<TrackingStatus, number>;
    return { newOrders, newStatuses, newUnlistedDates, orderChanges, statusChanges, unlistedDateChanges, statusCounts };
  }

  const reportRows = rows.map(row => [
    row[columns.uploadOrder], row[columns.artist], row[columns.album],
    row[columns.year], row[columns.type], row[columns.url], row[columns.status],
  ].map(value => value ?? ''));

  if (dryRun) {
    const simulated = [...existingRows, ...rows];
    const { orderChanges, statusChanges, unlistedDateChanges, statusCounts } = await sweep(simulated);
    return { added: rows.length, rows: reportRows, possibleDuplicates, orderChanges, statusChanges, unlistedDateChanges, statusCounts };
  }

  if (rows.length > 0) await appendRows(spreadsheetId, accessToken, sheetTitle, rows, columns);

  const allRows = rows.length > 0 ? await readExistingRows(spreadsheetId, accessToken, sheetTitle, columns) : existingRows;
  const lastRow = allRows.length + 1; // la fila 1 es el encabezado
  let orderChanges = 0;
  let statusChanges = 0;
  let unlistedDateChanges = 0;
  let statusCounts: Record<TrackingStatus, number> | null = null;
  if (lastRow > 1) {
    const result = await sweep(allRows);
    statusCounts = result.statusCounts;
    orderChanges = result.orderChanges;
    statusChanges = result.statusChanges;
    unlistedDateChanges = result.unlistedDateChanges;
    // No reescribir celdas derivadas que ya son correctas. Ademas de reducir
    // escrituras, RAW sobre texto puede cambiar su formato numerico en Sheets.
    const columnUpdates = (column: number, values: Array<string | number>): Array<{ range: string; values: Array<Array<string | number>> }> => {
      const updates: Array<{ range: string; values: Array<Array<string | number>> }> = [];
      let start = -1;
      for (let i = 0; i <= values.length; i += 1) {
        const changed = i < values.length && (allRows[i]?.[column] ?? '') !== values[i];
        if (changed && start < 0) start = i;
        if (!changed && start >= 0) {
          updates.push({ range: sheetRange(sheetTitle, `${columnLetter(column)}${start + 2}:${columnLetter(column)}${i + 1}`), values: values.slice(start, i).map(value => [value]) });
          start = -1;
        }
      }
      return updates;
    };
    await valuesBatchUpdate(spreadsheetId, accessToken, [
      ...columnUpdates(columns.uploadOrder, result.newOrders.map(o => o ?? '')),
      ...columnUpdates(columns.status, result.newStatuses),
      ...columnUpdates(columns.unlistedSince, result.newUnlistedDates),
    ], 'RAW');
  }

  const statusColumn = columnLetter(columns.status);
  const statusRange = sheetRange(sheetTitle, `${statusColumn}2:${statusColumn}`);
  const counterUpdates: Array<{ range: string; values: Array<Array<string | number>> }> = [];
  if (columns.counters) {
    for (const status of TRACKING_STATUSES) counterUpdates.push({
      range: sheetRange(sheetTitle, `${columnLetter(columns.counters[status])}1`),
      values: [[`="${status}: "&COUNTIF(${statusRange},"${status}")`]],
    });
  }
  if (sheetMeta.countersTitle) counterUpdates.push({
    range: sheetRange(sheetMeta.countersTitle, 'A1:B6'),
    values: [['Estado', 'Cantidad'], ...TRACKING_STATUSES.map(status => [status, `=COUNTIF(${statusRange},"${status}")`]), ['Total', '=SUM(B2:B5)']],
  });
  await valuesBatchUpdate(spreadsheetId, accessToken, counterUpdates);

  // Incluye la fecha y las filas anexadas dentro de la tabla nativa. No se
  // recrea la tabla ni sus chips/validaciones; solo se amplia su rango.
  // No reenviar columnProperties: la API omite los colores y la seleccion
  // multiple del desplegable; reescribirlas convierte los compuestos en invalidos.
  const tableWidth = Math.max(columns.uploadOrder, columns.artist, columns.album, columns.year, columns.type, columns.url, columns.status, columns.unlistedSince) + 1;
  const tableUpdates = sheetMeta.tables.filter(table => (table.range.startRowIndex ?? 0) === 0 && (table.range.startColumnIndex ?? 0) === 0)
    .filter(table => (table.range.endColumnIndex ?? 0) < tableWidth || (table.range.endRowIndex ?? 0) < lastRow)
    .map(table => ({ updateTable: { table: { tableId: table.tableId, range: { ...table.range, sheetId: sheetMeta.sheetId,
      endColumnIndex: Math.max(table.range.endColumnIndex ?? 0, tableWidth), endRowIndex: Math.max(table.range.endRowIndex ?? 0, lastRow) } }, fields: 'range' } }));
  await spreadsheetBatchUpdate(spreadsheetId, accessToken, tableUpdates);
  // La ampliacion de una tabla puede restablecer el formato de celdas nuevas.
  if (lastRow > 1) {
    await spreadsheetBatchUpdate(spreadsheetId, accessToken, [{ updateCells: {
      range: { sheetId: sheetMeta.sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: columns.unlistedSince, endColumnIndex: columns.unlistedSince + 1 },
      // Filas explicitas: repeatCell deja sin formato algunas filas ocultas
      // por el filtro de una tabla nativa.
      rows: allRows.map(() => ({ values: [{ userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }] })),
      fields: 'userEnteredFormat.numberFormat',
    } }]);
  }

  await ensureStatusValidationAndFormatting(spreadsheetId, accessToken, sheetMeta, columns);

  return { added: rows.length, rows: reportRows, possibleDuplicates, orderChanges, statusChanges, unlistedDateChanges, statusCounts };
}
