// CRV · Editor de estilos de la tienda del chat (administración).
//
// La vista previa manda: queda fija junto a los controles, a escala grande y
// dentro de una conversación. Los controles van por pestañas (texto, color,
// borde y sombra, movimiento, tienda) y solo aparecen los que afectan al
// movimiento o al color elegidos. Guardar es siempre la última acción.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ArrowCounterClockwise, ArrowsClockwise, ArrowUUpLeft, ArrowUUpRight, CircleHalf, Copy, DownloadSimple,
  Palette, Pause, Play, Plus, Storefront, Sun, TextAa, UploadSimple, Warning, Waves,
} from "@phosphor-icons/react";
import type { ChatEffect } from "../../../../src/chat/protocol";
import { effectProductSchema, effectPublicationSchema, EFFECT_KINDS } from "../../../../src/chat/effects-catalog";
import {
  DEFAULT_NAME_STYLE, FLOWING_NAME_ANIMATIONS, NAME_STYLE_FAMILIES, NAME_STYLE_REFERENCES, nameStyleSchema, type NameStyle,
} from "../../../../src/chat/name-style";
import { chatApi } from "../../lib/api";
import { EffectName, ProductBadge } from "./Effects";
import { StyledName } from "./StyledName";
import { AngleDial, Choices, ColorField, RangeField, Toggle } from "./NameStyleControls";
import "../../styles/name-editor.css";

type Product = Pick<ChatEffect, "code" | "name" | "kind" | "description" | "manifest" | "priceCoins" | "priceCredits" | "durationDays" | "sort"> & { enabled: boolean };
type Tab = "text" | "color" | "shadow" | "motion" | "shop";
type Issue = { field: "code" | "name" | "description" | "price" | "sort" | "duration" | "manifest"; message: string };

const fresh = (): Product => ({ code: "", name: "Nuevo estilo", kind: "name", description: "", manifest: { version: 1, triggers: ["always"], layers: [], nameStyle: { ...DEFAULT_NAME_STYLE }, reducedMotion: "static", cost: 2 }, priceCoins: 0, priceCredits: 0, durationDays: null, sort: 100, enabled: true });
const fromEffect = (effect: ChatEffect): Product => ({ code: effect.code, name: effect.name, kind: effect.kind, description: effect.description, manifest: effect.manifest, priceCoins: effect.priceCoins, priceCredits: effect.priceCredits, durationDays: effect.durationDays, sort: effect.sort, enabled: effect.enabled ?? true });
const KIND_NAMES: Record<string, string> = { name: "Nombre", name_font: "Fuente", badge: "Placa", frame: "Marco", entry: "Entrada", message: "Mensaje", action: "Acción", sticker: "Sticker", background: "Fondo", ambient: "Ambiente" };
const TABS: ReadonlyArray<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "text", label: "Texto", icon: <TextAa size={16} aria-hidden="true" /> },
  { id: "color", label: "Color", icon: <Palette size={16} aria-hidden="true" /> },
  { id: "shadow", label: "Borde y sombra", icon: <CircleHalf size={16} aria-hidden="true" /> },
  { id: "motion", label: "Movimiento", icon: <Waves size={16} aria-hidden="true" /> },
  { id: "shop", label: "Tienda", icon: <Storefront size={16} aria-hidden="true" /> },
];
const ANIMATIONS: ReadonlyArray<{ value: NameStyle["animation"]; label: string; hint: string }> = [
  { value: "none", label: "Estático", hint: "Sin movimiento" },
  { value: "wave", label: "Ola de color", hint: "El degradado recorre letra a letra" },
  { value: "flow", label: "Flujo de color", hint: "Un color continuo cruza el nombre" },
  { value: "sparkle", label: "Destello", hint: "Color en marcha y brillos por letra" },
  { value: "float", label: "Flotar", hint: "Las letras se mecen" },
  { value: "pulse", label: "Pulso", hint: "La luz late" },
  { value: "spin", label: "Giro de letras", hint: "Cada letra da la vuelta" },
];
const DIRECTIONS: ReadonlyArray<{ value: NameStyle["direction"]; label: string }> = [
  { value: "normal", label: "Normal" }, { value: "reverse", label: "Inverso" },
  { value: "alternate", label: "Ida y vuelta" }, { value: "alternate-reverse", label: "Vuelta e ida" },
];
const FAMILIES: ReadonlyArray<{ value: NameStyle["family"]; label: string }> = [
  { value: "sans", label: "Sans serif" }, { value: "serif", label: "Serif" }, { value: "script", label: "Cursiva" }, { value: "mono", label: "Mono" },
];

