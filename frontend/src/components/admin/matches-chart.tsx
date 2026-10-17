"use client";

import { useState } from "react";

/**
 * Single-series column chart (matches per hour). One hue (#9775f7, validated
 * for the dark surface), ≤24px columns with 4px rounded caps square at the
 * baseline, hairline grid, max value labelled, per-column hover/focus tooltip,
 * and a table view so no value is hover-gated.
 */
const BAR = "#9775f7";
const BAR_HOVER = "#a78bfa";

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow) * pow;
}

export function MatchesChart({ data }: { data: { hour: string; matches: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const width = 640;
  const height = 200;
  const pad = { top: 20, right: 8, bottom: 24, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.matches)));
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(24, band * 0.6);
  const ticks = [0, max / 2, max];
  const peak = data.reduce((best, d, i) => (d.matches > data[best].matches ? i : best), 0);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  return (
    <figure className="m-0">
      <div className="flex items-start justify-between gap-3">
        <figcaption>
          <h3 className="text-sm font-semibold text-fg">Matches per hour</h3>
          <p className="text-xs text-fg-subtle">Last 12 hours</p>
        </figcaption>
        <button type="button" className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg" aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {showTable ? (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-fg-subtle">
              <th className="py-1.5 font-medium">Hour</th>
              <th className="py-1.5 text-right font-medium">Matches</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.hour} className="border-t border-line">
                <td className="py-1.5">{d.hour}</td>
                <td className="py-1.5 text-right tabular-nums">{d.matches.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative mt-3">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`Matches per hour, peaking at ${data[peak]?.matches} at ${data[peak]?.hour}. Use Show table for all values.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / 0.08)" strokeWidth={1} />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-fg-subtle)">
                  {t >= 1000 ? `${t / 1000}K` : t}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = pad.left + band * i + band / 2;
              const top = y(d.matches);
              const h = pad.top + innerH - top;
              const r = Math.min(4, h);
              const x = cx - barW / 2;
              const base = pad.top + innerH;
              // Rounded data-end, square baseline.
              const path = `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`;
              return (
                <g key={d.hour}>
                  <path d={path} fill={active === i ? BAR_HOVER : BAR} />
                  {i === peak && (
                    <text x={cx} y={top - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-fg)">
                      {d.matches}
                    </text>
                  )}
                  {(i % 2 === 0 || data.length <= 8) && (
                    <text x={cx} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--color-fg-subtle)">
                      {d.hour}
                    </text>
                  )}
                  {/* Hit target: the full band, not just the painted column. */}
                  <rect
                    x={pad.left + band * i}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    tabIndex={0}
                    role="img"
                    aria-label={`${d.hour}: ${d.matches} matches`}
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="outline-none focus-visible:stroke-cyan-300"
                  />
                </g>
              );
            })}
          </svg>
          {active !== null && data[active] && (
            <div
              className="glass-strong pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-xs"
              style={{ left: `${((pad.left + band * active + band / 2) / width) * 100}%`, top: 0 }}
              aria-hidden="true"
            >
              <p className="font-semibold text-fg tabular-nums">{data[active].matches.toLocaleString()} matches</p>
              <p className="text-fg-subtle">{data[active].hour}</p>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
