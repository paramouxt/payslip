import { formatPence } from '@/lib/utils';

/**
 * Earnings by pay period: expected (engine) vs actual (payslip). Server-
 * rendered SVG following the dataviz method: one axis, thin marks with
 * rounded data-ends anchored to the baseline, 2px surface gaps, fixed hue
 * order, legend + table view (identity never colour-alone), palette
 * validated for both modes with scripts/validate_palette.js
 * (light #4f6bd8/#c97b2d · dark #5f7ce2/#bd7d38 — all checks pass).
 */
export interface PeriodEarnings {
  label: string; // "15–28 Jun"
  expectedPence: number | null;
  actualPence: number | null;
}

const SERIES = [
  { key: 'expected', label: 'Expected' },
  { key: 'actual', label: 'Actual' },
] as const;

const FILL = ['fill-[#4f6bd8] dark:fill-[#5f7ce2]', 'fill-[#c97b2d] dark:fill-[#bd7d38]'] as const;

export function EarningsChart({ data }: { data: PeriodEarnings[] }) {
  const width = 640;
  const height = 200;
  const pad = { left: 8, right: 8, top: 18, bottom: 26 };
  const max = Math.max(1, ...data.flatMap((d) => [d.expectedPence ?? 0, d.actualPence ?? 0]));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const groupW = plotW / Math.max(1, data.length);
  const barW = Math.min(28, groupW / 2 - 4);

  function bar(value: number | null, groupIndex: number, seriesIndex: 0 | 1) {
    if (value === null) return null;
    const h = Math.max(2, (value / max) * plotH);
    const x = pad.left + groupIndex * groupW + groupW / 2 + (seriesIndex === 0 ? -barW - 1 : 1);
    const y = pad.top + plotH - h;
    return (
      <g key={seriesIndex}>
        <rect x={x} y={y} width={barW} height={h} rx={4} className={FILL[seriesIndex]}>
          <title>{`${SERIES[seriesIndex].label}: ${formatPence(value)}`}</title>
        </rect>
        {/* keep the rounded end at the top only: square off the baseline */}
        <rect
          x={x}
          y={pad.top + plotH - Math.min(4, h)}
          width={barW}
          height={Math.min(4, h)}
          className={FILL[seriesIndex]}
        />
      </g>
    );
  }

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-[#4f6bd8] dark:bg-[#5f7ce2]" />
          Expected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-[#c97b2d] dark:bg-[#bd7d38]" />
          Actual
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width.toString()} ${height.toString()}`}
          role="img"
          aria-label="Earnings by pay period: expected versus actual"
          className="min-w-[480px]"
        >
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + plotH}
            y2={pad.top + plotH}
            className="stroke-border"
            strokeWidth={1}
          />
          {data.map((d, i) => (
            <g key={d.label}>
              {bar(d.expectedPence, i, 0)}
              {bar(d.actualPence, i, 1)}
              <text
                x={pad.left + i * groupW + groupW / 2}
                y={height - 8}
                textAnchor="middle"
                className="fill-current text-[10px] text-muted-foreground"
              >
                {d.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">View as table</summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Period</th>
              <th className="py-1 pr-2 text-right font-medium">Expected</th>
              <th className="py-1 text-right font-medium">Actual</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-t">
                <td className="py-1 pr-2">{d.label}</td>
                <td className="tnum py-1 pr-2 text-right">
                  {d.expectedPence !== null ? formatPence(d.expectedPence) : '—'}
                </td>
                <td className="tnum py-1 text-right">
                  {d.actualPence !== null ? formatPence(d.actualPence) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
