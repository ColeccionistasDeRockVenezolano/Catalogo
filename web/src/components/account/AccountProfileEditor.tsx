// CRV · «Mi perfil» (sección 4 de las instrucciones del admin).
//
// Es la página /cuenta de Herra dentro del catálogo: cabecera con avatar y la
// línea «Sesión: usuario en proyecto · Persona #N · Colaborador #N», el aviso
// de perfil incompleto, datos personales, perfil de colaboración con chips,
// enlaces con visibilidad, visibilidad del perfil, contraseña y un pie fijo
// con «Volver al roadmap» y «Guardar cambios».
//
// El servidor resuelve la persona desde la sesión: aquí no se elige a quién se
// edita.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FloppyDisk, Plus, Trash } from "@phosphor-icons/react";
import { accountApi, type GapKey, type OwnLink, type OwnProfile } from "../../lib/account";
import { ApiError } from "../../lib/api";
import { useI18n, type I18nKey } from "../../lib/i18n";
import { useToast } from "../../lib/ToastContext";
import { RowsSkeleton } from "../Skeletons";
import "../../styles/account-profile.css";

interface LinkDraft {
  type: string;
  label: string;
  url: string;
  isPublic: boolean;
}

interface FormState {
  firstName: string;
  lastName: string;
  birthDate: string;
  whatsappPhone: string;
  email: string;
  contactPreference: "whatsapp" | "email" | "both";
  city: string;
  country: string;
  bio: string;
  experience: string;
  availability: string;
  profileVisibility: "private" | "public";
  termIds: number[];
  links: LinkDraft[];
}

const GAP_LABELS: Record<GapKey, I18nKey> = {
  age: "account.gap.age",
  whatsapp: "account.gap.whatsapp",
  experience: "account.gap.experience",
  categories: "account.gap.categories",
  links: "account.gap.links",
};

function toForm(profile: OwnProfile): FormState {
  const person = profile.person;
  const links: LinkDraft[] = profile.links.map((link: OwnLink) => ({
    type: link.type, label: link.label ?? "", url: link.url, isPublic: link.is_public,
  }));
  // Herra ofrece siempre dos filas libres (mínimo tres) para no obligar a
  // pulsar «Añadir» antes de escribir.
  while (links.length < 3) links.push({ type: "", label: "", url: "", isPublic: false });
  return {
    firstName: profile.account.first_name || profile.account.name.split(" ")[0] || "",
    lastName: profile.account.last_name || profile.account.name.split(" ").slice(1).join(" "),
    birthDate: person?.birth_date ?? "",
    whatsappPhone: person?.whatsapp_phone ?? "",
    email: person?.email ?? "",
    contactPreference: person?.contact_preference ?? "whatsapp",
    city: person?.city ?? "",
    country: person?.country ?? "",
    bio: person?.bio ?? "",
    experience: person?.experience ?? "",
    availability: person?.availability ?? "",
    profileVisibility: person?.profile_visibility ?? "private",
    termIds: [...profile.termIds],
    links,
  };
}

function initials(profile: OwnProfile): string {
  const parts = `${profile.account.first_name} ${profile.account.last_name}`.trim().split(/\s+/u).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return letters || profile.account.username.slice(0, 2).toUpperCase();
}

