// CRV · Comunidad › colaboradores, invitaciones, activaciones y roles (Fase 1).
import { useState, type FormEvent } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import {
  communityApi, type AdminRole, type AdminUser, type Activation, type Invite,
} from "../lib/community";
import { useAsync } from "../lib/useAsync";
import { useOperator } from "../lib/OperatorContext";
import { useToast } from "../lib/ToastContext";
import { useI18n } from "../lib/i18n";
import { ErrorState, LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";

const STATUS_BADGE: Record<string, string> = {
  approved: "badge--teal", pending: "badge--amber", rejected: "badge--red",
};

const absolute = (path: string) => `${window.location.origin}${import.meta.env.BASE_URL}${path}`;

export function CommunityCollaboratorsPage() {
  const { t } = useI18n();
  const { isAdmin } = useOperator();
  const { notify } = useToast();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const collaborators = useAsync(
    () => communityApi.collaborators({ status, search }), [status, search]);
  const invites = useAsync(() => communityApi.invites(), []);
  const activations = useAsync(() => communityApi.activations(), []);
  const admins = useAsync(
    () => isAdmin ? communityApi.admins() : Promise.resolve({ data: [] as AdminUser[] }), [isAdmin]);

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    setLink(null);
    try {
      await action();
      notify("success", success);
      collaborators.reload();
      invites.reload();
      activations.reload();
      admins.reload();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get("name") ?? "").trim(),
      firstName: String(form.get("firstName") ?? "").trim(),
      lastName: String(form.get("lastName") ?? "").trim() || undefined,
      accessCode: String(form.get("accessCode") ?? ""),
    };
    await run(() => communityApi.createCollaborator(body), t("collab.created"));
    setCreateOpen(false);
    (event.target as HTMLFormElement).reset();
  }

  async function changeStatus(id: number, next: "approved" | "rejected" | "pending"): Promise<void> {
    await run(() => communityApi.updateCollaborator(id, { status: next }), t(`status.${next}` as never));
  }

  async function revoke(id: number, name: string): Promise<void> {
    if (!window.confirm(`${t("collab.revoke")}: ${name}?`)) return;
    await run(() => communityApi.revokeCollaborator(id), t("collab.revoke"));
  }

  async function resetCode(id: number): Promise<void> {
    const code = window.prompt(`${t("collab.reset")} — ${t("form.passwordHint")}`);
    if (!code) return;
    await run(() => communityApi.setAccessCode(id, code), t("collab.reset"));
  }

  async function createActivation(id: number): Promise<void> {
    setBusy(true);
    try {
      const created = await communityApi.createActivation(id);
      setLink(absolute(created.activationPath));
      activations.reload();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function createInvite(): Promise<void> {
    setBusy(true);
    try {
      const created = await communityApi.createInvite();
      setLink(absolute(created.invitePath));
      invites.reload();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      notify("success", t("common.copied"));
    } catch {
      notify("info", link);
    }
  }

  async function changeRole(admin: AdminUser, role: AdminRole): Promise<void> {
    await run(() => communityApi.setAdminRole(admin.id, role), `${admin.username}: ${role}`);
  }

  return (
    <div className="community-page">
      <div className="page-header">
        <div>
          <h1>{t("collab.title")}</h1>
          <p className="hint">{t("collab.lead")}</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setCreateOpen((value) => !value)}>
          {t("collab.new")}
        </button>
      </div>

      {link ? (
        <div className="community-success" role="status">
          <strong>{t("invites.created")}</strong>
          <div className="community-link-box">
            <code>{link}</code>
            <button type="button" className="btn btn--sm" onClick={() => void copyLink()}>{t("common.copy")}</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLink(null)}>{t("common.close")}</button>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <form className="community-card community-form" onSubmit={(event) => void create(event)}>
          <h2 className="span-2">{t("collab.formTitle")}</h2>
          <div className="field"><label htmlFor="c-username">{t("collab.username")} *</label><input id="c-username" name="name" required minLength={2} maxLength={80} autoComplete="off" /></div>
          <div className="field"><label htmlFor="c-first">{t("collab.firstName")} *</label><input id="c-first" name="firstName" required maxLength={80} /></div>
          <div className="field"><label htmlFor="c-last">{t("collab.lastName")}</label><input id="c-last" name="lastName" maxLength={80} /></div>
          <div className="field span-2"><label htmlFor="c-code">{t("collab.accessCode")} *</label><input id="c-code" name="accessCode" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /><span className="community-muted">{t("form.passwordHint")}</span></div>
          <div className="span-2 community-actions">
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? t("collab.creating") : t("collab.submit")}</button>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</button>
          </div>
        </form>
      ) : null}

      <div className="community-toolbar">
        <div className="field">
          <label htmlFor="c-search">{t("common.search")}</label>
          <input id="c-search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="nombre, usuario, correo" />
        </div>
        <div className="field">
          <label htmlFor="c-status">{t("common.status")}</label>
          <select id="c-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">—</option>
            <option value="pending">{t("status.pending")}</option>
            <option value="approved">{t("status.approved")}</option>
            <option value="rejected">{t("status.rejected")}</option>
          </select>
        </div>
        <button type="button" className="btn" onClick={() => setSearch(term.trim())}>{t("common.search")}</button>
      </div>

      {collaborators.loading ? <LoadingState label={t("common.loading")} /> : collaborators.error ? (
        <ErrorState message={collaborators.error} onRetry={() => void collaborators.reload()} />
      ) : (
        <div className="community-card community-table-wrap">
          <table className="community-table">
            <thead><tr>
              <th>{t("collab.username")}</th><th>{t("collab.person")}</th><th>{t("common.status")}</th>
              <th>{t("collab.source")}</th><th>{t("collab.access")}</th><th>{t("common.actions")}</th>
            </tr></thead>
            <tbody>
              {collaborators.data?.data.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong><div className="community-muted">#{row.id}</div></td>
                  <td>{[row.first_name, row.last_name].filter(Boolean).join(" ") || "—"}<div className="community-muted">{row.email ?? row.whatsapp_phone ?? ""}</div></td>
                  <td><span className={`badge ${STATUS_BADGE[row.status] ?? "badge--outline"}`}>{t(`status.${row.status}` as never)}</span></td>
                  <td className="community-muted">{row.signup_source}</td>
                  <td className="community-muted">{row.has_access_code ? "✓" : t("collab.noAccess")}</td>
                  <td>
                    <div className="community-actions">
                      {row.status !== "approved" ? <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void changeStatus(row.id, "approved")}>{t("collab.approve")}</button> : null}
                      {row.status !== "rejected" ? <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void changeStatus(row.id, "rejected")}>{t("collab.reject")}</button> : null}
                      <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void resetCode(row.id)}>{t("collab.reset")}</button>
                      {row.status === "approved" ? <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void createActivation(row.id)}>{t("collab.activation")}</button> : null}
                      <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void revoke(row.id, row.name)}>{t("collab.revoke")}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {collaborators.data?.data.length === 0 ? <tr><td colSpan={6} className="community-empty">{t("common.empty")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      <div className="community-grid">
        <section className="community-card">
          <h2>{t("invites.title")}</h2>
          <div className="community-actions" style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void createInvite()}>{t("invites.create")}</button>
          </div>
          {invites.loading ? <LoadingState label={t("common.loading")} /> : (
            <div className="community-table-wrap">
              <table className="community-table">
                <thead><tr><th>#</th><th>{t("invites.expires")}</th><th>{t("invites.uses")}</th><th>{t("common.actions")}</th></tr></thead>
                <tbody>
                  {invites.data?.data.map((invite: Invite) => (
                    <tr key={invite.id}>
                      <td>{invite.id}</td>
                      <td className="community-muted">{invite.expires_at}</td>
                      <td>{invite.use_count}</td>
                      <td><button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void run(() => communityApi.revokeInvite(invite.id), t("invites.revoke"))}>{t("invites.revoke")}</button></td>
                    </tr>
                  ))}
                  {invites.data?.data.length === 0 ? <tr><td colSpan={4} className="community-empty">{t("common.empty")}</td></tr> : null}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="community-card">
          <h2>{t("activations.title")}</h2>
          {activations.loading ? <LoadingState label={t("common.loading")} /> : (
            <div className="community-table-wrap">
              <table className="community-table">
                <thead><tr><th>{t("collab.username")}</th><th>{t("activations.expires")}</th><th>{t("common.actions")}</th></tr></thead>
                <tbody>
                  {activations.data?.data.map((activation: Activation) => (
                    <tr key={activation.id}>
                      <td>{activation.name}</td>
                      <td className="community-muted">{activation.expires_at}</td>
                      <td><button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void run(() => communityApi.revokeActivation(activation.id), t("activations.revoke"))}>{t("activations.revoke")}</button></td>
                    </tr>
                  ))}
                  {activations.data?.data.length === 0 ? <tr><td colSpan={3} className="community-empty">{t("common.empty")}</td></tr> : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="community-card">
        <h2>{t("roles.title")}</h2>
        <p className="community-muted">{t("roles.lead")}</p>
        {admins.loading ? <LoadingState label={t("common.loading")} /> : (
          <div className="community-table-wrap">
            <table className="community-table">
              <thead><tr><th>{t("collab.username")}</th><th>{t("roles.role")}</th><th>{t("common.actions")}</th></tr></thead>
              <tbody>
                {admins.data?.data.map((admin) => (
                  <tr key={admin.id}>
                    <td><strong>{admin.username}</strong>{admin.person_name ? <div className="community-muted">{admin.person_name}</div> : null}</td>
                    <td><span className="badge badge--outline">{admin.role}</span></td>
                    <td>
                      {isAdmin ? (
                        <div className="community-actions">
                          <select
                            defaultValue={admin.role === "curator" || admin.role === "community" ? admin.role : "admin"}
                            disabled={busy || admin.role === "superadmin"}
                            onChange={(event) => void changeRole(admin, event.target.value as AdminRole)}
                            aria-label={`${t("roles.change")}: ${admin.username}`}
                          >
                            <option value="admin">{t("roles.admin")}</option>
                            <option value="curator">{t("roles.curator")}</option>
                            <option value="community">{t("roles.community")}</option>
                          </select>
                        </div>
                      ) : <span className="community-muted"><WarningCircle size={14} aria-hidden="true" /> {t("roles.onlyAdmin")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
