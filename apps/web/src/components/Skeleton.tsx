/**
 * Loading skeletons.
 *
 * These exist because the screen used to freeze on the *previous* page after
 * every click: a server component waits for all of its data before it renders
 * anything, so nothing on screen changed until the request came back. The page
 * was rarely the problem — the user simply had no evidence that anything had
 * happened.
 *
 * The shapes here deliberately mirror the real screens (a table for a table, a
 * board for a board). A single spinner would say "wait"; a matching shape says
 * "this is arriving", and the swap to real content reads as the page filling in
 * rather than as a second page load.
 *
 * Everything is presentational, so it is hidden from assistive technology and
 * the wait is announced once, in words, instead of as a hundred blank cells.
 */

import type { ReactNode } from 'react';

export function SkeletonBar({
  width = '100%',
  height = 12,
  radius = 6,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
}) {
  return (
    <span
      className="sk"
      style={{ width: typeof width === 'number' ? `${width}px` : width, height, borderRadius: radius }}
    />
  );
}

/** Wraps a whole loading screen: hidden from screen readers, announced once. */
export function SkeletonScreen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {label}
      </span>
      <div className="sk-screen" aria-hidden="true">
        {children}
      </div>
    </>
  );
}

export function SkeletonPageHead({ actions = 2 }: { actions?: number }) {
  return (
    <div className="page-head">
      <div style={{ flex: 1, minWidth: 0 }}>
        <SkeletonBar width={220} height={22} />
        <div style={{ marginTop: 8 }}>
          <SkeletonBar width={320} height={12} />
        </div>
      </div>
      <div className="head-actions">
        {Array.from({ length: actions }).map((_, i) => (
          <SkeletonBar key={i} width={104} height={34} radius={11} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonFilters({ fields = 3 }: { fields?: number }) {
  return (
    <div className="list-filters">
      <SkeletonBar width={260} height={36} radius={11} />
      {Array.from({ length: Math.max(0, fields - 1) }).map((_, i) => (
        <SkeletonBar key={i} width={150} height={36} radius={11} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="panel">
      <table className="data">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}>
                <SkeletonBar width={i === 1 ? 120 : 64} height={9} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  {/* Widths vary a little so the block does not read as a grid
                      of identical boxes, which looks like a rendering fault. */}
                  <SkeletonBar width={c === 1 ? '80%' : c === 0 ? 70 : '55%'} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonKpis({ count = 4 }: { count?: number }) {
  return (
    <div className="grid cols-4" style={{ marginBottom: 20 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div className="kpi" key={i}>
          <SkeletonBar width={90} height={10} />
          <div style={{ marginTop: 10 }}>
            <SkeletonBar width={120} height={24} />
          </div>
          <div style={{ marginTop: 8 }}>
            <SkeletonBar width={70} height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonBoard({ columns = 6, cards = 3 }: { columns?: number; cards?: number }) {
  return (
    <div className="kanban">
      {Array.from({ length: columns }).map((_, c) => (
        <div className="kanban-col" key={c}>
          <div className="kanban-col-head">
            <SkeletonBar width={110} height={11} />
            <div style={{ marginTop: 6 }}>
              <SkeletonBar width={70} height={10} />
            </div>
          </div>
          {Array.from({ length: cards }).map((_, i) => (
            <div className="opp-card" key={i}>
              <SkeletonBar width="90%" height={13} />
              <div style={{ marginTop: 8 }}>
                <SkeletonBar width="65%" height={10} />
              </div>
              <div style={{ marginTop: 10 }}>
                <SkeletonBar width="45%" height={13} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ lines = 4, title = true }: { lines?: number; title?: boolean }) {
  return (
    <div className="panel">
      {title && (
        <div style={{ marginBottom: 14 }}>
          <SkeletonBar width={160} height={14} />
        </div>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonBar key={i} width={`${92 - i * 7}%`} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonForm({ fields = 8 }: { fields?: number }) {
  return (
    <div className="panel">
      <div className="form-grid">
        {Array.from({ length: fields }).map((_, i) => (
          <div className="field" key={i}>
            <SkeletonBar width={100} height={10} />
            <div style={{ marginTop: 8 }}>
              <SkeletonBar height={38} radius={11} />
            </div>
          </div>
        ))}
      </div>
      <div className="form-actions">
        <SkeletonBar width={120} height={36} radius={11} />
        <SkeletonBar width={90} height={36} radius={11} />
      </div>
    </div>
  );
}

/** A record screen: header, a facts panel, then two stacked panels. */
export function SkeletonDetail({ panels = 2 }: { panels?: number }) {
  return (
    <>
      <SkeletonPageHead actions={1} />
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div className="kpi" key={i}>
            <SkeletonBar width={80} height={10} />
            <div style={{ marginTop: 10 }}>
              <SkeletonBar width={130} height={18} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid" style={{ gap: 16 }}>
        {Array.from({ length: panels }).map((_, i) => (
          <SkeletonPanel key={i} lines={5} />
        ))}
      </div>
    </>
  );
}
