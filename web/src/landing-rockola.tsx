// TEMPORAL-PORTADA: standalone chat, without the catalog router.
import type { KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DailyCycleProvider } from './lib/DailyCycleContext';
import { useChat } from './lib/chatSocket';
import { LauncherPill } from './components/chat/LauncherPill';
import { ShopContent } from './components/chat/ShopSheet';
import { RockolaModeration } from './components/chat/RockolaModeration';
import { RockolaMessageMenu } from './components/chat/RockolaMessageMenu';
import { equippedEffect, useChatQuality, formatTime } from './lib/chatEffects';
import { EffectFilters } from './components/chat/TextEffects';
import { MaterialStage } from './components/chat/MaterialStage';
import { ParticleStage } from './components/chat/ParticleStage';
import { setMotionScope } from './lib/chatMotion';
import noxStyles from './styles/nox-effects.css?inline';
import nameStyles from './styles/name-editor.css?inline';
import textStyles from './styles/reactbits.css?inline';
import { ChatAvatar, EffectBubble, EffectName } from './components/chat/Effects';
import chatStyles from './styles/chat.css?inline';
import shopStyles from './styles/chat-shop.css?inline';
import materialStyles from './styles/chat-materials.css?inline';
import motionStyles from './styles/chat-motion.css?inline';
import widgetStyles from './styles/landing-rockola.css?inline';

// Economía del chat apagada por decisión de Brian (2026-11-06): sin monedas,
// sin efectos y sin tienda. Al volver a true reaparecen el icono y la tienda.
const CHAT_ECONOMY = false;

const counter = document.getElementById('visitCounter');
interface VisitPage { title: string; total: string; countries: Array<{ name: string; count: string; flag: string }> }
function readVisits(): VisitPage[] {
  return ['online', 'today', 'total'].map(key => ({
    title: key === 'online' ? 'EN LÍNEA' : key === 'today' ? 'VISITANTES HOY' : 'VISITANTES HISTÓRICOS',
    total: counter?.querySelector(`[data-visits-${key}]`)?.textContent?.trim() || '0',
    countries: [...(counter?.querySelectorAll(`[data-visits-page="${key}"] .visits__row`) ?? [])].map(row => ({
      name: row.querySelector('.visits__country')?.textContent || '',
      count: row.querySelector('.visits__count')?.textContent || '',
      flag: row.querySelector('img')?.src || '',
    })),
  }));
}
function VisitStats({open, paused}: {open:boolean; paused:boolean}) {
  const [pages, setPages] = useState(readVisits);
  const [selected, setSelected] = useState(2);
  const [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(!document.hidden);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!counter) return;
    const update = () => { const next = readVisits(); setPages(old => JSON.stringify(old) === JSON.stringify(next) ? old : next); };
    const observer = new MutationObserver(update);
    observer.observe(counter, {subtree:true, childList:true, characterData:true});
    update(); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(mq.matches);
    const visibility = () => setVisible(!document.hidden);
    mq.addEventListener('change',change); document.addEventListener('visibilitychange',visibility);
    return () => { mq.removeEventListener('change',change); document.removeEventListener('visibilitychange',visibility); };
  }, []);
  useEffect(() => {
    if (!open || paused || hovered || reduced || !visible) return;
    const timer = setTimeout(() => setSelected(i => (i + 1) % 3), selected === 2 ? 22000 : 6000);
    return () => clearTimeout(timer);
  }, [selected, open, paused, hovered, reduced, visible]);
  useEffect(() => {
    const el = track.current, view = viewport.current;
    if (!el || !view || !open) return;
    const fill = () => {
      el.replaceChildren(); el.classList.remove('is-scrolling'); view.classList.remove('is-scrolling');
      const first = document.createElement('div'); first.className = 'rv-flag-group';
      const countries = pages[selected]!.countries;
      const append = () => countries.forEach(country => {
        const chip = document.createElement('div'); chip.className = 'rv-flag-chip';
        const flag = document.createElement(country.flag ? 'img' : 'span'); flag.className = 'rv-flag';
        if (flag instanceof HTMLImageElement) { flag.src = country.flag; flag.alt = ''; flag.width = 21; flag.height = 15; } else flag.textContent = '🌐';
        const name = document.createElement('span'); name.className = 'rv-country'; name.textContent = country.name;
        const count = document.createElement('b'); count.textContent = country.count;
        chip.append(flag,name,count); first.append(chip);
      });
      append(); el.append(first);
      if (!countries.length) { first.textContent = 'Aún no hay visitas registradas.'; return; }
      // Only overflowing lists need a seamless duplicate. Short lists stay unique.
      const scrolling = !reduced && first.getBoundingClientRect().width > view.clientWidth;
      el.classList.toggle('is-scrolling', scrolling);
      view.classList.toggle('is-scrolling', scrolling);
      if (scrolling) {
        const duplicate = first.cloneNode(true) as HTMLElement; duplicate.setAttribute('aria-hidden','true');
        el.append(duplicate);
      }
      el.style.setProperty('--rv-travel', `-${first.getBoundingClientRect().width}px`);
      el.style.setProperty('--rv-duration', `${Math.max(8, first.getBoundingClientRect().width / 33)}s`);
      el.getAnimations().forEach(animation => { animation.currentTime = 0; });
    };
    fill(); const observer = new ResizeObserver(fill); observer.observe(view);
    return () => observer.disconnect();
  }, [pages, selected, open, reduced]);
  return <div className="rv-stats" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHovered(false); }}>
    <div className="rv-stat-top"><span className="rv-stat-title">{pages[selected]!.title}</span><span className="rv-stat-number">{pages[selected]!.total}</span></div>
    <div className="rv-flag-viewport" ref={viewport} tabIndex={0} aria-label="Visitas por país"><div className="rv-flag-track" ref={track}/></div>
    <div className="rv-dots" role="group" aria-label="Seleccionar tipo de visitas">{pages.map((page,i) => <button key={page.title} type="button" aria-label={page.title} title={page.title} aria-pressed={selected === i} className={selected === i ? 'is-active' : ''} onClick={() => setSelected(i)}/>)}</div>
  </div>;
}