export function AccountProfileEditor() {
  const { t } = useI18n();
  const { notify } = useToast();
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentCode, setCurrentCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [repeatCode, setRepeatCode] = useState("");

  useEffect(() => {
    let active = true;
    void accountApi.profile()
      .then((data) => {
        if (!active) return;
        setProfile(data);
        setForm(toForm(data));
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : t("account.loadError"));
      });
    return () => { active = false; };
  }, [t]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => (previous ? { ...previous, [key]: value } : previous));
  };

  const suggestions = useMemo(() => profile?.catalog ?? { skills: [], areas: [], linkTypes: [] }, [profile]);

  function toggleTerm(id: number): void {
    if (!form) return;
    set("termIds", form.termIds.includes(id) ? form.termIds.filter((value) => value !== id) : [...form.termIds, id]);
  }

  function setLink(index: number, patch: Partial<LinkDraft>): void {
    if (!form) return;
    set("links", form.links.map((link, position) => (position === index ? { ...link, ...patch } : link)));
  }

  async function save(): Promise<void> {
    if (!form) return;
    const wantsPassword = currentCode !== "" || newCode !== "" || repeatCode !== "";
    if (wantsPassword) {
      if (!currentCode) { notify("error", t("account.currentRequired")); return; }
      if (newCode !== repeatCode) { notify("error", t("account.passwordMismatch")); return; }
    }
    setSaving(true);
    try {
      let changedPassword = false;
      if (wantsPassword) {
        await accountApi.password({
          currentAccessCode: currentCode, newAccessCode: newCode, newAccessCodeConfirm: repeatCode,
        });
        changedPassword = true;
        setCurrentCode(""); setNewCode(""); setRepeatCode("");
      }
      const updated = await accountApi.save({
        firstName: form.firstName,
        lastName: form.lastName,
        birthDate: form.birthDate,
        whatsappPhone: form.whatsappPhone,
        email: form.email,
        city: form.city,
        country: form.country,
        bio: form.bio,
        experience: form.experience,
        availability: form.availability,
        contactPreference: form.contactPreference,
        profileVisibility: form.profileVisibility,
        termIds: form.termIds,
        links: form.links
          .filter((link) => link.url.trim() !== "")
          .map((link) => ({
            ...(link.type ? { type: link.type } : {}),
            ...(link.label ? { label: link.label } : {}),
            url: link.url.trim(),
            isPublic: link.isPublic,
          })),
      });
      setProfile(updated);
      setForm(toForm(updated));
      notify("success", changedPassword ? t("account.savedPassword") : t("account.saved"));
    } catch (error) {
      notify("error", error instanceof ApiError || error instanceof Error ? error.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="account-profile">
        <p className="community-error" role="alert">{loadError}</p>
      </div>
    );
  }
  if (!profile || !form) {
    return <div className="account-profile"><RowsSkeleton rows={4} label={t("common.loading")} /></div>;
  }

  const person = profile.person;
  const gaps = profile.gaps.map((key) => t(GAP_LABELS[key]));

  return (
    <div className="account-profile">
      <header className="account-profile__head">
        <span className="account-profile__avatar" aria-hidden="true">{initials(profile)}</span>
        <div className="account-profile__headtext">
          <h1>{t("account.title")}</h1>
          <p className="account-profile__session">
            {t("account.signedIn")}: {profile.account.username} {t("account.inProject")} {profile.project.name}
            {profile.account.person_id !== null ? (
              <> · {t("account.persona")} #{profile.account.person_id}</>
            ) : null}
            {profile.account.user_id !== null ? (
              <> · {t("account.collaborator")} #{profile.account.user_id}</>
            ) : null}
          </p>
          {gaps.length > 0 ? (
            <p className="account-profile__gaps" role="status">
              {t("account.incomplete")}: {gaps.join(" · ")}
            </p>
          ) : (
            <p className="account-profile__complete" role="status">{t("account.complete")}</p>
          )}
        </div>
      </header>

      {person === null ? <p className="account-profile__note">{t("account.noPerson")}</p> : (
        <>
          <section className="account-profile__section" aria-labelledby="acc-personal">
            <h2 id="acc-personal">{t("account.personalData")}</h2>
            <div className="account-profile__grid">
              <div className="field">
                <label htmlFor="acc-first">{t("form.firstName")} *</label>
                <input id="acc-first" required maxLength={80} autoComplete="given-name"
                  value={form.firstName} onChange={(event) => set("firstName", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="acc-last">{t("form.lastName")} *</label>
                <input id="acc-last" required maxLength={80} autoComplete="family-name"
                  value={form.lastName} onChange={(event) => set("lastName", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="acc-birth">{t("form.birthDate")}</label>
                <input id="acc-birth" type="date" value={form.birthDate}
                  onChange={(event) => set("birthDate", event.target.value)} />
                <small className="account-profile__help">{t("account.birthDateHelp")}</small>
              </div>
              <div className="field">
                <label htmlFor="acc-phone">{t("form.phone")}</label>
                <input id="acc-phone" type="tel" maxLength={120} autoComplete="tel" value={form.whatsappPhone}
                  onChange={(event) => set("whatsappPhone", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="acc-email">{t("form.email")}</label>
                <input id="acc-email" type="email" maxLength={120} autoComplete="email" value={form.email}
                  onChange={(event) => set("email", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="acc-prefer">{t("form.contactPreference")}</label>
                <select id="acc-prefer" value={form.contactPreference}
                  onChange={(event) => set("contactPreference", event.target.value as FormState["contactPreference"])}>
                  <option value="whatsapp">{t("form.whatsapp")}</option>
                  <option value="email">{t("form.emailPref")}</option>
                  <option value="both">{t("form.both")}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="acc-city">{t("form.city")}</label>
                <input id="acc-city" maxLength={200} value={form.city}
                  onChange={(event) => set("city", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="acc-country">{t("form.country")}</label>
                <input id="acc-country" maxLength={200} value={form.country}
                  onChange={(event) => set("country", event.target.value)} />
              </div>
            </div>
          </section>

          <section className="account-profile__section" aria-labelledby="acc-collab">
            <h2 id="acc-collab">{t("account.collabProfile")}</h2>
            <div className="account-profile__grid">
              <div className="field account-profile__wide">
                <label htmlFor="acc-bio">{t("account.bio")}</label>
                <textarea id="acc-bio" rows={4} maxLength={2000} value={form.bio}
                  onChange={(event) => set("bio", event.target.value)} />
                <small className="account-profile__help">{t("account.bioHelp")}</small>
              </div>
              <div className="field account-profile__wide">
                <label htmlFor="acc-experience">{t("form.experience")}</label>
                <textarea id="acc-experience" rows={4} maxLength={2000} value={form.experience}
                  onChange={(event) => set("experience", event.target.value)} />
              </div>
              <div className="field account-profile__wide">
                <label htmlFor="acc-availability">{t("account.availability")}</label>
                <input id="acc-availability" maxLength={200} placeholder={t("account.availabilityPlaceholder")}
                  value={form.availability} onChange={(event) => set("availability", event.target.value)} />
              </div>
            </div>
            <div className="account-profile__chips">
              <span className="account-profile__chiplabel">{t("account.skills")}</span>
              <div className="account-profile__chiprow">
                {suggestions.skills.map((term) => (
                  <label key={`skill-${term.id}`} className={`account-chip${form.termIds.includes(term.id) ? " is-on" : ""}`}>
                    <input type="checkbox" checked={form.termIds.includes(term.id)} onChange={() => toggleTerm(term.id)} />
                    <span>{term.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="account-profile__chips">
              <span className="account-profile__chiplabel">{t("account.areas")}</span>
              <div className="account-profile__chiprow">
                {suggestions.areas.map((term) => (
                  <label key={`area-${term.id}`} className={`account-chip${form.termIds.includes(term.id) ? " is-on" : ""}`}>
                    <input type="checkbox" checked={form.termIds.includes(term.id)} onChange={() => toggleTerm(term.id)} />
                    <span>{term.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="account-profile__section" aria-labelledby="acc-links">
            <h2 id="acc-links">{t("account.myLinks")}</h2>
            <p className="account-profile__help">{t("account.linksHelp")}</p>
            <div className="account-profile__links">
              {form.links.map((link, index) => (
                <div className="account-link" key={`link-${index}`}>
                  <select aria-label={`${t("account.linkType")} ${index + 1}`} value={link.type}
                    onChange={(event) => setLink(index, { type: event.target.value })}>
                    <option value="">{t("account.linkType")}</option>
                    {suggestions.linkTypes.map((term) => (
                      <option key={term.id} value={term.slug}>{term.label}</option>
                    ))}
                  </select>
                  <input type="url" maxLength={500} placeholder="https://…" aria-label={`${t("account.linkUrl")} ${index + 1}`}
                    value={link.url} onChange={(event) => setLink(index, { url: event.target.value })} />
                  <input maxLength={120} placeholder={t("account.linkLabel")} aria-label={`${t("account.linkLabel")} ${index + 1}`}
                    value={link.label} onChange={(event) => setLink(index, { label: event.target.value })} />
                  <label className="account-link__public">
                    <input type="checkbox" checked={link.isPublic}
                      onChange={(event) => setLink(index, { isPublic: event.target.checked })} />
                    <span>{t("account.public")}</span>
                  </label>
                  <button type="button" className="account-link__remove" title={t("account.removeLink")}
                    aria-label={t("account.removeLink")} disabled={form.links.length <= 1}
                    onClick={() => set("links", form.links.filter((_, position) => position !== index))}>
                    <Trash size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            {form.links.length < 10 ? (
              <button type="button" className="btn btn--sm"
                onClick={() => set("links", [...form.links, { type: "", label: "", url: "", isPublic: false }])}>
                <Plus size={14} aria-hidden="true" /> {t("account.addLink")}
              </button>
            ) : null}
          </section>

          <section className="account-profile__section" aria-labelledby="acc-visibility">
            <h2 id="acc-visibility">{t("account.visibility")}</h2>
            <div className="account-profile__grid">
              <div className="field">
                <label htmlFor="acc-visibility-select">{t("account.publicProfile")}</label>
                <select id="acc-visibility-select" value={form.profileVisibility}
                  onChange={(event) => set("profileVisibility", event.target.value as FormState["profileVisibility"])}>
                  <option value="private">{t("account.visibilityPrivate")}</option>
                  <option value="public">{t("account.visibilityPublic")}</option>
                </select>
                <small className="account-profile__help">{t("account.visibilityHelp")}</small>
              </div>
            </div>
          </section>
        </>
      )}

      <section className="account-profile__section" aria-labelledby="acc-password">
        <h2 id="acc-password">{t("account.password")}</h2>
        <p className="account-profile__help">{t("account.passwordHelp")}</p>
        <div className="account-profile__grid account-profile__grid--thirds">
          <div className="field">
            <label htmlFor="acc-current">{t("account.currentAccessCode")}</label>
            <input id="acc-current" type="password" maxLength={200} autoComplete="current-password"
              value={currentCode} onChange={(event) => setCurrentCode(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="acc-new">{t("account.newAccessCode")}</label>
            <input id="acc-new" type="password" minLength={12} maxLength={200} autoComplete="new-password"
              value={newCode} onChange={(event) => setNewCode(event.target.value)} />
            <small className="account-profile__help">{t("account.newAccessCodeHelp")}</small>
          </div>
          <div className="field">
            <label htmlFor="acc-repeat">{t("account.newAccessCodeRepeat")}</label>
            <input id="acc-repeat" type="password" minLength={12} maxLength={200} autoComplete="new-password"
              value={repeatCode} onChange={(event) => setRepeatCode(event.target.value)} />
          </div>
        </div>
      </section>

      <div className="account-profile__foot">
        <Link to="/roadmap" className="account-profile__back">
          <ArrowLeft size={15} aria-hidden="true" /> {t("account.backToRoadmap")}
        </Link>
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving}>
          <FloppyDisk size={15} aria-hidden="true" /> {saving ? t("account.saving") : t("account.saveChanges")}
        </button>
      </div>
    </div>
  );
}
