import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatEffect } from "../../../../src/chat/protocol";
import { effectProductSchema, effectPublicationSchema, EFFECT_KINDS } from "../../../../src/chat/effects-catalog";
import { DEFAULT_NAME_STYLE, NAME_STYLE_REFERENCES, nameStyleSchema, type NameStyle } from "../../../../src/chat/name-style";
import { chatApi } from "../../lib/api";
import { EffectName, ProductBadge } from "./Effects";
import "../../styles/name-editor.css";

type Product = Pick<ChatEffect, "code" | "name" | "kind" | "description" | "manifest" | "priceCoins" | "priceCredits" | "durationDays" | "sort"> & { enabled: boolean };
const fresh = (): Product => ({ code: "", name: "Nuevo estilo", kind: "name", description: "", manifest: { version: 1, triggers: ["always"], layers: [], nameStyle: { ...DEFAULT_NAME_STYLE }, reducedMotion: "static", cost: 2 }, priceCoins: 0, priceCredits: 0, durationDays: null, sort: 100, enabled: true });
const fromEffect = (effect: ChatEffect): Product => ({ code: effect.code, name: effect.name, kind: effect.kind, description: effect.description, manifest: effect.manifest, priceCoins: effect.priceCoins, priceCredits: effect.priceCredits, durationDays: effect.durationDays, sort: effect.sort, enabled: effect.enabled ?? true });
const KIND_NAMES: Record<string, string> = { name: "Nombre", name_font: "Fuente", badge: "Placa", frame: "Marco", entry: "Entrada", message: "Mensaje", action: "Acción", sticker: "Sticker", background: "Fondo", ambient: "Ambiente" };

