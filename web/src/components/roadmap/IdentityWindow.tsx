// CRV · Ventana 3.10 «Identidad y compartir» (B9 · C9).
//
// Cómo se ve el proyecto fuera de aquí: favicon e imagen al compartir,
// metadatos, contexto, redes y donación. Todo se guarda en
// `auth.projects.branding_json` y la portada lo publica (CP0).
import { useEffect, useState } from "react";
import { ArrowSquareOut, FloppyDisk, ImageSquare, Trash } from "@phosphor-icons/react";
import { assetUrl, identityApi, str, type AssetKind, type IdentityData } from "../../lib/identity";
import { useToast } from "../../lib/ToastContext";
import { Modal } from "../Modal";
import { ConfirmDialog } from "../ConfirmDialog";

type Tab = "vista" | "imagenes" | "metadatos" | "contexto" | "redes" | "donacion";

const TABS: Array<[Tab, string]> = [
  ["vista", "Vista previa"], ["imagenes", "Imágenes"], ["metadatos", "Metadatos"],
  ["contexto", "Contexto"], ["redes", "Redes"], ["donacion", "Donación"],
];

const META_KEYS: Array<[string, string, number]> = [
  ["metaTitle", "Título de la página", 60], ["metaDescription", "Descripción", 160],
  ["keywords", "Palabras clave", 200], ["imageAlt", "Texto alternativo de la imagen", 160],
];

const CONTEXT_KEYS: Array<[string, string]> = [
  ["aboutTitle", "Título de presentación"], ["aboutDescription", "Descripción del proyecto"],
  ["aboutStatus", "Estado actual"], ["aboutScope", "Alcance"],
  ["aboutSourceUrl", "Fuente o cobertura externa"], ["aboutSourceLabel", "Texto del enlace"],
  ["faqTitle", "Título de preguntas frecuentes"],
  ["faq1Question", "Pregunta 1"], ["faq1Answer", "Respuesta 1"],
  ["faq2Question", "Pregunta 2"], ["faq2Answer", "Respuesta 2"],
  ["faq3Question", "Pregunta 3"], ["faq3Answer", "Respuesta 3"],
  ["faq4Question", "Pregunta 4"], ["faq4Answer", "Respuesta 4"],
];

const SOCIAL_PLATFORMS = ["instagram", "youtube", "facebook", "x", "tiktok", "bandcamp", "soundcloud", "web", "email", "whatsapp"];
const DONATION_PLATFORMS = ["bandcamp", "patreon", "buymeacoffee", "kofi", "paypal", "link"];

interface SocialRow { platform: string; label: string; url: string }

