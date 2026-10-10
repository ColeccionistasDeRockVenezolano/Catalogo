const number=new Intl.NumberFormat("es-VE",{maximumFractionDigits:1});
export function ScoreRing({score,label,pending=false}:{score:number|null;label:string;pending?:boolean}) {
  const value=score===null?null:Math.max(0,Math.min(100,score));
  return <div className="score-ring" data-pending={pending||undefined}>
    <div className="score-ring__dial" role={value===null?"img":"meter"} aria-label={value===null?`${label}: pendiente` : label} aria-valuemin={value===null?undefined:0} aria-valuemax={value===null?undefined:100} aria-valuenow={value??undefined} aria-valuetext={value===null?undefined:`${number.format(value)} %`}>
      <svg viewBox="0 0 80 80" aria-hidden="true"><circle className="score-ring__track" cx="40" cy="40" r="35"/><circle className="score-ring__value" cx="40" cy="40" r="35" pathLength="100" strokeDasharray={`${value??0} 100`} transform="rotate(-90 40 40)"/></svg>
      <span className="mono">{value===null?"—":`${number.format(value)}%`}</span>
    </div>
    <span className="score-ring__label">{label}</span>
  </div>;
}
