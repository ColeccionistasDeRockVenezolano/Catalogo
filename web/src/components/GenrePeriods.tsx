import { genresApi } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatDate } from "../lib/format";
export function GenrePeriods({kind,id}:{kind:"album"|"artist"|"person";id:number}) {
 const {data,error,reload}=useAsync(()=>genresApi.periods(kind,id),[kind,id]);
 if(error)return <p role="alert">No se pudieron cargar los géneros por período. <button type="button" className="btn btn--sm" onClick={reload}>Reintentar</button></p>;
 if(!data?.length)return null;
 return <section className="section"><h2>Géneros por período</h2><ul>{data.map(g=><li key={g.id}>{g.name}{g.period?` · ${formatDate(g.period)}`:" · Sin período precisado"}</li>)}</ul><p className="hint">Ámbitos documentados de esta ficha. Se presentan por separado de sus géneros generales.</p></section>;
}
