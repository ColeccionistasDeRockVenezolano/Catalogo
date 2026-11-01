// CRV · /registro — alta con invitación; la cuenta queda pendiente de aprobación.
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { communityApi } from "../lib/community";
import { useAsync } from "../lib/useAsync";
import { useI18n } from "../lib/i18n";
import { LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";

export function RegisterInvitePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const info = useAsync(
    () => token ? communityApi.inviteInfo(token) : Promise.resolve({ valid: false, expiresAt: null }), [token]);
  const [name, setName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    if (code !== confirm) { setError("Las claves no coinciden."); return; }
    setSending(true);
    try {
      await communityApi.register({ token, name: name.trim(), firstName: firstName.trim(), lastName: lastName.trim(), accessCode: code });
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("common.error"));
    } finally {
      setSending(false);
    }
  }

  if (!token || info.data?.valid === false) {
    return <div className="community-form-page"><div className="community-card"><h1>{t("register.title")}</h1><p className="community-error">{t("register.invalid")}</p><Link to="/" className="btn">{t("nav.home")}</Link></div></div>;
  }
  if (done) {
    return (
      <div className="community-form-page">
        <div className="community-success" role="status">
          <h1>{t("register.success")}</h1>
          <p>{t("register.successLead")}</p>
          <Link to="/" className="btn btn--primary">{t("nav.home")}</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="community-form-page">
      <div><h1>{t("register.title")}</h1><p className="lead">{t("register.lead")}</p></div>
      {info.loading ? <LoadingState label={t("common.loading")} /> : (
        <form className="community-card community-form" onSubmit={(event) => void submit(event)}>
          <div className="field"><label htmlFor="reg-name">{t("form.name")} *</label><input id="reg-name" required minLength={2} maxLength={80} autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="reg-first">{t("form.firstName")} *</label><input id="reg-first" required maxLength={80} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
          <div className="field"><label htmlFor="reg-last">{t("form.lastName")} *</label><input id="reg-last" required maxLength={80} value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
          <div className="field"><label htmlFor="reg-code">{t("form.accessCode")} *</label><input id="reg-code" type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={code} onChange={(e) => setCode(e.target.value)} /><span className="community-muted">{t("form.passwordHint")}</span></div>
          <div className="field"><label htmlFor="reg-confirm">{t("form.confirm")} *</label><input id="reg-confirm" type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          {error ? <p className="community-error span-2" role="alert">{error}</p> : null}
          <div className="span-2"><button type="submit" className="btn btn--primary" disabled={sending}>{sending ? t("common.loading") : t("register.submit")}</button></div>
        </form>
      )}
    </div>
  );
}
