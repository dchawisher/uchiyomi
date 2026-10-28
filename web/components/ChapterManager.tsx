'use client';
import { useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { chapterLabel } from '@/lib/format';
import { t as tr } from '@/lib/i18n';
import type { Book, Series } from '@/lib/types';
import { Modal, msgOf } from './ConfirmDialog';
import VolumeRangeLookup from './VolumeRangeLookup';
import ChapterGrouping from './ChapterGrouping';
import ChapterGroupingSettings from './ChapterGroupingSettings';
import { chapterTree, filterChapterTree, type ChapterNode } from '@/lib/chapterTree';
import { useContextMenu, type MenuItem } from './ContextMenu';

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
  const [tab, setTab] = useState<'files' | 'settings' | 'lookup'>(target?.bookId ? 'lookup' : 'files');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [grouping, setGrouping] = useState<Book | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const menuBook = useRef<Book | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const byId = useMemo(() => new Map(books.map(b => [b.id, b])), [books]);
  const known = useMemo(() => new Set([...books, ...listed].map(b => Number(b.number.toFixed(3)))), [books, listed]);
  const tree = useMemo(() => chapterTree(books, known), [books, known]);
  const filtered = useMemo(() => filterChapterTree(tree, node => !!node.book
    && (filter === 'all' || node.kind === filter || (filter === 'chapter' && node.kind === 'bonus'))
    && `${node.book.name} ${node.book.metadata?.title ?? ''} ${chapterLabel(node.book)}`.toLowerCase().includes(search.toLowerCase())), [tree, filter, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const current = Math.min(page, pages - 1);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); onSaved(); return true; }
    catch (e) { setError(msgOf(e, tr('Could not save'))); return false; }
    finally { setBusy(false); }
  };
  const closeDraft = () => {
    const id = draft?.id;
    setDraft(null);
    requestAnimationFrame(() => (document.getElementById(`actions-${id}`) ?? searchRef.current)?.focus());
  };
  const save = async () => {
    if (!draft || !valid(draft)) return;
    if (await act(() => api(`/api/admin/books/${draft.id}/meta`, { method: 'PUT', json: {
      title: draft.title, number: Number(draft.first), numberEnd: draft.volume ? Number(draft.last) : null,
      volumeNumber: draft.volume ? Number(draft.vol) : null,
      volumeNumberEnd: draft.volume && draft.volEnd.trim() ? Number(draft.volEnd) : null,
    } }))) closeDraft();
  };
  const closeGrouping = () => {
    const id = grouping?.id;
    setGrouping(null);
    requestAnimationFrame(() => (document.getElementById(`actions-${id}`) ?? searchRef.current)?.focus());
  };
  const menu = useContextMenu(() => {
    const b = menuBook.current;
    if (!b) return [];
    const items: MenuItem[] = [
      { label: tr('Edit'), disabled: busy, onSelect: () => { setError(''); setDraft(seed(b)); } },
      { label: b.readProgress?.completed ? tr('Mark unread') : tr('Mark read'), disabled: busy,
        onSelect: async () => { await act(() => onMark(b, b.readProgress?.completed ? 'unread' : 'read')); } },
    ];
    const parent = b.alternateOf ? byId.get(b.alternateOf) : undefined;
    if (b.volumeNumber == null) {
      items.push({ label: tr('Change grouping'), disabled: busy, onSelect: () => { setError(''); setGrouping(b); } });
    }
    return items;
  }, { label: tr('Actions') });
  if (grouping) return <Modal wide title={tr('Change grouping for chapter {number}', { number: grouping.number })}
    onClose={() => { if (!busy) closeGrouping(); }} fieldFocus={false}>
    <ChapterGrouping book={grouping} busy={busy} error={error}
      onCancel={closeGrouping} onSave={async choice => {
        if (await act(() => api(`/api/admin/series/${series.id}/chapter-grouping`, {
          method: 'PUT', json: { number: grouping.number, ...choice },
        }))) closeGrouping();
      }} />
  </Modal>;
  if (draft) return <Modal wide title={tr('Edit chapter or volume')} onClose={() => { if (!busy) closeDraft(); }}>
    <form onSubmit={e => { e.preventDefault(); if (!busy) void save(); }}>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">{tr('Title')}<input autoFocus maxLength={300} className={`${field} mt-1`} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="text-sm sm:col-span-2">{tr('File contains')}
          <select className={`${field} mt-1`} value={draft.volume ? 'volume' : 'chapter'} onChange={e => setDraft({ ...draft, volume: e.target.value === 'volume' })}>
            <option value="chapter">{tr('Chapter')}</option><option value="volume">{tr('Volume')}</option>
          </select>
        </label>
        {draft.volume && <>
          <label className="text-sm">{tr('First volume')}<input inputMode="decimal" className={`${field} mt-1`} value={draft.vol} onChange={e => setDraft({ ...draft, vol: e.target.value })} /></label>
          <label className="text-sm">{tr('Last volume (omnibus only)')}<input inputMode="decimal" className={`${field} mt-1`} value={draft.volEnd} onChange={e => setDraft({ ...draft, volEnd: e.target.value })} /></label>
        </>}
        <label className="text-sm">{tr('First chapter')}<input inputMode="decimal" className={`${field} mt-1`} value={draft.first} onChange={e => setDraft({ ...draft, first: e.target.value })} /></label>
        {draft.volume && <label className="text-sm">{tr('Last chapter')}<input inputMode="decimal" className={`${field} mt-1`} value={draft.last} onChange={e => setDraft({ ...draft, last: e.target.value })} /></label>}
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-key" disabled={busy} onClick={closeDraft}>{tr('Cancel')}</button>
        <button type="submit" className="btn-key btn-key-primary" disabled={busy || !valid(draft)}>{tr('Save')}</button>
      </div>
    </form>
  </Modal>;
  const nodeTitle = (node: ChapterNode) => node.kind === 'volume'
    ? tr('Volume {number}', { number: `${node.book!.volumeNumber}${node.book!.volumeNumberEnd != null && node.book!.volumeNumberEnd > node.book!.volumeNumber! ? `–${node.book!.volumeNumberEnd}` : ''}` })
    : node.book?.grouping?.role === 'first' ? tr('Part 1 (listed as {number})', { number: node.number })
      : node.kind === 'part' ? tr('Part {number}', { number: node.number })
      : node.kind === 'bonus' ? node.book?.keepSeparate || node.book?.grouping?.manual ? tr('Chapter {number}', { number: node.number }) : tr('Bonus chapter {number}', { number: node.number })
        : tr('Chapter {number}', { number: node.number });
  const renderNodes = (nodes: ChapterNode[], nested = false) => <ul className={nested ? 'ms-3 sm:ms-4' : ''}>
    {nodes.map(node => {
      const b = node.book;
      const parent = b?.alternateOf ? byId.get(b.alternateOf) : undefined;
      const open = !collapsed.has(node.id) || !!search || filter !== 'all';
      const title = nodeTitle(node);
      return <li key={node.id} data-node-id={node.id}
        className={nested ? 'relative ps-5 before:absolute before:start-0 before:top-0 before:bottom-0 before:border-s before:border-fog-500 last:before:bottom-auto last:before:h-7' : ''}>
        {nested && <span aria-hidden="true" className="absolute start-0 top-7 w-4 border-t border-fog-500" />}
        <div data-book-id={b?.id} className="min-w-0 border-b border-ink-800 py-3">
          <div className="flex min-w-0 items-start gap-2">
            {node.children.length > 0 && <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fog-200 hover:bg-ink-800"
              aria-label={open ? tr('Collapse {name}', { name: title }) : tr('Expand {name}', { name: title })}
              aria-expanded={open} aria-controls={`children-${node.id}`} disabled={busy || !!search || filter !== 'all'}
              onClick={() => setCollapsed(prev => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}>
              <span aria-hidden="true">{open ? '▾' : '▸'}</span>
            </button>}
            <div className="min-w-0 flex-1">
              <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-fog-100" title={b?.name}>{title}</span>
                {b && b.media.pagesCount > 0 && <span className="text-xs text-fog-400">{b.media.pagesCount === 1 ? tr('1 page') : tr('{n} pages', { n: b.media.pagesCount })}</span>}
              </div>
              {b?.volumeNumber != null && <p className="text-sm text-fog-300">{tr('Chapters {range}', { range: `${b.number}${b.numberEnd != null && b.numberEnd > b.number ? `–${b.numberEnd}` : ''}` })}</p>}
              {b ? <>
                {b.chapterName && <p className="text-sm text-fog-300">{b.chapterName}</p>}
                <p data-reading-status className="mt-1 text-sm leading-relaxed text-fog-300">
                  {parent?.volumeNumber != null
                    ? tr('Volume {number} covers this chapter, so it isn’t listed separately.', { number: `${parent.volumeNumber}${parent.volumeNumberEnd != null && parent.volumeNumberEnd > parent.volumeNumber ? `–${parent.volumeNumberEnd}` : ''}` })
                    : parent ? tr('Chapter {number} is shown instead of this part.', { number: parent.number })
                      : b.alternateOf ? tr('Not shown as a separate entry.') : tr('Shown in the reading list.')}
                </p>
              </> : <p className="text-sm text-fog-400">{tr('Parts are grouped here by chapter number.')}</p>}
            </div>
            {b && <button id={`actions-${b.id}`} type="button" className="btn-key shrink-0" disabled={busy}
              aria-haspopup="menu" aria-label={tr('Actions for {name}', { name: title })}
              onClick={e => { menuBook.current = b; menu.openFrom(e.currentTarget); }}>⋯</button>}
          </div>
        </div>
        {node.children.length > 0 && <div id={`children-${node.id}`} hidden={!open}>{renderNodes(node.children, true)}</div>}
      </li>;
    })}
  </ul>;
  return <Modal wide="table" title={tr('Manage chapters')} onClose={() => { if (!busy) onClose(); }} fieldFocus={false}>
    {menu.element}
    <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={tr('Manage chapters')}>
      {(['files', 'settings', 'lookup'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} disabled={busy || !!draft}
        className={`btn-key ${tab === t ? 'text-accent' : ''}`} onClick={() => setTab(t)}>{t === 'files' ? tr('Files') : t === 'settings' ? tr('Grouping settings') : tr('Look up chapter ranges')}</button>)}
    </div>
    {tab === 'lookup' ? <VolumeRangeLookup embedded seriesId={series.id} title={series.metadata?.title || series.name} target={target}
      onClose={() => setTab('files')} onSaved={onSaved} /> : tab === 'settings' ? <>
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
      <ChapterGroupingSettings series={series} busy={busy} onBusy={setBusy} onSaved={onSaved}
        onChange={partDetection => act(() => api(`/api/admin/series/${series.id}`, {method:'PATCH',json:{partDetection}}))} />
    </> : <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input ref={searchRef} className={`${field} max-w-xs`} aria-label={tr('Search chapters')} placeholder={tr('Search chapters')} value={search}
          disabled={!!draft} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        <select className={`${field} max-w-36`} aria-label={tr('Show')} value={filter} disabled={!!draft}
          onChange={e => { setFilter(e.target.value); setPage(0); }}>
          <option value="all">{tr('All')}</option><option value="volume">{tr('Volumes')}</option>
          <option value="chapter">{tr('Chapters')}</option><option value="part">{tr('Parts')}</option>
        </select>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
      <div className="mb-2 flex gap-2 text-sm">
        <button className="btn-key" disabled={busy || !!search || filter !== 'all'} onClick={() => setCollapsed(new Set())}>{tr('Expand all')}</button>
        <button className="btn-key" disabled={busy || !!search || filter !== 'all'} onClick={() => {
          const ids = new Set<string>();
          const collect = (nodes: ChapterNode[]) => nodes.forEach(n => { if (n.children.length) ids.add(n.id); collect(n.children); });
          collect(tree); setCollapsed(ids);
        }}>{tr('Collapse all')}</button>
      </div>
      <div data-chapter-manager aria-label={tr('Volumes, chapters and parts')}>
        {renderNodes(filtered.slice(current * 50, current * 50 + 50))}
      </div>
      {!filtered.length && <p className="py-4 text-sm text-fog-400">{tr('No matching chapters')}</p>}
      {pages > 1 && <div className="mt-3 flex items-center justify-end gap-3 text-sm">
        <button className="btn-key" disabled={current === 0 || !!draft} onClick={() => setPage(current - 1)}>{tr('Previous')}</button>
        <span>{current + 1} / {pages}</span><button className="btn-key" disabled={current + 1 >= pages || !!draft} onClick={() => setPage(current + 1)}>{tr('Next')}</button>
      </div>}
    </>}
  </Modal>;
}