export function NameStyleEditor({ onSaved }: { onSaved: () => Promise<void> }) {
  const [catalog, setCatalog] = useState<ChatEffect[]>([]);
  const [product, setProduct] = useState<Product>(fresh);
  const [original, setOriginal] = useState<Product | null>(null);
  const [sample, setSample] = useState("Tu nombre");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [advanced, setAdvanced] = useState("");
  const [history, setHistory] = useState<Product[]>([]);
  const [future, setFuture] = useState<Product[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const load = async () => { const result = await chatApi.adminEffects(); setCatalog(result.effects); };
  useEffect(() => { let cancelled = false; void chatApi.adminEffects().then((result) => { if (!cancelled) setCatalog(result.effects); }).catch((error: unknown) => { if (!cancelled) setStatus(error instanceof Error ? error.message : "No se pudo cargar el catálogo."); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, []);
  function change(next: Product) { setHistory((items) => [...items.slice(-49), product]); setFuture([]); setProduct(next); setStatus(""); }
  function select(next: Product, saved: boolean) { setProduct(next); setOriginal(saved ? next : null); setHistory([]); setFuture([]); setAdvanced(""); setStatus(""); }
  function patch(values: Partial<Product>) { change({ ...product, ...values }); }
  const parsedStyle = nameStyleSchema.safeParse(product.manifest["nameStyle"]);
  const style = parsedStyle.success ? parsedStyle.data : DEFAULT_NAME_STYLE;
  function setStyle<K extends keyof NameStyle>(key: K, value: NameStyle[K]) {
    patch({ manifest: { ...product.manifest, nameStyle: { ...style, [key]: value } } });
  }
  const preview: ChatEffect = { ...product, owned: false, equipped: false };
  const field = (label: string, node: ReactNode) => <label>{label}{node}</label>;
  function numberField(key: keyof NameStyle, label: string, min: number, max: number, step = 1) {
    return field(label, <input type="number" min={min} max={max} step={step} value={Number(style[key])} onChange={(event) => { if (event.target.value !== "" && event.target.validity.valid) setStyle(key, Number(event.target.value)); }} />);
  }
  function angleField(key: "rotation" | "glyphRotation" | "gradientAngle" | "motionAngle" | "shadowAngle", label: string) {
    return <label>{label}<span className="name-editor-angle"><input aria-label={`${label}: deslizador`} type="range" min="0" max="360" value={style[key]} onChange={(event) => setStyle(key, Number(event.target.value))} /><input aria-label={`${label}: grados`} type="number" min="0" max="360" value={style[key]} onChange={(event) => { if (event.target.value !== "" && event.target.validity.valid) setStyle(key, Number(event.target.value)); }} /></span></label>;
  }
  const valid = effectProductSchema.safeParse({ kind: product.kind, manifest: product.manifest });
  const collision = catalog.some((item) => item.code === product.code) && original?.code !== product.code;
  const metadataValid = !collision && /^[a-z0-9-]{2,40}$/u.test(product.code) && product.name.trim().length >= 2 && product.name.trim().length <= 40 && product.description.length <= 160 && [product.priceCoins, product.priceCredits].every((value) => Number.isInteger(value) && value >= 0 && value <= 100000) && Number.isInteger(product.sort) && product.sort >= 0 && product.sort <= 10000 && (product.durationDays === null || (Number.isInteger(product.durationDays) && product.durationDays >= 1 && product.durationDays <= 3650));
  const save = async () => {
    if (busy || !valid.success || !metadataValid) return;
    setBusy(true); setStatus("");
    try {
      await chatApi.publishEffect({ ...product, manifest: valid.data.manifest });
      setOriginal(product);
      try { await Promise.all([load(), onSaved()]); setStatus(product.enabled ? "Guardado. El estilo y sus precios ya están en la tienda." : "Guardado como oculto. Puedes volver a publicarlo desde este editor."); }
      catch { setStatus("Guardado en el servidor. Cierra y abre la tienda para actualizar el catálogo."); }
    } catch (error) { setStatus(error instanceof Error ? error.message : "No se pudo guardar. Tu diseño sigue aquí; vuelve a intentarlo."); }
    finally { setBusy(false); }
  };
  const exportProduct = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(product, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${product.code || "estilo"}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="name-editor" aria-label="Editor de estilos">
    <h3>Editor de estilos</h3>
    <p>Diseña el nombre, pruébalo con mensajes y publica su precio. Las placas se venden y equipan por separado.</p>
    <div className="name-editor-toolbar">
      <button type="button" className="chat-secondary" disabled={busy} onClick={() => select(fresh(), false)}>Nuevo estilo</button>
      <button type="button" className="chat-secondary" disabled={busy} onClick={() => { select({ ...product, code: "", name: `${product.name.slice(0, 33)} copia` }, false); }}>Duplicar</button>
      <button type="button" className="chat-secondary" disabled={busy} onClick={() => void load().then(() => setStatus("Catálogo actualizado.")).catch(() => setStatus("No se pudo actualizar. Vuelve a intentarlo."))}>Actualizar catálogo</button>
    </div>
    {field(loading ? "Cargando catálogo…" : "Editar un producto existente", <select aria-label="Producto existente" disabled={loading || busy} value={original?.code ?? ""} onChange={(event) => { const item = catalog.find((entry) => entry.code === event.target.value); if (item) select(fromEffect(item), true); }}><option value="">Seleccionar producto</option>{catalog.map((item) => <option key={item.code} value={item.code}>{KIND_NAMES[item.kind]} · {item.name}{item.enabled === false ? " (oculto)" : ""}</option>)}</select>)}
    <div className="name-editor-toolbar" role="group" aria-label="Referencias conservadas">
      {NAME_STYLE_REFERENCES.map((reference) => <button type="button" className="chat-secondary" disabled={busy || loading} key={reference.code} onClick={() => {
        const existing = catalog.find((item) => item.code === reference.code && item.kind === "name");
        select(existing ? fromEffect(existing) : { ...fresh(), code: reference.code, name: reference.name, manifest: { ...fresh().manifest, nameStyle: reference.style } }, Boolean(existing)); setSample(reference.sample);
      }}>{reference.name}</button>)}
    </div>
    <div className="name-editor-workspace">
      <div className="name-editor-controls"><fieldset disabled={busy}><legend>Producto y precio</legend><div className="name-editor-fields">
        {field("Nombre en la tienda", <input maxLength={40} value={product.name} onChange={(event) => patch({ name: event.target.value })} />)}
        {field("Código único", <input placeholder="mi-estilo" maxLength={40} disabled={Boolean(original)} value={product.code} onChange={(event) => patch({ code: event.target.value })} />)}
        {field("Tipo de producto", <select value={product.kind} disabled={Boolean(original)} onChange={(event) => { const kind = event.target.value as Product["kind"]; const manifest = { ...product.manifest }; if (kind !== "name") delete manifest["nameStyle"]; patch({ kind, manifest }); }}>{EFFECT_KINDS.map((kind) => <option value={kind} key={kind}>{KIND_NAMES[kind]}</option>)}</select>)}
        {field("Orden en la tienda", <input type="number" min="0" max="10000" value={product.sort} onChange={(event) => patch({ sort: Number(event.target.value) })} />)}
        {field("Precio en monedas", <input type="number" min="0" max="100000" value={product.priceCoins} onChange={(event) => patch({ priceCoins: Number(event.target.value) })} />)}
        {field("Precio en créditos", <input type="number" min="0" max="100000" value={product.priceCredits} onChange={(event) => patch({ priceCredits: Number(event.target.value) })} />)}
        {field("Duración en días (vacío = permanente)", <input type="number" min="1" max="3650" value={product.durationDays ?? ""} onChange={(event) => patch({ durationDays: event.target.value ? Number(event.target.value) : null })} />)}
        <label><input type="checkbox" checked={product.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />Visible en la tienda</label>
      </div><p>Un precio de 0 permite adquirirlo gratis con esa moneda.</p>{field("Descripción", <textarea maxLength={160} rows={2} value={product.description} onChange={(event) => patch({ description: event.target.value })} />)}</fieldset>
      {product.kind === "name" ? <>
        <fieldset disabled={busy}><legend>Tipografía y adornos de texto</legend><div className="name-editor-fields">
          {field("Familia", <select value={style.family} onChange={(event) => setStyle("family", event.target.value as NameStyle["family"])}>{[["sans", "Sans serif"], ["serif", "Serif"], ["script", "Cursiva"], ["mono", "Monoespaciada"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>)}
          {numberField("size", "Tamaño (px)", 10, 40)}{numberField("weight", "Peso", 100, 900, 100)}{numberField("tracking", "Espaciado (px)", -1.5, 6, 0.05)}
          <label><input type="checkbox" checked={style.italic} onChange={(event) => setStyle("italic", event.target.checked)} />Cursiva</label>
          {field("Prefijo", <input maxLength={12} value={style.prefix} onChange={(event) => setStyle("prefix", event.target.value)} />)}
          {field("Sufijo", <input maxLength={12} value={style.suffix} onChange={(event) => setStyle("suffix", event.target.value)} />)}
          {angleField("rotation", "Giro del nombre (°)")}{angleField("glyphRotation", "Giro de cada letra (°)")}
        </div></fieldset>
        <fieldset disabled={busy}><legend>Colores y degradado</legend><div className="name-editor-fields">
          {style.colors.map((color, index) => <label key={index}>Color {index + 1}<input type="color" value={color} onChange={(event) => { const colors = [...style.colors]; colors[index] = event.target.value; setStyle("colors", colors); }} /></label>)}
          <label><input type="checkbox" checked={style.gradient} onChange={(event) => setStyle("gradient", event.target.checked)} />Usar degradado</label>
          {angleField("gradientAngle", "Ángulo del degradado (°)")}{numberField("colorStop", "Posición del color central (%)", 0, 100)}
        </div></fieldset>
        <fieldset disabled={busy}><legend>Contorno y sombra</legend><div className="name-editor-fields">
          {field("Color del contorno", <input type="color" value={style.outlineColor} onChange={(event) => setStyle("outlineColor", event.target.value)} />)}{numberField("outlineWidth", "Grosor (px)", 0, 2, 0.05)}
          <label><input type="checkbox" checked={style.shadow} onChange={(event) => setStyle("shadow", event.target.checked)} />Activar sombra</label>
          {field("Color de sombra", <input type="color" value={style.shadowColor} onChange={(event) => setStyle("shadowColor", event.target.value)} />)}
          {numberField("shadowBlur", "Desenfoque (px)", 0, 12, 0.5)}{numberField("shadowDistance", "Distancia (px)", 0, 8, 0.5)}{angleField("shadowAngle", "Dirección de sombra (°)")}
        </div></fieldset>
        <fieldset disabled={busy}><legend>Movimiento</legend><div className="name-editor-fields">
          {field("Animación", <select value={style.animation} onChange={(event) => setStyle("animation", event.target.value as NameStyle["animation"])}>{[["none", "Estático"], ["wave", "Degradado por letra"], ["flow", "Flujo de color"], ["float", "Onda de movimiento"], ["pulse", "Pulso"], ["sparkle", "Destello"], ["spin", "Giro de letras"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>)}
          {field("Sentido", <select value={style.direction} onChange={(event) => setStyle("direction", event.target.value as NameStyle["direction"])}>{[["normal", "Normal"], ["reverse", "Inverso"], ["alternate", "Ida y vuelta"], ["alternate-reverse", "Ida y vuelta inversa"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>)}
          {numberField("duration", "Duración del ciclo (s)", 0.3, 20, 0.05)}{numberField("amplitude", "Recorrido (px)", 0, 12, 0.5)}{numberField("stagger", "Desfase por letra (s)", -1, 1, 0.01)}{angleField("motionAngle", "Dirección del movimiento (°)")}
        </div></fieldset>
      </> : <p>Este producto conserva su manifiesto. Puedes editar su precio y abrir las opciones avanzadas para cambiar sus propiedades.</p>}
      <details><summary>Importar, exportar y opciones avanzadas</summary>
        <p>El JSON conserva todas las capas de productos existentes.</p>
        <div className="name-editor-toolbar"><button type="button" className="chat-secondary" onClick={exportProduct}>Exportar JSON</button><button type="button" className="chat-secondary" disabled={busy} onClick={() => importRef.current?.click()}>Importar JSON</button></div>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((value) => {
          const data = effectPublicationSchema.parse(JSON.parse(value));
          const result = effectProductSchema.safeParse(data);
          if (!result.success || typeof data.code !== "string" || typeof data.name !== "string") throw new Error("El archivo no es un producto válido de la tienda.");
          select({ ...fresh(), ...data, manifest: result.data.manifest }, false); setStatus("Importado como borrador. Revisa el código y los precios antes de guardar.");
        }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "No se pudo importar.")); event.target.value = ""; }} />
        <button type="button" className="chat-secondary" onClick={() => setAdvanced(JSON.stringify(product.manifest, null, 2))}>Cargar manifiesto actual</button>
        {field("Manifiesto JSON", <textarea rows={10} value={advanced} onChange={(event) => setAdvanced(event.target.value)} />)}
        <button type="button" className="chat-secondary" disabled={busy || !advanced} onClick={() => { try { const result = effectProductSchema.safeParse({ kind: product.kind, manifest: JSON.parse(advanced) }); if (!result.success) throw new Error(result.error.issues.map((issue) => issue.message).join(" · ")); patch({ manifest: result.data.manifest }); setStatus("Manifiesto aplicado al borrador."); } catch (error) { setStatus(error instanceof Error ? error.message : "JSON inválido."); } }}>Aplicar JSON al borrador</button>
      </details>
      </div>
      <aside className="name-editor-preview" aria-label="Vista previa en el chat">
        {field("Nombre para probar", <input maxLength={48} value={sample} onChange={(event) => setSample(event.target.value)} />)}
        <button type="button" className="chat-secondary" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "Reanudar animación" : "Pausar animación"}</button>
        <div className="name-editor-scene"><article><header>{product.kind === "badge" ? <ProductBadge effect={preview} quality={paused ? "low" : "high"} /> : <EffectName name={sample || "Tu nombre"} effect={product.kind === "name" ? preview : null} font={product.kind === "name_font" ? preview : null} cover={null} quality={paused ? "low" : "high"} priority={2} />}<time>ahora</time></header><p>Así se verá tu nombre sobre un mensaje.</p></article><article><header>Otro coleccionista <time>ahora</time></header><p>Este mensaje debe mantener su espacio.</p></article></div>
        <p>{product.priceCoins} monedas · {product.priceCredits} créditos<br />{product.durationDays === null ? "Permanente" : `${product.durationDays} días`} · {product.enabled ? "Visible al guardar" : "Oculto al guardar"}</p>
      </aside>
    </div>
    <div className="name-editor-actions">
      <button type="button" className="chat-secondary" disabled={busy || !history.length} onClick={() => { const previous = history.at(-1); if (previous) { setFuture((items) => [...items, product]); setProduct(previous); setHistory((items) => items.slice(0, -1)); } }}>Deshacer</button>
      <button type="button" className="chat-secondary" disabled={busy || !future.length} onClick={() => { const next = future.at(-1); if (next) { setHistory((items) => [...items, product]); setProduct(next); setFuture((items) => items.slice(0, -1)); } }}>Rehacer</button>
      <button type="button" className="chat-secondary" disabled={busy} onClick={() => change(original ?? fresh())}>Restablecer</button>
      <button type="button" className="chat-primary" disabled={busy || !valid.success || !metadataValid} onClick={() => void save()}>{busy ? "Guardando…" : original ? "Guardar cambios" : "Añadir a la tienda"}</button>
    </div>
    {collision ? <p role="alert">Ese código ya existe. Selecciona el producto del catálogo para editarlo o usa otro código.</p> : null}
    {!metadataValid ? <p>Usa un código de 2–40 letras minúsculas, números o guiones, un nombre de 2–40 caracteres y precios enteros válidos.</p> : null}
    {!valid.success ? <p role="alert">{valid.error.issues.map((issue) => issue.message).join(" · ")}</p> : null}
    <p role="status" aria-live="polite" className="name-editor-status">{status}</p>
  </section>;
}
