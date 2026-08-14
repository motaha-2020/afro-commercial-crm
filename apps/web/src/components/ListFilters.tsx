'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export type FilterField =
  | { kind: 'search'; name: string; placeholder: string; label: string }
  | {
      kind: 'select';
      name: string;
      label: string;
      anyLabel: string;
      options: { value: string; label: string }[];
    }
  | { kind: 'toggle'; name: string; label: string };

const DEBOUNCE_MS = 300;

/**
 * One filter bar for every list screen, so they cannot drift apart.
 *
 * Typing filters as you type; picking from a dropdown filters at once. The two
 * are deliberately different: a keystroke is not a decision, and firing a
 * request per letter would send five throwaway queries for a six-letter word —
 * and on a slow link they can land out of order, leaving the results for "Ora"
 * sitting on top of the results for "Orange".
 *
 * The URL stays the single source of truth, so a filtered list is still
 * something you can bookmark and send to somebody else.
 */
export function ListFilters({
  basePath,
  fields,
  values,
}: {
  basePath: string;
  fields: FilterField[];
  values: Record<string, string>;
}) {
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(values);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The URL is the truth. When it changes underneath us — the Clear link, the
  // back button — the inputs follow it rather than keeping what was typed.
  useEffect(() => {
    setDraft(values);
  }, [values]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function apply(next: Record<string, string>) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) query.set(k, v);
    // replace, not push: one entry per keystroke would turn the back button
    // into a walk through every letter somebody typed.
    startTransition(() => {
      router.replace(query.toString() ? `${basePath}?${query}` : basePath);
    });
  }

  function onType(name: string, value: string) {
    const next = { ...draft, [name]: value };
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(next), DEBOUNCE_MS);
  }

  function onPick(name: string, value: string) {
    const next = { ...draft, [name]: value };
    setDraft(next);
    // A pending keystroke would otherwise land after this and undo it.
    if (timer.current) clearTimeout(timer.current);
    apply(next);
  }

  const dirty = fields.some((f) => draft[f.name]);

  return (
    // Still a real form: without JavaScript the button submits it as a GET and
    // the screen filters exactly the same way.
    <form
      className="panel list-filters"
      method="get"
      action={basePath}
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        apply(draft);
      }}
    >
      {fields.map((field) => {
        if (field.kind === 'search') {
          return (
            <input
              key={field.name}
              type="search"
              name={field.name}
              value={draft[field.name] ?? ''}
              placeholder={field.placeholder}
              aria-label={field.label}
              onChange={(e) => onType(field.name, e.target.value)}
            />
          );
        }
        if (field.kind === 'toggle') {
          return (
            <label className="check" key={field.name}>
              <input
                type="checkbox"
                name={field.name}
                value="true"
                checked={draft[field.name] === 'true'}
                onChange={(e) => onPick(field.name, e.target.checked ? 'true' : '')}
              />
              {field.label}
            </label>
          );
        }
        return (
          <select
            key={field.name}
            name={field.name}
            value={draft[field.name] ?? ''}
            aria-label={field.label}
            onChange={(e) => onPick(field.name, e.target.value)}
          >
            <option value="">{field.anyLabel}</option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      })}

      <button type="submit" className="btn btn-primary">
        {t('filter')}
      </button>

      {dirty && (
        <button type="button" className="btn" onClick={() => apply({})}>
          {t('clear')}
        </button>
      )}

      {/* Said out loud, because a list that is about to change while you read
          it is worse than one that admits it is still working. */}
      <span className="filter-status" aria-live="polite">
        {pending ? t('filtering') : ''}
      </span>
    </form>
  );
}
