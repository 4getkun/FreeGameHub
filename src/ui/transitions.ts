type ViewTransitionDocument = Document & { startViewTransition?: (callback: () => void) => unknown };

/** Animates filter changes when supported and permitted by the user's motion preference. */
export function transitionFilters(update: () => void, doc: Document = document): void {
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const transition = (doc as ViewTransitionDocument).startViewTransition;
  if (!reduced && typeof transition === "function") {
    transition.call(doc, update);
  } else {
    update();
  }
}
