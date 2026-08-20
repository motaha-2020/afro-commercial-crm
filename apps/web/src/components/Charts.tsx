'use client';

import { useId, useState } from 'react';

/**
 * Charts, drawn as inline SVG and CSS.
 *
 * No charting library: the shapes this dashboard needs are a few dozen lines
 * each, while a library is a megabyte of JavaScript, a second theming system to
 * keep in step with ours, and — the part that matters here — a canvas the
 * reader cannot select text from or read with a screen reader.
 *
 * Every chart is paired with the number it draws. A bar is a comparison, not a
 * measurement: nobody reads a value off a bar, so the value is written down.
 * That also makes each of these legible when the SVG fails to render at all,
 * and it is what earns the relief on the three palette slots that sit below
 * 3:1 against the light surface.
 *
 * Colour does one job per chart, and which job is a property of the data:
 *
 *   ordinal    — pipeline stages. Swapping two changes the meaning, so the
 *                order is in the colour: one hue, light→dark.
 *   nominal    — countries, industries. Swapping two changes nothing, so every
 *                bar is the same hue and length does the comparing.
 *   categorical— created / won / lost. The series are the subject.
 *
 * The palette is the validated default, checked with the skill's validator
 * rather than by eye: categorical passes every gate on the adjacent pairlist,
 * and the five ordinal steps pass monotonicity, step gaps and light-end
 * contrast in both modes. Ten steps failed — the gaps were invisible — which
 * is why the funnel bands stages rather than colouring each one differently.
 */

/** Categorical slots, in the fixed order that is the CVD-safety mechanism. */
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] as const;

/** Ordinal ramp, light→dark. Five steps: fewer, so each step is visible. */
const ORDINAL_STEPS = 5;

export interface Slice {
  key: string;
  label: string;
  value: number;
  hint?: string;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n * 100) / 100);
}

/**
 * Horizontal bars.
 *
 * Horizontal rather than vertical because the labels are words — stage names,
 * country names — and vertical bars force them sideways or into a legend the
 * eye has to travel to.
 *
 * `scale` picks the colour job. Ordered data (a funnel) gets the ordinal ramp
 * so the reader sees the sequence; unordered data gets one hue for every bar,
 * because colouring nominal bars by their value spends the identity channel
 * re-encoding what the bar length already says.
 */
export function BarChart({
  data,
  unit,
  scale = 'nominal',
}: {
  data: Slice[];
  unit?: string;
  scale?: 'nominal' | 'ordinal';
}) {
  const max = Math.max(...data.map((d) => d.value), 0);

  return (
    <div className="chart-bars">
      {data.map((d, i) => {
        const empty = d.value <= 0;
        const band =
          scale === 'ordinal' && data.length > 1
            ? Math.round((i / (data.length - 1)) * (ORDINAL_STEPS - 1)) + 1
            : 1;

        return (
          <div className="chart-bar-row" key={d.key}>
            <span className="chart-bar-label" title={d.label}>
              {d.label}
            </span>
            <span className="chart-bar-track">
              <span
                className={`chart-bar-fill${empty ? ' is-empty' : ''}`}
                style={{
                  width: max > 0 && !empty ? `${Math.max((d.value / max) * 100, 1.5)}%` : '0%',
                  background:
                    scale === 'ordinal' ? `var(--ordinal-${band})` : 'var(--series-1)',
                }}
              />
            </span>
            <span className="chart-bar-value">
              {/* An empty row keeps its label and its zero, and loses its bar.
                  A hairline of colour at zero was reading as a small amount —
                  the stage is empty, which is a fact worth seeing plainly. */}
              <span className={empty ? 'muted' : undefined}>
                {formatNumber(d.value)}
                {unit === 'PERCENT' ? '%' : ''}
              </span>
              {d.hint && <span className="chart-bar-hint"> {d.hint}</span>}
            </span>
          </div>
        );
      })}
      {data.length === 0 && <p className="muted">—</p>}
    </div>
  );
}

