import { useEffect, useRef } from 'react';

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
 * ONE small hook wrapping Chart.js. Creates the chart, destroys on unmount,
 * and RE-READS the CSS custom properties and updates when `document.documentElement.dataset.theme`
 * changes. Chart.js does not re-read CSS custom properties on its own — this hook is
 * the only place that concern lives.
 */
export function useChart(canvasRef, config) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !config) return;

    const createChart = async () => {
      const { Chart } = await import('chart.js');
      if (chartRef.current) chartRef.current.destroy();
      chartRef.current = new Chart(canvasRef.current, config);
    };

    createChart();

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [config, canvasRef]);

  // Re-read CSS custom properties on theme change
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;

        const createChart = async () => {
          const { Chart } = await import('chart.js');
          chartRef.current = new Chart(canvasRef.current, config);
        };

        createChart();
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, [config, canvasRef]);

  return chartRef;
}