export function IdentityWindow({ title, kicker, onClose, onSaved }: {
  title: string; kicker: string; onClose: () => void; onSaved: () => void;
}) {
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>("vista");
  const [data, setData] = useState<IdentityData | null>(null);
  const [branding, setBranding] = useState<Record<string, string>>({});
  const [social, setSocial] = useState<SocialRow[]>([]);
  const [donation, setDonation] = useState<{ enabled: boolean; platform: string; label: string; url: string; note: string }>({
    enabled: false, platform: "buymeacoffee", label: "", url: "", note: "",
  });
  const [allowIndexing, setAllowIndexing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quitar, setQuitar] = useState<AssetKind | null>(null);

  function cargar(identity: IdentityData): void {
    setData(identity);
    const values: Record<string, string> = {};
    for (const key of [...META_KEYS.map(([key]) => key), ...CONTEXT_KEYS.map(([key]) => key)]) {
      values[key] = str(identity.branding, key, str(identity.brandingDefaults, key));
    }
    values["twitterCard"] = str(identity.branding, "twitterCard", "summary_large_image");
    values["twitterSite"] = str(identity.branding, "twitterSite");
    values["siteUrl"] = str(identity.branding, "siteUrl");
    values["supportKicker"] = str(identity.branding, "supportKicker", str(identity.brandingDefaults, "supportKicker"));
    values["supportTitle"] = str(identity.branding, "supportTitle", str(identity.brandingDefaults, "supportTitle"));
    values["supportSub"] = str(identity.branding, "supportSub", str(identity.brandingDefaults, "supportSub"));
    setBranding(values);
    setAllowIndexing(identity.branding["allowIndexing"] === true);
    const links = Array.isArray(identity.branding["socialLinks"]) ? identity.branding["socialLinks"] as Array<Record<string, unknown>> : [];
    setSocial(links.map((link) => ({
      platform: String(link["platform"] ?? "web"), label: String(link["label"] ?? ""), url: String(link["url"] ?? ""),
    })));
    const don = (identity.branding["donation"] ?? {}) as Record<string, unknown>;
    setDonation({
      enabled: don["enabled"] === true,
      platform: String(don["platform"] ?? "buymeacoffee"),
      label: String(don["label"] ?? "Apoya el proyecto"),
      url: String(don["url"] ?? ""),
      note: String(don["note"] ?? ""),
    });
  }

  useEffect(() => {
    void identityApi.get().then(cargar).catch((error: unknown) => {
      notify("error", error instanceof Error ? error.message : "No se pudo cargar la identidad.");
    });
  }, [notify]);

  const set = (key: string, value: string) => setBranding((previous) => ({ ...previous, [key]: value }));

  async function guardar(): Promise<void> {
    setBusy(true);
    try {
      const updated = await identityApi.saveBranding({
        ...branding,
        allowIndexing,
        socialLinks: social.filter((row) => row.platform && row.url.trim()),
        donation,
      });
      cargar(updated);
      notify("success", "Identidad guardada. La portada la aplica en menos de un minuto.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar la identidad.");
    } finally {
      setBusy(false);
    }
  }

  async function subir(kind: AssetKind, file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      const updated = await identityApi.uploadAsset(kind, file);
      cargar(updated);
      notify("success", kind === "favicon" ? "Favicon actualizado." : "Imagen para compartir actualizada.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo subir la imagen.");
    } finally {
      setBusy(false);
    }
  }

  async function borrarImagen(): Promise<void> {
    if (!quitar) return;
    const kind = quitar;
    setQuitar(null);
    setBusy(true);
    try {
      const updated = await identityApi.deleteAsset(kind);
      cargar(updated);
      notify("success", "Imagen retirada.");
      onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo retirar la imagen.");
    } finally {
      setBusy(false);
    }
  }

  const favicon = data ? assetUrl("favicon", data.assets.favicon) : null;
  const share = data ? assetUrl("share_image", data.assets.share_image) : null;
  const dominio = (() => {
    try { return new URL(branding["siteUrl"] || window.location.origin).hostname; } catch { return window.location.hostname; }
  })();

  return (
    <Modal title={title} kicker={kicker} onClose={onClose} wide panelClassName="roadmap-admin__window">
      <div className="rw-window">
        <div className="rw-window__bar">
          <div className="rw-tabs" role="tablist" aria-label="Secciones de la identidad">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          <a className="btn btn--sm" href="/roadmap" target="_blank" rel="noreferrer">
            <ArrowSquareOut size={14} aria-hidden="true" /> Ver la portada
          </a>
        </div>

        {tab === "vista" ? (
          <>
            <div className="rw-share">
              <div className="rw-share__card">
                {share ? <img src={share} alt="" className="rw-share__image" /> : <div className="rw-share__placeholder">Sin imagen para compartir</div>}
                <div className="rw-share__text">
                  <small>{dominio}</small>
                  <strong>{branding["ogTitle"] || branding["metaTitle"] || "Coleccionistas de Rock Venezolano"}</strong>
                  <span>{branding["ogDescription"] || branding["metaDescription"] || "El archivo del rock venezolano."}</span>
                </div>
              </div>
              <div className="rw-share__tab">
                {favicon ? <img src={favicon} alt="" width={16} height={16} /> : <span className="rw-share__dot" aria-hidden="true" />}
                <span>{branding["metaTitle"] || "Coleccionistas de Rock Venezolano"}</span>
              </div>
              <p className="rw-note">Así se ve el enlace al compartirlo en X, Facebook, LinkedIn y mensajería.</p>
            </div>
          </>
        ) : null}

        {tab === "imagenes" ? (
          <div className="rw-images">
            {([["favicon", "Favicon", data?.assets.favicon ?? null], ["share_image", "Imagen para compartir", data?.assets.share_image ?? null]] as const).map(([kind, label, asset]) => (
              <section className="rw-block" key={kind} aria-label={label}>
                <h3>{label.toUpperCase()}</h3>
                <div className="rw-images__row">
                  {asset ? <img src={assetUrl(kind, asset) ?? ""} alt="" className="rw-images__preview" /> : <span className="community-muted">Sin imagen</span>}
                  <label className="btn btn--sm">
                    <ImageSquare size={14} aria-hidden="true" /> Elegir imagen
                    <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy}
                      onChange={(event) => void subir(kind, event.target.files?.[0])} />
                  </label>
                  <button type="button" className="btn btn--sm" disabled={busy || !asset} onClick={() => setQuitar(kind)}>
                    <Trash size={14} aria-hidden="true" /> Quitar
                  </button>
                </div>
                <p className="rw-note">
                  {kind === "favicon" ? "PNG, JPG o WebP cuadrado; se usa en la pestaña del navegador." : "1200×630 px recomendado para la tarjeta al compartir."} Máximo 2 MB.
                </p>
              </section>
            ))}
          </div>
        ) : null}

        {tab === "metadatos" ? (
          <section className="rw-block" aria-label="METADATOS">
            <h3>METADATOS</h3>
            <div className="rw-textgrid">
              {META_KEYS.map(([key, label, max]) => (
                <label className="rw-field" key={key}>
                  <span>{label} <em className="rw-count">{branding[key]?.length ?? 0}/{max}</em></span>
                  <input value={branding[key] ?? ""} maxLength={max} onChange={(event) => set(key, event.target.value)} />
                </label>
              ))}
              <label className="rw-field"><span>URL pública</span>
                <input value={branding["siteUrl"] ?? ""} placeholder="https://…" onChange={(event) => set("siteUrl", event.target.value)} /></label>
              <label className="rw-field"><span>Cuenta de X</span>
                <input value={branding["twitterSite"] ?? ""} placeholder="@cuenta" onChange={(event) => set("twitterSite", event.target.value)} /></label>
              <label className="rw-field"><span>Tipo de tarjeta en X</span>
                <select value={branding["twitterCard"] ?? "summary_large_image"} onChange={(event) => set("twitterCard", event.target.value)}>
                  <option value="summary_large_image">Imagen grande</option>
                  <option value="summary">Resumen</option>
                </select></label>
              <label className="rw-check rw-check--line">
                <input type="checkbox" checked={allowIndexing} onChange={(event) => setAllowIndexing(event.target.checked)} />
                <span>Permitir que los buscadores indexen la página pública</span>
              </label>
            </div>
          </section>
        ) : null}

        {tab === "contexto" ? (
          <section className="rw-block" aria-label="CONTEXTO">
            <h3>CONTEXTO</h3>
            <div className="rw-textgrid">
              {CONTEXT_KEYS.map(([key, label]) => (
                <label className={`rw-field${key.startsWith("faq") || key === "aboutDescription" ? " rw-field--wide" : ""}`} key={key}>
                  <span>{label}</span>
                  <input value={branding[key] ?? ""} maxLength={700} onChange={(event) => set(key, event.target.value)} />
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {tab === "redes" ? (
          <section className="rw-block" aria-label="REDES">
            <h3>REDES</h3>
            <div className="rw-textgrid">
              <label className="rw-field"><span>Antetítulo</span>
                <input value={branding["supportKicker"] ?? ""} onChange={(event) => set("supportKicker", event.target.value)} /></label>
              <label className="rw-field"><span>Título</span>
                <input value={branding["supportTitle"] ?? ""} onChange={(event) => set("supportTitle", event.target.value)} /></label>
              <label className="rw-field rw-field--wide"><span>Texto de la sección</span>
                <input value={branding["supportSub"] ?? ""} onChange={(event) => set("supportSub", event.target.value)} /></label>
            </div>
            <div className="rw-rows">
              {social.map((row, index) => (
                <div className="rw-socialrow" key={`social-${index}`}>
                  <select aria-label={`Plataforma ${index + 1}`} value={row.platform}
                    onChange={(event) => setSocial(social.map((item, position) => position === index ? { ...item, platform: event.target.value } : item))}>
                    {SOCIAL_PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
                  </select>
                  <input placeholder="Etiqueta" aria-label={`Etiqueta ${index + 1}`} value={row.label}
                    onChange={(event) => setSocial(social.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} />
                  <input placeholder="https://…" aria-label={`URL ${index + 1}`} value={row.url}
                    onChange={(event) => setSocial(social.map((item, position) => position === index ? { ...item, url: event.target.value } : item))} />
                  <button type="button" className="btn btn--sm" aria-label={`Quitar red ${index + 1}`}
                    onClick={() => setSocial(social.filter((_, position) => position !== index))}>
                    <Trash size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn--sm" onClick={() => setSocial([...social, { platform: "instagram", label: "", url: "" }])}>
              + Añadir red
            </button>
          </section>
        ) : null}

        {tab === "donacion" ? (
          <section className="rw-block" aria-label="DONACIÓN">
            <h3>DONACIÓN</h3>
            <label className="rw-check rw-check--line">
              <input type="checkbox" checked={donation.enabled}
                onChange={(event) => setDonation({ ...donation, enabled: event.target.checked })} />
              <span>Mostrar el botón de donación en el roadmap público</span>
            </label>
            <div className="rw-textgrid">
              <label className="rw-field"><span>Plataforma</span>
                <select value={donation.platform} onChange={(event) => setDonation({ ...donation, platform: event.target.value })}>
                  {DONATION_PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
                </select></label>
              <label className="rw-field"><span>Texto del botón</span>
                <input value={donation.label} maxLength={120} onChange={(event) => setDonation({ ...donation, label: event.target.value })} /></label>
              <label className="rw-field rw-field--wide"><span>Enlace</span>
                <input value={donation.url} placeholder="https://…" onChange={(event) => setDonation({ ...donation, url: event.target.value })} /></label>
              <label className="rw-field rw-field--wide"><span>Nota</span>
                <input value={donation.note} maxLength={300} onChange={(event) => setDonation({ ...donation, note: event.target.value })} /></label>
            </div>
            {donation.enabled ? (
              <span className="btn btn--primary rw-donation-preview">{donation.label || "Apoya el proyecto"}</span>
            ) : null}
          </section>
        ) : null}

        <div className="rw-foot">
          <button type="button" className="btn btn--primary" onClick={() => void guardar()} disabled={busy || !data}>
            <FloppyDisk size={15} aria-hidden="true" /> {busy ? "Guardando…" : "Guardar identidad"}
          </button>
          <span className="community-muted">Los cambios llegan a la portada pública en menos de un minuto.</span>
        </div>
      </div>

      {quitar ? (
        <ConfirmDialog
          title={quitar === "favicon" ? "Quitar el favicon" : "Quitar la imagen para compartir"}
          description="La portada dejará de mostrar esta imagen. Podrás subir otra cuando quieras."
          confirmLabel="Quitar imagen"
          danger
          requireNote={false}
          onClose={() => setQuitar(null)}
          onConfirm={() => void borrarImagen()}
        />
      ) : null}
    </Modal>
  );
}
