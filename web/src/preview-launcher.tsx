// Vista previa local de la píldora de «Mensajes» (328×73). No entra al build
// público: solo la sirve Vite en desarrollo para comparar con la referencia.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LauncherPill, type LauncherPerson } from './components/chat/LauncherPill';
import './styles/landing-rockola.css';
import './preview-launcher.css';

const NAMES = ['Dayana', 'Jesús', 'Camila', 'Rafael', 'Andrea', 'Miguel'];
const EVERYONE: LauncherPerson[] = NAMES.map((name, index) => ({ id: `preview-${index}`, name }));

function Preview() {
  const [count, setCount] = useState(8);
  const [people, setPeople] = useState<LauncherPerson[]>(EVERYONE.slice(0, 4));
  const [label, setLabel] = useState('Mensajes');
  const [size, setSize] = useState('328 × 73');
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pill = stage.current?.querySelector<HTMLElement>('.rv-launcher');
    if (!pill) return;
    const box = pill.getBoundingClientRect();
    setSize(`${Math.round(box.width)} × ${Math.round(box.height)}`);
  }, [count, people, label]);

  function incoming() {
    setCount(value => Math.min(99, value + 1));
    setPeople(current => {
      const next = EVERYONE.find(person => person.id !== current[0]?.id) ?? EVERYONE[0]!;
      return [next, ...current.filter(person => person.id !== next.id)];
    });
  }

  return (
    <main className="pv-wrap">
      <header>
        <h1>Píldora de Mensajes · La Rockola</h1>
        <p className="pv-note">
          Componente real del chat minimizado. La referencia es la foto enviada; abajo, el mismo
          componente con el tamaño pedido ({size} px) y estados forzados.
        </p>
      </header>

      <div className="pv-row">
        <section className="pv-col">
          <h2>Referencia</h2>
          <img className="pv-reference" src="/preview/launcher-mensajes.png" alt="Referencia de la píldora de Mensajes" />
        </section>

        <section className="pv-col">
          <h2>Implementación · {size} px</h2>
          <div className="pv-frame" ref={stage}>
            <LauncherPill count={count} people={people} label={label} onOpen={() => {}} />
          </div>
        </section>
      </div>

      <div className="pv-controls">
        <label>
          Sin leer
          <input type="number" min={0} max={99} value={count} onChange={event => setCount(Number(event.target.value) || 0)} />
        </label>
        <label>
          Texto
          <input type="text" value={label} maxLength={16} onChange={event => setLabel(event.target.value)} />
        </label>
        <label>
          Personas
          <input
            type="number"
            min={0}
            max={EVERYONE.length}
            value={people.length}
            onChange={event => setPeople(EVERYONE.slice(0, Math.max(0, Math.min(EVERYONE.length, Number(event.target.value) || 0))))}
          />
        </label>
        <button type="button" onClick={incoming}>Entra mensaje nuevo</button>
        <button type="button" onClick={() => setCount(0)}>Marcar leído</button>
        <span className="pv-size">contador: {count > 50 ? '+50' : count}</span>
      </div>

      <p className="pv-note">
        Con más de tres personas aparece el círculo «…». Cada mensaje nuevo pone a su autor a la
        izquierda y corre al resto. Al abrir el chat el contador vuelve a cero.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