function Rockola() {
  const chat = useChat('general');
  const quality = useChatQuality();
  const [open, setOpen] = useState(() => { try { const saved = localStorage.getItem('crv-rockola-open'); return saved === null ? true : saved === 'true'; } catch { return false; } });
  const [expanded, setExpanded] = useState(false);
  const [sheet, setSheet] = useState('');
  const [draft, setDraft] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  // Avisos de las acciones del menú de cada mensaje (reportar, moderar).
  const [notice, setNotice] = useState('');
  // Solo la administración con sesión ve el botón y la ventana de moderación.
  const [isAdmin] = useState(() => document.body.dataset.canManageAllTasks === 'true');
  const feed = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const nearBottom = useRef(true);
  const loadingEarlier = useRef(false);
  function openSheet(value: string) {
    lastFocus.current = document.activeElement?.shadowRoot?.activeElement as HTMLElement | null;
    setError(''); setSheet(value);
  }
  function closeSheet() { setSheet(''); lastFocus.current?.focus(); }
  function trapKeys(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); }
    if (e.key !== 'Tab') return;
    const targets = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select') ?? [])];
    const first = targets[0], last = targets[targets.length - 1];
    const active = dialog.current?.getRootNode() instanceof ShadowRoot ? (dialog.current.getRootNode() as ShadowRoot).activeElement : document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first?.focus(); }
  }
  useEffect(() => {
    if (!sheet || !dialog.current) return;
    const root = dialog.current.getRootNode() as ShadowRoot;
    const background = [...root.querySelectorAll<HTMLElement>('.rv-chat, .rv-launcher')];
    for (let branch: Element | null = root.host; branch?.parentElement; branch = branch.parentElement) {
      background.push(...[...branch.parentElement.children].filter(child => child !== branch && child instanceof HTMLElement) as HTMLElement[]);
      if (branch.parentElement === document.body) break;
    }
    const previous = background.map(child => child.inert);
    background.forEach(child => { child.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setMotionScope(dialog.current);
    dialog.current.querySelector<HTMLElement>(sheet === 'name' ? 'input' : 'button')?.focus();
    return () => {
      background.forEach((child,i) => { child.inert = previous[i]!; });
      document.body.style.overflow = overflow;
      setMotionScope(null);
      requestAnimationFrame(() => lastFocus.current?.focus());
    };
  }, [sheet]);
  useEffect(() => { if (feed.current && nearBottom.current && !loadingEarlier.current) feed.current.scrollTop = feed.current.scrollHeight; }, [chat.messages, open]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { try { localStorage.setItem('crv-rockola-open', String(open)); } catch {} }, [open]);
  // Contador de la píldora: mensajes llegados desde la última apertura. La
  // primera ventana cargada recupera lo pendiente; luego suma en vivo, así el
  // tope «+50» se alcanza aunque la ventana solo guarde 50 mensajes.
  const seenAt = useRef(0);
  const topMessageId = useRef(0);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!seenAt.current) { try { seenAt.current = Number(localStorage.getItem('crv-rockola-seen-at') ?? 0) || 0; } catch {} }
    const self = chat.actor?.id ?? null;
    const newest = chat.messages.reduce((max, message) => Math.max(max, message.id), 0);
    const fresh = chat.messages.filter(message => message.kind !== 'system' && message.actorId && message.actorId !== self);
    if (!topMessageId.current) {
      topMessageId.current = newest;
      if (!open) setUnread(fresh.filter(message => Date.parse(message.createdAt) > seenAt.current).length);
      return;
    }
    const arrived = fresh.filter(message => message.id > topMessageId.current);
    topMessageId.current = Math.max(topMessageId.current, newest);
    if (!open && arrived.length) setUnread(current => current + arrived.length);
  }, [chat.messages, open, chat.actor?.id]);
  useEffect(() => {
    if (!open) return;
    seenAt.current = Date.now();
    try { localStorage.setItem('crv-rockola-seen-at', String(seenAt.current)); } catch {}
    setUnread(0);
  }, [open, chat.messages]);
  // Miniaturas: una por persona, la de su último mensaje, de más reciente a más antiguo.
  const recentPeople = useMemo(() => {
    const latest = new Map<string, { id: string; name: string; at: number }>();
    for (const message of chat.messages) {
      if (message.kind === 'system' || !message.actorId) continue;
      const at = Date.parse(message.createdAt);
      const current = latest.get(message.actorId);
      if (!current || at >= current.at) latest.set(message.actorId, { id: message.actorId, name: message.displayName || 'La Rockola', at });
    }
    return [...latest.values()].sort((a, b) => b.at - a.at).map(({ id, name }) => ({ id, name }));
  }, [chat.messages]);
  const effects = CHAT_ECONOMY ? chat.effects : [];
  const status = chat.status === 'online' ? `${chat.users.length} en línea` : chat.status === 'connecting' ? 'Conectando…' : 'Sin conexión · reconectando…';
  return <>
    <LauncherPill hidden={open} count={unread} people={recentPeople} onOpen={() => setOpen(true)} />
    <section className={'rv-chat' + (expanded ? ' is-expanded' : '')} hidden={!open} aria-label="Chat La Rockola">
      <header className="rv-header"><div className="rv-title"><strong>La Rockola</strong><small><span className="rv-live-dot"/>{status}</small></div><div className="rv-header-actions">
        <button className="rv-icon-button" aria-label={expanded ? "Restaurar tamaño" : "Ampliar chat"} title={expanded ? "Restaurar tamaño" : "Ampliar chat"} aria-pressed={expanded} onClick={() => setExpanded(!expanded)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><path d="M3 3l7 7m11-7-7 7M3 21l7-7m11 7-7-7"/></svg></button>
        <button className="rv-icon-button" title="Ver conectados" aria-label="Ver conectados" onClick={() => openSheet('users')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M17 14c3 0 4 2 4 5"/></svg></button>
        {isAdmin && <button type="button" className="rv-icon-button rv-icon-button--mod" title="Moderación" aria-label="Moderación" onClick={() => openSheet('mod')}><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true"><path d="M216,56v56c0,96-88,120-88,120S40,208,40,112V56a8,8,0,0,1,8-8H208A8,8,0,0,1,216,56Z" opacity="0.2"></path><path d="M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM82.34,141.66a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32l-56,56a8,8,0,0,1-11.32,0Z"></path></svg></button>}
        {CHAT_ECONOMY && <button className="rv-icon-button" title="Tienda de efectos" aria-label="Tienda de efectos" onClick={() => openSheet('shop')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 9l1-5h14l1 5M4 9h16v11H4zM3 9c0 4 5 4 6 1 1 3 5 3 6 0 1 3 6 3 6-1"/></svg></button>}
        <button className="rv-icon-button" title="Minimizar chat" aria-label="Minimizar chat" onClick={() => { closeSheet(); setOpen(false); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14"/></svg></button>
      </div></header>
      <div className="rv-feed" ref={feed} onScroll={() => { const el = feed.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70; }} role="log" aria-label="Mensajes de La Rockola" aria-live="polite">
        {chat.hasMore && <button className="rv-history" onClick={async () => { const el = feed.current; if (!el) return; loadingEarlier.current = true; const height = el.scrollHeight; const top = el.scrollTop; await chat.loadEarlier(); requestAnimationFrame(() => { el.scrollTop = top + el.scrollHeight - height; loadingEarlier.current = false; }); }} disabled={chat.loadingHistory}>Mensajes anteriores</button>}
        {chat.messages.length === 0 && <p>{chat.status === 'online' ? 'Todavía no hay mensajes. ¡Saluda!' : status}</p>}
        {chat.messages.filter(m => m.kind !== 'system').reduce<Array<{first: typeof chat.messages[number]; bodies: string[]}>>((groups, m) => {
          const previous = groups[groups.length - 1];
          if (previous && m.actorId && previous.first.actorId === m.actorId && Date.parse(m.createdAt) - Date.parse(previous.first.createdAt) < 300000) previous.bodies.push(m.body);
          else groups.push({first:m, bodies:[m.body]});
          return groups;
        }, []).map(({first:m, bodies}) => <div className="rv-message" key={m.id}>{equippedEffect(m.equipped ? {equipped:m.equipped} : null, effects, 'frame') ? <ChatAvatar user={{displayName:m.displayName || 'La Rockola', avatarSeed:m.actorId || m.displayName || 'rockola'}} frame={equippedEffect(m.equipped ? {equipped:m.equipped} : null, effects, 'frame')} quality={quality} size={26}/> : <div className={"rv-avatar" + (m.displayName === "Brian" ? " is-pink" : m.actorId === chat.actor?.id ? " is-red" : "")}>{(m.displayName || 'R')[0]}</div>}<div className="rv-message-main"><EffectName name={m.displayName || 'La Rockola'} effect={equippedEffect(m.equipped ? { equipped: m.equipped } : null, effects, 'name')} font={equippedEffect(m.equipped ? { equipped: m.equipped } : null, effects, 'name_font')} badge={equippedEffect(m.equipped ? { equipped: m.equipped } : null, effects, 'badge')} quality={quality} cover={chat.cover?.coverUrl ?? null}/><time className="rv-timestamp">{formatTime(m.createdAt)}</time>{bodies.map((body, i) => <EffectBubble key={i} effect={equippedEffect(m.equipped ? {equipped:m.equipped} : null, effects, 'bubble')} quality={quality}><p>{body}</p></EffectBubble>)}</div><RockolaMessageMenu message={m} own={m.actorId === chat.actor?.id} isAdmin={isAdmin} onNotice={setNotice}/></div>)}
      </div>
      {(error || chat.error || chat.historyError) && <p className="rv-error" role="alert">{error || chat.error || chat.historyError}</p>}
      {notice && <p className="rv-notice" role="status">{notice}</p>}
      <form className="rv-compose" onSubmit={e => { e.preventDefault(); if (draft.trim() && chat.status === 'online') { chat.sendMessage(draft); setDraft(''); } }}><input aria-label="Escribir mensaje" placeholder="Escribe en La Rockola…" maxLength={2000} value={draft} onChange={e => { setDraft(e.target.value); chat.notifyTyping(); }} disabled={chat.status !== 'online' || chat.banned}/><button className="rv-send" disabled={chat.status !== 'online' || !draft.trim()} aria-label="Enviar mensaje"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 3L9 15M21 3l-6 18-5-7-7-5z"/></svg></button></form>
      <div className="rv-identity"><span className="rv-alias">{chat.actor?.displayName || 'Conectando…'}</span><button className="rv-rename" disabled={!chat.actor} onClick={() => { setName(chat.actor?.displayName || ''); openSheet('name'); }}>✎ Editar nombre</button></div>
      <VisitStats open={open} paused={!!sheet}/>
    </section>
      {sheet && <div className="rv-overlay is-visible" onClick={e => { if (e.target === e.currentTarget) closeSheet(); }}>
      <div className={'rv-dialog' + (sheet === 'shop' ? ' rv-dialog--shop' : '')} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="rv-dialog-title" onKeyDown={trapKeys}><div className="rv-dialog-header"><strong id="rv-dialog-title">{sheet === 'shop' ? 'Tienda de efectos' : sheet === 'users' ? 'Conectados al chat' : sheet === 'mod' ? 'Moderación' : 'Editar nombre'}</strong><button className="rv-dialog-close" aria-label="Cerrar ventana" onClick={closeSheet}>×</button></div><div className="rv-dialog-content">
      {sheet === 'users' && <div><p>{chat.users.length} {chat.users.length === 1 ? 'persona conectada' : 'personas conectadas'} en La Rockola.</p>{chat.users.map(u => <div className="rv-user-card" key={u.id}><div className="rv-avatar">{u.displayName[0]}</div><div><EffectName name={u.displayName} effect={equippedEffect(u, effects, 'name')} font={equippedEffect(u, effects, 'name_font')} badge={equippedEffect(u, effects, 'badge')} quality={quality} cover={chat.cover?.coverUrl ?? null}/><small><span className="rv-live-dot"/>En línea{u.id === chat.actor?.id ? ' · Tú' : ''}</small></div></div>)}{!chat.users.length && <p className="rv-note">No hay usuarios conectados.</p>}</div>}
      {isAdmin && sheet === 'mod' && <RockolaModeration room={chat.room} alerts={chat.alerts} onClose={closeSheet}/>}
      {sheet === 'name' && <form onSubmit={async e => { e.preventDefault(); try { await chat.setName(name); setError(''); closeSheet(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el nombre'); } }}><label htmlFor="rv-name-input">Tu nombre en La Rockola</label><input className="rv-dialog-input" id="rv-name-input" aria-describedby="rv-name-help" aria-label="Nuevo nombre" value={name} minLength={2} maxLength={40} required onChange={e => setName(e.target.value)}/><p className="rv-note" id="rv-name-help">Entre 2 y 40 caracteres. El cambio se verá en el chat.</p><button className="rv-primary">Guardar nombre</button>{error && <p role="alert">{error}</p>}</form>}
      {CHAT_ECONOMY && sheet === 'shop' && <ShopContent actor={chat.actor} effects={chat.effects} wallet={chat.wallet} cover={chat.cover?.coverUrl ?? null} quality={quality} isAdmin={false} onClose={closeSheet} onCatalogChange={chat.refreshEffects} onBuy={async code => { await chat.buy(code); }} onEquip={async (slot, code) => { await chat.equip(slot, code); }} onAction={chat.sendAction} roomBackground={null} roomAmbient={null}/>}
    </div></div></div>}
    {CHAT_ECONOMY && <><EffectFilters/><ParticleStage quality={quality}/><MaterialStage quality={quality}/></>}
  </>;
}
if (counter) {
  // Shadow DOM prevents the landing's button, type and layout rules from changing the mockup.
  counter.hidden = true;
  const host = document.createElement('div'); host.id = 'rockola-host'; counter.before(host);
  const shadow = host.attachShadow({mode:'open'});
  const style = document.createElement('style');
  style.textContent = chatStyles + shopStyles + materialStyles + motionStyles + noxStyles + nameStyles + textStyles + widgetStyles;
  const root = document.createElement('div'); root.id = 'rockola-widget'; shadow.append(style, root);
  createRoot(root).render(<DailyCycleProvider><Rockola/></DailyCycleProvider>);
}
