import { useState } from "react";
import { ephemeridesApi, type Ephemeris } from "../lib/api";
import { useDailyAsync } from "../lib/useDailyAsync";
import { useDailyCycle } from "../lib/DailyCycleContext";
import "./ephemerides.css";

const months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function dateLabel(date:string) { return `${Number(date.slice(8))} de ${months[Number(date.slice(5,7))-1]}`; }
function Event({event}:{event:Ephemeris}) {
  return <article className="ephemeris">
    <div className="ephemeris-date"><span>{dateLabel(event.date)}</span><strong>{event.year}</strong></div>
    <div className="ephemeris-story"><h3>{event.title}</h3><p className="hint">{event.place}</p><p>{event.description}</p>
      <ul className="ephemeris-sources" aria-label="Fuentes del hecho histórico">{event.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<span className="visually-hidden"> (abre en otra pestaña)</span></a></li>)}</ul>
    </div>
  </article>;
}
export function EphemeridesPage() {
  const {cycle}=useDailyCycle();
  const {data,loading,error,reload}=useDailyAsync((date,signal)=>ephemeridesApi.get(date,signal));
  const [month,setMonth]=useState("");
  const [query,setQuery]=useState("");
  const events=data?.events.filter(event=>(!month||event.date.slice(5,7)===month)&&`${event.title} ${event.description} ${event.place} ${event.year}`.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")))??[];
  return <>
    <div className="page-header"><div><h1>Efemérides</h1><p className="hint">Fechas y encuentros que forman parte de la memoria musical venezolana.</p></div></div>
    {loading?<div className="state-block" role="status">Cargando efemérides…</div>:error?<div className="state-block" role="alert"><p>No se pudieron cargar las efemérides.</p><button className="btn" onClick={reload}>Reintentar</button></div>:data&&<>
      <section className="ephemerides-today" aria-labelledby="ephemerides-today"><p className="hint">Tal día como hoy · {cycle?dateLabel(cycle.date):""}</p><h2 id="ephemerides-today">Memoria del día</h2>
        {data.today.length?data.today.map(event=><Event key={event.id} event={event}/>):<p>Hoy no hay efemérides documentadas en el archivo. Puedes recorrer las fechas conservadas.</p>}
      </section>
      <section aria-labelledby="ephemerides-archive"><h2 id="ephemerides-archive">Explorar el archivo</h2>
        <div className="ephemerides-filters"><div><label htmlFor="ephemerides-query">Buscar un hecho</label><input id="ephemerides-query" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Banda, lugar o año"/></div>
          <div><label htmlFor="ephemerides-month">Mes</label><select id="ephemerides-month" value={month} onChange={event=>setMonth(event.target.value)}><option value="">Todos los meses</option>{months.map((name,index)=><option key={name} value={String(index+1).padStart(2,"0")}>{name[0]!.toUpperCase()+name.slice(1)}</option>)}</select></div></div>
        <p className="hint" role="status">{events.length} {events.length===1?"hecho documentado":"hechos documentados"}</p>
        {events.length?events.map(event=><Event key={event.id} event={event}/>):<p>No hay hechos que coincidan con estos filtros.</p>}
      </section>
    </>}
  </>;
}
