import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPool, closeDb } from "../src/db/client.js";
import { projectRoot } from "../src/config/project-root.js";
import { annotationSchema, analyzePattern, KNOWLEDGE_VERSION, type KnowledgeAnnotation } from "../src/search/knowledge-contracts.js";
import { studyReleaseFileSchema, studyReserveSchema, assertDevelopmentSelection, resolveStudyRelease } from "../src/search/study-identity.js";
import { hashText } from "../src/search/review-protocol.js";
import { crossStudySources } from "../src/search/study-crossing.js";
import { extractReviews, type ExtractedReview } from "../src/search/review-protocol.js";

const root=projectRoot(import.meta.url), out=path.join(root,"reports/unified-search-stage2");
interface Reading {id:string;study?:string;analyst?:string;comparisonAspect?:"voice"|"guitars"|"production"|"composition"|"atmosphere";reviewId:string;track?:string;aspect:string;value:string;quote:string;language:string;appreciation:"liked"|"disliked"|"mixed"|"descriptive";type?:"sound"|"taste"|"experience"|"context"|"attributed_intent";segment?:string;listeningCondition?:string;interpretation:string;alternative:string;query:string;comparison?:string;comparisonResolution?:"external"|"pending";state?:"affirmed"|"hypothetical"|"quoted"|"negated";dependencies?:KnowledgeAnnotation["dependencies"];evidenceChain?:string}
const readJson=async (f:string)=>JSON.parse(await readFile(path.join(root,f),"utf8"));
try {
  const config=await readJson("docs/unified-search/stage2/development-readings.json") as {version:string;analyst:string;readInFull:string[];readings:Reading[];patterns?:Array<{id:string;annotationIds:string[];interpretation:string;alternative:string}>};
  const releaseConfig=studyReleaseFileSchema.parse(await readJson("docs/unified-search/stage2/study-releases.json"));
  const reserve=studyReserveSchema.parse(await readJson("docs/unified-search/stage2/study-reserve.json"));
  assertDevelopmentSelection(config.readInFull,reserve.releases);
  const study=await readJson("reports/unified-search-stage2/study.json") as {manifest:Array<{release:string;page:number;capturedAt:string;html:string;htmlHash:string}>;releases:Array<{release:string;role:string;crvIdentity?:string;annotationStatus?:string}>};
  let annotations:KnowledgeAnnotation[]=[];
  const examined=[];
  for (const href of config.readInFull) {
    const spec=releaseConfig.releases.find(r=>r.release===href);if(!spec)throw new Error("Falta especificación de identidad de publicación");
    const expectedRole=spec.studyRole==="pilot_reanalysis"?"pilot_development":"new_development";
    if (study.releases.find(r=>r.release===href)?.role !== expectedRole) throw new Error("No abrir reserva ni reutilizar piloto como contraste nuevo");
    const pages=study.manifest.filter(p=>p.release===href);
    const rows:ExtractedReview[]=[];
    for (const p of pages){
      const html=await readFile(path.join(root,p.html),"utf8");
      if(hashText(html)!==p.htmlHash)throw new Error("Captura de reseñas cambió frente al corte");
      rows.push(...extractReviews({html,source:p.html,capturedAt:p.capturedAt,release:href,page:p.page}));
    }
    const identity=await resolveStudyRelease(root,spec),album=identity.album,albumId=album.id,identityEvidence=identity.identityEvidence;
    examined.push({release:href,studyRole:expectedRole,albumId,artistName:identity.artistName,albumName:album.title,sourceTitle:identity.sourceTitle,sourceArtist:identity.sourceArtist,
      trackIds:identity.tracks.map(t=>t.id),reviewIds:rows.map(r=>r.id),accounts:[...new Set(rows.map(r=>r.account))],pages:pages.length,
      rationale:spec.rationale,gaps:spec.gaps,stratum:spec.stratum,repertoire:identity.repertoire,identityEvidence,edition:"unknown"});
    for (const reading of config.readings.filter(r=>rows.some(row=>row.id===r.reviewId))) {
      const row=rows.find(r=>r.id===reading.reviewId)!;
      if(row.flags.length) throw new Error(`${reading.id}: captura con incidencias requiere revisión antes de anotar`);
      if (!row.text.includes(reading.quote)) throw new Error(`${reading.id}: cita no coincide con captura reparada`);
      let id=albumId, kind:"album"|"track"="album", name=album.title;
      if (reading.track) {
        const tracks=(await getPool().query("SELECT id,title FROM public.tracks WHERE album_id=$1 AND title=$2",[albumId,reading.track])).rows;
        if (tracks.length!==1) throw new Error("Pista no resuelta por título exacto dentro del álbum documentado");
        id=Number(tracks[0].id);name=tracks[0].title;kind="track";
      }
      const isAxis=reading.aspect==="atmosphere";
      const a=annotationSchema.parse({version:KNOWLEDGE_VERSION,study:reading.study??config.version,id:reading.id,
        object:{kind,id,name,resolution:"resolved",identityEvidence:[...identityEvidence,...(kind==="track"?[`public.tracks:${id}, título exacto dentro de album_id=${albumId}`]:[])],version:null,segment:reading.segment??null},
        observation:{resourceId:"R04",source:row.url,reviewId:row.id,account:row.account,page:row.page,captureHash:row.captureHash,
          capturedAt:null,capturedAtOriginal:row.capturedAt,captureTimeZone:null,locator:row.locator,quote:reading.quote,language:reading.language,visibleDate:row.visibleDate,textRevision:null,extractorVersion:row.extractorVersion,paraphrase:null},
        assertion:{type:reading.type??(reading.id==="E2-K05"?"taste":reading.comparison?"comparison":reading.aspect.startsWith("reception.")?"experience":"sound"),aspect:reading.aspect,value:reading.value,state:reading.state??"affirmed",appreciation:reading.appreciation,listeningCondition:reading.listeningCondition??null,coverage:"unknown",activityBasis:null},
        layers:{community:[],genreKnowledge:[],individualRating:row.rating===null?null:{value:row.rating,minimum:0.5,maximum:5,object:"album"},trackRatings:row.trackRatings.map(t=>({value:t.value,minimum:0.5,maximum:5,object:t.title})),communityRating:null},
        dependencies:reading.dependencies??[],evidenceChain:reading.evidenceChain??`rym-account:${row.account}`,
        analysis:{interpretation:reading.interpretation,alternative:reading.alternative,uncertainty:"Primera anotación; edición, procedencias comunitarias y conocimiento de género no cruzados todavía; requiere revisión independiente",analyst:reading.analyst??config.analyst,methodVersion:"review-analysis-0.2.0"},
        proposal:reading.type==="taste"||reading.id==="E2-K05"?null:{axis:isAxis?"atmosphere":null,facet:isAxis?null:`candidate:${reading.aspect}`,value:reading.value,query:reading.query,criterion:"Identidad y alcance documentados; criterio musical por atributo y decisión humana antes de publicar",status:"proposed"},
        comparison:reading.comparison?{reference:{kind:"artist",id:null,name:reading.comparison,resolution:reading.comparisonResolution??"external",identityEvidence:[`Referencia literal en ${row.url}; identidad externa no añadida al catálogo`],version:null,segment:null},aspect:reading.comparisonAspect??"other",direction:"resembles",polarity:"affirmed",period:null}:null,
      });annotations.push(a);
    }
  }
  const crossing=await crossStudySources(root,annotations,examined);
  annotations=crossing.annotations;
  await writeFile(path.join(out,"four-source-crossing.json"),JSON.stringify(crossing,null,2)+"\n");
  const blind=annotations.filter(a=>["E2-K01","E2-K02","E2-W01","E2-W04","E2-W05"].includes(a.id)).map(a=>({id:a.id,source:a.observation.source,locator:a.observation.locator,captureHash:a.observation.captureHash,quote:a.observation.quote,language:a.observation.language,
    annotation:{object:null,aspect:null,assertionState:null,appreciation:null,support:null,alternative:null,translation:null,reviewer:null},contextRevealedLater:{individualRating:a.layers.individualRating,community:a.layers.community}}));
  const addedPatterns=(config.patterns??[]).map(pattern=>{
    const selected=pattern.annotationIds.map(id=>{const row=annotations.find(a=>a.id===id);if(!row)throw new Error(`Patrón sin anotación: ${id}`);return row;});
    return {...pattern,analysis:analyzePattern(selected)};
  });
  await writeFile(path.join(out,"development-annotations.json"),JSON.stringify({version:config.version,crossingVersion:crossing.version,examined,annotations,
    patterns:[{id:"E2-P01",analyses:["E2-K01","E2-K02"].map(id=>({annotationId:id,analysis:analyzePattern(annotations.filter(a=>a.id===id))})),relation:"different_aspects_not_shared_trait",interpretation:"La intención imaginada de desarrollo y la experiencia de longitud excesiva no son dos testimonios del mismo atributo. Conservarlos por separado.",alternative:"El rechazo de extensión puede relacionarse con variedad, pero esta cita no lo demuestra."},...addedPatterns],
    independentEvaluation:"pending",communityAndGenreCrossing:"four-source-crossing.json; explicit analyst relations, no additional witnesses"},null,2)+"\n");
  const comparison=await readJson("docs/unified-search/stage2/comparative-reading.json") as {version:string;analyst:string;status:string;comparisons:Array<{id:string;annotationIds:string[]}>;limits:string[]};
  for(const row of comparison.comparisons)for(const id of row.annotationIds)if(!annotations.some(a=>a.id===id))throw new Error(`Comparación sin anotación de soporte: ${id}`);
  await writeFile(path.join(out,"development-analysis.json"),JSON.stringify({version:comparison.version,status:comparison.status,analyst:comparison.analyst,
    albums:examined.map(e=>({albumId:e.albumId,name:e.albumName,release:e.release,edition:e.edition,reviewsExamined:e.reviewIds.length,distinctAccountsExamined:e.accounts.length,
      findings:annotations.filter(a=>e.reviewIds.includes(a.observation.reviewId!)).map(a=>({id:a.id,object:a.object,observation:a.observation,assertion:a.assertion,
        interpretation:a.analysis.interpretation,alternative:a.analysis.alternative,query:a.proposal?.query??"Conservar valoración sin atributo",crossingId:a.id,
        uncertainties:a.analysis.uncertainty,publicationAuthorized:false}))})),comparisons:comparison.comparisons,limits:comparison.limits,
    independentValidation:false,populationPrevalenceAllowed:false},null,2)+"\n");
  // Rating/tags withheld from the first pass; contexts must be handed over separately.
  const contexts=blind.map(({id,contextRevealedLater})=>({id,...contextRevealedLater}));
  const reviewTemplate=JSON.stringify({version:config.version,status:"awaiting_independent_reviewer",firstPass:blind.map(({contextRevealedLater:_context,...rest})=>rest),thresholds:{status:"proposed_before_holdout_not_approved",scopeErrorsAllowed:0,unsupportedGeneralizationsAllowed:0,supportPrecision:0.95},metrics:null,adjudications:[]},null,2)+"\n";
  await writeFile(path.join(out,"independent-review-template.json"),reviewTemplate);
  try { await writeFile(path.join(out,"independent-review.json"),reviewTemplate,{flag:"wx"}); }
  catch(error) { if((error as NodeJS.ErrnoException).code!=="EEXIST") throw error; }
  await writeFile(path.join(out,"independent-review-context.json"),JSON.stringify(contexts,null,2)+"\n");
  for(const release of study.releases)if(examined.some(e=>e.release===release.release)){
    release.crvIdentity="resolved_documented_link";release.annotationStatus="annotated_four_sources_development";
  }
  await writeFile(path.join(out,"study.json"),JSON.stringify(study,null,2)+"\n");
  console.log(JSON.stringify({examined:examined.length,reviews:examined.reduce((n,a)=>n+a.reviewIds.length,0),annotations:annotations.length,independentEvaluation:"pending",fourSourceCrossings:crossing.crossings.length}));
} finally {await closeDb();}
