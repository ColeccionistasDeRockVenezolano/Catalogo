/** Variantes editoriales: B-Side, B - side, B–Sides, B Side y BSide. */
export const B_SIDES_TITLE_SQL_PATTERN = "(^|[^[:alpha:]])b[[:space:]‐‑‒–—-]*sides?([^[:alpha:]]|$)";
const B_SIDES_TITLE = /(?<!\p{L})b[\s‐‑‒–—-]*sides?(?!\p{L})/iu;
export const isBSidesTitle = (title: string): boolean => B_SIDES_TITLE.test(title.normalize("NFC"));
