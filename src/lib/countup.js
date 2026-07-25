/**
 * Count a number up in the DOM.
 *
 * This was anime.js, twice, and it was wrong twice: `anim.progress` is 0-100,
 * not 0-1, so every target overshot by 100x, and animating an object target
 * silently produced nothing. A count-up is a lerp and a rAF loop — a library
 * buys nothing here and hides the arithmetic that actually matters.
 *
 * Returns a cancel function; callers must call it on unmount.
 */
export function countUp(el, { from = 0, to, duration = 1200, delay = 0, format = String }) {
  if (!el) return () => {};

  let raf = null;
  let timer = null;
  let cancelled = false;

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const start = () => {
    const t0 = performance.now();
    const step = (now) => {
      if (cancelled) return;
      const t = Math.min(1, (now - t0) / duration);
      el.textContent = format(from + (to - from) * easeOutCubic(t));
      // Pin the exact target rather than trusting the last frame's rounding.
      if (t < 1) raf = requestAnimationFrame(step);
      else el.textContent = format(to);
    };
    raf = requestAnimationFrame(step);
  };

  if (delay > 0) timer = setTimeout(start, delay);
  else start();

  return () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
  };
}
