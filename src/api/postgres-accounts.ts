import type { Pool } from "pg";
import { getPool } from "../db/client.js";
import type { HerraAccount, HerraSessionRef } from "./herra-accounts.js";

/** Herra administra estas mismas filas. No hay réplica de cuentas en CRV. */
export class PostgresAccounts {
  constructor(private readonly projectSlug: string, private readonly pool: Pool = getPool()) {}

  async findAll(username: string): Promise<HerraAccount[]> {
    const { rows } = await this.pool.query<HerraAccount>(`
      WITH project AS (SELECT id FROM auth.projects WHERE lower(slug::text) = lower($2)),
      account AS (
        SELECT 'user' AS kind, u.id, lower(u.name::text) AS username,
               coalesce(nullif(trim(concat_ws(' ',u.first_name,u.last_name)),''),u.name::text) AS name,
               u.access_code_hash AS "passwordHash", u.session_version AS "sessionVersion", 'reader' AS role,
               'hex' AS "passwordEncoding", 2 AS priority
          FROM auth.users u WHERE u.project_id = (SELECT id FROM project)
           AND lower(u.name::text) = lower($1) AND u.status = 'approved' AND u.access_code_hash IS NOT NULL
        UNION ALL
        SELECT 'admin', a.id, lower(a.username::text),
               coalesce((SELECT coalesce(nullif(trim(concat_ws(' ',u.first_name,u.last_name)),''),u.name::text)
                           FROM auth.users u WHERE u.project_id=(SELECT id FROM project) AND lower(u.name::text)=lower($1)
                            AND u.status='approved'), a.username::text),
               a.password_hash, a.session_version, 'admin', 'hex', 1
          FROM auth.admins a WHERE lower(a.username::text)=lower($1) AND (a.role='superadmin' OR a.project_id=(SELECT id FROM project))
            AND (a.user_id IS NULL OR EXISTS (SELECT 1 FROM auth.users linked WHERE linked.id=a.user_id AND linked.status='approved' AND linked.access_code_hash IS NOT NULL))
        UNION ALL
        SELECT 'local', id, lower(username::text), name, password_hash, session_version, role, 'base64url', 0
          FROM auth.local_accounts WHERE lower(username::text)=lower($1) AND enabled
      ) SELECT kind,id,username,name,"passwordHash","sessionVersion",role,"passwordEncoding"
          FROM account WHERE priority=0 OR NOT EXISTS (SELECT 1 FROM account WHERE priority=0) ORDER BY priority`, [username, this.projectSlug]);
    return rows.map(row => ({ ...row, name: row.name.replace(/[^\p{L}\p{N} ._'-]/gu, "").replace(/\s+/gu," ").trim().slice(0,80) || "colaborador" }));
  }

  async stillValid(ref: HerraSessionRef): Promise<boolean> {
    if (ref.kind === "local") {
      const { rows } = await this.pool.query(`SELECT 1 FROM auth.local_accounts
        WHERE id=$1 AND enabled AND session_version=$2 AND role=$3`, [ref.id, ref.sessionVersion, ref.role]);
      return rows.length === 1;
    }
    const query = ref.kind === "user"
      ? `SELECT 1 FROM auth.users u JOIN auth.projects p ON p.id=u.project_id
           WHERE u.id=$1 AND u.session_version=$2 AND p.slug=$3 AND u.status='approved' AND u.access_code_hash IS NOT NULL`
      : `SELECT 1 FROM auth.admins a LEFT JOIN auth.projects p ON p.id=a.project_id
           WHERE a.id=$1 AND a.session_version=$2 AND (a.role='superadmin' OR p.slug=$3)
           AND (a.user_id IS NULL OR EXISTS (SELECT 1 FROM auth.users linked WHERE linked.id=a.user_id AND linked.status='approved' AND linked.access_code_hash IS NOT NULL))`;
    const { rows } = await this.pool.query(query, [ref.id, ref.sessionVersion, this.projectSlug]);
    return rows.length === 1;
  }

  close(): void { /* El pool pertenece a la aplicación. */ }
}

export interface SharedAccounts {
  findAll(username: string): HerraAccount[] | Promise<HerraAccount[]>;
  stillValid(ref: HerraSessionRef): boolean | Promise<boolean>;
  close(): void;
}
