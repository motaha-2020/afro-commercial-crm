'use client';

import { useLocale } from 'next-intl';
import Link from 'next/link';

/**
 * Renders an assistant answer as the structures it actually contains.
 *
 * The agents answer with Markdown tables by instruction — a list longer than
 * two rows is supposed to be a table — and printing that as preformatted text
 * shows the reader a wall of pipes and dashes. This turns the few constructs
 * the agents actually emit into real elements, and leaves everything else as
 * plain text.
 *
 * Deliberately not a full Markdown parser: a general one would render whatever
 * the model wrote, including links to anywhere. The only links here are ones
 * this component builds from record codes it recognises.
 */

/** ACMS record codes: OPP-2026-000289, ACC-000114. */
const CODE = /\b([A-Z]{2,5}-\d{4}-\d{3,}|[A-Z]{2,5}-\d{4,})\b/g;

/** Which list screen a code belongs to, so a mention can become a link. */
const ROUTE_BY_PREFIX: Record<string, string> = {
  OPP: 'opportunities',
  ACC: 'accounts',
  QUO: 'quotations',
  LEA: 'leads',
};

export function AiAnswer({ text }: { text: string }) {
  const blocks = splitBlocks(text);

  return (
    <div className="ai-answer">
      {blocks.map((block, i) =>
        block.type === 'table' ? (
          <AnswerTable key={i} rows={block.rows} />
        ) : (
          <p key={i}>
            <Inline text={block.text} />
          </p>
        ),
      )}
    </div>
  );
}

function AnswerTable({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    // Wide tables scroll inside their own box; the panel is narrow and the
    // page must not scroll sideways because an answer had nine columns.
    <div className="ai-table-scroll">
      <table className="ai-table">
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i}>
                <Inline text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Turns record codes into links to their screen, and **bold** into bold. */
function Inline({ text }: { text: string }) {
  const locale = useLocale();
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  const stripped = text.replace(/\*\*(.+?)\*\*/g, '$1');

  for (const match of stripped.matchAll(CODE)) {
    const code = match[0];
    const at = match.index ?? 0;
    if (at > cursor) parts.push(stripped.slice(cursor, at));

    const route = ROUTE_BY_PREFIX[code.split('-')[0]];
    parts.push(
      route ? (
        // The code is the reader's handle on the record, so make it one:
        // searching the list screen for it lands on the row.
        <Link key={`${code}-${at}`} href={`/${locale}/${route}?search=${code}`} className="ai-code">
          {code}
        </Link>
      ) : (
        <span key={`${code}-${at}`} className="ai-code">
          {code}
        </span>
      ),
    );
    cursor = at + code.length;
  }

  if (cursor < stripped.length) parts.push(stripped.slice(cursor));
  return <>{parts}</>;
}

type Block = { type: 'text'; text: string } | { type: 'table'; rows: string[][] };

/**
 * Splits the answer into paragraphs and Markdown tables.
 *
 * A table is two or more consecutive pipe-delimited lines. The separator row
 * (`|---|---|`) is dropped rather than rendered, which is exactly what made
 * the raw output unreadable.
 */
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let table: string[][] = [];

  const flushParagraph = () => {
    const joined = paragraph.join('\n').trim();
    if (joined) blocks.push({ type: 'text', text: joined });
    paragraph = [];
  };
  const flushTable = () => {
    if (table.length >= 2) blocks.push({ type: 'table', rows: table });
    else if (table.length === 1) blocks.push({ type: 'text', text: table[0].join(' | ') });
    table = [];
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const isRow = trimmed.startsWith('|') && trimmed.slice(1).includes('|');

    if (isRow) {
      flushParagraph();
      const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
      // The dashes-only row carries no content; it exists to mark the header.
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) table.push(cells);
    } else {
      flushTable();
      paragraph.push(line);
    }
  }

  flushTable();
  flushParagraph();
  return blocks;
}
