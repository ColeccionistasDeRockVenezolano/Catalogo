import { formatIdentityPoints, type ComparisonRow } from "../lib/personIdentityAssessment";

/** Cada aporte muestra lo comprobado y el máximo disponible, sin bonos fijos. */
export function PersonIdentitySignals({ signals, score }: { signals: readonly ComparisonRow[]; score: number | null }) {
  return <>
    {signals.length ? <ul className="signal-list">{signals.map((signal) => <li key={signal.key}>
      <span className="signal-list__points mono">+{formatIdentityPoints(score === 0 ? 0 : signal.points)}</span>
      <span className="signal-list__text">
        <strong>{signal.label}</strong>
        <span>Hasta {signal.maximum} puntos · {signal.status === "missing" ? "Datos faltantes" : signal.status === "unverified" ? "Sin comprobar" : signal.status === "different" ? "Datos diferentes" : signal.status === "partial" ? "Coincidencia parcial" : "Coincidencia comprobada"}</span>
      </span>
    </li>)}</ul> : <p className="score-guide__muted">Actualiza la investigación para obtener un desglose de los datos evaluados.</p>}
    {score === 0 && signals.some((signal) => signal.points > 0) ? <p className="signal-cap">Una contradicción o una decisión registrada impide sumar puntos de coincidencia. Revisa las pruebas.</p> : null}
  </>;
}
