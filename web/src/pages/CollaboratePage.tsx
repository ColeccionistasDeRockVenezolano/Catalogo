// CRV · /colaborar — formulario público de candidatura (Fase 1).
import { useEffect, useState, type FormEvent } from "react";
import { communityApi, type ApplicationInput, type FormOptions } from "../lib/community";
import { useAsync } from "../lib/useAsync";
import { useI18n } from "../lib/i18n";
import { ErrorState, LoadingState } from "../components/StateViews";
import "../styles/community-ui.css";

interface FormState {
  firstName: string; lastName: string; birthDate: string; email: string; phone: string;
  city: string; country: string; contactPreference: "whatsapp" | "email" | "both";
  contributionText: string; experience: string; idea: string; ideaReason: string;
  wantsToImplement: "yes" | "maybe" | "share_only"; availability: string;
  skills: number[]; areas: number[]; links: string[];
}

const EMPTY: FormState = {
  firstName: "", lastName: "", birthDate: "", email: "", phone: "", city: "", country: "",
  contactPreference: "whatsapp", contributionText: "", experience: "", idea: "", ideaReason: "",
  wantsToImplement: "maybe", availability: "", skills: [], areas: [], links: [""],
};

export function CollaboratePage() {
  const { t } = useI18n();
  const pageTitle = t("form.title");
  useEffect(() => {
    const previous = document.title;
    document.title = `${pageTitle} · CRV`;
    return () => { document.title = previous; };
  }, [pageTitle]);
  const options = useAsync<FormOptions>(() => communityApi.formOptions(), []);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setSending(true);
    const body: ApplicationInput = {
      firstName: form.firstName, lastName: form.lastName || undefined,
      birthDate: form.birthDate || undefined, email: form.email || undefined,
      whatsappPhone: form.phone || undefined, city: form.city || undefined,
      country: form.country || undefined, contactPreference: form.contactPreference,
      contributionText: form.contributionText || undefined, experience: form.experience || undefined,
      idea: form.idea || undefined, ideaReason: form.ideaReason || undefined,
      wantsToImplement: form.wantsToImplement, availability: form.availability || undefined,
      skillIds: form.skills, areaIds: form.areas,
      links: form.links.filter((url) => url.trim()).map((url) => ({ type: "web", url: url.trim() })),
    };
    try {
      await communityApi.apply(body);
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("common.error"));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="community-form-page">
        <div className="community-success" role="status">
          <h1>{t("form.success")}</h1>
          <p>{t("form.successLead")}</p>
          <a href={`${import.meta.env.BASE_URL}roadmap`} className="btn btn--primary">{t("nav.roadmap")}</a>
        </div>
      </div>
    );
  }

  return (
    <div className="community-form-page">
      <div>
        <h1>{t("form.title")}</h1>
        <p className="lead">{t("form.lead")}</p>
      </div>
      {options.loading ? <LoadingState label={t("common.loading")} /> : options.error ? (
        <ErrorState message={options.error} onRetry={() => void options.reload()} />
      ) : (
        <form className="community-card community-form" onSubmit={(event) => void submit(event)}>
          <div className="field"><label htmlFor="f-first">{t("form.firstName")} *</label><input id="f-first" required maxLength={80} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-last">{t("form.lastName")}</label><input id="f-last" maxLength={80} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-birth">{t("form.birthDate")}</label><input id="f-birth" type="date" value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-email">{t("form.email")}</label><input id="f-email" type="email" maxLength={200} value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-phone">{t("form.phone")}</label><input id="f-phone" maxLength={200} value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-city">{t("form.city")}</label><input id="f-city" maxLength={200} value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-country">{t("form.country")}</label><input id="f-country" maxLength={200} value={form.country} onChange={(e) => set("country", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-pref">{t("form.contactPreference")}</label>
            <select id="f-pref" value={form.contactPreference} onChange={(e) => set("contactPreference", e.target.value as FormState["contactPreference"])}>
              <option value="whatsapp">{t("form.whatsapp")}</option>
              <option value="email">{t("form.emailPref")}</option>
              <option value="both">{t("form.both")}</option>
            </select>
          </div>
          <div className="field span-2"><label htmlFor="f-contribution">{t("form.contribution")} *</label><textarea id="f-contribution" required value={form.contributionText} onChange={(e) => set("contributionText", e.target.value)} /></div>
          <div className="field span-2"><label htmlFor="f-experience">{t("form.experience")}</label><textarea id="f-experience" value={form.experience} onChange={(e) => set("experience", e.target.value)} /></div>
          <div className="field span-2"><label htmlFor="f-idea">{t("form.idea")}</label><textarea id="f-idea" value={form.idea} onChange={(e) => set("idea", e.target.value)} /></div>
          <div className="field span-2"><label htmlFor="f-reason">{t("form.ideaReason")}</label><textarea id="f-reason" value={form.ideaReason} onChange={(e) => set("ideaReason", e.target.value)} /></div>
          <div className="field"><label htmlFor="f-wants">{t("form.wants")}</label>
            <select id="f-wants" value={form.wantsToImplement} onChange={(e) => set("wantsToImplement", e.target.value as FormState["wantsToImplement"])}>
              <option value="yes">{t("form.yes")}</option>
              <option value="maybe">{t("form.maybe")}</option>
              <option value="share_only">{t("form.shareOnly")}</option>
            </select>
          </div>
          <div className="field"><label htmlFor="f-availability">{t("form.availability")}</label><input id="f-availability" maxLength={200} value={form.availability} onChange={(e) => set("availability", e.target.value)} /></div>
          <fieldset className="field span-2">
            <legend>{t("form.skills")}</legend>
            <div className="community-checkboxes">
              {options.data?.skills.map((option) => (
                <label key={option.id}><input type="checkbox" checked={form.skills.includes(option.id)} onChange={(e) => set("skills", e.target.checked ? [...form.skills, option.id] : form.skills.filter((id) => id !== option.id))} />{option.label}</label>
              ))}
            </div>
          </fieldset>
          <fieldset className="field span-2">
            <legend>{t("form.areas")}</legend>
            <div className="community-checkboxes">
              {options.data?.areas.map((option) => (
                <label key={option.id}><input type="checkbox" checked={form.areas.includes(option.id)} onChange={(e) => set("areas", e.target.checked ? [...form.areas, option.id] : form.areas.filter((id) => id !== option.id))} />{option.label}</label>
              ))}
            </div>
          </fieldset>
          <fieldset className="field span-2">
            <legend>{t("form.links")}</legend>
            {form.links.map((url, index) => (
              <div key={index} className="community-actions" style={{ marginBottom: 8 }}>
                <input aria-label={`${t("form.linkUrl")} ${index + 1}`} placeholder={t("form.linkUrl")} value={url} onChange={(e) => set("links", form.links.map((item, i) => i === index ? e.target.value : item))} />
                {form.links.length > 1 ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => set("links", form.links.filter((_, i) => i !== index))}>{t("common.cancel")}</button> : null}
              </div>
            ))}
            {form.links.length < 3 ? <button type="button" className="btn btn--sm" onClick={() => set("links", [...form.links, ""])}>{t("form.addLink")}</button> : null}
          </fieldset>
          {error ? <p className="community-error span-2" role="alert">{error}</p> : null}
          <div className="span-2 community-actions">
            <button type="submit" className="btn btn--primary" disabled={sending}>{sending ? t("form.sending") : t("form.submit")}</button>
            <span className="community-muted">{t("form.passwordHint")}</span>
          </div>
        </form>
      )}
    </div>
  );
}
