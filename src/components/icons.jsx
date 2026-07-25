/**
 * Inline SVG icons. No icon library: eight glyphs do not justify a dependency,
 * and inlining means they inherit `currentColor` and never flash in late.
 *
 * Every icon here is decorative — it sits beside a text label that already says
 * what the number is, so they carry aria-hidden. An icon is never the only
 * thing distinguishing one metric from another.
 */

function Svg({ children, size = 18, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconSales = (p) => (
  <Svg {...p}><path d="M3 17l6-6 4 4 7-7" /><path d="M14 8h6v6" /></Svg>
);

export const IconProfit = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2.2 0 2.8 6 1.4 6 4.1 0 1.3-1.3 2.2-3 2.2a3 3 0 0 1-3-1.5" /><path d="M12 6.5v11" /></Svg>
);

export const IconOrders = (p) => (
  <Svg {...p}><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5" /><path d="M12 12v9" /></Svg>
);

export const IconAvgOrder = (p) => (
  <Svg {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6" /><path d="M9 12h6" /></Svg>
);

export const IconLines = (p) => (
  <Svg {...p}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h10" /></Svg>
);

export const IconWarning = (p) => (
  <Svg {...p}><path d="M12 4 2.5 20h19z" /><path d="M12 10v4" /><path d="M12 17.5h.01" /></Svg>
);

export const IconPercent = (p) => (
  <Svg {...p}><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /></Svg>
);

export const IconRegion = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></Svg>
);

/** Dashboard KPI keys map to a fixed glyph so the tiles stay recognisable. */
export const KPI_ICONS = {
  sales: IconSales,
  profit: IconProfit,
  orders: IconOrders,
  aov: IconAvgOrder,
};
