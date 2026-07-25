import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Card, TableView, fmtCurrency } from '../components/ui';

// Same TableView({columns, rows}) signature as the other charts — ladder rows
// are { discount, profit, sales, lines }.
const ladderColumns = [
  { key: 'discount', label: 'Discount', numeric: true, render: (r) => `${Math.round(r.discount * 100)}%` },
  { key: 'profit', label: 'Profit', numeric: true, render: (r) => fmtCurrency(r.profit) },
  { key: 'sales', label: 'Sales', numeric: true, render: (r) => fmtCurrency(r.sales) },
  { key: 'lines', label: 'Lines', numeric: true },
];

export function DiscountScatter({ points = [], ladder = [] }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const svgRef = useRef(null);
  const [breakEven, setBreakEven] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  // Fall back to table alone below ~200 points
  if (points.length < 200) {
    return (
      <Card>
        <div className="p-6">
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4" aria-label="Discount analysis">
            Discount analysis by decile
          </h2>
          <TableView columns={ladderColumns} rows={ladder} label="View as table" />
        </div>
      </Card>
    );
  }

  const redraw = () => {
    if (!containerRef.current || !canvasRef.current || !svgRef.current) return;

    const width = containerRef.current.clientWidth || 800;
    const height = Math.max(300, width * (9 / 16));

    // Compute scales
    const xExtent = d3.extent(points, (d) => d.x);
    const yExtent = [
      d3.min(points, (d) => d.y) * 1.1,
      d3.max(points, (d) => d.y) * 1.1,
    ];

    const xScale = d3.scaleLinear().domain([0, 0.5]).range([40, width - 20]);
    const yScale = d3.scaleLinear().domain(yExtent).range([height - 40, 20]);

    // Clear canvas
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const computedStyle = getComputedStyle(document.documentElement);
    const pointColorProfit = computedStyle.getPropertyValue('--series-1').trim();
    const pointColorLoss = computedStyle.getPropertyValue('--status-critical').trim();

    // Draw points to canvas
    points.forEach((d) => {
      const x = xScale(d.x);
      const y = yScale(d.y);
      ctx.fillStyle = d.y >= 0 ? pointColorProfit : pointColorLoss;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Draw mean curve via LOESS-like smoothing
    const curvePoints = [];
    for (let discount = 0; discount <= 0.5; discount += 0.02) {
      const nearby = points.filter((d) => Math.abs(d.x - discount) < 0.05);
      if (nearby.length > 0) {
        const meanProfit = nearby.reduce((a, b) => a + b.y, 0) / nearby.length;
        curvePoints.push({ x: discount, y: meanProfit });
      }
    }

    ctx.strokeStyle = pointColorProfit;
    ctx.lineWidth = 2;
    ctx.beginPath();
    curvePoints.forEach((d, i) => {
      const px = xScale(d.x);
      const py = yScale(d.y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Find break-even (where curve crosses zero)
    let breakEvenX = null;
    for (let i = 0; i < curvePoints.length - 1; i++) {
      if (
        (curvePoints[i].y <= 0 && curvePoints[i + 1].y > 0) ||
        (curvePoints[i].y >= 0 && curvePoints[i + 1].y < 0)
      ) {
        breakEvenX = curvePoints[i].x;
        break;
      }
    }
    setBreakEven(breakEvenX);

    // SVG overlay for axes and annotations
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    // Axes
    const axisGroup = svg.append('g');

    // X-axis
    axisGroup
      .append('line')
      .attr('x1', xScale(0))
      .attr('x2', xScale(0.5))
      .attr('y1', height - 40)
      .attr('y2', height - 40)
      .attr('stroke', 'var(--gridline)')
      .attr('stroke-width', 1);

    // X-axis ticks
    d3.range(0, 0.55, 0.1).forEach((tick) => {
      axisGroup
        .append('line')
        .attr('x1', xScale(tick))
        .attr('x2', xScale(tick))
        .attr('y1', height - 35)
        .attr('y2', height - 40)
        .attr('stroke', 'var(--text-muted)')
        .attr('stroke-width', 1);

      axisGroup
        .append('text')
        .attr('x', xScale(tick))
        .attr('y', height - 20)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--text-muted)')
        .attr('font-size', '11px')
        .text(`${Math.round(tick * 100)}%`);
    });

    // Y-axis
    axisGroup
      .append('line')
      .attr('x1', 40)
      .attr('x2', 40)
      .attr('y1', 20)
      .attr('y2', height - 40)
      .attr('stroke', 'var(--gridline)')
      .attr('stroke-width', 1);

    // Zero line (profit baseline)
    if (yScale(0) >= 20 && yScale(0) <= height - 40) {
      axisGroup
        .append('line')
        .attr('x1', 40)
        .attr('x2', width - 20)
        .attr('y1', yScale(0))
        .attr('y2', yScale(0))
        .attr('stroke', 'var(--baseline)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4');
    }

    // Break-even annotation
    if (breakEvenX !== null) {
      const annotX = xScale(breakEvenX);
      const annotY = yScale(0);

      // Leader line
      axisGroup
        .append('line')
        .attr('x1', annotX)
        .attr('x2', annotX)
        .attr('y1', annotY - 30)
        .attr('y2', annotY)
        .attr('stroke', 'var(--text-secondary)')
        .attr('stroke-width', 1);

      // Annotation label
      axisGroup
        .append('text')
        .attr('x', annotX)
        .attr('y', annotY - 40)
        .attr('text-anchor', 'middle')
        .attr('fill', 'var(--text-primary)')
        .attr('font-size', '12px')
        .attr('font-weight', '600')
        .text(`Break-even ≈ ${Math.round(breakEvenX * 100)}%`);
    }
  };

  useEffect(() => {
    redraw();

    const observer = new MutationObserver(redraw);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const resizeObserver = new ResizeObserver(redraw);
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [points, ladder]);

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4">
          Profit vs. discount
        </h2>
        <div ref={containerRef} className="overflow-x-auto">
          <div
            role="img"
            aria-label={
              breakEven !== null
                ? `Scatter plot of profit versus discount percentage. Break-even around ${Math.round(breakEven * 100)}%; profit turns negative above that discount.`
                : 'Scatter plot of profit versus discount percentage.'
            }
            style={{ position: 'relative', minWidth: '640px' }}
          >
            <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
            <svg ref={svgRef} style={{ position: 'absolute', top: 0, left: 0 }} />
          </div>
        </div>
        {breakEven && (
          <p className="text-[11px] text-[var(--text-secondary)] mt-2">
            Break-even point: approximately {Math.round(breakEven * 100)}%
          </p>
        )}
        <div className="mt-4">
          <TableView columns={ladderColumns} rows={ladder} label="View as table" />
        </div>
      </div>
    </Card>
  );
}
