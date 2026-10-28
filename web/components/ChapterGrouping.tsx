'use client';
import { useState } from 'react';
import type { Book } from '@/lib/types';
import { t as tr } from '@/lib/i18n';

/** A numbering exception is separate from whether the file is currently in the reading list. */
export default function ChapterGrouping({ book, known, busy, error, onSave, onCancel }: {
  book: Book; known: ReadonlySet<number>; busy: boolean; error: string;
  onSave: (keepSeparate: boolean) => Promise<void>; onCancel: () => void;
}) {
  const [separate, setSeparate] = useState(!!book.keepSeparate);
  const whole = Math.floor(book.number);
  const bonus = Math.round((book.number % 1) * 1000) === 500 && !known.has(whole + 0.4);
  return <form onSubmit={e => { e.preventDefault(); if (!busy) void onSave(separate); }}>
    <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-3 text-sm leading-relaxed text-fog-200">
        {tr('Choose whether chapter {number} follows the usual numbering rules or should always be treated as a separate chapter.', { number: book.number })}
      </legend>
      <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${!separate ? 'border-accent bg-accent-soft' : 'border-ink-700'}`}>
        <input type="radio" name="chapter-grouping" autoFocus={!book.keepSeparate} checked={!separate} onChange={() => setSeparate(false)} className="mt-1 shrink-0 accent-[rgb(var(--accent))]" />
        <span>
          <span className="block text-sm font-medium">{tr('Follow the chapter numbering')}</span>
          <span className="mt-1 block text-sm leading-relaxed text-fog-300">{bonus
            ? tr('Chapter {number} is treated as a bonus chapter because no chapter {previous} is listed.', { number: book.number, previous: whole + 0.4 })
            : tr('Chapter {number} is treated as part of chapter {whole}.', { number: book.number, whole })}</span>
          {!bonus && <span className="mt-2 block text-sm leading-relaxed text-fog-300">
            {tr('When split-chapter grouping is on and you have the full chapter, the full chapter is shown in the reading list instead. Otherwise, this part is shown on its own.')}
          </span>}
        </span>
      </label>
      <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${separate ? 'border-accent bg-accent-soft' : 'border-ink-700'}`}>
        <input type="radio" name="chapter-grouping" autoFocus={!!book.keepSeparate} checked={separate} onChange={() => setSeparate(true)} className="mt-1 shrink-0 accent-[rgb(var(--accent))]" />
        <span>
          <span className="block text-sm font-medium">{tr('Treat this as a separate chapter')}</span>
          <span className="mt-1 block text-sm leading-relaxed text-fog-300">
            {tr('Use this for a bonus or extra chapter. Chapter {number} will stay in the reading list even when you have chapter {whole}.', { number: book.number, whole })}
          </span>
        </span>
      </label>
    </fieldset>
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" className="btn-key" disabled={busy} onClick={onCancel}>{tr('Cancel')}</button>
      <button type="submit" className="btn-key btn-key-primary" disabled={busy}>{tr('Save')}</button>
    </div>
  </form>;
}
