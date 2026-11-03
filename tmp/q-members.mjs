import pg from 'pg';
import fs from 'node:fs';

const env = fs.readFileSync('/home/brian/apps/Coleccionistas De Rock Venezolano/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const client = new pg.Client({ connectionString: url });
await client.connect();

const r = await client.query(`select biography, notes from public.artists where id = 206`);
const bio = r.rows[0].biography || '';
console.log('len', bio.length);
console.log(bio.slice(0, 4000));

await client.end();
