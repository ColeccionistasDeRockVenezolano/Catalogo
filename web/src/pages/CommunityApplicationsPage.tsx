// CRV · Comunidad › candidaturas (Fase 1).
import { useState } from "react";
import { communityApi, type ApplicationDetail, type ApplicationStatus } from "../lib/community";
import { useAsync } from "../lib/useAsync";
import { useToast } from "../lib/ToastContext";
import { useI18n } from "../lib/i18n";
import { ErrorState, LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";

const STATUS_BADGE: Record<string, string> = {
  new: "badge--amber", reviewing: "badge--violet", contact: "badge--teal",
  accepted: "badge--teal", rejected: "badge--red", archived: "badge--outline",
};

export function CommunityApplicationsPage() {
  const { t } = useI18n();
  const { notify } = useToast();
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const applications = useAsync(
    () => communityApi.applications({ status, search }), [status, search]);
  const detail = useAsync<ApplicationDetail | null>(
    () => selectedId ? communityApi.application(selectedId) : Promise.resolve(null), [selectedId]);

  async function setState(id: number, next: Exclude<ApplicationStatus, "accepted">): Promise<void> {
    setBusy(true);
    try {
      await communityApi.setApplicationStatus(id, next);
      notify("success", t(`status.${next}` as never));
      applications.reload();
      if (selectedId === id) detail.reload();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function accept(id: number): Promise<void> {
    setBusy(true);
    try {
      const result = await communityApi.acceptApplication(id);
      setLink(`${window.location.origin}${import.meta.env.BASE_URL}${result.activationPath}`);
      notify("success", t("apps.accept"));
      applications.reload();
      detail.reload();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="community-page">
      <div className="page-header">
        <div>
          <h1>{t("apps.title")}</h1>
          <p className="hint">{t("apps.lead")}</p>
        </div>
      </div>

      {link ? (
        <div className="community-success" role="status">
          <strong>{t("apps.activationReady")}</strong>
          <div className="community-link-box">
            <code>{link}</code>
            <button type="button" className="btn btn--sm" onClick={() => { void navigator.clipboard.writeText(link).then(() => notify("success", t("common.copied"))); }}>{t("common.copy")}</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLink(null)}>{t("common.close")}</button>
          </div>
          <span className="community-muted">{t("apps.activationHelp")}</span>
        </div>
      ) : null}

      <div className="community-toolbar">
        <div className="field">
          <label htmlFor="a-search">{t("common.search")}</label>
          <input id="a-search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="nombre, correo, WhatsApp" />
        </div>
        <div className="field">
          <label htmlFor="a-status">{t("common.status")}</label>
          <select id="a-status" value={status} onChange={(event) => { setStatus(event.target.value); setSelectedId(null); }}>
            <option value="open">Abiertas</option>
            <option value="">Todas</option>
            <option value="new">{t("status.new")}</option>
            <option value="reviewing">{t("status.reviewing")}</option>
            <option value="contact">{t("status.contact")}</option>
            <option value="accepted">{t("status.accepted")}</option>
            <option value="rejected">{t("status.rejected")}</option>
            <option value="archived">{t("status.archived")}</option>
          </select>
        </div>
        <button type="button" className="btn" onClick={() => setSearch(term.trim())}>{t("common.search")}</button>
      </div>

      {applications.loading ? <LoadingState label={t("common.loading")} /> : applications.error ? (
        <ErrorState message={applications.error} onRetry={() => void applications.reload()} />
      ) : (
        <div className="community-card community-table-wrap">
          <table className="community-table">
            <thead><tr>
              <th>{t("apps.applicant")}</th><th>{t("apps.contact")}</th><th>{t("apps.city")}</th>
              <th>{t("common.status")}</th><th>{t("apps.skills")}</th><th>{t("common.actions")}</th>
            </tr></thead>
            <tbody>
              {applications.data?.data.map((row) => (
                <tr key={row.id}>
                  <td><strong>{[row.first_name, row.last_name].filter(Boolean).join(" ")}</strong><div className="community-muted">#{row.id} · {row.created_at}</div></td>
                  <td>{row.email ?? "—"}<div className="community-muted">{row.whatsapp_phone ?? ""}</div></td>
                  <td className="community-muted">{[row.city, row.country].filter(Boolean).join(", ") || "—"}</td>
                  <td><span className={`badge ${STATUS_BADGE[row.status] ?? "badge--outline"}`}>{t(`status.${row.status}` as never)}</span></td>
                  <td className="community-muted">{row.terms || "—"}</td>
                  <td><button type="button" className="btn btn--sm" onClick={() => setSelectedId(row.id)}>{t("apps.detail")}</button></td>
                </tr>
              ))}
              {applications.data?.data.length === 0 ? <tr><td colSpan={6} className="community-empty">{t("apps.empty")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {selectedId ? (
        <section className="community-card community-detail">
          <div className="community-actions" style={{ justifyContent: "space-between" }}>
            <h2>{t("apps.detail")} #{selectedId}</h2>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelectedId(null)}>{t("common.close")}</button>
          </div>
          {detail.loading ? <LoadingState label={t("common.loading")} /> : detail.error ? (
            <ErrorState message={detail.error} onRetry={() => void detail.reload()} />
          ) : detail.data ? (
            <>
              <dl>
                <dt>{t("apps.applicant")}</dt><dd>{[detail.data.first_name, detail.data.last_name].filter(Boolean).join(" ")}</dd>
                <dt>{t("form.email")}</dt><dd>{detail.data.email ?? "—"}</dd>
                <dt>{t("form.phone")}</dt><dd>{detail.data.whatsapp_phone ?? "—"}</dd>
                <dt>{t("form.city")}</dt><dd>{[detail.data.city, detail.data.country].filter(Boolean).join(", ") || "—"}</dd>
                <dt>{t("apps.birthDate")}</dt><dd>{detail.data.birth_date ?? "—"}</dd>
                <dt>{t("apps.contactPreference")}</dt><dd>{detail.data.contact_preference}</dd>
                <dt>{t("apps.contribution")}</dt><dd>{detail.data.contribution_text ?? "—"}</dd>
                <dt>{t("apps.experience")}</dt><dd>{detail.data.experience ?? "—"}</dd>
                <dt>{t("apps.idea")}</dt><dd>{detail.data.idea ?? "—"}</dd>
                <dt>{t("apps.ideaReason")}</dt><dd>{detail.data.idea_reason ?? "—"}</dd>
                <dt>{t("apps.wants")}</dt><dd>{detail.data.wants_to_implement}</dd>
                <dt>{t("apps.availability")}</dt><dd>{detail.data.availability ?? "—"}</dd>
                <dt>{t("apps.skills")}</dt><dd>{detail.data.terms || "—"}</dd>
                <dt>{t("apps.links")}</dt><dd>{detail.data.links.length ? detail.data.links.map((item) => (
                  <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="community-muted">{item.label ?? item.type}: {item.url}<br /></a>
                )) : "—"}</dd>
              </dl>
              <div className="community-actions">
                {detail.data.status !== "accepted" ? (
                  <>
                    <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void accept(detail.data!.id)}>{busy ? t("apps.accepting") : t("apps.accept")}</button>
                    <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void setState(detail.data!.id, "reviewing")}>{t("apps.reviewing")}</button>
                    <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void setState(detail.data!.id, "contact")}>{t("apps.contacted")}</button>
                    <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void setState(detail.data!.id, "rejected")}>{t("apps.reject")}</button>
                  </>
                ) : <span className="badge badge--teal">{t("status.accepted")}</span>}
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void setState(detail.data!.id, "archived")}>{t("apps.archive")}</button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
