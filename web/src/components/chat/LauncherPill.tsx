// CRV · Píldora de «Mensajes» de La Rockola, la vista minimizada del chat.
// 328×73: icono con el contador de mensajes sin leer (tope «+50»), etiqueta y
// las iniciales de quienes escribieron último, de más reciente a más antiguo.
import type { CSSProperties } from 'react';

export interface LauncherPerson {
  id: string;
  name: string;
}

interface LauncherPillProps {
  /** Mensajes llegados desde la última vez que se abrió el chat. */
  count: number;
  /** Personas con mensajes, ordenadas de más reciente a más antiguo. */
  people: LauncherPerson[];
  onOpen: () => void;
  hidden?: boolean;
  label?: string;
}

const TONES: ReadonlyArray<readonly [string, string]> = [
  ['#3788ba', '#261568'],
  ['#b62e6b', '#73143b'],
  ['#c22435', '#68121f'],
  ['#2f8f6f', '#14503f'],
  ['#b07a2a', '#5c3a10'],
  ['#6b57c8', '#2c2166'],
];

/** Color estable por persona: la misma inicial siempre lleva el mismo tono. */
export function launcherTone(key: string): CSSProperties {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [from, to] = TONES[hash % TONES.length]!;
  return { background: `linear-gradient(140deg, ${from}, ${to})` };
}

/** El contador llega a 50; por encima se muestra «+50». */
export function launcherBadge(count: number): string {
  return count > 50 ? '+50' : String(Math.max(count, 0));
}

export function launcherInitial(name: string): string {
  return (name.trim()[0] || '?').toUpperCase();
}

export function LauncherPill({ count, people, onOpen, hidden = false, label = 'Mensajes' }: LauncherPillProps) {
  const badge = count > 0 ? launcherBadge(count) : '';
  const visible = people.slice(0, 3);
  return (
    <button
      className="rv-launcher"
      type="button"
      hidden={hidden}
      onClick={onOpen}
      aria-label={`Abrir ${label} de La Rockola${badge ? `, ${badge} sin leer` : ''}`}
    >
      <span className="rv-launcher-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
          <path d="M8 12h.01" />
          <path d="M12 12h.01" />
          <path d="M16 12h.01" />
        </svg>
        {badge && <span className="rv-launcher-count">{badge}</span>}
      </span>
      <span className="rv-launcher-label">{label}</span>
      {visible.length > 0 && (
        <span className="rv-launcher-people" aria-hidden="true">
          {visible.map(person => (
            <span className="rv-launcher-avatar" key={person.id} style={launcherTone(person.id)}>
              {launcherInitial(person.name)}
            </span>
          ))}
          {people.length > visible.length && <span className="rv-launcher-more">…</span>}
        </span>
      )}
    </button>
  );
}
