// CRV · Plan del primo, etapa 1: comprobación de las salidas en las fichas guía (lee la base, no escribe).
import { closeDb } from "../src/db/client.js";
import { getArtistDetail } from "../src/api/repositories/artists.js";
import { getPersonDetail } from "../src/api/repositories/persons.js";

const shownAliases = (aliases: Array<{ alias: string; publicHidden: boolean }>) => aliases.filter((a) => !a.publicHidden).map((a) => a.alias);
for (const id of [72, 31, 1212, 47, 6664, 1905]) {
  const artist = await getArtistDetail(id);
  if (!artist) { console.log(`artista ${id}: no existe`); continue; }
  const titular = artist.members.find((m) => m.role === "Titular del proyecto");
  console.log(`artista ${id} «${artist.name}» titular=${titular ? `${titular.personDisplayName ?? titular.personName} (${titular.personId})` : "—"} alias públicos=${JSON.stringify(shownAliases(artist.aliases))} formado=${artist.formedYear} discos=${artist.discography.map((d) => d.title).join(" | ")}`);
}
for (const id of [386, 645, 3617, 411, 21473]) {
  const person = await getPersonDetail(id);
  if (!person) { console.log(`persona ${id}: no existe`); continue; }
  console.log(`persona ${id} «${person.name}» → «${person.displayName ?? person.name}»; proyectos=${[...new Set(person.bands.map((b) => b.artistName))].join(", ")}; créditos disco=${person.albumCredits.length} pista=${person.trackCredits.length}; alias públicos=${JSON.stringify(shownAliases(person.aliases))}`);
}
await closeDb();
