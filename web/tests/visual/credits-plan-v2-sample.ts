// Plan v2, etapa 4: muestra de discos con la estructura pública de créditos, en texto.
// Solo lee de la API local. Uso: tsx web/tests/visual/credits-plan-v2-sample.ts 142 168 … [--api=http://127.0.0.1:8080]
import { creditLines, joinList, otherWithoutRepeats, otherCreditsWithChannel, orderMusicianBlocks, PRODUCTION_TYPES, trackScope, type CreditLine } from "../../src/lib/creditLayout";
import { roleTitle } from "../../src/lib/labels";
import type { Credit, CreditStatement, ScopedCredit } from "../../src/lib/types";

const api = process.argv.find((arg) => arg.startsWith("--api="))?.slice(6) ?? "http://127.0.0.1:8080";
const ids = process.argv.slice(2).filter((arg) => /^\d+$/u.test(arg)).map(Number);

const name = (credit: Credit) => credit.personDisplayName ?? credit.personName ?? credit.artistName ?? credit.organizationName ?? credit.role;
const line = (item: CreditLine) => `${item.roles}${item.joiner === ":" ? ":" : ` ${item.joiner}`} ${joinList(item.targets.map(({ target, fallback }) => target?.name ?? fallback))}${item.scope ? ` (${item.scope})` : ""}`;

function chips(credits: Credit[], scoped: ScopedCredit[], musicians = false): string[] {
  const blocks = new Map<string, string[]>();
  for (const credit of credits) blocks.set(roleTitle(credit.role || credit.creditType), [...(blocks.get(roleTitle(credit.role || credit.creditType)) ?? []), name(credit)]);
  for (const credit of scoped) blocks.set(roleTitle(credit.role || credit.creditType), [...(blocks.get(roleTitle(credit.role || credit.creditType)) ?? []), `${name(credit)} (${trackScope(credit.tracks)})`]);
  const entries = [...blocks.entries()].map(([role, items]) => ({ role, items: [...new Set(items)] }));
  return (musicians ? orderMusicianBlocks(entries, (item) => item) : entries).map((block) => `  ${block.role}: ${block.items.join(" · ")}`);
}

for (const id of ids) {
  const response = await fetch(`${api}/albums/${id}`);
  const body = await response.json() as { data?: unknown };
  const album = (body.data ?? body) as { id: number; title: string; artist: { name: string }; creditsByType: Record<string, Credit[]>; scopedCreditsByType: Record<string, ScopedCredit[]>; creditStatements: CreditStatement[] };
  const pick = (types: readonly string[]) => [types.flatMap((type) => album.creditsByType[type] ?? []), types.flatMap((type) => album.scopedCreditsByType[type] ?? [])] as const;
  const out: string[] = [`## ${album.id} · ${album.artist.name} — ${album.title} (${album.creditStatements.length ? "con canal" : "sin canal"})`];
  out.push("Músicos", ...chips(...pick(["musician"]), true));
  const guests = pick(["guest"]);
  if (guests[0].length || guests[1].length) out.push("Músicos Invitados", ...chips(...guests));
  if (album.creditStatements.length) {
    const plan = otherCreditsWithChannel(album.creditStatements, album.creditsByType, album.scopedCreditsByType);
    if (plan.statements.length || plan.lines.length) out.push("Otros Créditos", ...plan.statements.map((item) => `  ${item.text}`), ...plan.lines.map((item) => `  ${line(item)}  [atomizado]`));
    out.push(`  (líneas del canal: ${album.creditStatements.length}; mostradas: ${plan.statements.length})`);
  } else {
    out.push("Producción", ...creditLines(...pick(PRODUCTION_TYPES)).map((item) => `  ${line(item)}`));
  }
  out.push("Composición", ...chips(...pick(["writer", "composer"])), "Arte", ...chips(...pick(["artwork", "photography"])));
  const other = [otherWithoutRepeats(album.creditsByType.other ?? [], album.creditsByType, album.scopedCreditsByType), otherWithoutRepeats(album.scopedCreditsByType.other ?? [], album.creditsByType, album.scopedCreditsByType)] as const;
  if (!album.creditStatements.length && (other[0].length || other[1].length)) out.push("Otros Créditos", ...chips(...other));
  console.log(out.join("\n") + "\n");
}
