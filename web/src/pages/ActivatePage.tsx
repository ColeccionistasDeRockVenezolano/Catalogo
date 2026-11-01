// CRV · /activar — enlace de un solo uso para una colaboración aceptada.
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { communityApi } from "../lib/community";
import { useAsync } from "../lib/useAsync";
import { useI18n } from "../lib/i18n";
import { LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";

export function ActivatePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const info = useAsync(
    () => token ? communityApi.activationInfo(token) : Promise.resolve({ valid: false, name: null, firstName: null, lastName: null, expiresAt: null }),
    [token]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (info.data?.name) setName((current) => current || info.data!.name!);
  }, [info.data]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    if (code !== confirm) { setError("Las claves no coinciden."); return; }
    setSending(true);
    try {
      await communityApi.activate({ token, name: name.trim(), accessCode: code });
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("common.error"));
    } finally {
      setSending(false);
    }
  }

  if (!token || info.data?.valid === false) {
    return <div className="community-form-page"><div className="community-card"><h1>{t("activate.title")}</h1><p className="community-error">{t("activate.invalid")}</p><Link to="/" className="btn">{t("nav.home")}</Link></div></div>;
  }
  if (done) {
    return (
      <div className="community-form-page">
        <div className="community-success" role="status">
          <h1>{t("activate.success")}</h1>
          <p>{t("activate.successLead")}</p>
          <Link to="/cuenta" className="btn btn--primary">{t("activate.goLogin")}</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="community-form-page">
      <div><h1>{t("activate.title")}</h1><p className="lead">{t("activate.lead")}</p></div>
      {info.loading ? <LoadingState label={t("common.loading")} /> : (
        <form className="community-card community-form" onSubmit={(event) => void submit(event)}>
          <div className="field"><label htmlFor="act-name">{t("activate.username")} *</label><input id="act-name" required minLength={2} maxLength={80} autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="act-code">{t("activate.accessCode")} *</label><input id="act-code" type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={code} onChange={(e) => setCode(e.target.value)} /><span className="community-muted">{t("form.passwordHint")}</span></div>
          <div className="field"><label htmlFor="act-confirm">{t("activate.confirm")} *</label><input id="act-confirm" type="password" required minLength={12} maxLength={200} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          {error ? <p className="community-error span-2" role="alert">{error}</p> : null}
          <div className="span-2"><button type="submit" className="btn btn--primary" disabled={sending}>{sending ? t("common.loading") : t("activate.submit")}</button></div>
        </form>
      )}
    </div>
  );
}