/**
 * A line over time, drawn from several series so won can be read against
 * created.
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
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();

  // One month is not a trend. Drawing a line through a single point invites the
  // eye to read a direction out of it, and the reader cannot tell that the
  // slope is an artefact of having one measurement.
  if (points.length < 2) {
    return (
      <p className="muted">
        {points.length === 0
          ? '—'
          : `${points[0]} · ${series.map((s) => `${s.label} ${s.values[0]}`).join(' · ')}`}
      </p>
    );
  }

  const width = 720;
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 30, left: 44 };
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const stepX = (width - pad.left - pad.right) / (points.length - 1);

  const x = (i: number) => pad.left + i * stepX;
  const y = (v: number) => height - pad.bottom - (v / max) * (height - pad.top - pad.bottom);

  return (
    <div className="chart-line">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={series.map((s) => s.label).join(', ')}
      >
        <clipPath id={clipId}>
          <rect x={pad.left} y={pad.top} width={width - pad.left - pad.right} height={height - pad.top - pad.bottom} />
        </clipPath>

        {/* Three gridlines, not ten: the eye needs a reference, not a ruler.
            Labelled, so the reference means something. */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(max * f)}
              y2={y(max * f)}
              className="chart-grid"
            />
            <text x={pad.left - 8} y={y(max * f) + 4} className="chart-axis" textAnchor="end">
              {formatNumber(max * f)}
            </text>
          </g>
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.top}
            y2={height - pad.bottom}
            className="chart-crosshair"
          />
        )}

        <g clipPath={`url(#${clipId})`}>
          {series.map((s, si) => (
            <g key={s.key}>
              <polyline
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                fill="none"
                stroke={SERIES[si % SERIES.length]}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.values.map((v, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(v)}
                  r={hover === i ? 5 : 3.5}
                  fill={SERIES[si % SERIES.length]}
                  // A ring in the surface colour, so two series crossing at a
                  // point stay two marks rather than one blob.
                  stroke="var(--panel)"
                  strokeWidth="2"
                />
              ))}
            </g>
          ))}
        </g>

        {points.map((p, i) => (
          <text key={p} x={x(i)} y={height - 8} className="chart-axis" textAnchor="middle">
            {p.slice(2)}
          </text>
        ))}

        {/* Hit targets far wider than the marks: the reader aims at a month,
            not at a 3px dot. */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p}`}
            x={x(i) - stepX / 2}
            y={pad.top}
            width={stepX}
            height={height - pad.top - pad.bottom}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {/* The reading for the hovered month, in text. An SVG tooltip would be
          invisible to a screen reader and unselectable with a mouse. */}
      <div className="chart-readout" aria-live="polite">
        {hover !== null ? (
          <>
            <strong>{points[hover]}</strong>
            {series.map((s, si) => (
              <span key={s.key}>
                <i style={{ background: SERIES[si % SERIES.length] }} />
                {s.label} <strong>{s.values[hover]}</strong>
              </span>
            ))}
          </>
        ) : (
          series.map((s, si) => (
            <span key={s.key}>
              <i style={{ background: SERIES[si % SERIES.length] }} />
              {s.label}
            </span>
          ))
        )}
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
 *
 * The strip is one hue stepped by rank, not eight hues: these are the top
 * accounts of one measure, and the reader's question is about the size of the
 * first slice, not about which colour Nile Telecom is.
 */
export function ShareBar({ data }: { data: (Slice & { share: number })[] }) {
  const [hover, setHover] = useState<string | null>(null);

  const band = (i: number) =>
    `var(--ordinal-${Math.min(Math.round((i / Math.max(data.length - 1, 1)) * (ORDINAL_STEPS - 1)) + 1, ORDINAL_STEPS)})`;

  return (
    <div className="chart-share">
      <div className="chart-share-track">
        {data.map((d, i) => (
          <span
            key={d.key}
            className={`chart-share-seg${hover === d.key ? ' is-hover' : ''}`}
            style={{ width: `${d.share}%`, background: band(i) }}
            title={`${d.label} — ${d.share}%`}
            onMouseEnter={() => setHover(d.key)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </div>
      <ul className="chart-share-legend">
        {data.map((d, i) => (
          <li
            key={d.key}
            className={hover === d.key ? 'is-hover' : undefined}
            onMouseEnter={() => setHover(d.key)}
            onMouseLeave={() => setHover(null)}
          >
            <i style={{ background: band(i) }} />
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
