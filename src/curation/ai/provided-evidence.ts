import { DeepSeekValidationError, type DeepSeekGateway } from "../../ai/gateway.js";
import { CATALOG_PLANNING_INSTRUCTIONS, type PlannedDraft } from "./planner.js";
import { plannerSchema,operationRefs } from "./schema.js";
import { combinePlanningResults } from "./research-results.js";
import type { CatalogEvidence, CatalogPlan,CatalogOperation,CatalogRef } from "./types.js";

const normalized=(value:string)=>value.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
function reconcileExistingPeople(operations:CatalogOperation[],context:Record<string,unknown>):{operations:CatalogOperation[];unresolved:string[]}{
  const candidates=(context["catalogCandidates"]??[]) as Array<{kind:string;id:number;name:string;matchedAlias?:string|null}>;
  const profiles=(context["catalogIdentityProfiles"]??[]) as Array<{id:number;memberships:Array<{artistId:number}>;rootCredits:unknown[]}>;
  const root=context["root"] as {kind:string;id:number};
  const refs=new Map<string,CatalogRef>(),blocked=new Set<string>(),unresolved:string[]=[];
  for(const operation of operations){
    if(operation.op!=="create_entity"||operation.kind!=="person"||typeof operation.values["name"]!=="string")continue;
    const name=normalized(operation.values["name"]);
    const matches=[...new Map(candidates.filter(candidate=>candidate.kind==="person"&&[candidate.name,candidate.matchedAlias].some(value=>value&&normalized(value)===name)).map(candidate=>[candidate.id,candidate])).values()];
    if(!matches.length)continue;
    const associated=matches.filter(candidate=>profiles.some(profile=>profile.id===candidate.id&&(profile.rootCredits.length||profile.memberships.some(member=>root.kind==="artist"&&member.artistId===root.id))));
    if(associated.length===1)refs.set(operation.key,{kind:"person",id:associated[0]!.id});
    else{blocked.add(operation.key);unresolved.push(`Identidad pendiente: ${operation.values["name"]} ya coincide con personas ${matches.map(candidate=>candidate.id).join(", ")} del catálogo; comprobar vínculos antes de crear o asociar otra ficha.`);}
  }
  const result:CatalogOperation[]=[];
  for(const input of operations){
    if(refs.has(input.key)||blocked.has(input.key))continue;
    const operation=structuredClone(input);
    let invalid=false;
    for(const ref of operationRefs(operation))if("key" in ref){
      if(blocked.has(ref.key)){invalid=true;break;}
      const replacement=refs.get(ref.key);if(replacement&&"id" in replacement){if(replacement.kind!==ref.kind){invalid=true;break;}delete (ref as Partial<{key:string}>).key;Object.assign(ref,replacement);}
    }
    if(invalid){blocked.add(operation.key);unresolved.push(`Relación pendiente de resolver identidad: ${operation.key} · ${operation.label}`);}
    else result.push(operation);
  }
  return {operations:result,unresolved};
}

/** Source collection and catalog identity retrieval happen before this planner.
 * Every citation is visited; the prose synthesis is a separate pass over all citations.
 */
