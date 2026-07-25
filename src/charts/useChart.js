import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';

// `chart.js` ships tree-shakeable: nothing is registered until you ask for it,
// so `new Chart(...)` throws "linear is not a registered scale" / "doughnut is
// not a registered controller". Register once at module load rather than per
// chart. (Importing 'chart.js/auto' would do the same but pulls in every
// controller implicitly, which is harder to notice when trimming later.)
Chart.register(...registerables);

/**
 * Chart.js draws to a <canvas> — CanvasRenderingContext2D.fillStyle/strokeStyle
 * never runs through the CSS cascade, so a literal 'var(--x)' string is just an
 * invalid color that canvas silently ignores. Resolve the custom property to
 * its actual computed value (matching DiscountScatter's d3/canvas approach) so
 * charts pick up the current theme's colors.
 */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * ONE small hook wrapping Chart.js. Creates the chart, destroys it on unmount,
 * and rebuilds it when `data-theme` flips on <html> — Chart.js does not re-read
 * CSS custom properties on its own, so this hook is the only place that
 * concern lives.
 *
 * `config` is expected to be memoised by the caller; an inline object literal
 * would rebuild the chart on every render.
 */
export function useChart(canvasRef, config) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !config) return;

    const build = () => {
      if (chartRef.current) chartRef.current.destroy();
      chartRef.current = new Chart(canvasRef.current, config);
    };

    build();

    const observer = new MutationObserver(() => {
      // The config closes over cssVar() values read at render time, so the
      // caller re-renders on theme change too; rebuilding here covers the
      // canvas itself, which cannot repaint from CSS.
      if (canvasRef.current) build();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      observer.disconnect();
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [config, canvasRef]);

  return chartRef;
}
