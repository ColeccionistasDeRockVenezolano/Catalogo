import { createHash } from "node:crypto";
import type { WebPage } from "../ambiguity/web-search.js";
import type { VerificationProposal } from "./evaluate.js";

export type ResearchTaskStatus = "pending" | "running" | "completed" | "failed";
export type ResearchTaskKind = "search" | "acquire" | "evaluate" | "extract";
export type ResearchStopReason = "paused" | "cancelled" | "budget" | "provider";
export interface ResearchTask {
  id: string;
  kind: ResearchTaskKind;
  input: string;
  dependencies: string[];
  status: ResearchTaskStatus;
  attempts: number;
  evaluatedKeys?:string[];
  error: string | null;
  updatedAt: string;
}
export interface ResearchSource {
  url: string;
  status: "discovered" | "obtained" | "partially_read" | "completely_read" | "failed" | "inaccessible";
  reason: string | null;
  capturedAt: string | null;
  contentHash: string | null;
  attempts: number;
  snippet?: WebPage;
  captureId?:number | undefined;
  chunks: { total: number; processed: number };
}
export interface ResearchLedger {
  version: 1;
  tasks: ResearchTask[];
  sources: ResearchSource[];
  consumption: { calls: number; cachedCalls: number; tokensIn: number; tokensOut: number; unknownUsageCalls: number };
  stopReason: ResearchStopReason | null;
}
export function newResearchLedger(): ResearchLedger {
  return { version: 1, tasks: [], sources: [], consumption: { calls: 0, cachedCalls: 0, tokensIn: 0, tokensOut: 0, unknownUsageCalls: 0 }, stopReason: null };
}
export function researchTask(ledger: ResearchLedger, kind: ResearchTaskKind, input: string, dependencies: string[] = []): ResearchTask {
  const id = createHash("sha256").update(JSON.stringify([kind, input])).digest("hex");
  const existing = ledger.tasks.find(task => task.id === id);
  if (existing) {
    existing.dependencies = [...new Set([...existing.dependencies, ...dependencies])];
    return existing;
  }
  const task: ResearchTask = { id, kind, input, dependencies, status: "pending", attempts: 0, error: null, updatedAt: new Date().toISOString() };
  ledger.tasks.push(task);
  return task;
}
export function researchSource(ledger: ResearchLedger, url: string): ResearchSource {
  const existing = ledger.sources.find(source => source.url === url);
  if (existing) return existing;
  const source: ResearchSource = { url, status: "discovered", reason: null, capturedAt: null, contentHash: null, attempts: 0, chunks: { total: 0, processed: 0 } };
  ledger.sources.push(source);
  return source;
}
export function setTaskStatus(task: ResearchTask, status: ResearchTaskStatus, error: string | null = null): void {
  task.status = status;
  task.error = error;
  task.updatedAt = new Date().toISOString();
}

/** Idempotent retries group equivalent assertions while keeping every citation and conflicting value. */
export function mergeResearchProposal(target: VerificationProposal, incoming: VerificationProposal): number {
  let changed=0;
  const normalize = (text: string) => {
    if(/^https?:\/\//u.test(text.trim())){try{return new URL(text.trim()).href;}catch{return text.trim();}}
    return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/\s+/gu, " ").trim();
  };
  const evidenceKey = (item: { source: number; quote: string }) => JSON.stringify([item.source, item.quote]);
  const citations = <T extends { evidence: Array<{ source: number; quote: string }> }>(old: T, next: T) => {
    const seen = new Set(old.evidence.map(evidenceKey));
    let added=false;
    for (const item of next.evidence) if (!seen.has(evidenceKey(item))) { old.evidence.push(item); seen.add(evidenceKey(item));added=true; }
    return added;
  };
  for (const item of incoming.findings) {
    const old = target.findings.find(candidate => candidate.key === item.key && candidate.status === item.status && normalize(candidate.observed ?? "") === normalize(item.observed ?? ""));
    if (old){if(citations(old,item))changed++;}else {target.findings.push(structuredClone(item));changed++;}
  }
  for (const item of incoming.discoveries) {
    const old = target.discoveries.find(candidate => candidate.area === item.area && normalize(candidate.context) === normalize(item.context) && normalize(candidate.value) === normalize(item.value));
    if (old){if(citations(old,item))changed++;}else {target.discoveries.push(structuredClone(item));changed++;}
  }
  return changed;
}
export class ResearchInterrupted extends Error {
  constructor(readonly reason: ResearchStopReason, readonly detail?: string) { super(`Investigación detenida: ${reason}`); }
}
