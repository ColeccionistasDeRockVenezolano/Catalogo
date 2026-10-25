import type { Pool, PoolClient } from "pg";
import { getPool } from "../../db/client.js";
import { dailyCycleForDate, dailyDate } from "../../shared/daily-cycle.js";

export interface Ephemeris {
  id: number; title: string; description: string; date: string; year: number;
  place: string; subject: string; sources: Array<{ title: string; url: string }>;
}
export async function getEphemerides(date = dailyDate(), db: Pick<Pool | PoolClient,"query"> = getPool()) {
  const dailyCycle = dailyCycleForDate(date);
  const rows = (await db.query<Ephemeris>(`SELECT id::int,title,description,event_date::text AS date,
    event_year::int AS year,place,subject_name AS subject,sources
    FROM ingest.ephemerides WHERE status='verified' ORDER BY extract(month FROM event_date),extract(day FROM event_date),event_year,id`)).rows;
  return { dailyCycle, today: rows.filter(row => row.date.slice(5) === date.slice(5) && row.date <= date), events: rows.filter(row => row.date <= date) };
}
