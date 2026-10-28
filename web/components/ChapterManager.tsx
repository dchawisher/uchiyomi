'use client';
import { Fragment, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t as tr } from '@/lib/i18n';
import type { Book, Series } from '@/lib/types';
import { Modal, msgOf } from './ConfirmDialog';
import VolumeRangeLookup from './VolumeRangeLookup';
import ChapterGrouping from './ChapterGrouping';
import ChapterGroupingSettings from './ChapterGroupingSettings';
import { chapterTree, filterChapterTree, type ChapterNode, type ChapterTreeEntry } from '@/lib/chapterTree';

type SourceChapter = ChapterTreeEntry & {
  name:string; pagesCount:number|null; status:string;
  coveredBy:{kind:'volume'|'chapter';number:number;end?:number|null}|null;
};
type Entry = ChapterTreeEntry & {name:string; chapterName?:string|null; pagesCount:number|null; remote?:SourceChapter};
type Node = ChapterNode<Entry>;
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
  const [grouping, setGrouping] = useState<Entry | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const queryKey = ['chapter-management', series.id];
  const sources = useQuery({queryKey, queryFn:()=>api<{content:SourceChapter[]}>(`/api/admin/series/${series.id}/chapter-grouping`)});
  const changed = () => { void qc.invalidateQueries({queryKey}); onSaved(); };
  const entries = useMemo<Entry[]>(()=>{
    const localNumbers=new Set(books.filter(b=>b.volumeNumber==null&&b.numberEnd==null).map(b=>Number(b.number.toFixed(3))));
    return [...books.map(b=>({...b,pagesCount:b.media.pagesCount})),
      ...(sources.data?.content??[]).filter(r=>!localNumbers.has(Number(r.number.toFixed(3)))).map(r=>({...r,chapterName:r.name,remote:r}))];
  },[books,sources.data]);
  const byId = useMemo(() => new Map(books.map(b => [b.id, b])), [books]);
  const known = useMemo(() => new Set([...entries, ...listed].map(b => Number(b.number.toFixed(3)))), [entries, listed]);
  const tree = useMemo(() => chapterTree(entries, known), [entries, known]);
  const filtered = useMemo(() => filterChapterTree(tree, node => !!node.book
    && (filter === 'all' || node.kind === filter || (filter === 'chapter' && node.kind === 'bonus'))
    && `${node.book.name} ${node.book.chapterName ?? ''} ${node.number} ${node.book.volumeNumber ?? ''}`.toLowerCase().includes(search.toLowerCase())), [tree, filter, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const current = Math.min(page, pages - 1);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); changed(); return true; }
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
    requestAnimationFrame(() => (document.getElementById(`grouping-${id}`) ?? searchRef.current)?.focus());
  };
  if (grouping) return <Modal wide title={tr('Change grouping for chapter {number}', { number: grouping.number })}
    onClose={() => { if (!busy) closeGrouping(); }} fieldFocus={false}>
    <ChapterGrouping book={grouping} busy={busy} error={error}
      onCancel={closeGrouping} onSave={async choice => {
        if (await act(() => api(`/api/admin/series/${series.id}/chapter-grouping`, {
          method: 'PUT', json: { number: grouping.number, ...choice },
        }))) closeGrouping();
      }} />
  </Modal>;
  const nodeTitle = (node: Node) => node.kind === 'volume'
    ? tr('Volume {number}', { number: `${node.book!.volumeNumber}${node.book!.volumeNumberEnd != null && node.book!.volumeNumberEnd > node.book!.volumeNumber! ? `–${node.book!.volumeNumberEnd}` : ''}` })
    : node.book?.grouping?.role === 'first' ? tr('Part 1 (listed as {number})', { number: node.number })
      : node.kind === 'part' ? tr('Part {number}', { number: node.number })
      : node.kind === 'bonus' ? node.book?.keepSeparate || node.book?.grouping?.manual ? tr('Chapter {number}', { number: node.number }) : tr('Bonus chapter {number}', { number: node.number })
        : tr('Chapter {number}', { number: node.number });
  const statusOf = (node:Node, parent?:Book) => {
    const b=node.book;
    if(!b) return '';
    const cover=b.remote?.coveredBy ?? (parent ? {kind:parent.volumeNumber!=null?'volume':'chapter',number:parent.volumeNumber??parent.number} : null);
    if(b.remote&&cover?.kind==='chapter'&&!books.some(file=>file.number===cover.number&&file.volumeNumber==null&&!file.pruned&&!file.missingPages?.length))
      return tr('Download chapter {number} instead',{number:cover.number});
    if(cover) return cover.kind==='volume' ? tr('Covered by volume {number}',{number:cover.number}) : tr('Covered by chapter {number}',{number:cover.number});
    if(!b.remote) return byId.get(b.id)?.pruned ? tr('File removed') : tr('On server');
    if(b.remote.status==='available') return tr('Available to download');
    if(b.remote.status==='blocked') return tr('Source blocked');
    if(b.remote.status==='held') return tr('Waiting for preferred release');
    if(b.remote.status==='ignored') return tr('Excluded from downloads');
    return tr('Not selected for download');
  };
  const renderNodes = (nodes:Node[], ancestors:boolean[]=[], nested=false):React.ReactNode => nodes.map((node,index)=>{
    const b=node.book,local=b?byId.get(b.id):undefined;
    const parent=b?.alternateOf?byId.get(b.alternateOf):undefined;
    const last=index===nodes.length-1;
    const prefix=nested?ancestors.map(end=>end?'  ':'│ ').join('')+(last?'└─':'├─'):'';
    const open=!collapsed.has(node.id)||!!search||filter!=='all';
    const title=nodeTitle(node);
    const editing=!!b&&draft?.id===b.id;
    const change=(patch:Partial<Draft>)=>setDraft(d=>d?{...d,...patch}:d);
    const kindLabel=node.kind==='volume'?tr('Volume'):node.kind==='part'?tr('Part'):node.kind==='bonus'?tr('Extra'):tr('Chapter');
    return <Fragment key={node.id}>
      <tr data-node-id={node.id} data-book-id={b?.id} data-remote={!!b?.remote} className="border-b border-ink-800 [&>td]:px-2 [&>td]:py-1">
        <td><div className="flex min-h-7 min-w-0 items-center">
          <span aria-hidden="true" className="shrink-0 whitespace-pre font-mono text-base leading-none text-fog-500">{prefix}</span>
          {node.children.length>0?<button type="button" className="h-7 w-6 shrink-0 rounded text-fog-300 hover:bg-ink-800"
            aria-label={open?tr('Collapse {name}',{name:title}):tr('Expand {name}',{name:title})} aria-expanded={open}
            disabled={busy||!!draft||!!search||filter!=='all'} onClick={()=>setCollapsed(prev=>{const next=new Set(prev);if(next.has(node.id))next.delete(node.id);else next.add(node.id);return next;})}>{open?'▾':'▸'}</button>:<span className="w-6 shrink-0"/>}
          {editing?<input aria-label={tr('Title')} className={field} maxLength={300} value={draft.title} onChange={e=>change({title:e.target.value})}/>
            :<span className="min-w-0 truncate" title={b?.name||title}>{b?.name||title}</span>}
        </div></td>
        <td>{editing?<select aria-label={tr('Type')} className={field} value={draft.volume?'volume':'chapter'} onChange={e=>change({volume:e.target.value==='volume'})}><option value="chapter">{tr('Chapter')}</option><option value="volume">{tr('Volume')}</option></select>:kindLabel}</td>
        <td>{editing&&draft.volume?<div className="flex gap-1"><input aria-label={tr('First volume')} inputMode="decimal" className={field} value={draft.vol} onChange={e=>change({vol:e.target.value})}/><input aria-label={tr('Last volume (omnibus only)')} inputMode="decimal" className={field} value={draft.volEnd} onChange={e=>change({volEnd:e.target.value})}/></div>
          :b?.volumeNumber!=null?`${b.volumeNumber}${b.volumeNumberEnd!=null&&b.volumeNumberEnd>b.volumeNumber?'–'+b.volumeNumberEnd:''}`:'—'}</td>
        <td className="tabular-nums">{editing?<div className="flex gap-1"><input aria-label={tr('First chapter')} inputMode="decimal" className={field} value={draft.first} onChange={e=>change({first:e.target.value})}/>{draft.volume&&<input aria-label={tr('Last chapter')} inputMode="decimal" className={field} value={draft.last} onChange={e=>change({last:e.target.value})}/>}</div>
          :`${node.number}${b?.numberEnd!=null&&b.numberEnd>node.number?'–'+b.numberEnd:''}`}</td>
        <td className="tabular-nums text-fog-400">{b?b.pagesCount||'—':''}</td>
        <td data-reading-status className="text-xs text-fog-300">{statusOf(node,parent)}</td>
        <td><div className="flex items-center gap-2 whitespace-nowrap text-xs">
          {editing?<><button className="btn-key" disabled={busy||!valid(draft)} onClick={()=>void save()}>{tr('Save')}</button><button className="btn-key" disabled={busy} onClick={closeDraft}>{tr('Cancel')}</button></>
            :<>{local&&<><button id={`actions-${local.id}`} className="py-1 text-accent hover:underline" disabled={busy||!!draft} onClick={()=>setDraft(seed(local))}>{tr('Edit')}</button>
              <button className="py-1 text-accent hover:underline" disabled={busy||!!draft} onClick={()=>void act(()=>onMark(local,local.readProgress?.completed?'unread':'read'))}>{local.readProgress?.completed?tr('Mark unread'):tr('Mark read')}</button></>}
              {b&&b.volumeNumber==null&&<button id={`grouping-${b.id}`} className="py-1 text-accent hover:underline" disabled={busy||!!draft} aria-label={tr('Change grouping for chapter {number}',{number:b.number})} onClick={()=>{setError('');setGrouping(b);}}>{tr('Change grouping')}</button>}
              {b?.grouping?.manual&&<span className="text-accent" title={tr('Manual choices stay in place until you change them.')}>{tr('Manual')}</span>}
            </>}
        </div></td>
      </tr>
      {open&&node.children.length>0&&renderNodes(node.children,nested?[...ancestors,last]:[],true)}
    </Fragment>;
  });
  return <Modal wide="manager" title={tr('Manage chapters')} onClose={() => { if (!busy) onClose(); }} fieldFocus={false}>
    <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={tr('Manage chapters')}>
      {(['files', 'settings', 'lookup'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} disabled={busy || !!draft}
        className={`btn-key ${tab === t ? 'text-accent' : ''}`} onClick={() => setTab(t)}>{t === 'files' ? tr('Chapters') : t === 'settings' ? tr('Grouping settings') : tr('Look up chapter ranges')}</button>)}
    </div>
    {tab === 'lookup' ? <VolumeRangeLookup embedded seriesId={series.id} title={series.metadata?.title || series.name} target={target}
      onClose={() => setTab('files')} onSaved={changed} /> : tab === 'settings' ? <>
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
      <ChapterGroupingSettings series={series} busy={busy} onBusy={setBusy} onSaved={changed}
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
          const collect = (nodes: Node[]) => nodes.forEach(n => { if (n.children.length) ids.add(n.id); collect(n.children); });
          collect(tree); setCollapsed(ids);
        }}>{tr('Collapse all')}</button>
      </div>
      {sources.isLoading && <p role="status" className="py-2 text-sm text-fog-400">{tr('Loading source chapters…')}</p>}
      {sources.isError && <p role="alert" className="py-2 text-sm text-red-300">{tr('Could not load source chapters.')} <button className="underline" onClick={()=>void sources.refetch()}>{tr('Retry')}</button></p>}
      <div className="overflow-x-auto" data-lenis-prevent-horizontal>
        <table className="w-full min-w-[1080px] table-fixed text-sm" data-chapter-manager aria-label={tr('Volumes, chapters and parts')}>
          <colgroup><col/><col className="w-24"/><col className="w-24"/><col className="w-28"/><col className="w-16"/><col className="w-52"/><col className="w-64"/></colgroup>
          <thead className="text-xs text-fog-400"><tr>{[tr('File / source chapter'),tr('Type'),tr('Volume'),tr('Chapters'),tr('Pages'),tr('Availability'),tr('Actions')].map(h=><th key={h} className="border-b border-ink-700 px-2 py-2 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>{renderNodes(filtered.slice(current * 50, current * 50 + 50))}</tbody>
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
