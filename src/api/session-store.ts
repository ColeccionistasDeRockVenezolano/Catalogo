import type { Pool } from "pg";
import { getPool } from "../db/client.js";

export interface ExpiringSession { expiresAt: number }

/** Solo el hash SHA-256 del token sale de la capa HTTP. */
export class SessionStore<T extends ExpiringSession> {
  private readonly memory = new Map<string, T>();
  constructor(private readonly audience: "crv" | "cotejo", private readonly persistent: boolean, private readonly pool?: Pool) {}
  private database(): Pool { return this.pool ?? getPool(); }

  async get(key: string): Promise<T | undefined> {
    if (!this.persistent) {
      const value = this.memory.get(key);
      if (value && value.expiresAt > Date.now()) return value;
      this.memory.delete(key);
      return undefined;
    }
    const { rows } = await this.database().query<{ payload: T }>(
      "SELECT payload FROM auth.sessions WHERE audience=$1 AND token_hash=$2 AND expires_at > now()", [this.audience, key]);
    return rows[0]?.payload;
  }

  async set(key: string, value: T): Promise<void> {
    if (!this.persistent) { this.memory.set(key, value); return; }
    await this.database().query(`INSERT INTO auth.sessions (audience,token_hash,payload,expires_at)
      VALUES ($1,$2,$3,$4) ON CONFLICT (audience,token_hash) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`,
    [this.audience, key, JSON.stringify(value), new Date(value.expiresAt)]);
    // Poda acotada; ninguna sesión vencida puede usarse aunque todavía no se haya podado.
    await this.database().query("DELETE FROM auth.sessions WHERE ctid IN (SELECT ctid FROM auth.sessions WHERE expires_at <= now() LIMIT 100)");
  }

  async delete(key: string): Promise<void> {
    if (!this.persistent) { this.memory.delete(key); return; }
    await this.database().query("DELETE FROM auth.sessions WHERE audience=$1 AND token_hash=$2", [this.audience,key]);
  }

  resetMemory(): void { this.memory.clear(); }
  sweepMemory(): void {
    for (const [key,value] of this.memory) if (value.expiresAt <= Date.now()) this.memory.delete(key);
  }
}
