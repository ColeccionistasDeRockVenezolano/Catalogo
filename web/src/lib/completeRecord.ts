// The record's «Completar la ficha» panel sits below the profile; the admin bar jumps to it.
export const COMPLETE_RECORD_ID = "completar-la-ficha";

/** Scrolls to the panel and moves focus to its heading, so keyboard and screen readers land there too. */
export function goToCompleteRecord(): void {
  const section = document.getElementById(COMPLETE_RECORD_ID);
  if (!section) return;
  section.scrollIntoView({ block: "start" });
  section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
}
