'use client';
import { useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { chapterLabel } from '@/lib/format';
import { t as tr } from '@/lib/i18n';
import type { Book, Series } from '@/lib/types';
import { Modal, msgOf } from './ConfirmDialog';
import VolumeRangeLookup from './VolumeRangeLookup';
import { Switch } from './Switch';
import ChapterGrouping from './ChapterGrouping';

const field = 'w-full min-w-0 rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm';
type Draft = { id: string; title: string; volume: boolean; vol: string; volEnd: string; first: string; last: string };
const seed = (b: Book): Draft => ({ id: b.id, title: b.metadata?.title ?? b.name, volume: b.volumeNumber != null,
  vol: String(b.volumeNumber ?? ''), volEnd: String(b.volumeNumberEnd ?? ''), first: String(b.number), last: String(b.numberEnd ?? b.number) });
const number = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100000;
const valid = (d: Draft) => d.title.length <= 300 && number(d.first) && (!d.volume || (number(d.vol) && Number(d.vol) > 0 && number(d.last)
  && Number(d.last) >= Number(d.first) && Number(d.last) - Number(d.first) <= 1000
  && (!d.volEnd.trim() || (number(d.volEnd) && Number(d.volEnd) >= Number(d.vol)))));

export default function ChapterManager({ series, books, listed, target, onClose, onSaved, onMark }: {
  series: Series; books: Book[]; listed: ReadonlyArray<{ number: number }>; target?: { bookId?: string; volume?: number };
  onClose: () => void; onSaved: () => void; onMark: (b: Book, mode: 'read' | 'unread') => Promise<void>;
}) {
  const [tab, setTab] = useState<'files' | 'lookup'>(target?.bookId ? 'lookup' : 'files');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [grouping, setGrouping] = useState<Book | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const byId = useMemo(() => new Map(books.map(b => [b.id, b])), [books]);
  const known = useMemo(() => new Set([...books, ...listed].map(b => Number(b.number.toFixed(3)))), [books, listed]);
  const kind = (b: Book) => b.volumeNumber != null ? 'volume' : Number.isInteger(b.number) ? 'chapter'
    : b.keepSeparate || (Math.round((b.number % 1) * 1000) === 500 && !known.has(Math.floor(b.number) + 0.4)) ? 'bonus' : 'part';
  const labels = { volume: tr('Volume'), chapter: tr('Chapter'), bonus: tr('Bonus chapter'), part: tr('Chapter part') };
  const filtered = books.filter(b => (filter === 'all' || kind(b) === filter || (filter === 'chapter' && kind(b) === 'bonus'))
    && `${b.name} ${b.metadata?.title ?? ''} ${chapterLabel(b)}`.toLowerCase().includes(search.toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const current = Math.min(page, pages - 1);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); onSaved(); return true; }
    catch (e) { setError(msgOf(e, tr('Could not save'))); return false; }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!draft || !valid(draft)) return;
    if (await act(() => api(`/api/admin/books/${draft.id}/meta`, { method: 'PUT', json: {
      title: draft.title, number: Number(draft.first), numberEnd: draft.volume ? Number(draft.last) : null,
      volumeNumber: draft.volume ? Number(draft.vol) : null,
      volumeNumberEnd: draft.volume && draft.volEnd.trim() ? Number(draft.volEnd) : null,
    } }))) setDraft(null);
  };
  const closeGrouping = () => {
    const id = grouping?.id;
    setGrouping(null);
    requestAnimationFrame(() => (document.getElementById(`grouping-${id}`) ?? searchRef.current)?.focus());
  };
  if (grouping) return <Modal wide title={tr('Change grouping for chapter {number}', { number: grouping.number })}
    onClose={() => { if (!busy) closeGrouping(); }} fieldFocus={false}>
    <ChapterGrouping book={grouping} known={known} busy={busy} error={error}
      onCancel={closeGrouping} onSave={async keepSeparate => {
        if (await act(() => api(`/api/admin/series/${series.id}/part-exception`, {
          method: 'PUT', json: { number: grouping.number, keepSeparate },
        }))) closeGrouping();
      }} />
  </Modal>;
  return <Modal wide="table" title={tr('Manage chapters')} onClose={() => { if (!busy) onClose(); }} fieldFocus={false}>
    <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={tr('Manage chapters')}>
      {(['files', 'lookup'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} disabled={busy || !!draft}
        className={`btn-key ${tab === t ? 'text-accent' : ''}`} onClick={() => setTab(t)}>{t === 'files' ? tr('Files') : tr('Look up chapter ranges')}</button>)}
    </div>
    {tab === 'lookup' ? <VolumeRangeLookup embedded seriesId={series.id} title={series.metadata?.title || series.name} target={target}
      onClose={() => setTab('files')} onSaved={onSaved} /> : <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input ref={searchRef} className={`${field} max-w-xs`} aria-label={tr('Search chapters')} placeholder={tr('Search chapters')} value={search}
          disabled={!!draft} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        <select className={`${field} max-w-36`} aria-label={tr('Show')} value={filter} disabled={!!draft}
          onChange={e => { setFilter(e.target.value); setPage(0); }}>
          <option value="all">{tr('All')}</option><option value="volume">{tr('Volumes')}</option>
          <option value="chapter">{tr('Chapters')}</option><option value="part">{tr('Parts')}</option>
        </select>
        <label className="ms-auto flex items-center gap-2 text-sm">
          {tr('Deduplicate split releases')}
          <Switch label={tr('Deduplicate split releases')} on={series.fullChapters === true} disabled={busy || !!draft}
            onChange={fullChapters => act(() => api(`/api/admin/series/${series.id}`, { method: 'PATCH', json: { fullChapters } })).then(() => {})} />
        </label>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
      <div className="overflow-x-auto" data-lenis-prevent-horizontal>
        <table className="w-full min-w-[760px] text-start text-sm" data-chapter-manager>
          <thead className="text-xs text-fog-400"><tr>{[tr('File'), tr('Type'), tr('Volume'), tr('Chapters'), tr('Reading list'), tr('Actions')].map(h => <th key={h} className="border-b border-ink-700 px-2 py-2 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>{filtered.slice(current * 50, current * 50 + 50).map(b => {
            const editing = draft?.id === b.id;
            const parent = b.alternateOf ? byId.get(b.alternateOf) : undefined;
            const change = (patch: Partial<Draft>) => setDraft(d => d ? { ...d, ...patch } : d);
            return <tr key={b.id} data-book-id={b.id} className="border-b border-ink-800 align-top [&>td]:px-2 [&>td]:py-2">
              <td className="max-w-64">{editing ? <input aria-label={tr('Title')} maxLength={300} className={field} value={draft.title} onChange={e => change({ title: e.target.value })} />
                : <span className="block truncate" title={b.name}>{b.metadata?.title || b.name}</span>}</td>
              <td>{editing ? <select aria-label={tr('Type')} className={field} value={draft.volume ? 'volume' : 'chapter'}
                onChange={e => change({ volume: e.target.value === 'volume' })}><option value="chapter">{tr('Chapter')}</option><option value="volume">{tr('Volume')}</option></select> : <>
                  <span className="block">{b.volumeNumber == null && b.keepSeparate ? tr('Separate chapter') : labels[kind(b)]}</span>
                  {b.volumeNumber == null && !Number.isInteger(b.number) && parent?.volumeNumber == null &&
                    <button type="button" id={`grouping-${b.id}`} className="mt-1 py-1 text-start text-xs text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
                      disabled={busy || !!draft} aria-label={tr('Change grouping for chapter {number}', { number: b.number })}
                      onClick={() => { setError(''); setGrouping(b); }}>{tr('Change grouping')}</button>}
                </>}</td>
              <td className="w-32">{editing && draft.volume ? <div className="flex gap-1">
                <input aria-label={tr('First volume')} inputMode="decimal" className={field} value={draft.vol} onChange={e => change({ vol: e.target.value })} />
                <input aria-label={tr('Last volume (omnibus only)')} inputMode="decimal" className={field} value={draft.volEnd} onChange={e => change({ volEnd: e.target.value })} />
              </div> : b.volumeNumber != null ? `${b.volumeNumber}${b.volumeNumberEnd != null ? `–${b.volumeNumberEnd}` : ''}` : '—'}</td>
              <td className="w-36">{editing ? <div className="flex gap-1">
                <input aria-label={tr('First chapter')} inputMode="decimal" className={field} value={draft.first} onChange={e => change({ first: e.target.value })} />
                {draft.volume && <input aria-label={tr('Last chapter')} inputMode="decimal" className={field} value={draft.last} onChange={e => change({ last: e.target.value })} />}
              </div> : `${b.number}${b.numberEnd != null ? `–${b.numberEnd}` : ''}`}</td>
              <td className="min-w-56 max-w-72 text-[13px] leading-relaxed text-fog-300">
                {parent?.volumeNumber != null
                  ? tr('Volume {number} covers this chapter, so it isn’t listed separately.', { number: `${parent.volumeNumber}${parent.volumeNumberEnd != null && parent.volumeNumberEnd > parent.volumeNumber ? `–${parent.volumeNumberEnd}` : ''}` })
                  : parent ? tr('Chapter {number} is shown instead of this part.', { number: parent.number })
                    : b.alternateOf ? tr('Not shown as a separate entry.') : tr('Shown in the reading list.')}
              </td>
              <td><div className="flex flex-wrap gap-1">
                {editing ? <><button className="btn-key" disabled={busy || !valid(draft)} onClick={() => void save()}>{tr('Save')}</button>
                  <button className="btn-key" disabled={busy} onClick={() => setDraft(null)}>{tr('Cancel')}</button></> : <>
                  <button className="btn-key" disabled={busy || !!draft} onClick={() => setDraft(seed(b))}>{tr('Edit')}</button>
                  <button className="btn-key" disabled={busy || !!draft} onClick={() => void act(() => onMark(b, b.readProgress?.completed ? 'unread' : 'read'))}>
                    {b.readProgress?.completed ? tr('Mark unread') : tr('Mark read')}</button>
                </>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!filtered.length && <p className="py-4 text-sm text-fog-400">{tr('No matching chapters')}</p>}
      {pages > 1 && <div className="mt-3 flex items-center justify-end gap-3 text-sm">
        <button className="btn-key" disabled={current === 0 || !!draft} onClick={() => setPage(current - 1)}>{tr('Previous')}</button>
        <span>{current + 1} / {pages}</span><button className="btn-key" disabled={current + 1 >= pages || !!draft} onClick={() => setPage(current + 1)}>{tr('Next')}</button>
      </div>}
    </>}
  </Modal>;
}
