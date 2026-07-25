/**
 * Unsplash images, sized to the slot instead of to the biggest screen anyone
 * might have.
 *
 * The landing page was asking for a 1920px hero and three 1600px feature
 * images regardless of the viewport: 1.3 MB of photography, with the hero alone
 * at 708 kB and 2.8s. Every one of those was several times larger than the box
 * it rendered into.
 *
 * Unsplash resizes on their CDN, so the fix is to hand the browser a srcset and
 * let it pick — the platform already solves this and does it better than a
 * guess, because it knows the viewport and the device pixel ratio.
 */

/** Widths worth offering; more entries just bloat the attribute. */
const HERO_WIDTHS = [960, 1440, 1920];
const CARD_WIDTHS = [640, 960, 1280];

function build(url, widths, quality) {
  const base = url.split('?')[0];
  // auto=format lets them serve WebP/AVIF to browsers that accept it.
  const at = (w) => `${base}?auto=format&fit=crop&w=${w}&q=${quality}`;
  return {
    // Callers may pass a URL that already carries Unsplash params; the split
    // above drops them so ours are the only ones that apply.
    src: at(widths[1]),
    srcSet: widths.map((w) => `${at(w)} ${w}w`).join(', '),
  };
}

/**
 * A full-bleed image: it is always as wide as the viewport, which makes it the
 * largest thing on the page and the LCP. Compressed harder than the rest
 * because it renders under a black/40 -> black/60 gradient, so the detail that
 * quality buys is covered up anyway.
 */
export function heroImage(url) {
  return { ...build(url, HERO_WIDTHS, 55), sizes: '100vw' };
}

/** A feature image: half the row on desktop, full width once the row stacks. */
export function cardImage(url) {
  return { ...build(url, CARD_WIDTHS, 70), sizes: '(min-width: 1024px) 50vw, 100vw' };
}
