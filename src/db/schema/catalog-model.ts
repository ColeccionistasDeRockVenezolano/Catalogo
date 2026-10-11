import { bigint, integer, jsonb, primaryKey, text } from "drizzle-orm/pg-core";
import { ingestSchema } from "./ingest-enums.js";
import { albums, albumFormats, artists, persons, tracks } from "./core.js";
import { genres } from "./ingest.js";
import type { DateValue } from "../../catalog/date-value.js";

export const catalogWorks=ingestSchema.table("catalog_works",{
  id:bigint("id",{mode:"number"}).primaryKey().generatedAlwaysAsIdentity(),
  title:text("title").notNull(),artistId:bigint("artist_id",{mode:"number"}).notNull().references(()=>artists.id,{onDelete:"cascade"}),notes:text("notes"),
});
export const catalogEditionDetails=ingestSchema.table("catalog_edition_details",{
  id:bigint("id",{mode:"number"}).primaryKey().generatedAlwaysAsIdentity(),
  albumId:bigint("album_id",{mode:"number"}).notNull().unique().references(()=>albums.id,{onDelete:"cascade"}),
  workId:bigint("work_id",{mode:"number"}).references(()=>catalogWorks.id,{onDelete:"restrict"}),
  releaseDate:jsonb("release_date").$type<DateValue>(),editionName:text("edition_name"),notes:text("notes"),
});
export const musicalIdentities=ingestSchema.table("musical_identities",{
  id:bigint("id",{mode:"number"}).primaryKey().generatedAlwaysAsIdentity(),
  personId:bigint("person_id",{mode:"number"}).notNull().references(()=>persons.id,{onDelete:"cascade"}),
  artistId:bigint("artist_id",{mode:"number"}).notNull().references(()=>artists.id,{onDelete:"cascade"}),
  relationship:text("relationship").notNull(),period:jsonb("period").$type<DateValue>(),notes:text("notes"),
});
export const editionSupportDetails=ingestSchema.table("edition_support_details",{
  id:bigint("id",{mode:"number"}).primaryKey().generatedAlwaysAsIdentity(),
  albumId:bigint("album_id",{mode:"number"}).notNull().references(()=>albums.id,{onDelete:"cascade"}),
  albumFormatId:bigint("album_format_id",{mode:"number"}).unique().references(()=>albumFormats.id,{onDelete:"cascade"}),
  format:text("format").notNull(),discNumber:integer("disc_number").notNull(),notes:text("notes"),
});
export const supportTracks=ingestSchema.table("support_tracks",{
  supportId:bigint("support_id",{mode:"number"}).notNull().references(()=>editionSupportDetails.id,{onDelete:"cascade"}),
  trackId:bigint("track_id",{mode:"number"}).notNull().references(()=>tracks.id,{onDelete:"cascade"}),
},table=>[primaryKey({columns:[table.supportId,table.trackId]})]);
export const scopedGenres=ingestSchema.table("scoped_genres",{
  id:bigint("id",{mode:"number"}).primaryKey().generatedAlwaysAsIdentity(),
  artistId:bigint("artist_id",{mode:"number"}).references(()=>artists.id,{onDelete:"cascade"}),
  personId:bigint("person_id",{mode:"number"}).references(()=>persons.id,{onDelete:"cascade"}),
  albumId:bigint("album_id",{mode:"number"}).references(()=>albums.id,{onDelete:"cascade"}),
  trackId:bigint("track_id",{mode:"number"}).references(()=>tracks.id,{onDelete:"cascade"}),
  genreId:bigint("genre_id",{mode:"number"}).notNull().references(()=>genres.id,{onDelete:"restrict"}),
  period:jsonb("period").$type<DateValue>(),notes:text("notes"),
});