/** El escaparate amplía el nombre sin cambiar el estilo guardado. */
function scaled(style: NameStyle, factor: number): NameStyle {
  return { ...style, size: style.size * factor, tracking: style.tracking * factor, outlineWidth: style.outlineWidth * factor,
    shadowBlur: style.shadowBlur * factor, shadowDistance: style.shadowDistance * factor, amplitude: style.amplitude * factor };
}

function issuesOf(product: Product, collision: boolean, manifestError: string | null): Issue[] {
  const issues: Issue[] = [];
  if (!/^[a-z0-9-]{2,40}$/u.test(product.code)) issues.push({ field: "code", message: "El código usa de 2 a 40 letras minúsculas, números o guiones." });
  else if (collision) issues.push({ field: "code", message: "Ese código ya existe. Ábrelo desde «Producto existente» o usa otro." });
  const name = product.name.trim().length;
  if (name < 2 || name > 40) issues.push({ field: "name", message: "El nombre en la tienda lleva de 2 a 40 caracteres." });
  if (product.description.length > 160) issues.push({ field: "description", message: "La descripción admite hasta 160 caracteres." });
  if (![product.priceCoins, product.priceCredits].every((value) => Number.isInteger(value) && value >= 0 && value <= 100000)) issues.push({ field: "price", message: "Los precios son enteros entre 0 y 100.000." });
  if (!Number.isInteger(product.sort) || product.sort < 0 || product.sort > 10000) issues.push({ field: "sort", message: "El orden es un entero entre 0 y 10.000." });
  if (product.durationDays !== null && !(Number.isInteger(product.durationDays) && product.durationDays >= 1 && product.durationDays <= 3650)) issues.push({ field: "duration", message: "La duración va de 1 a 3.650 días, o vacía para permanente." });
  if (manifestError) issues.push({ field: "manifest", message: manifestError });
  return issues;
}