export async function planProvidedEvidence(context: Record<string, unknown>, evidence: CatalogEvidence[], instruction: string,
  gateway: DeepSeekGateway, notify: (phase: string, usage: CatalogPlan["usage"]) => Promise<void>): Promise<PlannedDraft> {
  const groups: CatalogEvidence[][] = [];
  for (const item of evidence) {
    const last = groups.at(-1);
    if (last && JSON.stringify([...last, item]).length < 24000) last.push(item);
    else groups.push([item]);
  }
  const results: Array<{ draft: PlannedDraft["draft"]; evidence: CatalogEvidence[]; taskKey: string }> = [];
  const usage: CatalogPlan["usage"] = { calls: 0, cachedCalls: 0, tokensIn: 0, tokensOut: 0 };
  let complete = true;
  for (let index = 0; index <= groups.length; index++) {
    const biography = index === groups.length;
    const citations = biography ? evidence : groups[index]!;
    await notify(biography ? "biography" : `documentary:${index + 1}/${groups.length}`, usage);
    try {
      const result = await gateway.propose({ taskKind: "curation_plan", schemaVersion: biography ? "official-biography-plan.v2" : "official-documentary-plan.v2", responseSchema: plannerSchema,
        instructions: `${CATALOG_PLANNING_INSTRUCTIONS}\n${biography
          ? "Esta ronda SOLO propone combinar y enriquecer la biografía del sujeto raíz mediante replace_fields. Conserva la información respaldada de narrativeOriginals y suma los hechos documentados; no presentes contradicciones como hechos resueltos. No limites la historia a los datos de la última página. Cada dato nuevo debe aparecer en las citas. La longitud es proporcional al material. Una sola operación para la biografía, con target del sujeto raíz."
          : "Esta ronda propone SOLO datos estructurados: miembros, períodos, actividad, fechas, relaciones, discos, pistas, créditos, sellos y organizaciones. NO propone biography ni description: su síntesis se hace después con todas las citas. Usa catalogCandidates y currentMembers/currentAlbums para evitar crear fichas que ya existen. Si una identidad no puede decidirse con esos contextos, conserva el hecho en unresolved. Nunca crear una persona cuyo nombre ya aparece entre los candidatos: resolver su identidad antes. No modelar minitecas, salas o eventos como bandas salvo que se documente una identidad interpretativa."}\nforcePlan=true: lookups debe ser []. No solicites nuevas páginas ni búsquedas: la campaña ya suministra las publicaciones recorridas. label máximo 160 caracteres; reason y cada unresolved máximo 700; evidenceIds máximo 8 por operación, siempre de las citas suministradas. Ninguna operación puede tener values vacío. Nunca inventes IDs ni campos. Las identidades del catálogo son contexto, no evidencia documental.`,
        input: { ...context, catalogReleases:biography?[]:context["catalogReleases"]??[],instruction, evidence: citations, forcePlan: true, previousDraft: null } });
      usage.calls++; usage.model = result.model;
      if (result.cached) usage.cachedCalls++; else { usage.tokensIn += result.tokensIn ?? 0; usage.tokensOut += result.tokensOut ?? 0; }
      const reconciled=reconcileExistingPeople(result.proposal.operations,context);
      const ids = new Set(citations.map(item => item.id));
      const root = context["root"] as {kind: string;id:number};
      const people=(context["catalogCandidates"]??[]) as Array<{kind:string;id:number;name:string;matchedAlias?:string|null}>;
      const identifiedPeople=(operation:CatalogOperation)=>{
        const text=` ${normalized(citations.filter(item=>operation.evidenceIds.includes(item.id)).map(item=>item.quote).join(" "))} `;
        return operationRefs(operation).filter(ref=>ref.kind==="person"&&"id" in ref).every(ref=>"id" in ref&&people.some(person=>person.kind==="person"&&person.id===ref.id&&[person.name,person.matchedAlias].some(name=>name&&text.includes(` ${normalized(name)} `))));
      };
      const eligible = reconciled.operations.filter(operation => operation.evidenceIds.length && operation.evidenceIds.every(id => ids.has(id)) &&
        identifiedPeople(operation)&&
        (biography ? operation.op === "replace_fields" && operation.target.kind === root.kind && "id" in operation.target && operation.target.id === root.id && Object.keys(operation.values).every(key => key === "biography") :
          operation.op !== "replace_fields" || !Object.keys(operation.values).some(key => key === "biography" || key === "description")));
      // Conflicting competing biographies need a fresh synthesis, not an arbitrary first choice.
      const allowed = biography && eligible.length > 1 ? [] : eligible;
      const unresolved = [...result.proposal.unresolved,...reconciled.unresolved,
        ...result.proposal.lookups.map(lookup => `Consulta de identidad pendiente: ${lookup.type} · ${lookup.query}`),
        ...reconciled.operations.filter(operation => !allowed.includes(operation)).map(operation => `Operación pendiente de revisión de alcance o evidencia: ${operation.key} · ${operation.label}`)];
      results.push({ draft: { summary: result.proposal.summary, operations: allowed, unresolved }, evidence: citations, taskKey: `official_${index}` });
    } catch (error) {
      usage.calls++;
      if(error instanceof DeepSeekValidationError && error.usage){usage.tokensIn+=error.usage.tokensIn;usage.tokensOut+=error.usage.tokensOut;}
      complete = false;
      results.push({ draft: { summary: "Ronda documental pendiente", operations: [], unresolved: [`Ronda ${index + 1}: ${error instanceof Error ? error.message : "No se pudo analizar"}`] }, evidence: citations, taskKey: `official_${index}` });
    }
  }
  await notify("documentary_complete",usage);
  return { ...combinePlanningResults(results, evidence), usage, complete };
}
