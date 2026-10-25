import { z } from "zod";

export const catalogSortSchema = z.enum(["name", "name_desc", "year_asc", "year_desc"]);
export type CatalogSort = z.infer<typeof catalogSortSchema>;