export function NameStyleEditor({ onSaved }: { onSaved: () => Promise<void> }) {
  const [catalog, setCatalog] = useState<ChatEffect[]>([]);
  const [product, setProduct] = useState<Product>(fresh);
  const [original, setOriginal] = useState<Product | null>(null);
  const [baseline, setBaseline] = useState<Product>(product);
  const [sample, setSample] = useState("Tu nombre");
  const [paused, setPaused] = useState(false);
  const [lightStage, setLightStage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [advanced, setAdvanced] = useState("");
  const [history, setHistory] = useState<Product[]>([]);
  const [future, setFuture] = useState<Product[]>([]);
  const [tab, setTab] = useState<Tab>("text");
  const importRef = useRef<HTMLInputElement>(null);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);

  const load = async () => { const result = await chatApi.adminEffects(); setCatalog(result.effects); };
  useEffect(() => { let cancelled = false; void chatApi.adminEffects().then((result) => { if (!cancelled) setCatalog(result.effects); }).catch((error: unknown) => { if (!cancelled) setStatus({ tone: "error", text: error instanceof Error ? error.message : "No se pudo cargar el catálogo." }); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, []);

  const dirty = JSON.stringify(product) !== JSON.stringify(baseline);
  /** Un arrastre o una escritura seguida en el mismo control es un solo paso de Deshacer. */
  function change(next: Product, key?: string) {
    const now = Date.now();
    const merge = key !== undefined && lastEdit.current?.key === key && now - lastEdit.current.at < 900;
    if (!merge) setHistory((items) => [...items.slice(-49), product]);
    lastEdit.current = key === undefined ? null : { key, at: now };
    setFuture([]); setProduct(next); setStatus(null);
  }
  function select(next: Product, saved: boolean): boolean {
    if (dirty && !window.confirm("Hay cambios sin guardar en este estilo. ¿Descartarlos?")) return false;
    setProduct(next); setBaseline(next); setOriginal(saved ? next : null); setHistory([]); setFuture([]); setAdvanced(""); setStatus(null); lastEdit.current = null;
    if (next.kind !== "name") setTab("shop");
    return true;
  }
  function patch(values: Partial<Product>, key?: string) { change({ ...product, ...values }, key); }
  const parsedStyle = nameStyleSchema.safeParse(product.manifest["nameStyle"]);
  const style = parsedStyle.success ? parsedStyle.data : DEFAULT_NAME_STYLE;
  function setStyle<K extends keyof NameStyle>(key: K, value: NameStyle[K]) {
    change({ ...product, manifest: { ...product.manifest, nameStyle: { ...style, [key]: value } } }, `style.${key}`);
  }
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [...items, product]); setProduct(previous); setHistory((items) => items.slice(0, -1)); lastEdit.current = null; };
  const redo = () => { const next = future.at(-1); if (!next) return; setHistory((items) => [...items, product]); setProduct(next); setFuture((items) => items.slice(0, -1)); lastEdit.current = null; };

  const preview: ChatEffect = { ...product, owned: false, equipped: false };
  const valid = effectProductSchema.safeParse({ kind: product.kind, manifest: product.manifest });
  const collision = catalog.some((item) => item.code === product.code) && original?.code !== product.code;
  const issues = issuesOf(product, collision, valid.success ? null : valid.error.issues.map((issue) => issue.message).join(" · "));
  const issueFor = (field: Issue["field"]) => issues.find((issue) => issue.field === field)?.message;
  const tabs = product.kind === "name" ? TABS : TABS.filter((item) => item.id === "shop");
  const activeTab = tabs.some((item) => item.id === tab) ? tab : "shop";
  const grouped = useMemo(() => EFFECT_KINDS.map((kind) => ({ kind, items: catalog.filter((item) => item.kind === kind) })).filter((group) => group.items.length), [catalog]);

  const save = async () => {
    if (busy || !valid.success || issues.length) return;
    setBusy(true); setStatus(null);
    try {
      await chatApi.publishEffect({ ...product, manifest: valid.data.manifest });
      setOriginal(product); setBaseline(product); lastEdit.current = null;
      try { await Promise.all([load(), onSaved()]); setStatus({ tone: "ok", text: product.enabled ? "Guardado. El estilo y sus precios ya están en la tienda." : "Guardado como oculto. Puedes volver a publicarlo desde este editor." }); }
      catch { setStatus({ tone: "ok", text: "Guardado en el servidor. Cierra y abre la tienda para actualizar el catálogo." }); }
    } catch (error) { setStatus({ tone: "error", text: error instanceof Error ? error.message : "No se pudo guardar. Tu diseño sigue aquí; vuelve a intentarlo." }); }
    finally { setBusy(false); }
  };
  const exportProduct = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(product, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${product.code || "estilo"}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); void save(); return; }
    // En campos de texto, Ctrl+Z sigue deshaciendo lo escrito.
    const target = event.target as HTMLElement;
    if (target.matches("textarea, input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color])")) return;
    if (key === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
    else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); redo(); }
  };
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((item) => item.id === activeTab);
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length]!;
    setTab(target.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${target.id}"]`)?.focus();
  };

  const quality = paused ? "low" : "high";
  const nameField = (label: string, field: Issue["field"] | null, node: ReactNode, hint?: string) => {
    // Un código aún vacío no es un error: el pie ya explica por qué no se puede guardar.
    const error = field && !(field === "code" && product.code === "") ? issueFor(field) : undefined;
    return <label className={`ne-field${error ? " has-error" : ""}`}><span className="ne-field-label">{label}</span>{node}{error ? <small className="ne-error">{error}</small> : hint ? <small className="ne-hint">{hint}</small> : null}</label>;
  };
  const needsGradient = (style.animation === "wave" || style.animation === "flow") && !style.gradient;

  const panels: Record<Tab, () => ReactNode> = {
    text: () => <>
      <Choices label="Familia" value={style.family} columns={4} onChange={(value) => setStyle("family", value)}
        options={FAMILIES.map((family) => ({ ...family, sample: <span style={{ fontFamily: NAME_STYLE_FAMILIES[family.value] }}>Aa</span> }))} />
      <div className="ne-grid">
        <RangeField label="Tamaño" unit="px" min={10} max={40} value={style.size} onChange={(value) => setStyle("size", value)} />
        <RangeField label="Grosor" min={100} max={900} step={100} value={style.weight} onChange={(value) => setStyle("weight", value)} />
        <RangeField label="Espaciado" unit="px" min={-1.5} max={6} step={0.05} value={style.tracking} onChange={(value) => setStyle("tracking", value)} />
        <Toggle label="Cursiva" checked={style.italic} onChange={(value) => setStyle("italic", value)} />
      </div>
      <div className="ne-grid">
        {nameField("Prefijo", null, <input maxLength={12} value={style.prefix} placeholder="♀ " onChange={(event) => setStyle("prefix", event.target.value)} />, "Hasta 12 caracteres antes del nombre")}
        {nameField("Sufijo", null, <input maxLength={12} value={style.suffix} placeholder=" ♥" onChange={(event) => setStyle("suffix", event.target.value)} />, "Hasta 12 caracteres después")}
      </div>
      <div className="ne-grid">
        <AngleDial label="Giro del nombre (°)" value={style.rotation} onChange={(value) => setStyle("rotation", value)} />
        <AngleDial label="Giro de cada letra (°)" value={style.glyphRotation} onChange={(value) => setStyle("glyphRotation", value)} />
      </div>
    </>,
    color: () => <>
      <Toggle label="Usar degradado" description="Mezcla tres colores; necesario para la ola y el flujo de color" checked={style.gradient} onChange={(value) => setStyle("gradient", value)} />
      {style.gradient ? <>
        <div className="ne-gradient-bar" aria-hidden="true" style={{ background: `linear-gradient(90deg, ${style.colors[0]}, ${style.colors[1]} ${Math.min(style.colorStop, 85)}%, ${style.colors[2]} 85%, ${style.colors[0]})` }} />
        <div className="ne-colors">
          {(["Inicio", "Centro", "Final"] as const).map((label, index) => <ColorField key={label} label={label} value={style.colors[index]!} onChange={(value) => { const colors = [...style.colors]; colors[index] = value; setStyle("colors", colors); }} />)}
        </div>
        <div className="ne-grid">
          <RangeField label="Posición del color central" unit="%" min={0} max={100} value={style.colorStop} onChange={(value) => setStyle("colorStop", value)} />
          <AngleDial label="Ángulo del degradado (°)" value={style.gradientAngle} onChange={(value) => setStyle("gradientAngle", value)} hint="0° sube de abajo arriba, 90° va de izquierda a derecha. La ola y el flujo avanzan en esta dirección." />
        </div>
      </> : <div className="ne-colors"><ColorField label="Color del texto" value={style.colors[0]} onChange={(value) => setStyle("colors", [value, style.colors[1], style.colors[2]])} /></div>}
    </>,
    shadow: () => <>
      <h4 className="ne-subhead">Contorno</h4>
      <div className="ne-grid">
        <ColorField label="Color del contorno" value={style.outlineColor} onChange={(value) => setStyle("outlineColor", value)} />
        <RangeField label="Grosor del contorno" unit="px" min={0} max={2} step={0.05} value={style.outlineWidth} onChange={(value) => setStyle("outlineWidth", value)} />
      </div>
      <h4 className="ne-subhead">Sombra</h4>
      <Toggle label="Activar sombra" checked={style.shadow} onChange={(value) => setStyle("shadow", value)} />
      {style.shadow ? <div className="ne-grid">
        <ColorField label="Color de sombra" value={style.shadowColor} onChange={(value) => setStyle("shadowColor", value)} />
        <RangeField label="Desenfoque" unit="px" min={0} max={12} step={0.5} value={style.shadowBlur} onChange={(value) => setStyle("shadowBlur", value)} />
        <RangeField label="Distancia" unit="px" min={0} max={8} step={0.5} value={style.shadowDistance} onChange={(value) => setStyle("shadowDistance", value)} />
        <AngleDial label="Dirección de sombra (°)" value={style.shadowAngle} onChange={(value) => setStyle("shadowAngle", value)} />
      </div> : null}
    </>,
    motion: () => <>
      <Choices label="Animación" value={style.animation} columns={2} options={ANIMATIONS} onChange={(value) => setStyle("animation", value)} />
      {needsGradient ? <p className="ne-notice" role="note"><Warning size={16} aria-hidden="true" /> Este movimiento desplaza el degradado y sin él no se ve. <button type="button" onClick={() => setStyle("gradient", true)}>Activar degradado</button></p> : null}
      {style.animation === "none" ? <p className="ne-hint">El nombre queda quieto. Así se ve también con movimiento reducido o calidad baja.</p> : <>
        <div className="ne-grid">
          <RangeField label="Duración del ciclo" unit="s" min={0.3} max={20} step={0.05} value={style.duration} onChange={(value) => setStyle("duration", value)} />
          {style.animation !== "flow" ? <RangeField label="Desfase por letra" unit="s" min={-1} max={1} step={0.01} value={style.stagger} onChange={(value) => setStyle("stagger", value)} /> : null}
        </div>
        <Choices label="Sentido" value={style.direction} columns={4} options={DIRECTIONS} onChange={(value) => setStyle("direction", value)} />
        {style.animation === "float" ? <div className="ne-grid">
          <RangeField label="Recorrido" unit="px" min={0} max={12} step={0.5} value={style.amplitude} onChange={(value) => setStyle("amplitude", value)} />
          <AngleDial label="Dirección del movimiento (°)" value={style.motionAngle} onChange={(value) => setStyle("motionAngle", value)} />
        </div> : null}
        {FLOWING_NAME_ANIMATIONS.has(style.animation) && style.gradient ? <p className="ne-hint">El color avanza en la dirección del degradado ({style.gradientAngle}°, pestaña Color).</p> : null}
      </>}
    </>,
    shop: () => <>
      <div className="ne-grid">
        {nameField("Nombre en la tienda", "name", <input maxLength={40} value={product.name} onChange={(event) => patch({ name: event.target.value }, "name")} />)}
        {nameField("Código único", "code", <input placeholder="mi-estilo" maxLength={40} disabled={Boolean(original)} value={product.code} onChange={(event) => patch({ code: event.target.value }, "code")} />, original ? "No cambia en un producto publicado" : "Minúsculas, números y guiones")}
        {nameField("Tipo de producto", null, <select value={product.kind} disabled={Boolean(original)} onChange={(event) => {
          const kind = event.target.value as Product["kind"]; const manifest = { ...product.manifest };
          if (kind === "name") manifest["nameStyle"] ??= { ...DEFAULT_NAME_STYLE }; else delete manifest["nameStyle"];
          patch({ kind, manifest });
        }}>{EFFECT_KINDS.map((kind) => <option value={kind} key={kind}>{KIND_NAMES[kind]}</option>)}</select>)}
        {nameField("Orden en la tienda", "sort", <input type="number" min="0" max="10000" value={product.sort} onChange={(event) => patch({ sort: Number(event.target.value) }, "sort")} />, "Menor aparece antes")}
      </div>
      {nameField("Descripción", "description", <textarea maxLength={160} rows={2} value={product.description} onChange={(event) => patch({ description: event.target.value }, "description")} />, `${product.description.length}/160`)}
      <h4 className="ne-subhead">Precio y duración</h4>
      <div className="ne-grid ne-grid-3">
        {nameField("Precio en monedas", "price", <input type="number" min="0" max="100000" value={product.priceCoins} onChange={(event) => patch({ priceCoins: Number(event.target.value) }, "priceCoins")} />)}
        {nameField("Precio en créditos", null, <input type="number" min="0" max="100000" value={product.priceCredits} onChange={(event) => patch({ priceCredits: Number(event.target.value) }, "priceCredits")} />)}
        {nameField("Duración en días", "duration", <input type="number" min="1" max="3650" placeholder="Permanente" value={product.durationDays ?? ""} onChange={(event) => patch({ durationDays: event.target.value ? Number(event.target.value) : null }, "duration")} />, "Vacío = permanente")}
      </div>
      <p className="ne-hint">Un precio de 0 permite adquirirlo gratis con esa moneda.</p>
      <Toggle label="Visible en la tienda" description="Desmarcado, se guarda oculto y puedes recuperarlo desde aquí" checked={product.enabled} onChange={(value) => patch({ enabled: value })} />
      <details className="ne-advanced">
        <summary>Importar, exportar y JSON avanzado</summary>
        <p className="ne-hint">El JSON conserva todas las capas de productos existentes. Importar o aplicar solo cambia el borrador.</p>
        <div className="ne-row">
          <button type="button" className="chat-secondary ne-icon-button" onClick={exportProduct}><DownloadSimple size={16} aria-hidden="true" />Exportar JSON</button>
          <button type="button" className="chat-secondary ne-icon-button" disabled={busy} onClick={() => importRef.current?.click()}><UploadSimple size={16} aria-hidden="true" />Importar JSON</button>
          <button type="button" className="chat-secondary" onClick={() => setAdvanced(JSON.stringify(product.manifest, null, 2))}>Cargar manifiesto actual</button>
        </div>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((value) => {
          const data = effectPublicationSchema.parse(JSON.parse(value));
          const result = effectProductSchema.safeParse(data);
          if (!result.success || typeof data.code !== "string" || typeof data.name !== "string") throw new Error("El archivo no es un producto válido de la tienda.");
          if (select({ ...fresh(), ...data, manifest: result.data.manifest }, false)) setStatus({ tone: "ok", text: "Importado como borrador. Revisa el código y los precios antes de guardar." });
        }).catch((error: unknown) => setStatus({ tone: "error", text: error instanceof Error ? error.message : "No se pudo importar." })); event.target.value = ""; }} />
        {nameField("Manifiesto JSON", null, <textarea className="ne-code" rows={10} spellCheck={false} value={advanced} onChange={(event) => setAdvanced(event.target.value)} />)}
        <button type="button" className="chat-secondary" disabled={busy || !advanced} onClick={() => { try { const result = effectProductSchema.safeParse({ kind: product.kind, manifest: JSON.parse(advanced) }); if (!result.success) throw new Error(result.error.issues.map((issue) => issue.message).join(" · ")); patch({ manifest: result.data.manifest }); setStatus({ tone: "ok", text: "Manifiesto aplicado al borrador." }); } catch (error) { setStatus({ tone: "error", text: error instanceof Error ? error.message : "JSON inválido." }); } }}>Aplicar JSON al borrador</button>
      </details>
    </>,
  };

  return <section className="name-editor" aria-label="Editor de estilos" onKeyDown={onKeyDown}>
    <header className="ne-head">
      <div>
        <h3>Editor de estilos</h3>
        <p>Diseña el nombre, pruébalo en la conversación y publica su precio. Las placas se venden y equipan por separado.</p>
      </div>
      <div className="ne-head-actions">
        <label className="ne-product"><span className="ne-field-label">{loading ? "Cargando catálogo…" : "Editar un producto existente"}</span>
          <select aria-label="Producto existente" disabled={loading || busy} value={original?.code ?? ""} onChange={(event) => { const item = catalog.find((entry) => entry.code === event.target.value); if (item) select(fromEffect(item), true); }}>
            <option value="">{original ? "Seleccionar producto" : "Borrador sin publicar"}</option>
            {grouped.map((group) => <optgroup key={group.kind} label={KIND_NAMES[group.kind]}>{group.items.map((item) => <option key={item.code} value={item.code}>{item.name}{item.enabled === false ? " (oculto)" : ""}</option>)}</optgroup>)}
          </select>
        </label>
        <button type="button" className="chat-secondary ne-icon-button" disabled={busy} onClick={() => select({ ...product, code: "", name: `${product.name.slice(0, 33)} copia` }, false)}><Copy size={16} aria-hidden="true" />Duplicar</button>
        <button type="button" className="chat-secondary ne-icon-only" disabled={busy} aria-label="Actualizar catálogo" title="Actualizar catálogo" onClick={() => void load().then(() => setStatus({ tone: "ok", text: "Catálogo actualizado." })).catch(() => setStatus({ tone: "error", text: "No se pudo actualizar. Vuelve a intentarlo." }))}><ArrowsClockwise size={16} aria-hidden="true" /></button>
      </div>
    </header>

    <div className="ne-templates" role="group" aria-label="Empezar desde">
      <button type="button" className="ne-template ne-template-blank" disabled={busy} onClick={() => { if (select(fresh(), false)) setTab("text"); }}>
        <span className="ne-template-art" aria-hidden="true"><Plus size={20} /></span>
        <strong>Nuevo estilo</strong><small>En blanco</small>
      </button>
      {NAME_STYLE_REFERENCES.map((reference) => {
        const existing = catalog.find((item) => item.code === reference.code && item.kind === "name");
        const active = product.code === reference.code;
        return <button type="button" className={`ne-template${active ? " is-on" : ""}`} aria-pressed={active} disabled={busy || loading} key={reference.code} aria-label={reference.name} title={reference.description} onClick={() => {
          if (select(existing ? fromEffect(existing) : { ...fresh(), code: reference.code, name: reference.name, description: reference.description, manifest: { ...fresh().manifest, nameStyle: reference.style } }, Boolean(existing))) { setSample(reference.sample); setTab("text"); }
        }}>
          <span className="ne-template-art" aria-hidden="true"><StyledName name={reference.sample} style={reference.style} quality={quality} priority={1.8} /></span>
          <strong>{reference.name}</strong><small>{existing ? (existing.enabled === false ? "En la tienda · oculto" : "En la tienda") : "Plantilla"}</small>
        </button>;
      })}
    </div>

    <div className="name-editor-workspace">
      <aside className="name-editor-preview" aria-label="Vista previa en el chat">
        <div className={`ne-stage${lightStage ? " is-light" : ""}`}>
          <div className="ne-stage-head">
            <span className="ne-stage-tags">
              <span className="ne-tag">{KIND_NAMES[product.kind]}</span>
              {dirty ? <span className="ne-tag is-warn">Cambios sin guardar</span> : original ? <span className="ne-tag is-ok">Publicado</span> : <span className="ne-tag">Borrador</span>}
              {!product.enabled ? <span className="ne-tag">Oculto</span> : null}
            </span>
            <button type="button" className="ne-stage-button" aria-pressed={lightStage} aria-label="Fondo claro" title="Comprobar sobre fondo claro" onClick={() => setLightStage((value) => !value)}><Sun size={16} aria-hidden="true" /></button>
            <button type="button" className="ne-stage-button" aria-pressed={paused} aria-label={paused ? "Reanudar animación" : "Pausar animación"} title={paused ? "Reanudar animación" : "Pausar animación"} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}</button>
          </div>
          <div className="ne-stage-name">
            {product.kind === "badge" ? <ProductBadge effect={preview} quality={quality} />
              : product.kind === "name" && parsedStyle.success ? <StyledName name={sample || "Tu nombre"} style={scaled(style, 2)} quality={quality} priority={2} />
                : <EffectName name={sample || "Tu nombre"} effect={product.kind === "name" ? preview : null} font={product.kind === "name_font" ? preview : null} cover={null} quality={quality} priority={2} />}
          </div>
          <label className="ne-sample"><span className="ne-field-label">Nombre para probar</span><input maxLength={48} value={sample} onChange={(event) => setSample(event.target.value)} /></label>
          <p className="ne-stage-price">{product.priceCoins} monedas · {product.priceCredits} créditos · {product.durationDays === null ? "permanente" : `${product.durationDays} días`}</p>
        </div>
        <div className="name-editor-scene" aria-label="Así se verá en la conversación">
          <article><header>{product.kind === "badge" ? <ProductBadge effect={preview} quality={quality} /> : <EffectName name={sample || "Tu nombre"} effect={product.kind === "name" ? preview : null} font={product.kind === "name_font" ? preview : null} cover={null} quality={quality} priority={2} />}<time>ahora</time></header><p>Así se verá tu nombre sobre un mensaje.</p></article>
          <article><header>Otro coleccionista <time>ahora</time></header><p>Este mensaje debe mantener su espacio.</p></article>
        </div>
      </aside>

      <div className="ne-panel">
        <div className="ne-tabs" role="tablist" aria-label="Secciones del estilo" onKeyDown={onTabKey}>
          {tabs.map((item) => <button key={item.id} type="button" role="tab" data-tab={item.id} id={`ne-tab-${item.id}`} aria-controls="ne-tabpanel" aria-selected={activeTab === item.id} tabIndex={activeTab === item.id ? 0 : -1} className={`${activeTab === item.id ? "is-on" : ""}${item.id === "shop" && issues.length ? " has-issue" : ""}`} onClick={() => setTab(item.id)}>{item.icon}{item.label}</button>)}
        </div>
        <fieldset className="ne-tabpanel" id="ne-tabpanel" role="tabpanel" aria-labelledby={`ne-tab-${activeTab}`} disabled={busy}>
          {product.kind !== "name" && activeTab === "shop" ? <p className="ne-hint">Este producto conserva su manifiesto. Edita aquí sus datos y precios; sus capas se ajustan con el JSON avanzado.</p> : null}
          {panels[activeTab]()}
        </fieldset>
      </div>
    </div>

    <footer className="ne-footer">
      <div className="ne-history" role="group" aria-label="Historial">
        <button type="button" className="chat-secondary ne-icon-only" disabled={busy || !history.length} aria-label="Deshacer" title="Deshacer (Ctrl+Z)" onClick={undo}><ArrowUUpLeft size={16} aria-hidden="true" /></button>
        <button type="button" className="chat-secondary ne-icon-only" disabled={busy || !future.length} aria-label="Rehacer" title="Rehacer (Ctrl+Mayús+Z)" onClick={redo}><ArrowUUpRight size={16} aria-hidden="true" /></button>
        <button type="button" className="chat-secondary ne-icon-only" disabled={busy || !dirty} aria-label="Restablecer" title="Restablecer" onClick={() => change(baseline)}><ArrowCounterClockwise size={16} aria-hidden="true" /></button>
      </div>
      <div className="ne-footer-message">
        {issues.length ? <p className="ne-issues" role="alert"><Warning size={16} aria-hidden="true" /><span>{issues.length === 1 ? issues[0]!.message : `${issues.length} datos por revisar antes de guardar.`}</span>{activeTab !== "shop" && issues.some((issue) => issue.field !== "manifest") ? <button type="button" onClick={() => setTab("shop")}>Revisar</button> : null}</p> : null}
        <p role="status" aria-live="polite" className={`name-editor-status${status?.tone === "error" ? " is-error" : ""}`}>{status?.text ?? ""}</p>
      </div>
      <button type="button" className="chat-primary" disabled={busy || !valid.success || issues.length > 0} onClick={() => void save()}>{busy ? "Guardando…" : original ? "Guardar cambios" : "Añadir a la tienda"}</button>
    </footer>
  </section>;
}
