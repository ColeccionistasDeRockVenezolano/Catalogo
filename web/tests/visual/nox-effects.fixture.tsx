import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { NOX_PRODUCTS, type NoxStyle } from "../../../src/chat/nox";
import { EffectName, ChatAvatar, EffectBubble } from "../../src/components/chat/Effects";
import type { ChatEffect } from "../../../src/chat/protocol";
import type { Quality } from "../../src/lib/chatEffects";
const root = createRoot(document.getElementById("root")!);
function Product({ kind, preset, enhanced, quality = "high", name = "TuNickname" }: { kind: string; preset: string; enhanced: boolean; quality?: Quality; name?: string }) {
  const recipe = NOX_PRODUCTS.find(p => p.kind === kind && p.manifest.nox?.preset === preset)!;
  const nox: NoxStyle = { ...recipe.manifest.nox!, bloodfall: enhanced ? "enhanced" : "classic" };
  const effect: ChatEffect = { ...recipe, manifest: { ...recipe.manifest, nox }, owned: false, equipped: false };
  if (kind === "frame") return <ChatAvatar user={{ displayName: "T", avatarSeed: "T" }} frame={effect} quality={quality} size={46} priority={2} />;
  if (kind === "bubble") return <EffectBubble effect={effect} quality={quality} priority={2}>Este es mi nuevo estilo ✧</EffectBubble>;
  return <EffectName name={name} effect={effect} cover={null} quality={quality} priority={2} />;
}
Object.assign(window, {
  renderNox: (input: React.ComponentProps<typeof Product>) => flushSync(() => root.render(<Product {...input} />)),
  showNoxGallery: () => flushSync(() => root.render(<main style={{ display: "grid", gap: 28, padding: 20 }}>
    <h1 style={{ fontSize: 22, margin: 0 }}>Colección NOX</h1>
    <section className="nox-showcase">
      <style>{`.nox-showcase .nox-name{font-size:clamp(36px,6vw,54px)}.nox-showcase{display:flex;gap:40px;flex-wrap:wrap}.nox-showcase p{font-size:12px;color:#a2a5bb;margin:0 0 10px}`}</style>
      <div><p>Original del demo</p><Product kind="name" preset="blood" enhanced={false} name="Bloodfall" /></div>
      <div><p>Bloodfall · mejorado</p><Product kind="name" preset="blood" enhanced name="Bloodfall" /></div>
    </section>
    {NOX_PRODUCTS.filter(p => p.kind === "name").map(p => <section key={p.code} style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid #282a38", paddingTop: 16 }}>
      <div style={{ minWidth: 125 }}><Product kind="name" preset={p.manifest.nox!.preset} enhanced name={p.name} /></div>
      <Product kind="frame" preset={p.manifest.nox!.preset} enhanced />
      <Product kind="bubble" preset={p.manifest.nox!.preset} enhanced />
    </section>)}
  </main>)),
});
