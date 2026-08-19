/**
 * Charts, drawn as inline SVG.
 *
 * No charting library: the three shapes this dashboard needs are a few dozen
 * lines each, while a library is a megabyte of JavaScript, a second theming
 * system to keep in step with ours, and — the part that matters here — a
 * canvas the reader cannot select text from or read with a screen reader.
 *
 * Every chart is paired with the number it draws. A bar is a comparison, not a
 * measurement: nobody reads a value off a bar, so the value is written down.
 * That also makes each of these legible when the SVG fails to render at all.
 */

const PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
];

export interface Slice {
  key: string;
  label: string;
  value: number;
  hint?: string;
}

/**
 * Horizontal bars.
 *
 * Horizontal rather than vertical because the labels are words — stage names,
 * country names — and vertical bars force them sideways or into a legend the
 * eye has to travel to.
 */
export function BarChart({ data, unit }: { data: Slice[]; unit?: string }) {
  const max = Math.max(...data.map((d) => d.value), 0);

  return (
    <div className="chart-bars">
      {data.map((d, i) => (
        <div className="chart-bar-row" key={d.key}>
          <span className="chart-bar-label" title={d.label}>
            {d.label}
          </span>
          <span className="chart-bar-track">
            <span
              className="chart-bar-fill"
              style={{
                // Zero keeps a hairline rather than vanishing: an empty stage
                // is a fact about the pipeline, and a missing row reads as a
                // stage that does not exist.
                width: max > 0 ? `${Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0.6)}%` : '0.6%',
                background: PALETTE[i % PALETTE.length],
              }}
            />
          </span>
          <span className="chart-bar-value">
            {formatNumber(d.value)}
            {unit === 'PERCENT' ? '%' : ''}
            {d.hint && <span className="chart-bar-hint"> {d.hint}</span>}
          </span>
        </div>
      ))}
      {data.length === 0 && <p className="muted">—</p>}
    </div>
  );
}

/**
 * A line over time, drawn from two series so won can be read against created.
 *
 * Points are marked, because a line through three months is a shape the eye
 * over-reads: the dots say how much of it is measurement and how much is
 * interpolation.
 */
export function LineChart({
  points,
  series,
}: {
  points: string[];
  series: { key: string; label: string; values: number[] }[];
}) {
  const width = 720;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const stepX =
    points.length > 1 ? (width - pad.left - pad.right) / (points.length - 1) : 0;

  const x = (i: number) => pad.left + i * stepX;
  const y = (v: number) => height - pad.bottom - (v / max) * (height - pad.top - pad.bottom);

  return (
    <div className="chart-line">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={series.map((s) => s.label).join(', ')}
        preserveAspectRatio="none"
      >
        {/* Three gridlines, not ten: the eye needs a reference, not a ruler. */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={pad.left}
            x2={width - pad.right}
            y1={y(max * f)}
            y2={y(max * f)}
            className="chart-grid"
          />
        ))}

        {series.map((s, si) => (
          <g key={s.key}>
            <polyline
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={PALETTE[si % PALETTE.length]}
              strokeWidth="2"
            />
            {s.values.map((v, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v)}
                r="3"
                fill={PALETTE[si % PALETTE.length]}
              />
            ))}
          </g>
        ))}

        {points.map((p, i) => (
          <text key={p} x={x(i)} y={height - 8} className="chart-axis" textAnchor="middle">
            {p.slice(2)}
          </text>
        ))}
      </svg>

      <div className="chart-legend">
        {series.map((s, si) => (
          <span key={s.key}>
            <i style={{ background: PALETTE[si % PALETTE.length] }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Concentration, as a stacked strip rather than a pie.
 *
 * A pie asks the eye to compare angles, which it does badly; a strip asks it to
 * compare lengths, which it does well. The share is written on each segment
 * anyway, because the question here — "how much of the book is one customer?" —
 * deserves a number rather than an impression.
 */
export function ShareBar({ data }: { data: (Slice & { share: number })[] }) {
  return (
    <div className="chart-share">
      <div className="chart-share-track">
        {data.map((d, i) => (
          <span
            key={d.key}
            className="chart-share-seg"
            style={{ width: `${d.share}%`, background: PALETTE[i % PALETTE.length] }}
            title={`${d.label} — ${d.share}%`}
          />
        ))}
      </div>
      <ul className="chart-share-legend">
        {data.map((d, i) => (
          <li key={d.key}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="chart-share-name">{d.label}</span>
            <strong>{d.share}%</strong>
            <span className="muted">{formatNumber(d.value)}</span>
          </li>
        ))}
        {data.length === 0 && <li className="muted">—</li>}
      </ul>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n * 100) / 100);
}
