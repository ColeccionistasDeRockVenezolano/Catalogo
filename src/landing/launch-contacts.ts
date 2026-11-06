import { readFile } from 'node:fs/promises';
import { sign } from 'node:crypto';
import { z } from 'zod';
import { getPool } from '../db/client.js';
import { getEnv } from '../config/env.js';

const clean = (max: number) => z.string().trim().max(max).refine(value => !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), 'Elimina los caracteres de control.');
export const launchContactBody = z.object({
  name: clean(120).pipe(z.string().min(2)),
  type: z.enum(['Oyente', 'Músico / banda', 'Investigador', 'Coleccionista']),
  email: z.string().trim().max(254).email().transform(value => value.toLowerCase()),
  phone: clean(40).default('').refine(value => !value || (/^[+\d\s().-]{6,40}$/u.test(value) && value.replace(/\D/gu, '').length >= 6), 'Revisa el número de teléfono.'),
  social: clean(500).default(''),
  campaign: clean(200).default(''),
  website: z.string().max(200).default(''),
}).strict();
export type LaunchContactInput = z.infer<typeof launchContactBody>;
interface Contact { id: string; name: string; type: string; email: string; phone: string; social: string; origin: string; campaign: string }

export async function saveLaunchContact(input: LaunchContactInput): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(`
    INSERT INTO auth.launch_contacts(id,name,type,email,phone,social,campaign)
    VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6)
    ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email
    RETURNING id`, [input.name, input.type, input.email, input.phone, input.social, input.campaign]);
  return rows[0]!.id;
}

let cachedToken: { path: string; value: string; expires: number } | undefined;
async function accessToken(credentials: string): Promise<string> {
  if (cachedToken?.path === credentials && cachedToken.expires > Date.now()) return cachedToken.value;
  const account = JSON.parse(await readFile(credentials, 'utf8')) as { client_email: string; private_key: string };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const assertion = `${payload}.${sign('RSA-SHA256', Buffer.from(payload), account.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error(`launch_google_token_${response.status}`);
  const token = await response.json() as { access_token: string; expires_in: number };
  if (!token.access_token) throw new Error('launch_google_token_missing');
  cachedToken = { path: credentials, value: token.access_token, expires: Date.now() + Math.max(0, token.expires_in - 60) * 1000 };
  return token.access_token;
}

const expectedHeaders = ['Nombre', 'Tipo', 'Correo', 'Numero', 'Redes', 'Origen', 'UTM Campaign'];
interface SheetCell {
  formattedValue?: string;
  userEnteredValue?: { stringValue?: string; numberValue?: number; boolValue?: boolean; formulaValue?: string };
}
async function syncToSheet(contacts: Contact[]): Promise<void> {
  const env = getEnv();
  const token = await accessToken(env.CRV_LAUNCH_SHEET_CREDENTIALS!);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${env.CRV_LAUNCH_SHEET_ID}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function get(suffix: string) {
    const response = await fetch(base + suffix, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`launch_google_read_${response.status}`);
    return response.json();
  }
  // Resolver la pestaña por su ID estable, y comprobar columnas antes de escribir.
  const metadata = await get('?fields=sheets.properties') as { sheets: Array<{ properties: { sheetId: number; title: string; gridProperties: { rowCount: number } } }> };
  const sheet = metadata.sheets.find(item => item.properties.sheetId === 0)?.properties;
  if (!sheet) throw new Error('launch_sheet_missing');
  const title = `'${sheet.title.replaceAll("'", "''")}'`;
  const heading = await get(`/values/${encodeURIComponent(title + '!A1:G1')}`) as { values?: string[][] };
  if (JSON.stringify(heading.values?.[0]) !== JSON.stringify(expectedHeaders)) throw new Error('launch_sheet_headers_changed');
  // Tras un timeout de append Google puede haber guardado la fila. Volver a leer
  // los correos antes de reintentar evita duplicarla, incluidas las altas manuales.
  const column = await get(`/values/${encodeURIComponent(title + '!C2:C' + Math.max(2, sheet.gridProperties.rowCount))}`) as { values?: string[][] };
  const known = new Map<string, number>();
  for (const [index, row] of (column.values ?? []).entries()) {
    const email = row[0]?.trim().toLowerCase();
    if (email && !known.has(email)) known.set(email, index + 2);
  }
  const valuesFor = (contact: Contact) => [contact.name, contact.type, contact.email, contact.phone, contact.social, 'Roadmap', contact.campaign];
  const fresh: Contact[] = [];
  const updates: Array<{ range: string; values: string[][] }> = [];
  for (const contact of contacts) {
    const rowNumber = known.get(contact.email);
    if (rowNumber === undefined) { fresh.push(contact); continue; }
    // Leer los valores originales, incluidas fórmulas que visualmente estén
    // vacías. Completar solo celdas vacías; conservar los datos ya existentes.
    const row = await get(`?ranges=${encodeURIComponent(`${title}!A${rowNumber}:G${rowNumber}`)}&includeGridData=true&fields=sheets.data.rowData.values(userEnteredValue,formattedValue)`) as {
      sheets?: Array<{ data?: Array<{ rowData?: Array<{ values?: SheetCell[] }> }> }>;
    };
    const cells = row.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values ?? [];
    // Una edición manual puede haber movido la fila desde la lectura del índice.
    if (cells[2]?.formattedValue?.trim().toLowerCase() !== contact.email) throw new Error('launch_sheet_row_changed');
    for (const [index, value] of valuesFor(contact).entries()) {
      const current = cells[index]?.userEnteredValue;
      const empty = !current || Object.keys(current).length === 0 || (current.stringValue !== undefined && !current.stringValue.trim());
      if (value && empty) updates.push({ range: `${title}!${String.fromCharCode(65 + index)}${rowNumber}`, values: [[value]] });
    }
  }
  if (updates.length) {
    const response = await fetch(`${base}/values:batchUpdate`, { method: 'POST', headers, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
    if (!response.ok) throw new Error(`launch_google_update_${response.status}`);
  }
  if (!fresh.length) return;
  const response = await fetch(`${base}/values/${encodeURIComponent(title + '!A:G')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', headers, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ values: fresh.map(valuesFor) }),
  });
  if (!response.ok) throw new Error(`launch_google_append_${response.status}`);
}

/** Un solo escritor en ambas instancias; una caída conserva las filas pendientes. */
export async function syncPendingLaunchContacts(): Promise<void> {
  if (!getEnv().CRV_LAUNCH_SHEET_CREDENTIALS) return;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('crv:launch-sheet')) AS acquired");
    if (!lock.rows[0]?.acquired) { await client.query('ROLLBACK'); return; }
    const { rows } = await client.query<Contact>(`SELECT * FROM auth.launch_contacts WHERE synced_at IS NULL AND next_attempt_at <= now() ORDER BY created_at LIMIT 20 FOR UPDATE`);
    if (rows.length) {
      try {
        await syncToSheet(rows);
        await client.query('UPDATE auth.launch_contacts SET synced_at=now(),attempts=attempts+1 WHERE id=ANY($1::uuid[])', [rows.map(row => row.id)]);
      } catch {
        await client.query(`UPDATE auth.launch_contacts SET attempts=attempts+1,
          next_attempt_at=now()+make_interval(secs => LEAST(3600,60*power(2,LEAST(attempts,6)))::int)
          WHERE id=ANY($1::uuid[])`, [rows.map(row => row.id)]);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
