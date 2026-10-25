import { KNOWLEDGE_VERSION, type KnowledgeAnnotation } from "../../src/search/knowledge-contracts.js";
export function knowledgeFixture(): KnowledgeAnnotation & {proposal:NonNullable<KnowledgeAnnotation["proposal"]>} {
  return {
    version: KNOWLEDGE_VERSION, study:"stage2-test", id:"statement-1",
    object:{kind:"track",id:1,name:"Canción",resolution:"resolved",identityEvidence:["documented repertoire link"],version:"studio-original",segment:null},
    observation:{resourceId:"R05",source:"https://rateyourmusic.com/music-review/test/album/1",reviewId:"1",account:"account-1",page:1,
      captureHash:"a".repeat(64),capturedAt:"2026-10-17T12:00:00.000Z",capturedAtOriginal:null,captureTimeZone:null,locator:"#review_shell_1",quote:"Guitarras fuzz",language:"es",visibleDate:"2026-10-16",textRevision:null,extractorVersion:"test-v1",paraphrase:null},
    assertion:{type:"sound",aspect:"guitars",value:"fuzz",state:"affirmed",appreciation:"descriptive",listeningCondition:null,coverage:"complete",activityBasis:null},
    layers:{community:[],genreKnowledge:[],individualRating:null,trackRatings:[],communityRating:null},dependencies:[],evidenceChain:"chain-1",
    analysis:{interpretation:"Timbre atribuido",alternative:"Distorsión de otra técnica",uncertainty:"Equipo desconocido",analyst:"fixture",methodVersion:"review-v1"},
    proposal:{axis:null,facet:"candidate:timbre.fuzz",value:"fuzz",query:"guitarra fuzz",criterion:"Revisión específica de timbre",status:"proposed"},comparison:null,
  };
}
